"""Validação, recálculo e exportação A4 da planilha de simulação."""

import io
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

import reportlab
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

CENT = Decimal('0.01')
WIDTH, HEIGHT = A4
MARGIN = 32
RED, GREEN, ORANGE, BLUE, INK, MUTED = '#b6463a', '#16724f', '#a66819', '#246ba0', '#223735', '#687777'


def _number(value, label):
    if isinstance(value, bool):
        raise ValueError(f'{label}: informe um número válido.')
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f'{label}: informe um número válido.') from None
    if not result.is_finite() or result < 0 or result > Decimal('1e12'):
        raise ValueError(f'{label}: use um número entre zero e 1 trilhão.')
    return result


def calculate_report(payload):
    if not isinstance(payload, dict):
        raise ValueError('Dados da simulação inválidos.')
    rows = payload.get('rows')
    if not isinstance(rows, list) or not rows or len(rows) > 500:
        raise ValueError('Envie entre 1 e 500 layers para exportar.')
    land = _number(payload.get('land', 0), 'Terreno')
    grant = _number(payload.get('grant', 0), 'Outorga')
    years = _number(payload.get('years', 0), 'Período')
    costs, sales = [], []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Layer inválida.')
        if any(not isinstance(row.get(key), str) or len(row[key]) > 255 for key in ('name', 'group', 'use')):
            raise ValueError('Nome, grupo ou uso da layer inválido.')
        if row['group'].upper() == 'REP' or row['use'].upper() in ('REP', 'VAGAS'):
            continue
        area = _number(row.get('areaM2'), 'Área')
        for section, destination in (('cost', costs), ('sale', sales)):
            if section == 'sale' and row['use'].upper() != 'PRIV':
                continue
            included = row.get(f'include{section.title()}')
            if not isinstance(included, bool):
                raise ValueError('Informe quais layers entram no cálculo.')
            price = _number(row.get(f'{section}Price', 0), 'Valor por m²')
            total = (area * price).quantize(CENT, rounding=ROUND_HALF_UP) if included else Decimal(0)
            destination.append({**row, 'area': area, 'price': price, 'included': included, 'total': total})
    if not costs:
        raise ValueError('Nenhuma layer com área disponível para exportar.')
    investment = land + grant + sum((row['total'] for row in costs), Decimal(0))
    vgv = sum((row['total'] for row in sales), Decimal(0))
    ratio = vgv / investment if investment else None
    missing = payload.get('missingAreas', 0)
    if isinstance(missing, bool) or not isinstance(missing, int) or missing < 0:
        raise ValueError('Contagem de áreas ausentes inválida.')
    return {'land': land, 'grant': grant, 'years': years, 'costs': costs, 'sales': sales,
            'investment': investment, 'vgv': vgv, 'ratio': ratio,
            'annual': ratio / years if ratio is not None and years else None, 'missing': missing}


def _format(value):
    return f'{value.quantize(CENT, rounding=ROUND_HALF_UP):,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def _layer_label(name):
    parts = name.split('-')
    return '-'.join(parts[1:-1]) if len(parts) >= 3 and all(part.strip() for part in parts) else name


def _usage_label(code):
    names = {'COM': 'Comum', 'PRIV': 'Privado', 'EST': 'Estacionamento'}
    return f'{code} · {names[code]}' if code in names else code


@lru_cache(maxsize=1)
def _fonts():
    root = Path(reportlab.__file__).parent / 'fonts'
    regular, bold = root / 'Vera.ttf', root / 'VeraBd.ttf'
    pdfmetrics.registerFont(TTFont('SimulationSans', str(regular)))
    pdfmetrics.registerFont(TTFont('SimulationBold', str(bold)))
    return regular, bold


