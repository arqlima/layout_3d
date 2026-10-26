from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.db import transaction
from projects3d.models import Project, ProjectImage
from projects3d.folder_import import PROJECT_FILES, delete_stored_files

@receiver(post_delete, sender=Project)
def delete_project_files(sender, instance, **kwargs):
    files = [(getattr(instance, name).storage, getattr(instance, name).name)
             for name in PROJECT_FILES if getattr(instance, name)]
    transaction.on_commit(lambda: delete_stored_files(files))


@receiver(post_delete, sender=ProjectImage)
def delete_project_image(sender, instance, **kwargs):
    files = [(instance.image.storage, instance.image.name)]
    transaction.on_commit(lambda: delete_stored_files(files))
