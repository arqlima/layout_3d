from django.db import models
from django.core.validators import FileExtensionValidator, MinValueValidator, MaxValueValidator


def default_csv_columns():
    return {'id': 'ID_OBJETO', 'area': 'AREA_BASE_M2',
            'areaFallback': 'AREA_CURVA_M2', 'use': 'USO', 'elevation': 'COTA_BASE_M'}

# Create your models here.

class Project(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    model_file = models.FileField(upload_to='projects3d/models/', blank=True)
    location_kmz = models.FileField(
        'Localização (KMZ)', upload_to='projects3d/locations/', blank=True,
        validators=[FileExtensionValidator(['kmz'])],
    )
    latitude = models.FloatField('Latitude', null=True, blank=True,
                                 validators=[MinValueValidator(-90), MaxValueValidator(90)])
    longitude = models.FloatField('Longitude', null=True, blank=True,
                                  validators=[MinValueValidator(-180), MaxValueValidator(180)])
    object_data_file = models.FileField(
        'Tabela de objetos (CSV)', upload_to='projects3d/data/', blank=True,
        validators=[FileExtensionValidator(['csv'])],
    )
    csv_columns = models.JSONField('Colunas do CSV', default=default_csv_columns)
    location_video = models.FileField(
        'Vídeo de localização (MP4)', upload_to='projects3d/videos/', blank=True,
        validators=[FileExtensionValidator(['mp4'])],
    )
    cover_image = models.ImageField('Capa', upload_to='projects3d/covers/', blank=True)
    summary_file = models.FileField('Resumo', upload_to='projects3d/summaries/', blank=True)
    guidelines_file = models.FileField('Diretrizes', upload_to='projects3d/guidelines/', blank=True)
    summary_data = models.JSONField(default=list, blank=True)
    guidelines_data = models.JSONField(default=list, blank=True)
    source_folder = models.CharField('Pasta importada', max_length=255, blank=True)
    

    def __str__(self):
        return self.name


class ProjectImage(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='images')
    image = models.ImageField(upload_to='projects3d/images/')
    position = models.PositiveIntegerField()
    original_name = models.CharField(max_length=255)

    class Meta:
        ordering = ['position', 'pk']

    def __str__(self):
        return f'{self.project.name} / {self.original_name}'
