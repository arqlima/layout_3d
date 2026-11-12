import io
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image, ImageCms

from projects3d.image_previews import image_preview_url
from projects3d.models import Project, ProjectImage


def upload(name='cover.png', mode='RGB', size=(1800, 1200)):
    output = io.BytesIO()
    color = (0, 128, 0, 128) if mode == 'RGBA' else 'green'
    Image.new(mode, size, color).save(output, format='PNG')
    return SimpleUploadedFile(name, output.getvalue(), content_type='image/png')


@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class ImagePreviewTests(TestCase):
    def setUp(self):
        self.client.force_login(get_user_model().objects.create_user(username='preview-test'))
        self.project = Project.objects.create(name='Preview', cover_image=upload())

    def test_resized_preview_preserves_original_and_reuses_cache(self):
        field = self.project.cover_image
        with field.open('rb') as source:
            original = source.read()
        url = self.project.cover_thumbnail_url
        response = self.client.get(url)
        content = b''.join(response.streaming_content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/webp')
        with Image.open(io.BytesIO(content)) as preview:
            self.assertEqual(preview.size, (640, 427))
        with field.open('rb') as source:
            self.assertEqual(source.read(), original)
        with patch('projects3d.image_previews.Image.open', side_effect=AssertionError('Cache should avoid decoding')):
            cached = self.client.get(url)
            self.assertEqual(b''.join(cached.streaming_content), content)
        self.assertEqual(self.client.get(url, HTTP_IF_NONE_MATCH=response['ETag']).status_code, 304)

    def test_authentication_variants_and_revision(self):
        url = self.project.cover_thumbnail_url
        self.assertEqual(self.client.get(url.replace('/card/', '/huge/')).status_code, 404)
        self.project.cover_image = upload('replacement.png')
        self.project.save()
        self.assertNotEqual(url, self.project.cover_thumbnail_url)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.client.logout()
        self.assertEqual(self.client.get(self.project.cover_thumbnail_url).status_code, 302)

    def test_gallery_alpha_and_project_isolation(self):
        image = ProjectImage.objects.create(project=self.project, image=upload('01.png', 'RGBA'), position=1, original_name='01.png')
        url = image_preview_url(self.project.pk, image.image, 'thumbnail', image.pk)
        response = self.client.get(url)
        with Image.open(io.BytesIO(b''.join(response.streaming_content))) as preview:
            self.assertLessEqual(max(preview.size), 240)
            self.assertEqual(preview.mode, 'RGBA')
        other = Project.objects.create(name='Other')
        wrong = image_preview_url(other.pk, image.image, 'thumbnail', image.pk)
        self.assertEqual(self.client.get(wrong).status_code, 404)
        config = self.client.get(f'/projects3d/detail/{self.project.pk}/').context['viewer_config']
        self.assertEqual(config['images'][0]['url'], image.image.url)
        self.assertEqual(config['images'][0]['thumbnailUrl'], url)
        self.assertIn('/cover/', config['coverPreviewUrl'])

    def test_failed_conversion_falls_back_to_original(self):
        with patch('projects3d.views.open_image_preview', side_effect=OSError('storage unavailable')):
            response = self.client.get(self.project.cover_thumbnail_url)
        self.assertRedirects(response, self.project.cover_image.url, fetch_redirect_response=False)

    def test_orientation_and_small_images(self):
        output = io.BytesIO()
        image = Image.new('RGB', (120, 80), 'green')
        exif = image.getexif()
        exif[274] = 6
        image.save(output, format='JPEG', exif=exif)
        self.project.cover_image = SimpleUploadedFile('rotated.jpg', output.getvalue(), content_type='image/jpeg')
        self.project.save()
        response = self.client.get(self.project.cover_thumbnail_url)
        with Image.open(io.BytesIO(b''.join(response.streaming_content))) as preview:
            self.assertEqual(preview.size, (80, 120))

    def test_rgb_color_profile(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        output = io.BytesIO()
        Image.new('RGB', (80, 60), 'green').save(output, format='PNG', icc_profile=profile)
        self.project.cover_image = SimpleUploadedFile('profiled.png', output.getvalue(), content_type='image/png')
        self.project.save()
        response = self.client.get(self.project.cover_thumbnail_url)
        with Image.open(io.BytesIO(b''.join(response.streaming_content))) as preview:
            self.assertEqual(preview.info['icc_profile'], profile)
