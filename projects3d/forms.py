from django import forms
from projects3d.models import Project
from projects3d.object_data import read_object_csv, validate_csv_columns
from projects3d.folder_import import inspect_folder


class ProjectForm(forms.ModelForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            field.widget.attrs.setdefault('class', 'campo')
        self.fields['model_file'].widget.attrs.update({
            'accept': '.3dm,.glb,.gltf', 'class': 'campo arquivo',
        })

    class Meta:
        model = Project
        fields = ['name', 'description', 'model_file', 'object_data_file',
                  'csv_columns', 'location_video']
        labels = {'name': 'Nome', 'description': 'Descrição', 'model_file': 'Modelo 3D'}
        widgets = {
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


class ProjectFolderForm(forms.Form):
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
        if replacing:
            self.fields['confirm_replace'].required = True
            self.fields['confirm_replace'].error_messages['required'] = 'Confirme a substituição dos arquivos do projeto.'

    def clean(self):
        cleaned = super().clean()
        if 'folder_files' in cleaned and 'folder_paths' in cleaned:
            self.bundle = inspect_folder(cleaned['folder_files'], cleaned['folder_paths'])
        return cleaned