class ReportLayout:
    """Um único layout em pontos para o PDF vetorial e as imagens PNG."""

    def __init__(self, project_name):
        _fonts()
        self.project_name = project_name
        self.pages = []
        self.new_page()

    def text(self, x, y, text, size=9, color=INK, bold=False, right=False):
        self.pages[-1].append(('text', x, y, str(text), size, color, bold, right))

    def line(self, y):
        self.pages[-1].append(('line', MARGIN, y, WIDTH - MARGIN, y))

    def new_page(self):
        self.pages.append([])
        self.text(MARGIN, 36, 'Simulação de investimento', 20, bold=True)
        self.text(MARGIN, 55, self.project_name, 9, MUTED)
        self.line(66)
        self.y = 91

    def ensure(self, height):
        if self.y + height > HEIGHT - 50:
            self.new_page()
            return True
        return False

    def section(self, title, color=INK):
        self.ensure(60)
        self.text(MARGIN, self.y, title, 13, color, True)
        self.y += 25

    def pair(self, label, value, color=INK, bold=False):
        self.ensure(25)
        self.text(MARGIN, self.y, label, 10, INK, bold)
        self.text(WIDTH - MARGIN, self.y, value, 10, color, bold, True)
        self.y += 21

    def group_header(self, group, continuation=False):
        self.ensure(44)
        title = group if group == 'Sem grupo' else f'Grupo {group}'
        self.text(MARGIN, self.y, title + (' (continuação)' if continuation else ''), 10, bold=True)
        self.y += 18
        for x, title, right in [(MARGIN, 'Layer', False), (326, 'Área (m²)', True), (437, 'Valor/m² (R$)', True), (WIDTH - MARGIN, 'Total (R$)', True)]:
            self.text(x, self.y, title, 7.5, MUTED, right=right)
        self.y += 18

    def wrap(self, text):
        result, line = [], ''
        for char in text:
            if pdfmetrics.stringWidth(line + char, 'SimulationSans', 8) > 235:
                result.append(line)
                line = ''
            line += char
        return result + [line]

    def table(self, rows, color):
        groups = dict.fromkeys(row['group'] for row in rows)
        for group in groups:
            members = [row for row in rows if row['group'] == group]
            order = {'COM': 0, 'PRIV': 1, 'EST': 2}
            members.sort(key=lambda row: (order.get(row['use'], 3), row['use'], row['name']))
            self.ensure(96)
            self.group_header(group)
            previous_use = None
            for row in members:
                label = _layer_label(row['name']) + ('' if row['included'] else ' (não incluída)')
                lines = self.wrap(label)
                height = max(18, len(lines) * 11 + 6)
                new_usage = row['use'] != previous_use
                if self.ensure(height + 23 + (19 if new_usage else 0)):
                    self.group_header(group, True)
                    new_usage = True
                if new_usage:
                    self.text(MARGIN, self.y, _usage_label(row['use']), 8.5, INK, True)
                    self.y += 19
                for offset, line in enumerate(lines):
                    self.text(MARGIN, self.y + offset * 11, line, 8, ORANGE if row['included'] else MUTED)
                self.text(326, self.y, _format(row['area']), 8, ORANGE, right=True)
                self.text(437, self.y, _format(row['price']), 8, BLUE, right=True)
                self.text(WIDTH - MARGIN, self.y, _format(row['total']), 8, color, right=True)
                self.y += height
                previous_use = row['use']
            self.line(self.y - 6)
            self.text(437, self.y + 7, 'Total do grupo', 8, bold=True, right=True)
            self.text(WIDTH - MARGIN, self.y + 7, _format(sum((row['total'] for row in members), Decimal(0))), 9, color, True, True)
            self.y += 35


