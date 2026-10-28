import { projectConfig } from '../data/config';

export type IconName = 'brand-triangle' | 'arrow-right' | 'arrow-left' | 'arrow-up-right' | 'plus' | 'x' | 'search' | 'user' | 'log-out' | 'log-in' | 'edit' | 'trash' | 'folder' | 'box' | 'home' | 'map-pin' | 'file-text' | 'image' | 'calculator' | 'maximize' | 'refresh' | 'save' | 'printer' | 'download' | 'play' | 'pause' | 'move' | 'zoom' | 'orbit';

export function iconMarkup(name: IconName): string {
  return `<svg class="au-icon" aria-hidden="true" focusable="false"><use href="${projectConfig.iconSpriteUrl}#${name}"></use></svg>`;
}

export function createIcon(name: IconName): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'au-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${projectConfig.iconSpriteUrl}#${name}`);
  icon.append(use);
  return icon;
}
