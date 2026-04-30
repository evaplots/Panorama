import { getAll, loadIntoState } from '../presets/PresetLoader.js';

export function createIconicViewGallery(container) {
  const root = document.createElement('div');
  root.className = 'pano-section pano-iconic-section';

  const h = document.createElement('h3');
  h.textContent = 'Iconic views';
  root.appendChild(h);

  const strip = document.createElement('div');
  strip.className = 'pano-iconic-strip';
  root.appendChild(strip);

  for (const preset of getAll()) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pano-iconic-card';
    card.dataset.slug = preset.slug;
    card.innerHTML = `
      <div class="pano-iconic-name"></div>
      <div class="pano-iconic-region"></div>
      <div class="pano-iconic-blurb"></div>
    `;
    card.querySelector('.pano-iconic-name').textContent = preset.name;
    card.querySelector('.pano-iconic-region').textContent = preset.region;
    card.querySelector('.pano-iconic-blurb').textContent = preset.blurb;
    strip.appendChild(card);
  }

  strip.addEventListener('click', e => {
    const card = e.target.closest('.pano-iconic-card');
    if (!card) return;
    const slug = card.dataset.slug;

    strip.querySelectorAll('.pano-iconic-card.active')
      .forEach(c => c.classList.remove('active'));
    card.classList.add('active');

    loadIntoState(slug);
  });

  container.appendChild(root);

  return () => { container.removeChild(root); };
}
