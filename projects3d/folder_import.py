"""Validate a standardized project folder and copy its files to owned storage."""

import csv
import io
import logging
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from django.core.exceptions import ValidationError
from django.db import transaction

from projects3d.models import Project, ProjectImage, default_csv_columns
from projects3d.object_data import read_object_csv

logger = logging.getLogger(__name__)
PROJECT_FILES = ('model_file', 'object_data_file', 'location_video', 'cover_image',
                 'summary_file', 'guidelines_file')
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp'}
METADATA_LIMIT = 10 * 1024 * 1024


def file_role(path):
    """Only the root and imagens/ contain deliverables; fontes/ is never imported."""
    parts = PurePosixPath(path.lower()).parts
    if len(parts) == 1:
        name = parts[0]
        fixed = {'massa.3dm': 'model_file', 'objetos.csv': 'object_data_file',
                 'localizacao.mp4': 'location_video', 'localização.mp4': 'location_video',
                 'resumo.txt': 'summary_file', 'resumo.csv': 'summary_file',
                 'diretrizes.csv': 'guidelines_file'}
        if name in fixed:
            return fixed[name]
        if PurePosixPath(name).stem == 'capa' and PurePosixPath(name).suffix in IMAGE_EXTENSIONS:
            return 'cover_image'
    if len(parts) == 1 or (len(parts) == 2 and parts[0] == 'imagens'):
        name = PurePosixPath(parts[-1])
        if name.suffix in IMAGE_EXTENSIONS and re.fullmatch(r'[0-9]{1,8}', name.stem):
            return 'image'
    return None


def read_table(file):
    if file.size > METADATA_LIMIT:
        raise ValidationError(f'{file.name}: a tabela deve ter até 10 MB.')
    try:
        file.seek(0)
        raw = file.read()
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = raw.decode('cp1252')
        return [[cell.strip() for cell in row]
                for row in csv.reader(io.StringIO(text), delimiter=';', strict=True)
                if any(cell.strip() for cell in row)]
    except (UnicodeError, csv.Error) as error:
        raise ValidationError(f'{file.name}: tabela inválida; use ponto e vírgula.') from error
    finally:
        file.seek(0)


def validate_image(file):
    try:
        file.seek(0)
        with Image.open(file) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP'}:
                raise ValidationError(f'{file.name}: use PNG, JPEG ou WebP.')
            image.verify()
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise ValidationError(f'{file.name}: imagem inválida.') from error
    finally:
        file.seek(0)


@dataclass
class FolderBundle:
    files: dict
    images: list
    columns: dict
    summary: list
    guidelines: list
    object_count: int


