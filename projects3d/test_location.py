import io
import json
from zipfile import ZipFile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.contrib.auth import get_user_model

from projects3d.forms import ProjectCreateForm, ProjectUpdateForm, ProjectFolderForm
from projects3d.models import Project, default_csv_columns
from projects3d.tests import folder_payload


def kmz_upload(coordinates='-54.62,-20.46,0', geometry='Point'):
    stream = io.BytesIO()
    with ZipFile(stream, 'w') as archive:
        archive.writestr('doc.kml', (
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark>'
            f'<{geometry}><coordinates>{coordinates}</coordinates></{geometry}>'
            '</Placemark></kml>'
        ))
    return SimpleUploadedFile('localizacao.kmz', stream.getvalue())


class LocationFormTests(SimpleTestCase):
    def data(self, **kwargs):
        return {'name': 'Localização', 'csv_columns': json.dumps(default_csv_columns()), **kwargs}

    def test_manual_coordinates_are_required_without_kmz(self):
        form = ProjectCreateForm(self.data())
        self.assertFalse(form.is_valid())
        self.assertIn('latitude', form.errors)
        self.assertIn('longitude', form.errors)

    def test_manual_coordinates_validate_ranges(self):
        for lat, lon, valid in [(0, 0, True), (-90, 180, True), (91, 0, False), (0, -181, False)]:
            form = ProjectCreateForm(self.data(latitude=lat, longitude=lon))
            self.assertEqual(form.is_valid(), valid, form.errors)

    def test_kmz_overrides_even_invalid_manual_coordinates(self):
        form = ProjectCreateForm(self.data(latitude='invalid', longitude=999), {'location_kmz': kmz_upload()})
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(float(form.instance.latitude), -20.46)
        self.assertEqual(float(form.instance.longitude), -54.62)
        self.assertTrue(form.fields['latitude'].disabled)

    def test_invalid_kmz_is_rejected(self):
        for file in [SimpleUploadedFile('bad.kmz', b'bad'), kmz_upload('NaN,0'), kmz_upload('0,91'),
                     kmz_upload(''), SimpleUploadedFile('bad.txt', b'bad')]:
            form = ProjectCreateForm(self.data(latitude=0, longitude=0), {'location_kmz': file})
            self.assertFalse(form.is_valid())
            self.assertIn('location_kmz', form.errors)

    def test_folder_without_kmz_requires_manual_coordinates(self):
        payload = folder_payload(False)
        form = ProjectFolderForm(payload, {'folder_files': payload.pop('folder_files')})
        self.assertFalse(form.is_valid())
        self.assertIn('latitude', form.errors)


@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class LocationIntegrationTests(TestCase):
    def setUp(self):
        self.client.force_login(get_user_model().objects.create_user(username='location-test'))

    def test_create_edit_clear_and_viewer(self):
        data = {'name': 'KMZ', 'csv_columns': json.dumps(default_csv_columns()), 'location_kmz': kmz_upload()}
        self.assertEqual(self.client.post(reverse('projects3d:project-create'), data).status_code, 302)
        project = Project.objects.get()
        form = ProjectUpdateForm({'name': 'Edited', 'csv_columns': data['csv_columns'],
                                  'latitude': 1, 'longitude': 2}, instance=project)
        self.assertTrue(form.is_valid(), form.errors)
        project = form.save()
        self.assertEqual(float(project.latitude), -20.46)
        config = self.client.get(reverse('projects3d:project-detail', args=[project.pk])).context['viewer_config']
        self.assertEqual(config['location'], {'latitude': -20.46, 'longitude': -54.62, 'locked': True})
        form = ProjectUpdateForm({'name': 'Manual', 'csv_columns': data['csv_columns'],
                                  'location_kmz-clear': 'on', 'latitude': 0, 'longitude': 0}, instance=project)
        self.assertTrue(form.is_valid(), form.errors)
        project = form.save()
        self.assertFalse(project.location_kmz)
        self.assertEqual(project.latitude, 0)

    def test_folder_imports_kmz(self):
        payload = folder_payload(False)
        payload['folder_files'].append(kmz_upload())
        payload['folder_paths'] = json.dumps(['massa.3dm', 'objetos.csv', 'localizacao.kmz'])
        response = self.client.post(reverse('projects3d:project-folder-import'), payload)
        self.assertEqual(response.status_code, 302, response.context['form'].errors if response.context else '')
        project = Project.objects.get()
        self.assertTrue(project.location_kmz)
        self.assertEqual(float(project.longitude), -54.62)
