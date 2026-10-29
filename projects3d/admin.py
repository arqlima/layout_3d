from django.contrib import admin
from projects3d.models import Project
from projects3d.forms import ProjectForm

class ProjectAdmin(admin.ModelAdmin):
    form = ProjectForm
    fields = tuple(field.name for field in Project._meta.fields if field.editable and not field.primary_key)
    list_display = ('name', 'model_file')
    search_fields = ('name',)



admin.site.register(Project, ProjectAdmin)