def inspect_folder(files, paths):
    if not isinstance(paths, list) or len(paths) != len(files) or not files:
        raise ValidationError('Selecione novamente a pasta para conferir seus arquivos.')
    selected = {}
    images = []
    seen_paths = set()
    positions = set()
    for file, relative in zip(files, paths):
        if (not isinstance(relative, str) or '\\' in relative or ':' in relative
                or relative.startswith('/') or any(part in {'', '.', '..'} for part in relative.split('/'))):
            raise ValidationError('A pasta contém um caminho inválido.')
        path = PurePosixPath(relative)
        if path.name != file.name:
            raise ValidationError('O nome de um arquivo não corresponde à pasta selecionada.')
        key = relative.casefold()
        if key in seen_paths:
            raise ValidationError(f'Arquivo repetido: {relative}.')
        seen_paths.add(key)
        role = file_role(relative)
        if role is None:
            continue
        if file.size == 0:
            raise ValidationError(f'{relative}: o arquivo está vazio.')
        if role == 'image':
            position = int(path.stem)
            if position in positions:
                raise ValidationError('Existem imagens com o mesmo número de apresentação.')
            positions.add(position)
            validate_image(file)
            images.append((position, file))
        else:
            if role in selected:
                raise ValidationError(f'Mais de um arquivo para a mesma função: {relative}.')
            selected[role] = file
    missing = [name for role, name in [('model_file', 'massa.3dm'), ('object_data_file', 'objetos.csv')]
               if role not in selected]
    if missing:
        raise ValidationError(f'Arquivos obrigatórios ausentes: {", ".join(missing)}.')
    model = selected['model_file']
    model.seek(0)
    signature = model.read(32)
    model.seek(0)
    if not signature.startswith(b'3D Geometry File Format '):
        raise ValidationError('massa.3dm não é um arquivo Rhino reconhecido.')

    table = read_table(selected['object_data_file'])
    header = table[0] if table else []
    if {'Id', 'Area', 'Uso', 'Cota'}.issubset(header):
        columns = {'id': 'Id', 'area': 'Area', 'use': 'Uso', 'elevation': 'Cota'}
    elif {'ID_OBJETO', 'AREA_BASE_M2', 'USO', 'COTA_BASE_M'}.issubset(header):
        columns = default_csv_columns()
        if 'AREA_CURVA_M2' not in header:
            columns.pop('areaFallback')
    else:
        raise ValidationError('objetos.csv: use Id;Area;Uso;Cota ou os cabeçalhos da exportação Rhino.')
    records = read_object_csv(selected['object_data_file'], columns)
    if not records:
        raise ValidationError('objetos.csv não contém registros de objetos.')
    if 'cover_image' in selected:
        validate_image(selected['cover_image'])
    summary = []
    if 'summary_file' in selected:
        rows = read_table(selected['summary_file'])
        if rows and rows[0][0].casefold() in {'indicador', 'campo'}:
            rows = rows[1:]
        if any(len(row) != 2 or not row[0] for row in rows):
            raise ValidationError('O resumo deve conter duas colunas: indicador;valor.')
        summary = [{'label': row[0], 'value': row[1]} for row in rows]
    guidelines = []
    if 'guidelines_file' in selected:
        guidelines = read_table(selected['guidelines_file'])
        if guidelines and (len(guidelines[0]) > 30 or any(len(row) != len(guidelines[0]) for row in guidelines)):
            raise ValidationError('diretrizes.csv contém uma quantidade inconsistente de colunas.')
    return FolderBundle(selected, sorted(images, key=lambda item: item[0]), columns,
                        summary, guidelines, len(records))


def delete_stored_files(files):
    for storage, name in files:
        try:
            if name:
                storage.delete(name)
        except OSError:
            logger.exception('Não foi possível remover um arquivo substituído do projeto.')


def save_folder(bundle, name, description, source_folder, project_id=None):
    """Roll back database changes and newly copied files if any write fails."""
    copied = []
    try:
        with transaction.atomic():
            if project_id:
                project = Project.objects.select_for_update().get(pk=project_id)
                old_files = [(getattr(project, field).storage, getattr(project, field).name)
                             for field in PROJECT_FILES if getattr(project, field)]
                # Separate versions prevent overwriting files still used by the saved project.
                prefix = f'projects3d/projetos/{project.pk}/versoes/{uuid4().hex}'
            else:
                project = Project.objects.create(name=name)
                old_files = []
                prefix = f'projects3d/projetos/{project.pk}'

            def copy_file(field, file, relative):
                file.seek(0)
                stored = field.storage.save(f'{prefix}/{relative}', file)
                copied.append((field.storage, stored))
                field.name = stored

            for field in PROJECT_FILES:
                target = getattr(project, field)
                if field in bundle.files:
                    file = bundle.files[field]
                    copy_file(target, file, file.name.lower())
                else:
                    setattr(project, field, '')
            project.name = name
            project.description = description
            project.source_folder = source_folder
            project.csv_columns = bundle.columns
            project.summary_data = bundle.summary
            project.guidelines_data = bundle.guidelines
            project.save()
            project.images.all().delete()
            for position, file in bundle.images:
                image = ProjectImage(project=project, position=position, original_name=file.name)
                copy_file(image.image, file, f'imagens/{file.name.lower()}')
                image.save()
            transaction.on_commit(lambda: delete_stored_files(old_files))
        return project
    except Exception:
        delete_stored_files(copied)
        raise
