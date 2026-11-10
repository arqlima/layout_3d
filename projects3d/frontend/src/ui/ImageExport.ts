import { createIcon, iconMarkup } from './icons';
import type { ExportedImage, ImageExportOptions } from '../viewer/exportImage';
import type { ScenePrintSource } from './SceneToolbar';

export function mountImageExport(
  button: HTMLButtonElement, name: string, capture: (options: ImageExportOptions) => Promise<ExportedImage>,
): { setReady(ready: boolean): void; setScenes(source: ScenePrintSource): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'sim-export-dialog image-export-dialog';
  dialog.setAttribute('aria-label', 'Imprimir imagem do modelo 3D');
  dialog.innerHTML = `<h2>Imprimir imagem 3D</h2>
    <p>Exporte a vista sem os menus, incluindo o mapa de exposição e a faixa solar quando visíveis. A câmera, as layers, as cotas e a seleção atuais serão mantidas.</p>
    <label>Resolução <select class="image-export-resolution"><option value="4096">4K · até 4.096 px</option><option value="6144">6K · até 6.144 px</option><option value="8192">8K · até 8.192 px</option></select></label>
    <label class="hide-unchecked"><input class="image-export-transparent" type="checkbox" role="switch" checked /> Fundo transparente</label>
    <p class="sim-help">PNG em alta resolução, na proporção da vista. O tamanho final respeita a capacidade do navegador.</p>
    <div><button class="image-export-cancel" type="button">Cancelar</button><button class="image-export-confirm" type="button">${iconMarkup('download')} Gerar PNG</button></div>
    <p class="image-export-status" role="status" aria-live="polite"></p>`;
  const scope = document.createElement('select');
  scope.className = 'image-export-scope';
  scope.setAttribute('aria-label', 'Cenas para imprimir');
  for (const [value, label] of [['current', 'Vista atual'], ['all', 'Todas as cenas salvas'], ['selected', 'Escolher cenas…']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label; scope.append(option);
  }
  const scopeLabel = document.createElement('label');
  scopeLabel.append(document.createTextNode('Imprimir'), scope);
  const choices = document.createElement('fieldset');
  choices.className = 'image-export-scenes';
  choices.hidden = true;
  const print = document.createElement('button');
  print.type = 'button'; print.textContent = 'Imprimir / Salvar PDF';
  dialog.querySelector('p')!.after(scopeLabel, choices);
  dialog.querySelector('.image-export-confirm')!.before(print);
  button.closest('.viewer-panel')!.append(dialog);
  const confirm = dialog.querySelector<HTMLButtonElement>('.image-export-confirm')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('.image-export-cancel')!;
  const status = dialog.querySelector<HTMLElement>('.image-export-status')!;
  const resolution = dialog.querySelector<HTMLSelectElement>('.image-export-resolution')!;
  const transparent = dialog.querySelector<HTMLInputElement>('.image-export-transparent')!;
  let busy = false;
  let scenes: ScenePrintSource | null = null;
  const refreshChoices = () => {
    choices.replaceChildren();
    const legend = document.createElement('legend'); legend.textContent = 'Selecione as cenas'; choices.append(legend);
    for (const scene of scenes?.list() ?? []) {
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox'; check.value = String(scene.index); check.checked = true;
      label.append(check, document.createTextNode(`${scene.index + 1} · ${scene.name}`)); choices.append(label);
    }
    if (!scenes?.list().length) {
      const empty = document.createElement('p'); empty.textContent = 'Salve uma cena para imprimir em lote.'; choices.append(empty);
    }
    choices.hidden = scope.value === 'current';
    choices.disabled = scope.value === 'all';
    confirm.disabled = scope.value !== 'current';
  };
  scope.onchange = refreshChoices;
  button.onclick = () => { if (!busy) { status.textContent = ''; refreshChoices(); dialog.showModal(); } };
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  print.onclick = async () => {
    if (busy) return;
    const indices = scope.value === 'all' ? scenes?.list().map(scene => scene.index) ?? []
      : [...choices.querySelectorAll<HTMLInputElement>('input:checked')].map(input => Number(input.value));
    if (scope.value !== 'current' && (!scenes || !indices.length)) {
      status.textContent = 'Selecione pelo menos uma cena salva.'; return;
    }
    const preview = window.open('', '_blank');
    if (!preview) { status.textContent = 'Permita abrir a janela de impressão neste navegador.'; return; }
    preview.opener = null;
    const doc = preview.document;
    doc.title = `${name} · Cenas`;
    const style = doc.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm; } body { margin: 0; font: 14px Arial, sans-serif; } section { break-after: page; page-break-after: always; } section:last-child { break-after: auto; page-break-after: auto; } h1 { font-size: 16px; margin: 0 0 4mm; } img { display: block; max-width: 100%; max-height: 172mm; object-fit: contain; margin: auto; } @media print { button { display: none; } }';
    doc.head.append(style);
    const retry = doc.createElement('button'); retry.textContent = 'Imprimir / Salvar PDF'; retry.disabled = true;
    retry.onclick = () => preview.print(); doc.body.append(retry);
    const urls: string[] = [];
    preview.addEventListener('unload', () => urls.forEach(url => URL.revokeObjectURL(url)), { once: true });
    busy = true;
    for (const control of [confirm, cancel, print, scope, resolution, transparent, choices]) control.disabled = true;
    const addPage = async (label: string) => {
      if (preview.closed) throw new Error('A janela de impressão foi fechada.');
      status.textContent = `Preparando ${label}…`;
      const image = await capture({ longestEdge: Number(resolution.value), transparent: transparent.checked });
      const page = doc.createElement('section');
      const heading = doc.createElement('h1'); heading.textContent = `${name} · ${label}`;
      const img = doc.createElement('img'); img.alt = label;
      const url = URL.createObjectURL(image.blob); urls.push(url); img.src = url;
      page.append(heading, img); doc.body.append(page);
      await img.decode();
    };
    try {
      if (scope.value === 'current') await addPage('Vista atual');
      else await scenes!.visit(indices, addPage);
      retry.disabled = false;
      preview.focus(); preview.print();
      status.textContent = 'Impressão preparada: uma cena por página. Escolha a impressora ou Salvar como PDF.';
    } catch (error) {
      preview.close(); urls.forEach(url => URL.revokeObjectURL(url));
      status.textContent = error instanceof Error ? error.message : 'Não foi possível preparar a impressão.';
    } finally {
      busy = false;
      for (const control of [confirm, cancel, print, scope, resolution, transparent, choices]) control.disabled = false;
      choices.disabled = scope.value === 'all';
      confirm.disabled = scope.value !== 'current';
    }
  };
  confirm.onclick = async () => {
    if (busy || scope.value !== 'current') return;
    busy = true; confirm.disabled = true; cancel.disabled = true; resolution.disabled = true; transparent.disabled = true; scope.disabled = true; print.disabled = true;
    status.textContent = 'Gerando imagem em alta resolução…';
    confirm.replaceChildren(createIcon('download'), document.createTextNode('Gerando…'));
    try {
      // Permite que o navegador mostre o estado de geração antes de renderizar.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const image = await capture({ longestEdge: Number(resolution.value), transparent: transparent.checked });
      const base = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'modelo';
      const link = document.createElement('a');
      const url = URL.createObjectURL(image.blob);
      link.href = url;
      link.download = `${base}-${image.width}x${image.height}${transparent.checked ? '-sem-fundo' : '-3d'}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `PNG gerado: ${image.width.toLocaleString('pt-BR')} × ${image.height.toLocaleString('pt-BR')} px${transparent.checked ? ', com fundo transparente' : ''}.`;
    } catch (error) {
      status.textContent = error instanceof Error ? `Não foi possível gerar a imagem: ${error.message}` : 'Não foi possível gerar a imagem. Tente uma resolução menor.';
    } finally {
      busy = false; confirm.disabled = false; cancel.disabled = false; resolution.disabled = false; transparent.disabled = false; scope.disabled = false; print.disabled = false;
      confirm.replaceChildren(createIcon('download'), document.createTextNode('Gerar PNG'));
    }
  };
  return { setReady(ready) { button.disabled = !ready; }, setScenes(source) { scenes = source; } };
}
