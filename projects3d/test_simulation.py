import io
import json
from decimal import Decimal
from zipfile import ZipFile

from PIL import Image
from django.contrib.auth import get_user_model
from django.test import Client, SimpleTestCase, TestCase
from django.urls import reverse

from projects3d.models import Project
from projects3d.simulation_export import calculate_report, build_report_pages, export_simulation


def example_payload(count=4):
    return {'land': 60000, 'grant': 20000, 'years': 5, 'rows': [
        {'name': f'{index // 2:02}-Res{"_DESC" if index % 2 else ""}-PRIV', 'group': f'{index // 2:02}',
         'use': 'PRIV', 'areaM2': 200, 'costPrice': 100, 'salePrice': 500, 'includeCost': True, 'includeSale': True}
        for index in range(count)
    ]}


class SimulationCalculationTests(SimpleTestCase):
    def test_confirmed_formulas_and_fixed_total_values(self):
        report = calculate_report(example_payload())
        self.assertEqual(report['investment'], Decimal('160000'))
        self.assertEqual(report['vgv'], Decimal('400000'))
        self.assertEqual(report['ratio'], Decimal('2.5'))
        self.assertEqual(report['annual'], Decimal('0.5'))

    def test_independent_inclusion_rep_exclusion_and_private_only_vgv(self):
        payload = example_payload()
        payload['rows'][1]['includeCost'] = False
        payload['rows'][1]['includeSale'] = False
        payload['rows'].append({**payload['rows'][0], 'name': '00-circ-COM', 'use': 'COM', 'group': '00'})
        payload['rows'].append({**payload['rows'][0], 'name': 'REP-context-COM', 'use': 'COM', 'group': 'REP'})
        report = calculate_report(payload)
        self.assertEqual(report['investment'], 160000)
        self.assertEqual(report['vgv'], 300000)
        self.assertEqual(len(report['costs']), 5)
        self.assertEqual(len(report['sales']), 4)

    def test_zero_denominators_and_invalid_inputs(self):
        payload = example_payload(1)
        payload.update(land=0, grant=0, years=0)
        payload['rows'][0]['costPrice'] = 0
        report = calculate_report(payload)
        self.assertIsNone(report['ratio'])
        self.assertIsNone(report['annual'])
        for value in (-1, 'NaN', 'Infinity', True, None):
            payload['land'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                calculate_report(payload)

    def test_report_groups_usage_and_omits_repeated_codes_and_vagas(self):
        payload = example_payload(1)
        payload['rows'][0]['name'] = '00-RES_DESC-PRIV'
        for use, name in [('EST', 'EST'), ('COM', 'C_CLUB_AMEN'), ('VAGAS', 'VAGAS')]:
            payload['rows'].append({**payload['rows'][0], 'use': use, 'name': f'00-{name}-{use}'})
        report = calculate_report(payload)
        self.assertEqual(len(report['costs']), 3)
        texts = [command[3] for page in build_report_pages('Estudo', report) for command in page if command[0] == 'text']
        self.assertLess(texts.index('COM · Comum'), texts.index('PRIV · Privado'))
        self.assertLess(texts.index('PRIV · Privado'), texts.index('EST · Estacionamento'))
        self.assertIn('C_CLUB_AMEN', texts)
        self.assertIn('RES_DESC', texts)
        self.assertNotIn('00-RES_DESC-PRIV', texts)
        self.assertFalse(any('VAGAS' in text for text in texts))

    def test_single_page_a4_png_and_pdf(self):
        payload = example_payload(1)
        png, content_type, extension = export_simulation('Estudo de simulação', payload, 'png')
        self.assertEqual((content_type, extension), ('image/png', 'png'))
        with Image.open(io.BytesIO(png)) as image:
            self.assertEqual(image.size, (2480, 3508))
            self.assertAlmostEqual(image.info['dpi'][0], 300, places=1)
        pdf, content_type, extension = export_simulation('Estudo', payload, 'pdf')
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertIn(b'595.2756 841.8898', pdf)
        self.assertEqual((content_type, extension), ('application/pdf', 'pdf'))

    def test_long_reports_keep_readable_a4_pages(self):
        payload = example_payload(12)
        pages = build_report_pages('Estudo', calculate_report(payload))
        self.assertGreater(len(pages), 1)
        for page in pages:
            for command in page:
                if command[0] == 'text':
                    self.assertGreaterEqual(command[2], 20)
                    self.assertLessEqual(command[2], 825)
        png, content_type, extension = export_simulation('Estudo', example_payload(), 'png')
        self.assertEqual((content_type, extension), ('application/zip', 'zip'))
        with ZipFile(io.BytesIO(png)) as archive:
            self.assertGreater(len(archive.namelist()), 1)
            with Image.open(io.BytesIO(archive.read(archive.namelist()[0]))) as image:
                self.assertEqual(image.size, (2480, 3508))


class SimulationExportViewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username='simulation-test', password='test-password')
        cls.project = Project.objects.create(name='Estudo financeiro')

    def test_export_requires_login_and_validates_inputs(self):
        url = reverse('projects3d:project-simulation-export', args=[self.project.pk])
        self.assertEqual(self.client.post(url).status_code, 302)
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertEqual(self.client.post(url, data='null', content_type='application/json').status_code, 422)
        self.assertEqual(self.client.post(url, data='not json', content_type='application/json').status_code, 422)

    def test_export_has_csrf_protection_and_download_headers(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        url = reverse('projects3d:project-simulation-export', args=[self.project.pk])
        payload = {**example_payload(1), 'format': 'pdf'}
        self.assertEqual(client.post(url, data=json.dumps(payload), content_type='application/json').status_code, 403)
        page = client.get(reverse('projects3d:project-detail', args=[self.project.pk]))
        token = page.context['viewer_config']['csrfToken']
        self.assertIn('simulationExportUrl', page.context['viewer_config'])
        response = client.post(url, data=json.dumps(payload), content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('attachment;', response['Content-Disposition'])
        self.assertTrue(b''.join(response.streaming_content).startswith(b'%PDF-'))
