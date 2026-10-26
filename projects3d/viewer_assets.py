"""URLs do visualizador que mudam quando o conteúdo do build muda."""

import json
from pathlib import Path

from django.contrib.staticfiles import finders
from django.templatetags.static import static


def viewer_asset_url(filename):
    source = finders.find('projects3d/viewer/manifest.json')
    if source is None:
        raise FileNotFoundError('Build do visualizador ausente. Execute pnpm build em projects3d/frontend.')
    entry = json.loads(Path(source).read_text(encoding='utf-8'))['src/entry.ts']
    asset = entry['file'] if filename == 'viewer.js' else entry['css'][0]
    return static(f'projects3d/viewer/{asset}')
