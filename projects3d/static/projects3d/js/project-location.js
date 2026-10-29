(() => {
  for (const note of document.querySelectorAll('[data-location-note]')) {
    const form = note.closest('form');
    if (!form || form.dataset.locationBound) continue;
    form.dataset.locationBound = 'true';
    const upload = form.querySelector('[name="location_kmz"]');
    const clear = form.querySelector('[name="location_kmz-clear"]');
    const coordinates = ['latitude', 'longitude'].map(name => form.querySelector(`[name="${name}"]`));
    const existing = coordinates.some(input => input.disabled);
    const update = () => {
      const locked = upload
        ? Boolean(upload.files.length || (existing && !clear?.checked))
        : JSON.parse(form.querySelector('[name="folder_paths"]').value || '[]')
          .some(path => !path.includes('/') && path.toLowerCase().endsWith('.kmz'));
      for (const input of coordinates) {
        input.disabled = locked;
        input.required = !locked;
      }
    };
    form.addEventListener('change', update);
    // A folder must be selected again after an unsuccessful POST.
    if (!upload) form.querySelector('[name="folder_paths"]').value = '[]';
    update();
  }
})();
