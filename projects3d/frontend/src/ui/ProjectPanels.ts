import { projectConfig } from '../data/config';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export function formatIndicator(value: string): string {
  if (!value.trim()) return 'Não informado';
  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(value.trim())) {
    const number = Number(value.trim().replace(',', '.'));
    if (Number.isFinite(number)) return numberFormat.format(number);
  }
  return value;
}

export function mountProjectPanels(mount: HTMLElement): void {
  const cover = mount.querySelector<HTMLElement>('#cover-panel')!;
  if (projectConfig.coverUrl) {
    const image = element('img', 'project-cover-art');
    image.src = projectConfig.coverUrl;
    image.alt = `Capa de ${projectConfig.name}`;
    image.fetchPriority = 'high';
    cover.append(image);
  } else {
    const content = element('div', 'project-cover-intro');
    content.append(element('p', 'document-eyebrow', 'APRESENTAÇÃO DO PROJETO'),
      element('h1', '', projectConfig.name), element('p', 'project-description', projectConfig.description));
    cover.append(content);
  }
  const actions = element('nav', 'project-management');
  actions.setAttribute('aria-label', 'Gerenciar projeto');
  for (const [text, url] of [['Editar cadastro', projectConfig.editUrl], ['Atualizar pasta', projectConfig.importUrl]]) {
    const link = element('a', '', text);
    link.href = url;
    actions.append(link);
  }
  cover.append(actions);

  const guidelines = mount.querySelector<HTMLElement>('#guidelines-panel')!;
  const document = element('article', 'project-document');
  document.append(element('p', 'document-eyebrow', 'INFORMAÇÕES DO PROJETO'),
    element('h1', '', 'Diretrizes'), element('p', 'document-description', projectConfig.name));
  if (projectConfig.summary.length) {
    const list = element('dl', 'project-indicators');
    for (const item of projectConfig.summary) {
      const row = element('div', 'indicator-row');
      row.append(element('dt', '', item.label), element('dd', '', formatIndicator(item.value)));
      list.append(row);
    }
    document.append(list);
  }
  if (projectConfig.guidelines.length) {
    document.append(element('h2', '', 'Informações complementares'));
    const scroll = element('div', 'project-table-scroll');
    const table = element('table', 'project-guidelines-table');
    const head = element('thead', '');
    const heading = element('tr', '');
    for (const value of projectConfig.guidelines[0]) {
      const cell = element('th', '', value);
      cell.scope = 'col';
      heading.append(cell);
    }
    head.append(heading);
    const body = element('tbody', '');
    for (const values of projectConfig.guidelines.slice(1)) {
      const row = element('tr', '');
      for (const value of values) row.append(element('td', '', formatIndicator(value)));
      body.append(row);
    }
    table.append(head, body);
    scroll.append(table);
    document.append(scroll);
  }
  if (!projectConfig.summary.length && !projectConfig.guidelines.length) {
    document.append(element('p', 'project-empty', 'Este projeto ainda não possui informações de diretrizes.'));
  }
  guidelines.append(document);

  const concept = mount.querySelector<HTMLElement>('#concept-panel')!;
  concept.classList.add('concept-panel');
  if (projectConfig.images.length) {
    const viewer = element('div', 'concept-viewer');
    const stage = element('figure', 'concept-stage');
    const mainImage = element('img', 'concept-main-image');
    mainImage.id = 'concept-main-image';
    mainImage.loading = 'lazy';
    const counter = element('figcaption', 'concept-counter');
    counter.setAttribute('aria-live', 'polite');
    const error = element('p', 'concept-image-error', 'Não foi possível carregar esta imagem. Selecione outra miniatura.');
    error.setAttribute('role', 'status');
    error.hidden = true;
    mainImage.addEventListener('error', () => { error.hidden = false; });
    mainImage.addEventListener('load', () => { error.hidden = true; });
    stage.append(mainImage, counter, error);
    const thumbnails = element('nav', 'concept-thumbnails');
    thumbnails.setAttribute('aria-label', 'Imagens de conceito');
    const buttons: HTMLButtonElement[] = [];
    const selectImage = (index: number) => {
      const item = projectConfig.images[index];
      mainImage.src = item.url;
      mainImage.alt = `${projectConfig.name} — conceito ${item.position}`;
      counter.textContent = `${index + 1} / ${projectConfig.images.length}`;
      error.hidden = true;
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    };
    for (const [index, item] of projectConfig.images.entries()) {
      const button = element('button', 'concept-thumbnail');
      button.type = 'button';
      button.setAttribute('aria-label', `Mostrar imagem ${index + 1} de ${projectConfig.images.length}`);
      button.setAttribute('aria-controls', mainImage.id);
      const image = element('img', '');
      image.src = item.url;
      image.alt = '';
      image.loading = 'lazy';
      button.append(image);
      button.addEventListener('click', () => selectImage(index));
      button.addEventListener('keydown', (event) => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault();
        selectImage(next);
        buttons[next].focus();
        buttons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      buttons.push(button);
      thumbnails.append(button);
    }
    selectImage(0);
    viewer.append(stage, thumbnails);
    concept.append(viewer);
  } else {
    const content = element('article', 'project-document');
    content.append(element('h1', '', 'Conceito'));
    content.append(element('p', 'project-empty', 'Este projeto ainda não possui imagens de conceito.'));
    concept.append(content);
  }
}
