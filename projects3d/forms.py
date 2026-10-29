import json

from django import forms
from projects3d.models import Project
from projects3d.object_data import read_object_csv, validate_csv_columns
from projects3d.folder_import import inspect_folder, file_role
from projects3d.location import read_kmz


class CoordinatesMixin:
    def configure_coordinates(self, locked):
        for name in ('latitude', 'longitude'):
            field = self.fields[name]
            field.disabled = locked
            field.required = not locked
            field.widget.attrs.update({'class': 'campo', 'step': 'any'})
            if locked:
                # Disabled fields ignore submitted values, even malformed ones.
                self.initial[name] = None

    def clean_coordinates(self, cleaned, file):
        if file:
            cleaned['latitude'], cleaned['longitude'] = read_kmz(file)
        return cleaned


class ProjectForm(CoordinatesMixin, forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.setdefault('class', 'campo')
        self.fields['model_file'].widget.attrs.update({
            'accept': '.3dm,.glb,.gltf', 'class': 'campo arquivo',
        })
        kmz_widget = self.fields['location_kmz'].widget
        file = kmz_widget.value_from_datadict(self.data, self.files, self.add_prefix('location_kmz'))
        locked = bool(file or (self.instance.location_kmz and file is not False))
        self.configure_coordinates(locked)
        if locked and self.instance.location_kmz:
            self.initial['latitude'] = self.instance.latitude
            self.initial['longitude'] = self.instance.longitude

    class Meta:
        model = Project
        fields = ['name', 'description', 'model_file', 'object_data_file',
                  'csv_columns', 'location_video', 'location_kmz', 'latitude', 'longitude']
        labels = {'name': 'Nome', 'description': 'Descrição', 'model_file': 'Modelo 3D'}
        widgets = {
            'location_kmz': forms.ClearableFileInput(attrs={'accept': '.kmz', 'class': 'campo arquivo'}),
            'object_data_file': forms.ClearableFileInput(attrs={'accept': '.csv', 'class': 'campo arquivo'}),
            'location_video': forms.ClearableFileInput(attrs={'accept': '.mp4', 'class': 'campo arquivo'}),
            'csv_columns': forms.Textarea(attrs={'rows': 5, 'class': 'campo'}),
        }

    def clean_csv_columns(self):
        return validate_csv_columns(self.cleaned_data['csv_columns'])

    def clean_model_file(self):
        file = self.cleaned_data.get('model_file')
        if file and not file.name.lower().endswith(('.3dm', '.glb', '.gltf')):
            raise forms.ValidationError('Envie um modelo .3dm, .glb ou .gltf.')
        return file

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('location_kmz'):
            try:
                self.clean_coordinates(cleaned, cleaned['location_kmz'])
            except forms.ValidationError as error:
                self.add_error('location_kmz', error)
        file = cleaned.get('object_data_file')
        columns = cleaned.get('csv_columns')
        if file and columns:
            try:
                file.open('rb')
                read_object_csv(file, columns)
            except forms.ValidationError as error:
                self.add_error('object_data_file', error)
            except OSError:
                self.add_error('object_data_file', 'Não foi possível ler o CSV. Envie o arquivo novamente.')
        return cleaned


class ProjectCreateForm(ProjectForm):
    pass


class ProjectUpdateForm(ProjectForm):
    pass


class FolderFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class FolderFilesField(forms.FileField):
    def clean(self, data, initial=None):
        if not data:
            raise forms.ValidationError('Selecione a pasta do projeto.')
        return [super(FolderFilesField, self).clean(item, initial) for item in data]


class ProjectFolderForm(CoordinatesMixin, forms.Form):
    latitude = forms.FloatField(label='Latitude', min_value=-90, max_value=90, required=False)
    longitude = forms.FloatField(label='Longitude', min_value=-180, max_value=180, required=False)
    name = forms.CharField(label='Nome do projeto', max_length=100,
                           widget=forms.TextInput(attrs={'class': 'campo'}))
    description = forms.CharField(label='Descrição', required=False,
                                  widget=forms.Textarea(attrs={'class': 'campo', 'rows': 3}))
    source_folder = forms.CharField(required=False, max_length=255, widget=forms.HiddenInput())
    folder_paths = forms.JSONField(widget=forms.HiddenInput())
    folder_files = FolderFilesField(widget=FolderFileInput(attrs={
        'webkitdirectory': True, 'directory': True, 'class': 'campo arquivo',
    }))
    confirm_replace = forms.BooleanField(required=False)

    def __init__(self, *args, replacing=False, **kwargs):
        super().__init__(*args, **kwargs)
        files = self.fields['folder_files'].widget.value_from_datadict(
            self.data, self.files, self.add_prefix('folder_files')) or []
        try:
            paths = json.loads(self.data.get(self.add_prefix('folder_paths'), '[]'))
        except (ValueError, TypeError):
            paths = []
        locked = isinstance(paths, list) and any(
            isinstance(path, str) and file_role(path) == 'location_kmz'
            for path in paths[:len(files)]
        )
        self.configure_coordinates(locked)
        if replacing:
            self.fields['confirm_replace'].required = True
            self.fields['confirm_replace'].error_messages['required'] = 'Confirme a substituição dos arquivos do projeto.'

    def clean(self):
        cleaned = super().clean()
        if 'folder_files' in cleaned and 'folder_paths' in cleaned:
            self.bundle = inspect_folder(cleaned['folder_files'], cleaned['folder_paths'])
            if self.bundle.coordinates:
                cleaned['latitude'], cleaned['longitude'] = self.bundle.coordinates
        return cleaned
