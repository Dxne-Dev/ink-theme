import markup from './page.html?raw';
import './page.css';

/** Injects the static studio markup. Called synchronously before first paint. */
export function mountPage(target: HTMLElement): void {
  target.innerHTML = markup;

  // Static on purpose: the page is snapshotted for the ink transition, so content
  // must not change between capture and reveal.
  const time = target.querySelector<HTMLElement>('#local-time');
  if (time) {
    time.textContent = new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(new Date());
  }
}
