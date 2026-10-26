import { projectConfig } from '../data/config';
import { createIcon } from './icons';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const total = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export function mountLocationVideo(panel: HTMLElement): void {
  const video = panel.querySelector<HTMLVideoElement>('#location-video');
  const toggle = panel.querySelector<HTMLButtonElement>('#video-toggle');
  const icon = panel.querySelector<HTMLElement>('#video-icon');
  const action = panel.querySelector<HTMLElement>('#video-action');
  const timeline = panel.querySelector<HTMLInputElement>('#video-timeline');
  const current = panel.querySelector<HTMLElement>('#video-current');
  const duration = panel.querySelector<HTMLElement>('#video-duration');
  const error = panel.querySelector<HTMLElement>('#location-error');
  if (!video || !toggle || !icon || !action || !timeline || !current || !duration || !error) {
    throw new Error('Controles do vídeo incompletos.');
  }

  const updatePlayback = () => {
    const playing = !video.paused && !video.ended;
    icon.replaceChildren(createIcon(playing ? 'pause' : 'play'));
    action.textContent = playing ? 'Pausar' : 'Reproduzir';
    toggle.setAttribute('aria-label', `${action.textContent} vídeo`);
  };
  const updateTimeline = () => {
    const validDuration = Number.isFinite(video.duration) && video.duration > 0;
    timeline.disabled = !validDuration;
    timeline.value = validDuration ? String(Math.round((video.currentTime / video.duration) * 1000)) : '0';
    timeline.style.setProperty('--video-progress', `${Number(timeline.value) / 10}%`);
    current.textContent = formatTime(video.currentTime);
    duration.textContent = formatTime(video.duration);
  };

  toggle.addEventListener('click', async () => {
    if (!video.paused && !video.ended) {
      video.pause();
      return;
    }
    try {
      await video.play();
      error.hidden = true;
    } catch {
      error.textContent = 'Não foi possível reproduzir o vídeo de localização.';
      error.hidden = false;
    }
  });
  timeline.addEventListener('input', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (Number(timeline.value) / 1000) * video.duration;
      updateTimeline();
    }
  });
  video.addEventListener('loadedmetadata', () => {
    error.hidden = true;
    toggle.disabled = false;
    updateTimeline();
  });
  video.addEventListener('durationchange', updateTimeline);
  video.addEventListener('timeupdate', updateTimeline);
  video.addEventListener('play', updatePlayback);
  video.addEventListener('pause', updatePlayback);
  video.addEventListener('ended', updatePlayback);
  video.addEventListener('error', () => {
    if (video.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
    error.textContent = video.error?.code === MediaError.MEDIA_ERR_DECODE
      ? 'O novo MP4 não pôde ser decodificado neste navegador.'
      : video.error?.code === MediaError.MEDIA_ERR_NETWORK
        ? 'Falha ao carregar o vídeo pela rede local. Recarregue a página.'
        : 'Vídeo ausente ou formato MP4 incompatível com este navegador.';
    error.hidden = false;
    toggle.disabled = true;
  });
  // Cada abertura usa um URL novo para não misturar trechos em cache de versões distintas do MP4.
  if (projectConfig.videoUrl) {
    video.src = projectConfig.videoUrl;
  } else {
    toggle.disabled = true;
    error.textContent = 'Este projeto ainda não possui vídeo de localização.';
    error.hidden = false;
  }
  updatePlayback();
  updateTimeline();
}
