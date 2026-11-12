"""Cache bounded WebP previews alongside the uploaded originals."""

import hashlib
import io

from django.core.files.base import ContentFile
from django.urls import reverse
from PIL import Image, ImageOps

PREVIEW_SIZES = {'thumbnail': 240, 'card': 640, 'cover': 1920}


def image_revision(field):
    return hashlib.sha256(field.name.encode('utf-8')).hexdigest()[:24]


def image_preview_url(project_id, field, variant, image_id=None):
    if not field:
        return None
    arguments = [project_id, image_revision(field), variant]
    route = 'projects3d:project-cover-preview'
    if image_id is not None:
        route = 'projects3d:project-image-preview'
        arguments.insert(1, image_id)
    return reverse(route, args=arguments)


def open_image_preview(field, variant):
    size = PREVIEW_SIZES[variant]
    name = f'projects3d/previews/v1/{image_revision(field)}-{variant}.webp'
    storage = field.storage
    if storage.exists(name):
        return storage.open(name, 'rb')
    with field.open('rb') as source, Image.open(source) as image:
        if getattr(image, 'is_animated', False):
            raise ValueError('Animated images use the original file.')
        image.draft('RGB', (size, size))
        preview = ImageOps.exif_transpose(image)
        preview.thumbnail((size, size), Image.Resampling.LANCZOS, reducing_gap=3.0)
        mode = 'RGBA' if 'A' in preview.getbands() or 'transparency' in preview.info else 'RGB'
        converted = preview.convert(mode)
        profile = preview.info.get('icc_profile', b'') if preview.mode in ('RGB', 'RGBA') else b''
        try:
            output = io.BytesIO()
            converted.save(output, format='WEBP', quality=85, method=4, icc_profile=profile)
        finally:
            converted.close()
            preview.close()
    stored_name = storage.save(name, ContentFile(output.getvalue()))
    return storage.open(stored_name, 'rb')
