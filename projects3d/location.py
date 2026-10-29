"""Read local KML geometries without extracting ZIP files or resolving links."""

import math
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile
from zlib import error as ZlibError

from django.core.exceptions import ValidationError

KMZ_LIMIT = 10 * 1024 * 1024
KML_LIMIT = 5 * 1024 * 1024
KML_NS = 'http://www.opengis.net/kml/2.2'


def read_kmz(file):
    """Return (latitude, longitude) at the geographic bounds' center."""
    try:
        file.open('rb')
        if not file.name.lower().endswith('.kmz') or file.size > KMZ_LIMIT:
            raise ValidationError('Envie um arquivo .kmz de até 10 MB.')
        with ZipFile(file) as archive:
            entries = archive.infolist()
            if len(entries) > 1000:
                raise ValidationError('O KMZ contém arquivos demais (máximo: 1000).')
            kmls = [entry for entry in entries if entry.filename.lower().endswith('.kml')]
            if not kmls or sum(entry.file_size for entry in kmls) > KML_LIMIT:
                raise ValidationError('O KMZ deve conter KML com até 5 MB no total.')
            points = []
            for entry in kmls:
                with archive.open(entry) as source:
                    raw = source.read(KML_LIMIT + 1)
                if len(raw) > KML_LIMIT:
                    raise ValidationError('O KML excede 5 MB.')
                # Reject DTD/entities, including UTF-16/32 encodings, before parsing.
                normalized = raw.replace(b'\x00', b'').upper()
                if b'<!DOCTYPE' in normalized or b'<!ENTITY' in normalized:
                    raise ValidationError('KML com DTD ou entidades não é permitido.')
                root = ET.fromstring(raw)
                for namespace in (f'{{{KML_NS}}}', ''):
                    for placemark in root.iter(f'{namespace}Placemark'):
                        for node in placemark.iter(f'{namespace}coordinates'):
                            for token in (node.text or '').split():
                                parts = token.split(',')
                                if len(parts) not in (2, 3):
                                    raise ValueError('Invalid coordinate tuple')
                                lon, lat = map(float, parts[:2])
                                if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
                                    raise ValueError('Invalid coordinate range')
                                points.append((lat, lon))
            if not points:
                raise ValidationError('O KMZ não contém coordenadas de pontos, linhas ou polígonos locais.')
            latitudes, longitudes = zip(*points)
            # Use the smallest longitude arc, including sites across the antimeridian.
            ordered = sorted(set(lon % 360 for lon in longitudes))
            gaps = [(ordered[(i + 1) % len(ordered)] - lon) % 360 for i, lon in enumerate(ordered)]
            index = max(range(len(gaps)), key=gaps.__getitem__)
            start = ordered[(index + 1) % len(ordered)]
            width = 0 if len(ordered) == 1 else 360 - gaps[index]
            longitude = (min(longitudes) + max(longitudes)) / 2
            if max(longitudes) - min(longitudes) > 180:
                longitude = (start + width / 2 + 180) % 360 - 180
            return (min(latitudes) + max(latitudes)) / 2, longitude
    except (BadZipFile, ET.ParseError, ValueError, OSError, RuntimeError, NotImplementedError, ZlibError) as error:
        raise ValidationError('KMZ inválido ou ilegível. Envie um arquivo com coordenadas geográficas válidas.') from error
    finally:
        try:
            file.seek(0)
        except OSError:
            pass
