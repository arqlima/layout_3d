from django.urls import reverse, reverse_lazy
from projects3d.forms import ProjectCreateForm, ProjectUpdateForm
from projects3d.models import Project
from django.views.generic import ListView, DetailView, CreateView, UpdateView, DeleteView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse, FileResponse
from django.middleware.csrf import get_token
from django.views import View
import io
import json
from django.core.exceptions import ValidationError
from django.templatetags.static import static
from projects3d.object_data import read_object_csv
from functools import cached_property
import logging
from django.db import DatabaseError
from django.shortcuts import get_object_or_404, redirect
from django.views.generic import FormView
from projects3d.forms import ProjectFolderForm
from projects3d.folder_import import save_folder
from projects3d.viewer_assets import viewer_asset_url

logger = logging.getLogger(__name__)

# Create your views here.
class ProjectListView(LoginRequiredMixin,ListView):
    model = Project
    template_name = 'projects3d/project_list.html'
    context_object_name = 'projects'
    paginate_by = 9
    ordering = ['pk']

    def get_queryset(self):
        queryset = super().get_queryset()
        search_query = self.request.GET.get('search', None)
        if search_query:
            queryset = queryset.filter(name__icontains=search_query)
        return queryset

class ProjectDetailView(LoginRequiredMixin,DetailView):
    model = Project
    template_name = 'projects3d/project_detail.html'
    context_object_name = 'project'

    def get_queryset(self):
        return super().get_queryset().prefetch_related('images')

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        project = self.object
        context['viewer_script_url'] = viewer_asset_url('viewer.js')
        context['viewer_styles_url'] = viewer_asset_url('assets/entry.css')
        context['viewer_config'] = {
            'name': project.name,
            'description': project.description,
            'location': {'latitude': project.latitude, 'longitude': project.longitude,
                         'locked': bool(project.location_kmz)},
            'modelUrl': project.model_file.url if project.model_file else None,
            'objectDataUrl': reverse('projects3d:project-object-data', args=[project.pk]),
            'simulationExportUrl': reverse('projects3d:project-simulation-export', args=[project.pk]),
            'csrfToken': get_token(self.request),
            'iconSpriteUrl': static('projects3d/design-system/icons.svg'),
            'videoUrl': project.location_video.url if project.location_video else None,
            'rhinoLibraryUrl': static('projects3d/viewer/vendor/rhino3dm/'),
            'listUrl': reverse('projects3d:project-list'),
            'editUrl': reverse('projects3d:project-update', args=[project.pk]),
            'importUrl': reverse('projects3d:project-folder-update', args=[project.pk]),
            'coverUrl': project.cover_image.url if project.cover_image else None,
            'summary': project.summary_data,
            'guidelines': project.guidelines_data,
            'images': [{'url': image.image.url, 'name': image.original_name,
                        'position': image.position} for image in project.images.all()],
        }
        return context


class ProjectOverviewView(ProjectDetailView):
    pass


class ProjectSimulationExportView(LoginRequiredMixin, View):
    def post(self, request, pk):
        project = get_object_or_404(Project, pk=pk)
        from projects3d.simulation_export import export_simulation
        try:
            if len(request.body) > 1_000_000:
                raise ValueError('A simulação excede o tamanho permitido para exportação.')
            payload = json.loads(request.body)
            if not isinstance(payload, dict):
                raise ValueError('Dados da simulação inválidos.')
            content, content_type, extension = export_simulation(project.name, payload, payload.get('format', 'pdf'))
        except (ValueError, UnicodeError, ArithmeticError) as error:
            return JsonResponse({'error': str(error)}, status=422)
        response = FileResponse(io.BytesIO(content), content_type=content_type, as_attachment=True,
                                filename=f'simulacao-{project.pk}.{extension}')
        response['Cache-Control'] = 'private, no-store'
        return response


class ProjectFolderImportView(LoginRequiredMixin, FormView):
    form_class = ProjectFolderForm
    template_name = 'projects3d/project_folder_form.html'

    @cached_property
    def project(self):
        if 'pk' in self.kwargs:
            return get_object_or_404(Project, pk=self.kwargs['pk'])
        return None

    def get_initial(self):
        if self.project:
            return {'name': self.project.name, 'description': self.project.description,
                    'latitude': self.project.latitude, 'longitude': self.project.longitude}
        return super().get_initial()

    def get_form_kwargs(self):
        return {**super().get_form_kwargs(), 'replacing': self.project is not None}

    def get_context_data(self, **kwargs):
        return {**super().get_context_data(**kwargs), 'project': self.project}

    def form_valid(self, form):
        try:
            project = save_folder(
                form.bundle, form.cleaned_data['name'], form.cleaned_data['description'],
                form.cleaned_data['source_folder'], self.project.pk if self.project else None,
                latitude=form.cleaned_data['latitude'], longitude=form.cleaned_data['longitude'],
            )
        except (OSError, DatabaseError):
            logger.exception('Falha ao importar pasta do projeto.')
            form.add_error(None, 'Não foi possível concluir a cópia. Os dados anteriores foram mantidos. Selecione a pasta e tente novamente.')
            return self.form_invalid(form)
        return redirect('projects3d:project-detail', pk=project.pk)


class ProjectObjectDataView(LoginRequiredMixin, DetailView):
    model = Project

    def get(self, request, *args, **kwargs):
        project = self.get_object()
        if not project.object_data_file:
            return JsonResponse([], safe=False)
        try:
            with project.object_data_file.open('rb') as file:
                records = read_object_csv(file, project.csv_columns)
        except (OSError, ValidationError):
            return JsonResponse({'error': 'Não foi possível ler a tabela de objetos.'}, status=422)
        response = JsonResponse(records, safe=False)
        response['Cache-Control'] = 'private, no-store'
        return response

class ProjectCreateView(LoginRequiredMixin,CreateView):
    model = Project
    form_class = ProjectCreateForm
    template_name = 'projects3d/project_create.html'
    context_object_name = 'project'
    success_url = reverse_lazy('projects3d:project-list')

    def get(self, request, *args, **kwargs):
        if request.GET.get('individual') != '1':
            return ProjectFolderImportView.as_view()(request, *args, **kwargs)
        return super().get(request, *args, **kwargs)

class ProjectUpdateView(LoginRequiredMixin,UpdateView):
    model = Project
    form_class = ProjectUpdateForm
    template_name = 'projects3d/project_update.html'
    context_object_name = 'project'
    success_url = reverse_lazy('projects3d:project-list')

    def get_template_names(self):
        if self.request.headers.get('HX-Request') == 'true':
            return ['projects3d/project_update.html']
        return ['projects3d/project_update_page.html']

class ProjectDeleteView(LoginRequiredMixin,DeleteView):
    model = Project
    template_name = 'projects3d/project_confirm_delete.html'
    context_object_name = 'project'
    success_url = reverse_lazy('projects3d:project-list')
