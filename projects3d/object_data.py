"""Convert uploaded Rhino CSV tables into the viewer's object records."""

import csv
import io
import math
from uuid import UUID

from django.core.exceptions import ValidationError


def validate_csv_columns(columns):
    required = {'id', 'area', 'use', 'elevation'}
    allowed = required | {'areaFallback'}
    if (not isinstance(columns, dict) or not required.issubset(columns)
            or set(columns) - allowed
            or any(not isinstance(value, str) or not value.strip()
                   for value in columns.values())):
        raise ValidationError(
            'Informe um objeto JSON com id, area, use e elevation; '
            'areaFallback é opcional. Os valores devem ser nomes de colunas.'
        )
    if len(set(columns.values())) != len(columns):
        raise ValidationError('Cada campo deve apontar para uma coluna diferente.')
    return columns


def read_object_csv(file, columns):
    validate_csv_columns(columns)
    try:
        file.seek(0)
        content = file.read().decode('utf-8-sig')
        rows = [row for row in csv.reader(io.StringIO(content), delimiter=';', strict=True)
                if any(value.strip() for value in row)]
    except (UnicodeError, csv.Error) as error:
        raise ValidationError('Envie um CSV UTF-8 válido separado por ponto e vírgula.') from error
    finally:
        file.seek(0)

    if not rows:
        raise ValidationError('O CSV está vazio.')
    header = [name.strip() for name in rows[0]]
    if len(header) != len(set(header)):
        raise ValidationError('O CSV contém cabeçalhos duplicados.')
    missing = set(columns.values()) - set(header)
    if missing:
        raise ValidationError(f'Colunas ausentes no CSV: {", ".join(sorted(missing))}.')
    indexes = {key: header.index(value) for key, value in columns.items()}
    if 'Piso_a_Piso' in header:
        indexes['floorToFloor'] = header.index('Piso_a_Piso')
    records = []
    ids = set()
    for line, row in enumerate(rows[1:], start=2):
        if len(row) != len(header):
            raise ValidationError(f'Quantidade incorreta de colunas no registro {line}.')

        def get(key):
            return row[indexes[key]].strip() if key in indexes else ''

        raw_id = get('id').lower()
        try:
            identifier = UUID(raw_id)
        except ValueError as error:
            raise ValidationError(f'ID inválido no registro {line}.') from error
        if str(identifier) != raw_id or identifier.int == 0 or raw_id in ids:
            raise ValidationError(f'ID inválido ou duplicado no registro {line}.')
        ids.add(raw_id)

        def decimal(value):
            if not value:
                return None
            try:
                number = float(value.replace(',', '.'))
            except ValueError as error:
                raise ValidationError(f'Número inválido no registro {line}.') from error
            if not math.isfinite(number):
                raise ValidationError(f'Número inválido no registro {line}.')
            return number

        records.append({
            'id': raw_id,
            'areaM2': decimal(get('area') or get('areaFallback')),
            'use': get('use') or None,
            'elevationM': decimal(get('elevation')),
            'floorToFloorM': decimal(get('floorToFloor')),
        })
    return records
