import json
import io
import shutil
from uuid import uuid4
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch
from PIL import Image

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from projects3d.forms import ProjectCreateForm, ProjectUpdateForm
from projects3d.models import Project, default_csv_columns
from projects3d.object_data import read_object_csv
from projects3d.models import ProjectImage
from django.core.files.storage import default_storage
from django.core.files import File
from projects3d.folder_import import inspect_folder, save_folder


OBJECT_ID = '12345678-1234-1234-1234-123456789abc'
COLUMNS = {'id': 'Id', 'area': 'Area', 'use': 'Uso', 'elevation': 'Cota'}


def csv_upload(rows=None):
    if rows is None:
        rows = f'{OBJECT_ID};"12,50";PRIV;"3,25"\n'
    return SimpleUploadedFile('objects.csv', ('\ufeffId;Area;Uso;Cota\n' + rows).encode('utf-8'))


class ObjectDataTests(SimpleTestCase):
    def test_floor_to_floor_from_csv(self):
        for value, expected in [('3,06', 3.06), ('3.5', 3.5), ('0', 0), ('', None)]:
            with self.subTest(value=value):
                file = SimpleUploadedFile('objects.csv', (
                    f'Id;Area;Uso;Cota;Piso_a_Piso\n{OBJECT_ID};12;PRIV;5;{value}\n'
                ).encode())
                self.assertEqual(read_object_csv(file, COLUMNS)[0]['floorToFloorM'], expected)

    def test_floor_to_floor_rejects_invalid_numbers(self):
        for value in ('NaN', 'Infinity', 'invalid'):
            file = SimpleUploadedFile('objects.csv', (
                f'Id;Area;Uso;Cota;Piso_a_Piso\n{OBJECT_ID};12;PRIV;5;{value}\n'
            ).encode())
            with self.subTest(value=value), self.assertRaises(ValidationError):
                read_object_csv(file, COLUMNS)

    def test_csv_normalizes_guid_and_brazilian_numbers(self):
        file = csv_upload(f'{OBJECT_ID.upper()};"12,50";PRIV;-1.25\n')
        self.assertEqual(read_object_csv(file, COLUMNS), [{
            'id': OBJECT_ID, 'areaM2': 12.5, 'use': 'PRIV', 'elevationM': -1.25,
            'floorToFloorM': None,
        }])
        self.assertEqual(file.tell(), 0)

    def test_blank_values_and_area_fallback(self):
        file = SimpleUploadedFile('objects.csv', (
            f'Id;Area;Uso;Cota;Curva\n{OBJECT_ID};;;;15.5\n'
        ).encode())
        record = read_object_csv(file, {**COLUMNS, 'areaFallback': 'Curva'})[0]
        self.assertEqual(record['areaM2'], 15.5)
        self.assertIsNone(record['use'])
        self.assertIsNone(record['elevationM'])

    def test_rejects_invalid_or_duplicate_guids_and_nonfinite_numbers(self):
        cases = [
            'invalid;12;COM;0\n',
            '00000000-0000-0000-0000-000000000000;12;COM;0\n',
            f'{OBJECT_ID};12;COM;0\n{OBJECT_ID.upper()};13;COM;1\n',
            f'{OBJECT_ID};NaN;COM;0\n',
            f'{OBJECT_ID};12;COM;Infinity\n',
            f'{OBJECT_ID};invalid;COM;0\n',
            f'{OBJECT_ID};12;COM\n',
            f'{OBJECT_ID};"12;COM;0\n',
        ]
        for rows in cases:
            with self.subTest(rows=rows), self.assertRaises(ValidationError):
                read_object_csv(csv_upload(rows), COLUMNS)

    def test_rejects_missing_or_duplicate_headers(self):
        for content in (b'', b'Id;Area;Uso\n', b'Id;Area;Uso;Cota;Area\n'):
            with self.subTest(content=content), self.assertRaises(ValidationError):
                read_object_csv(SimpleUploadedFile('objects.csv', content), COLUMNS)


class ProjectViewerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username='viewer-test', password='test-password')
        cls.project = Project.objects.create(name='Estudo de teste')

    def setUp(self):
        settings = override_settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
            'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
        })
        settings.enable()
        self.addCleanup(settings.disable)
        self.client.force_login(self.user)

    def test_login_required_for_viewer_and_data(self):
        self.client.logout()
        for name in ('project-detail', 'project-object-data'):
            response = self.client.get(reverse(f'projects3d:{name}', args=[self.project.pk]))
            self.assertEqual(response.status_code, 302)
            self.assertIn(reverse('accounts:login'), response.url)

    def test_project_without_model_renders_safe_runtime_config(self):
        self.project.name = '</script><script>alert(1)</script>'
        self.project.save()
        response = self.client.get(reverse('projects3d:project-viewer', args=[self.project.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, response.context['viewer_script_url'])
        self.assertIsNone(response.context['viewer_config']['modelUrl'])
        self.assertIsNone(response.context['viewer_config']['videoUrl'])
        self.assertNotContains(response, '</script><script>alert(1)</script>')

    def test_viewer_asset_urls_follow_build_manifest_without_query_strings(self):
        url = reverse('projects3d:project-detail', args=[self.project.pk])
        def manifest(version):
            return json.dumps({'src/entry.ts': {
                'file': f'viewer-{version}.js', 'css': [f'assets/entry-{version}.css'],
            }})
        with patch('projects3d.viewer_assets.Path.read_text', return_value=manifest('old')):
            before = self.client.get(url)
        with patch('projects3d.viewer_assets.Path.read_text', return_value=manifest('new')):
            after = self.client.get(url)
        for key in ('viewer_script_url', 'viewer_styles_url'):
            self.assertNotIn('?', after.context[key])
            self.assertNotEqual(before.context[key], after.context[key])
            self.assertContains(after, after.context[key])
        self.assertTrue(after.context['viewer_script_url'].endswith('/viewer-new.js'))
        self.assertTrue(after.context['viewer_styles_url'].endswith('/entry-new.css'))

    def test_data_endpoint_uses_only_requested_project(self):
        first = Project.objects.create(name='Com dados', object_data_file=csv_upload(), csv_columns=COLUMNS)
        response = self.client.get(reverse('projects3d:project-object-data', args=[first.pk]))
        self.assertEqual(response.json()[0]['id'], OBJECT_ID)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        response = self.client.get(reverse('projects3d:project-object-data', args=[self.project.pk]))
        self.assertEqual(response.json(), [])
        self.assertEqual(self.client.get(reverse('projects3d:project-object-data', args=[99999])).status_code, 404)

    def test_missing_csv_returns_controlled_error(self):
        self.project.object_data_file = 'projects3d/data/missing.csv'
        self.project.csv_columns = COLUMNS
        self.project.save()
        response = self.client.get(reverse('projects3d:project-object-data', args=[self.project.pk]))
        self.assertEqual(response.status_code, 422)
        self.assertIn('error', response.json())

    def test_create_and_update_uploads_preserve_model(self):
        response = self.client.post(reverse('projects3d:project-create'), {
            'latitude': -20.46, 'longitude': -54.62,
            'name': 'Novo estudo', 'description': 'Descrição', 'csv_columns': json.dumps(COLUMNS),
            'model_file': SimpleUploadedFile('model.3dm', b'test-model'),
            'object_data_file': csv_upload(),
            'location_video': SimpleUploadedFile('location.mp4', b'test-video'),
        })
        self.assertRedirects(response, reverse('projects3d:project-list'))
        project = Project.objects.get(name='Novo estudo')
        original_model = project.model_file.name
        config = self.client.get(reverse('projects3d:project-viewer', args=[project.pk])).context['viewer_config']
        self.assertEqual(config['modelUrl'], project.model_file.url)
        self.assertEqual(config['videoUrl'], project.location_video.url)
        response = self.client.post(reverse('projects3d:project-update', args=[project.pk]), {
            'latitude': -20.46, 'longitude': -54.62,
            'name': 'Estudo atualizado', 'csv_columns': json.dumps(COLUMNS),
            'object_data_file-clear': 'on', 'location_video-clear': 'on',
        })
        self.assertEqual(response.status_code, 302)
        project.refresh_from_db()
        self.assertEqual(project.model_file.name, original_model)
        self.assertFalse(project.object_data_file)
        self.assertFalse(project.location_video)

    def test_csv_errors_render_on_update_page_and_modal_still_works(self):
        url = reverse('projects3d:project-update', args=[self.project.pk])
        response = self.client.post(url, {
            'name': self.project.name, 'csv_columns': json.dumps(COLUMNS),
            'object_data_file': csv_upload('bad;12;COM;0\n'),
        })
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'projects3d/project_update_page.html')
        self.assertContains(response, 'ID inválido')
        response = self.client.get(url, headers={'HX-Request': 'true'})
        self.assertContains(response, '<dialog')

    def test_form_rejects_bad_mapping_and_extensions(self):
        for mapping in ([], {}, {'id': 'Id'}, {**COLUMNS, 'area': 'Id'}):
            with self.subTest(mapping=mapping):
                form = ProjectCreateForm({'name': 'Teste', 'csv_columns': json.dumps(mapping)})
                self.assertFalse(form.is_valid())
                self.assertIn('csv_columns', form.errors)
        for field, filename in [('model_file', 'model.exe'), ('location_video', 'video.html'), ('object_data_file', 'data.txt')]:
            with self.subTest(field=field):
                form = ProjectCreateForm(
                    {'name': 'Teste', 'csv_columns': json.dumps(COLUMNS)},
                    {field: SimpleUploadedFile(filename, b'invalid')},
                )
                self.assertFalse(form.is_valid())
                self.assertIn(field, form.errors)

    def test_model_is_optional_and_existing_forms_use_default_mapping(self):
        form = ProjectCreateForm({'name': 'Sem modelo', 'csv_columns': json.dumps(default_csv_columns()),
                                  'latitude': -20.46, 'longitude': -54.62})
        self.assertTrue(form.is_valid(), form.errors)
        form = ProjectUpdateForm(instance=self.project)
        self.assertEqual(form.initial['csv_columns'], default_csv_columns())

    def test_delete_removes_all_project_uploads(self):
        project = Project.objects.create(
            name='Remover', model_file=SimpleUploadedFile('model.3dm', b'test-model'),
            object_data_file=csv_upload(), location_video=SimpleUploadedFile('location.mp4', b'test-video'),
        )
        files = [(getattr(project, name).storage, getattr(project, name).name)
                 for name in ('model_file', 'object_data_file', 'location_video')]
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(reverse('projects3d:project-delete', args=[project.pk]))
        self.assertEqual(response.status_code, 302)
        self.assertTrue(all(not storage.exists(name) for storage, name in files))


def image_upload(name):
    stream = io.BytesIO()
    Image.new('RGB', (8, 8), '#446655').save(stream, format='PNG')
    return SimpleUploadedFile(name, stream.getvalue(), content_type='image/png')


def folder_payload(optional=True):
    table = csv_upload()
    table.name = 'objetos.csv'
    files = [SimpleUploadedFile('massa.3dm', b'3D Geometry File Format       80' + b'\0' * 32), table]
    paths = ['massa.3dm', 'objetos.csv']
    if optional:
        files += [image_upload('capa.png'), image_upload('02.png'), image_upload('01.png'),
                  SimpleUploadedFile('resumo.txt', 'Área do terreno;120,5\nEficiência;0.65\nVagas;\n'.encode()),
                  SimpleUploadedFile('localizacao.mp4', b'test-video'),
                  SimpleUploadedFile('diretrizes.csv', b'Indicador;Valor\nCA;2\n')]
        paths += ['capa.png', '02.png', 'imagens/01.png', 'resumo.txt', 'localizacao.mp4', 'diretrizes.csv']
    return {'name': 'Projeto por pasta', 'description': 'Apresentação de teste',
            'latitude': -20.46, 'longitude': -54.62,
            'source_folder': 'Pasta de origem', 'folder_paths': json.dumps(paths), 'folder_files': files}


class FolderImportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username='folder-test', password='test-password')

    def setUp(self):
        settings = override_settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
            'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
        })
        settings.enable()
        self.addCleanup(settings.disable)
        self.client.force_login(self.user)

    def create_project(self, optional=True):
        response = self.client.post(reverse('projects3d:project-folder-import'), folder_payload(optional))
        self.assertEqual(response.status_code, 302, response.context['form'].errors if response.context else '')
        return Project.objects.latest('pk')

    def test_new_project_opens_folder_selection_and_legacy_form_is_available(self):
        response = self.client.get(reverse('projects3d:project-create'))
        self.assertContains(response, 'webkitdirectory')
        self.assertContains(response, 'Conferência da pasta')
        response = self.client.get(reverse('projects3d:project-create') + '?individual=1')
        self.assertTemplateUsed(response, 'projects3d/project_create.html')

    def test_folder_import_copies_deliverables_by_project_and_orders_images(self):
        project = self.create_project()
        prefix = f'projects3d/projetos/{project.pk}/'
        self.assertEqual(project.model_file.name, prefix + 'massa.3dm')
        self.assertEqual(project.object_data_file.name, prefix + 'objetos.csv')
        self.assertEqual(project.cover_image.name, prefix + 'capa.png')
        self.assertEqual(project.summary_data[0], {'label': 'Área do terreno', 'value': '120,5'})
        self.assertEqual(project.guidelines_data, [['Indicador', 'Valor'], ['CA', '2']])
        self.assertEqual(project.source_folder, 'Pasta de origem')
        self.assertEqual(list(project.images.values_list('position', flat=True)), [1, 2])
        self.assertEqual(project.csv_columns, COLUMNS)
        with project.object_data_file.open('rb') as file:
            self.assertEqual(read_object_csv(file, project.csv_columns)[0]['id'], OBJECT_ID)
        response = self.client.get(reverse('projects3d:project-detail', args=[project.pk]))
        self.assertTemplateUsed(response, 'projects3d/project_detail.html')
        config = response.context['viewer_config']
        self.assertEqual(config['coverUrl'], project.cover_image.url)
        self.assertEqual(config['summary'][0]['value'], '120,5')
        self.assertEqual([image['position'] for image in config['images']], [1, 2])
        self.assertEqual(config['listUrl'], reverse('projects3d:project-list'))
        self.assertContains(response, response.context['viewer_script_url'])

    def test_source_files_are_ignored_even_when_sent_by_client(self):
        payload = folder_payload(False)
        payload['folder_files'].append(SimpleUploadedFile('massa.3dm', b'backup'))
        payload['folder_paths'] = json.dumps(['massa.3dm', 'objetos.csv', 'fontes/massa.3dm'])
        response = self.client.post(reverse('projects3d:project-folder-import'), payload)
        self.assertEqual(response.status_code, 302)
        project = Project.objects.get()
        with project.model_file.open('rb') as file:
            self.assertTrue(file.read().startswith(b'3D Geometry File Format '))

    def test_two_imports_with_same_name_have_separate_copies(self):
        first = self.create_project(False)
        second = self.create_project(False)
        self.assertNotEqual(first.model_file.name, second.model_file.name)
        with self.captureOnCommitCallbacks(execute=True):
            first.delete()
        self.assertTrue(default_storage.exists(second.model_file.name))

    def test_missing_required_file_creates_no_project(self):
        payload = folder_payload(False)
        payload['folder_files'] = payload['folder_files'][:1]
        payload['folder_paths'] = json.dumps(['massa.3dm'])
        response = self.client.post(reverse('projects3d:project-folder-import'), payload)
        self.assertContains(response, 'objetos.csv')
        self.assertFalse(Project.objects.exists())

    def test_invalid_csv_or_image_is_rejected_before_any_copy(self):
        for invalid_image in (False, True):
            with self.subTest(invalid_image=invalid_image):
                payload = folder_payload()
                index = 2 if invalid_image else 1
                payload['folder_files'][index] = SimpleUploadedFile('capa.png' if invalid_image else 'objetos.csv', b'bad')
                response = self.client.post(reverse('projects3d:project-folder-import'), payload)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context['form'].errors)
                self.assertFalse(Project.objects.exists())

    def test_rejects_traversal_duplicate_roles_and_image_positions(self):
        for extra_path, extra_file in [
            ('../capa.png', image_upload('capa.png')),
            ('capa.jpg', image_upload('capa.jpg')),
            ('imagens/1.png', image_upload('1.png')),
        ]:
            with self.subTest(path=extra_path):
                payload = folder_payload()
                payload['folder_files'].append(extra_file)
                payload['folder_paths'] = json.dumps(json.loads(payload['folder_paths']) + [extra_path])
                response = self.client.post(reverse('projects3d:project-folder-import'), payload)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context['form'].errors)
                self.assertFalse(Project.objects.exists())

    def test_update_requires_explicit_replacement_and_keeps_old_files_on_error(self):
        project = self.create_project()
        original = project.model_file.name
        url = reverse('projects3d:project-folder-update', args=[project.pk])
        response = self.client.post(url, folder_payload(False))
        self.assertEqual(response.status_code, 200)
        self.assertIn('confirm_replace', response.context['form'].errors)
        project.refresh_from_db()
        self.assertEqual(project.model_file.name, original)
        self.assertTrue(default_storage.exists(original))

    def test_update_replaces_optional_files_and_removes_old_copies_after_commit(self):
        project = self.create_project()
        original_files = [project.model_file.name, project.object_data_file.name, project.cover_image.name]
        original_files += list(project.images.values_list('image', flat=True))
        payload = folder_payload(False)
        payload['confirm_replace'] = 'on'
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(reverse('projects3d:project-folder-update', args=[project.pk]), payload)
        self.assertEqual(response.status_code, 302)
        project.refresh_from_db()
        self.assertIn('/versoes/', project.model_file.name)
        self.assertTrue(default_storage.exists(project.model_file.name))
        self.assertFalse(project.cover_image)
        self.assertEqual(project.summary_data, [])
        self.assertFalse(project.images.exists())
        self.assertTrue(all(not default_storage.exists(name) for name in original_files))

    def test_storage_failure_rolls_back_project_and_removes_partial_copies(self):
        project = self.create_project()
        old_model = project.model_file.name
        copied = []
        original_save = default_storage.save

        def failing_save(name, content, **kwargs):
            if copied:
                raise OSError('Simulated disk failure')
            result = original_save(name, content, **kwargs)
            copied.append(result)
            return result

        payload = folder_payload(False)
        payload['confirm_replace'] = 'on'
        with patch.object(default_storage, 'save', side_effect=failing_save), self.assertLogs('projects3d.views', level='ERROR'):
            response = self.client.post(reverse('projects3d:project-folder-update', args=[project.pk]), payload)
        self.assertEqual(response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.model_file.name, old_model)
        self.assertTrue(default_storage.exists(old_model))
        self.assertTrue(project.images.exists())
        self.assertTrue(all(not default_storage.exists(name) for name in copied))

    def test_summary_csv_and_original_rhino_headers_are_supported(self):
        payload = folder_payload(False)
        payload['folder_files'][1] = SimpleUploadedFile('objetos.csv', (
            f'ID_OBJETO;AREA_BASE_M2;USO;COTA_BASE_M\n{OBJECT_ID};12;REP;0\n'
        ).encode())
        payload['folder_files'].append(SimpleUploadedFile('resumo.csv', b'indicador;valor\nCA;2\n'))
        payload['folder_paths'] = json.dumps(['massa.3dm', 'objetos.csv', 'resumo.csv'])
        response = self.client.post(reverse('projects3d:project-folder-import'), payload)
        self.assertEqual(response.status_code, 302)
        project = Project.objects.get()
        self.assertNotIn('areaFallback', project.csv_columns)
        self.assertEqual(project.summary_data, [{'label': 'CA', 'value': '2'}])

    def test_delete_removes_cover_summary_guidelines_and_gallery(self):
        project = self.create_project()
        files = [project.cover_image.name, project.summary_file.name, project.guidelines_file.name]
        files += list(project.images.values_list('image', flat=True))
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(reverse('projects3d:project-delete', args=[project.pk]))
        self.assertFalse(ProjectImage.objects.exists())
        self.assertTrue(all(not default_storage.exists(name) for name in files))

    def test_import_and_update_require_login(self):
        project = self.create_project(False)
        self.client.logout()
        for name, args in [('project-folder-import', []), ('project-folder-update', [project.pk]),
                           ('project-viewer', [project.pk])]:
            response = self.client.get(reverse(f'projects3d:{name}', args=args))
            self.assertEqual(response.status_code, 302)
            self.assertIn(reverse('accounts:login'), response.url)

    def test_filesystem_copy_survives_removal_of_original_folder(self):
        parent = Path(__file__).resolve().parent
        temporary = parent / f'test_folder_{uuid4().hex}'
        temporary.mkdir()
        try:
            self.assertEqual(temporary.parent, parent)
            source = temporary / 'origem'
            source.mkdir()
            payload = folder_payload()
            paths = json.loads(payload['folder_paths'])
            for upload, relative in zip(payload['folder_files'], paths):
                original = source / relative
                original.parent.mkdir(exist_ok=True)
                original.write_bytes(upload.read())
            with override_settings(MEDIA_ROOT=temporary / 'media', STORAGES={
                'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
                'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
            }):
                with ExitStack() as stack:
                    files = [File(stack.enter_context((source / relative).open('rb')),
                                  name=Path(relative).name) for relative in paths]
                    bundle = inspect_folder(files, paths)
                    project = save_folder(bundle, 'Cópia independente', '', source.name)
                # Remove only the explicitly created originals; no platform file is removed.
                for relative in paths:
                    (source / relative).unlink()
                (source / 'imagens').rmdir()
                source.rmdir()
                self.assertFalse(source.exists())
                self.assertTrue(Path(project.model_file.path).is_file())
                self.assertTrue(Path(project.cover_image.path).is_file())
                self.assertEqual(project.images.count(), 2)
                with project.object_data_file.open('rb') as file:
                    self.assertEqual(read_object_csv(file, project.csv_columns)[0]['id'], OBJECT_ID)
        finally:
            if temporary.resolve().parent != parent:
                raise ValueError('A pasta temporária está fora do diretório de testes.')
            shutil.rmtree(temporary)

    def test_project_entry_points_provide_all_tab_content_without_separate_overview(self):
        project = self.create_project()
        for route in ('project-detail', 'project-viewer'):
            response = self.client.get(reverse(f'projects3d:{route}', args=[project.pk]))
            self.assertTemplateUsed(response, 'projects3d/project_detail.html')
            config = response.context['viewer_config']
            self.assertEqual(config['summary'], project.summary_data)
            self.assertEqual(config['guidelines'], project.guidelines_data)
            self.assertEqual(config['videoUrl'], project.location_video.url)
            self.assertEqual(config['importUrl'], reverse('projects3d:project-folder-update', args=[project.pk]))

    def test_tab_content_is_encoded_safely_in_project_configuration(self):
        project = self.create_project(False)
        malicious = '</script><img src=x onerror=alert(1)>'
        project.summary_data = [{'label': malicious, 'value': malicious}]
        project.guidelines_data = [[malicious], [malicious]]
        project.save()
        response = self.client.get(reverse('projects3d:project-detail', args=[project.pk]))
        self.assertNotContains(response, malicious)
        self.assertEqual(response.context['viewer_config']['summary'][0]['label'], malicious)
