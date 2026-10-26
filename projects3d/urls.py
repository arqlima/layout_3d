from django.urls import path
from projects3d.views import ProjectDeleteView, ProjectListView, ProjectDetailView, ProjectCreateView, ProjectUpdateView
from projects3d.views import ProjectObjectDataView
from projects3d.views import ProjectOverviewView, ProjectFolderImportView

app_name = 'projects3d'

urlpatterns = [
    path('list/', ProjectListView.as_view(), name='project-list'),
    path('detail/<int:pk>/', ProjectOverviewView.as_view(), name='project-detail'),
    path('detail/<int:pk>/viewer/', ProjectDetailView.as_view(), name='project-viewer'),
    path('detail/<int:pk>/objects/', ProjectObjectDataView.as_view(), name='project-object-data'),
    path('create/', ProjectCreateView.as_view(), name='project-create'),
    path('import/', ProjectFolderImportView.as_view(), name='project-folder-import'),
    path('detail/<int:pk>/import/', ProjectFolderImportView.as_view(), name='project-folder-update'),
    path('update/<int:pk>/', ProjectUpdateView.as_view(), name='project-update'),
    path('delete/<int:pk>/', ProjectDeleteView.as_view(), name='project-delete'),
]
