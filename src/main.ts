import gsap from 'gsap';
import { inkParams, isTransitionMode, TRANSITION_MODES } from './gl/params';
import { mountPage } from './page/mount';
import { startAutoMode } from './ui/autoMode';
import { DemoPanel, loadSettings } from './ui/demoPanel';
import { InkTransition, SPREAD } from './ui/inkTransition';
import { applyTheme, getTheme } from './ui/theme';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root missing');

mountPage(app);

const toggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
// Theme already set before first paint by the early script in index.html; just sync ARIA.
applyTheme(getTheme(), toggle);

const canvas = document.createElement('canvas');
canvas.className = 'ink-canvas';
canvas.setAttribute('aria-hidden', 'true');
canvas.setAttribute('data-html2canvas-ignore', '');
document.body.append(canvas);

const params = new URLSearchParams(location.search);
const settings = loadSettings();
const modeParam = params.get('mode');
if (modeParam && isTransitionMode(modeParam)) {
  inkParams.mode = modeParam;
}

// ?gl=0 forces the CSS fallback (what browsers without WebGL2 get).
const ink = new InkTransition(canvas, toggle, { webgl: params.get('gl') !== '0' });

let showMarker = settings.showMarker;
const panel = new DemoPanel(ink, {
  showMarker,
  hideDock: params.get('clean') === '1',
  onMarkerChange: (show) => {
    showMarker = show;
  },
});

toggle?.addEventListener('click', (e) => {
  // detail === 0 means a keyboard-activated click (Enter/Space): spread from the button.
  ink.toggle(e.detail === 0 ? undefined : { x: e.clientX, y: e.clientY });
  panel.refresh();
});

// Text-entry fields swallow shortcuts; sliders and checkboxes in the demo panel don't.
const TEXT_ENTRY =
  'input:not([type="range"]):not([type="checkbox"]):not([type="button"]):not([readonly]), textarea, select, [contenteditable="true"]';

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  if (target instanceof Element && target.closest(TEXT_ENTRY)) return;

  switch (e.key.toLowerCase()) {
    case 't':
      ink.toggle();
      panel.refresh();
      break;
    case 'd':
      panel.toggle();
      break;
    case 'r':
      ink.replay();
      break;
    case 'm':
      panel.cycleMode();
      break;
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
    case '0': {
      // 1..9 => index 0..8, 0 => index 9 (10th mode). Beyond that use M to cycle.
      const idx = e.key === '0' ? 9 : Number(e.key) - 1;
      const mode = TRANSITION_MODES[idx];
      if (mode) panel.setMode(mode.id);
      break;
    }
    default:
      return;
  }
  e.preventDefault();
});

if (params.get('auto') === '1') {
  startAutoMode(ink, () => showMarker, () => panel.refresh());
}

// ?panel=1 opens the controls on load (phones have no "D" key).
if (params.get('panel') === '1') {
  panel.toggle();
}

document.addEventListener('click', (e) => {
  const target = (e.target as Element | null)?.closest<HTMLButtonElement>('[data-open-controls]');
  if (!target) return;
  if (!panel.isOpen) panel.toggle();
  target.setAttribute('aria-expanded', String(panel.isOpen));
});

// Keep Labo button state in sync when panel toggled via keyboard.
const labButton = document.querySelector<HTMLButtonElement>('[data-open-controls]');
if (labButton) {
  const origToggle = panel.toggle.bind(panel);
  panel.toggle = () => {
    origToggle();
    labButton.setAttribute('aria-expanded', String(panel.isOpen));
  };
}

if (import.meta.env.DEV) {
  Object.assign(window, { __ink: ink, __gsap: gsap, __spread: SPREAD, __panel: panel });
  void import('./dev/probe').then((m) => m.installProbe(ink));
}
