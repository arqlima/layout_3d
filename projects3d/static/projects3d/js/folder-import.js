(() => {
  const form = document.getElementById('folder-import-form');
  if (!form) return;
  const input = form.querySelector('[name="folder_files"]');
  const paths = form.querySelector('[name="folder_paths"]');
  const folder = form.querySelector('[name="source_folder"]');
  const submit = document.getElementById('folder-submit');
  const preview = document.getElementById('folder-preview');
  const list = document.getElementById('folder-file-list');
  const error = document.getElementById('folder-error');
  const cover = document.getElementById('folder-cover-preview');
  let coverUrl;
  let validSelection = false;
  function role(path) {
    const name = path.toLowerCase();
    const fixed = {
      'massa.3dm': 'Modelo 3D', 'objetos.csv': 'Tabela de objetos',
      'resumo.txt': 'Resumo', 'resumo.csv': 'Resumo', 'diretrizes.csv': 'Diretrizes',
      'localizacao.mp4': 'Vídeo', 'localização.mp4': 'Vídeo',
    };
    if (fixed[name]) return fixed[name];
    if (!name.includes('/') && name.endsWith('.kmz')) return 'Localização KMZ';
    if (/^capa\.(png|jpe?g|webp)$/.test(name)) return 'Capa';
    if (/^(imagens\/)?[0-9]{1,8}\.(png|jpe?g|webp)$/.test(name)) return 'Imagem';
    return null;
  }
  input.addEventListener('change', () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    cover.hidden = true;
    cover.removeAttribute('src');
    list.replaceChildren();
    error.textContent = '';
    validSelection = false;
    submit.disabled = true;
    paths.value = '[]';
    const original = [...input.files];
    preview.hidden = original.length === 0;
    if (!original.length) return;
    const root = original[0].webkitRelativePath.split('/')[0];
    const selected = original.map(file => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') }))
      .filter(item => role(item.path));
    folder.value = root;
    const nameInput = form.querySelector('[name="name"]');
    if (!nameInput.value.trim()) nameInput.value = root.slice(0, 100);
    const problems = [];
    const seen = new Set();
    const imagePositions = new Set();
    const ordered = selected.toSorted((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
    for (const item of ordered) {
      const kind = role(item.path);
      if (kind === 'Imagem') {
        const position = Number(item.path.split('/').pop().split('.')[0]);
        if (imagePositions.has(position)) problems.push('Há imagens com o mesmo número.');
        imagePositions.add(position);
      } else if (seen.has(kind)) problems.push(`Há mais de um arquivo para ${kind.toLowerCase()}.`);
      seen.add(kind);
      if (!item.file.size) problems.push(`${item.path} está vazio.`);
      const row = document.createElement('li');
      row.textContent = `${kind}: ${item.path} · ${(item.file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`;
      list.append(row);
      if (kind === 'Capa') {
        coverUrl = URL.createObjectURL(item.file);
        cover.src = coverUrl;
        cover.hidden = false;
      }
    }
    for (const required of ['Modelo 3D', 'Tabela de objetos']) {
      if (!seen.has(required)) problems.push(`Não foi encontrado: ${required === 'Modelo 3D' ? 'massa.3dm' : 'objetos.csv'}.`);
    }
    document.getElementById('folder-description').textContent = `${root}: ${selected.length} arquivo(s) para importar; ${original.length - selected.length} ignorado(s).`;
    try {
      // Send only deliverables. Source models, backups and fontes/ remain on the user's computer.
      const transfer = new DataTransfer();
      for (const item of selected) transfer.items.add(item.file);
      input.files = transfer.files;
      input.required = false;
      paths.value = JSON.stringify(selected.map(item => item.path));
    } catch {
      problems.push('Este navegador não conseguiu preparar a pasta. Tente no Chrome ou Edge atualizado.');
    }
    error.textContent = problems.join(' ');
    validSelection = problems.length === 0;
    submit.disabled = !validSelection;
  });
  form.addEventListener('submit', event => {
    if (!validSelection) { event.preventDefault(); return; }
    submit.disabled = true;
    document.getElementById('folder-progress').hidden = false;
  });
  window.addEventListener('pageshow', () => {
    submit.disabled = !validSelection;
    document.getElementById('folder-progress').hidden = true;
  });
})();