def build_report_pages(project_name, report):
    layout = ReportLayout(project_name)
    layout.section('INVESTIMENTO', RED)
    layout.pair('Custos fixos iniciais', 'Valor total (R$)', bold=True)
    layout.pair('Terreno', _format(report['land']), BLUE)
    layout.pair('Outorga', _format(report['grant']), BLUE)
    layout.pair('Total fixo', _format(report['land'] + report['grant']), RED, True)
    layout.y += 10
    layout.section('Custos variáveis por layer', RED)
    layout.table(report['costs'], RED)
    layout.pair('Investimento total (R$)', _format(report['investment']), RED, True)
    layout.y += 12
    layout.section('VGV', GREEN)
    if report['sales']:
        layout.table(report['sales'], GREEN)
    else:
        layout.pair('Nenhuma layer privativa no modelo', '—')
    layout.y += 8
    layout.ensure(170)
    layout.section('RESUMO')
    layout.pair('Investimento total (R$)', _format(report['investment']), RED, True)
    layout.pair('VGV total (R$)', _format(report['vgv']), GREEN, True)
    percent = lambda value: _format(value * 100) + '%' if value is not None else '—'
    layout.pair('VGV%', percent(report['ratio']), GREEN)
    layout.pair('Período (anos)', _format(report['years']) if report['years'] else '—', BLUE)
    layout.pair('Média por ano', percent(report['annual']), BLUE)
    layout.ensure(42)
    layout.text(MARGIN, layout.y, 'VGV% = VGV / investimento. Média por ano = VGV% / anos.', 7, MUTED)
    if report['missing']:
        layout.text(MARGIN, layout.y + 14, f"Áreas parciais: {report['missing']} objeto(s) sem área informada no CSV.", 7, RED)
    for index, page in enumerate(layout.pages, 1):
        page.append(('text', WIDTH - MARGIN, HEIGHT - 18, f'Página {index} / {len(layout.pages)}', 7, MUTED, False, True))
    return layout.pages


def render_report_pdf(pages, title):
    output = io.BytesIO()
    document = canvas.Canvas(output, pagesize=A4)
    document.setTitle(title)
    for page in pages:
        for command in page:
            if command[0] == 'line':
                _, x1, y1, x2, y2 = command
                document.setStrokeColor(HexColor('#dbe2de'))
                document.setLineWidth(.5)
                document.line(x1, HEIGHT - y1, x2, HEIGHT - y2)
            else:
                _, x, y, text, size, color, bold, right = command
                document.setFont('SimulationBold' if bold else 'SimulationSans', size)
                document.setFillColor(HexColor(color))
                (document.drawRightString if right else document.drawString)(x, HEIGHT - y, text)
        document.showPage()
    document.save()
    return output.getvalue()


def render_report_png(page):
    scale = 300 / 72
    image = Image.new('RGB', (round(WIDTH * scale), round(HEIGHT * scale)), 'white')
    draw = ImageDraw.Draw(image)
    fonts = {}
    for command in page:
        if command[0] == 'line':
            _, x1, y1, x2, y2 = command
            draw.line((x1 * scale, y1 * scale, x2 * scale, y2 * scale), fill='#dbe2de', width=2)
        else:
            _, x, y, text, size, color, bold, right = command
            key = (size, bold)
            if key not in fonts:
                fonts[key] = ImageFont.truetype(str(_fonts()[int(bold)]), round(size * scale))
            draw.text((x * scale, y * scale), text, font=fonts[key], fill=color, anchor='rs' if right else 'ls')
    output = io.BytesIO()
    image.save(output, format='PNG', dpi=(300, 300))
    image.close()
    return output.getvalue()


def export_simulation(project_name, payload, output_format):
    if output_format not in ('pdf', 'png'):
        raise ValueError('Escolha PDF ou PNG.')
    report = calculate_report(payload)
    pages = build_report_pages(project_name, report)
    if output_format == 'pdf':
        return render_report_pdf(pages, project_name), 'application/pdf', 'pdf'
    if len(pages) == 1:
        return render_report_png(pages[0]), 'image/png', 'png'
    output = io.BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for index, page in enumerate(pages, 1):
            archive.writestr(f'pagina-{index:02}.png', render_report_png(page))
    return output.getvalue(), 'application/zip', 'zip'
