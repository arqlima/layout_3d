import type { ProjectionMode, StandardView, ViewState } from '../types/view';

export interface ViewCubeController {
  setActions(onView: (view: StandardView) => void, onProjection: (mode: ProjectionMode) => void): void;
  update(state: ViewState): void;
}

/** Cubo CSS sincronizado com a orientação da câmera Three.js. */
export function createViewCube(host: HTMLElement): ViewCubeController {
  const cubeScene = document.createElement('div');
  cubeScene.className = 'view-cube-scene';
  const cube = document.createElement('div');
  cube.className = 'view-cube';
  const faces: { view: StandardView; text: string; name: string }[] = [
    { view: 'front', text: 'FR', name: 'Frente' },
    { view: 'back', text: 'TR', name: 'Trás' },
    { view: 'left', text: 'ES', name: 'Esquerda' },
    { view: 'right', text: 'DI', name: 'Direita' },
    { view: 'top', text: 'TO', name: 'Topo' },
    { view: 'bottom', text: 'BA', name: 'Base' },
  ];
  let chooseView: (view: StandardView) => void = () => {};
  let chooseProjection: (mode: ProjectionMode) => void = () => {};

  for (const face of faces) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `view-cube-face view-cube-${face.view}`;
    button.textContent = face.text;
    button.title = `Vista ${face.name.toLowerCase()}`;
    button.setAttribute('aria-label', `Vista ${face.name.toLowerCase()}`);
    button.addEventListener('click', () => chooseView(face.view));
    cube.append(button);
  }
  cubeScene.append(cube);

  const viewSelect = document.createElement('select');
  viewSelect.className = 'view-cube-select';
  viewSelect.setAttribute('aria-label', 'Escolher vista padrão');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Escolher vista…';
  viewSelect.append(placeholder);
  for (const face of faces) {
    const option = document.createElement('option');
    option.value = face.view;
    option.textContent = face.name;
    viewSelect.append(option);
  }
  viewSelect.addEventListener('change', () => {
    if (viewSelect.value) chooseView(viewSelect.value as StandardView);
    viewSelect.value = '';
  });

  const projection = document.createElement('div');
  projection.className = 'view-projection';
  const perspective = document.createElement('button');
  perspective.type = 'button';
  perspective.textContent = 'Perspectiva';
  perspective.title = 'Vista em perspectiva';
  perspective.addEventListener('click', () => chooseProjection('perspective'));
  const isometric = document.createElement('button');
  isometric.type = 'button';
  isometric.textContent = 'Isométrica';
  isometric.title = 'Vista isométrica em projeção ortográfica';
  isometric.addEventListener('click', () => chooseProjection('orthographic'));
  projection.append(perspective, isometric);
  host.append(cubeScene, viewSelect, projection);

  return {
    setActions(onView, onProjection) {
      chooseView = onView;
      chooseProjection = onProjection;
    },
    update(state) {
      cube.style.transform = state.cubeTransform;
      perspective.setAttribute('aria-pressed', String(state.projection === 'perspective'));
      isometric.setAttribute('aria-pressed', String(state.projection === 'orthographic'));
    },
  };
}
