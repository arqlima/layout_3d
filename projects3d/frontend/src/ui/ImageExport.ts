import { createIcon, iconMarkup } from './icons';
import type { ExportedImage, ImageExportOptions } from '../viewer/exportImage';

export function mountImageExport(
  button: HTMLButtonElement, name: string, capture: (options: ImageExportOptions) => Promise<ExportedImage>,
): { setReady(ready: boolean): void } {
  const dialog = document.createElement('dialog');
  dialog.className = 'sim-export-dialog image-export-dialog';
  dialog.setAttribute('aria-label', 'Imprimir imagem do modelo 3D');
  dialog.innerHTML = `<h2>Imprimir imagem 3D</h2>
    <p>Exporte somente o modelo, sem os menus. A câmera, as layers, as cotas e a seleção atuais serão mantidas.</p>
    <label>Resolução <select class="image-export-resolution"><option value="4096">4K · até 4.096 px</option><option value="6144">6K · até 6.144 px</option><option value="8192">8K · até 8.192 px</option></select></label>
    <label class="hide-unchecked"><input class="image-export-transparent" type="checkbox" role="switch" checked /> Fundo transparente</label>
    <p class="sim-help">PNG em alta resolução, na proporção da vista. O tamanho final respeita a capacidade do navegador.</p>
    <div><button class="image-export-cancel" type="button">Cancelar</button><button class="image-export-confirm" type="button">${iconMarkup('download')} Gerar PNG</button></div>
    <p class="image-export-status" role="status" aria-live="polite"></p>`;
  button.closest('.viewer-panel')!.append(dialog);
  const confirm = dialog.querySelector<HTMLButtonElement>('.image-export-confirm')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('.image-export-cancel')!;
  const status = dialog.querySelector<HTMLElement>('.image-export-status')!;
  const resolution = dialog.querySelector<HTMLSelectElement>('.image-export-resolution')!;
  const transparent = dialog.querySelector<HTMLInputElement>('.image-export-transparent')!;
  let busy = false;
  button.onclick = () => { status.textContent = ''; dialog.showModal(); };
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  confirm.onclick = async () => {
    if (busy) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; resolution.disabled = true; transparent.disabled = true;
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
      busy = false; confirm.disabled = false; cancel.disabled = false; resolution.disabled = false; transparent.disabled = false;
      confirm.replaceChildren(createIcon('download'), document.createTextNode('Gerar PNG'));
    }
  };
  return { setReady(ready) { button.disabled = !ready; } };
}
