import {
  inkParams,
  isTransitionMode,
  MODE_BY_ID,
  TRANSITION_MODES,
  type InkParams,
  type TransitionMode,
} from '../gl/params';
import type { InkTransition } from './inkTransition';
import './demoPanel.css';

/**
 * Transition mode selector + filming controls (toggle panel with "D"). Settings
 * persist in localStorage so a session survives reloads. Both the panel and the
 * collapsed dock are position: fixed and excluded from snapshots.
 */

type SliderKey = 'duration' | 'tendril' | 'noiseScale' | 'softness' | 'drift';

interface SliderDef {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDERS: SliderDef[] = [
  { key: 'duration', label: 'Duration', min: 0.4, max: 4, step: 0.05, format: (v) => `${v.toFixed(2)}s` },
  { key: 'tendril', label: 'Tendrils', min: 0, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'noiseScale', label: 'Noise scale', min: 0.4, max: 2.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'softness', label: 'Edge softness', min: 0.5, max: 8, step: 0.1, format: (v) => `${v.toFixed(1)}px` },
  { key: 'drift', label: 'Drift speed', min: 0, max: 4, step: 0.05, format: (v) => v.toFixed(2) },
];

const STORAGE_KEY = 'ink-bleed:params:v1';
const DEFAULTS: InkParams = { ...inkParams };
const SLOW_MO = 0.25;

export interface PanelOptions {
  showMarker: boolean;
  hideDock?: boolean;
  onMarkerChange: (show: boolean) => void;
}

/** Applies persisted settings to `inkParams`. Call before the first transition. */
export function loadSettings(): { showMarker: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { showMarker: true };
    const saved = JSON.parse(raw) as Partial<InkParams> & { showMarker?: boolean };
    if (typeof saved.mode === 'string' && isTransitionMode(saved.mode)) {
      inkParams.mode = saved.mode;
    }
    for (const s of SLIDERS) {
      const v = saved[s.key];
      if (typeof v === 'number' && Number.isFinite(v)) inkParams[s.key] = clamp(v, s.min, s.max);
    }
    if (saved.timeScale === SLOW_MO) inkParams.timeScale = SLOW_MO;
    return { showMarker: saved.showMarker !== false };
  } catch {
    return { showMarker: true };
  }
}

export class DemoPanel {
  readonly el: HTMLElement;
  readonly dock: HTMLElement;
  private readonly ink: InkTransition;
  private readonly opts: PanelOptions;
  private readonly replayButton: HTMLButtonElement;
  private readonly dockSelect: HTMLSelectElement;
  private readonly modeButtons = new Map<TransitionMode, HTMLButtonElement>();
  private readonly sliderLabels = new Map<SliderKey, HTMLElement>();
  private showMarker: boolean;

  constructor(ink: InkTransition, opts: PanelOptions) {
    this.ink = ink;
    this.opts = opts;
    this.showMarker = opts.showMarker;

    // Compact collapsed dock so the mode selector is immediately discoverable.
    const dock = document.createElement('div');
    dock.className = 'demo-dock';
    dock.hidden = Boolean(opts.hideDock);
    dock.setAttribute('aria-label', 'Transition mode selector');
    dock.setAttribute('data-html2canvas-ignore', '');
    dock.innerHTML = `
      <label class="demo-dock__label" for="transition-mode-select">Mode</label>
      <select class="demo-dock__select" id="transition-mode-select" name="transition-mode" aria-label="Transition effect"></select>
      <button type="button" class="demo-dock__btn demo-dock__btn--accent" data-dock-toggle>Switch</button>
      <button type="button" class="demo-dock__btn" data-dock-open title="Open controls (D)">Controls</button>
    `;

    const select = dock.querySelector<HTMLSelectElement>('.demo-dock__select');
    if (!select) throw new Error('demo dock markup');
    this.dockSelect = select;
    for (const [index, m] of TRANSITION_MODES.entries()) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${index + 1} · ${m.label}`;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      if (isTransitionMode(select.value)) {
        this.setMode(select.value);
      }
    });
    this.bindSwitch(dock.querySelector('[data-dock-toggle]'));
    dock.querySelector('[data-dock-open]')?.addEventListener('click', () => this.toggle());

    const el = document.createElement('aside');
    el.className = 'demo-panel';
    el.hidden = true;
    el.setAttribute('aria-label', 'Transition demo controls');
    el.setAttribute('data-html2canvas-ignore', '');
    el.innerHTML = `
      <header class="demo-panel__head">
        <span>Transition controls</span>
        <span class="demo-panel__head-right">
          <span class="demo-panel__mode">${ink.isWebGL ? 'WebGL2' : 'CSS fallback'}</span>
          <button type="button" class="demo-panel__close" data-close aria-label="Collapse controls">×</button>
        </span>
      </header>
      <div class="demo-panel__modes" role="radiogroup" aria-label="Transition effect"></div>
      <div class="demo-panel__sliders"></div>
      <label class="demo-panel__check">
        <input type="checkbox" data-slowmo /> Slow motion 0.25×
      </label>
      <label class="demo-panel__check">
        <input type="checkbox" data-marker /> Tap marker (auto mode)
      </label>
      <div class="demo-panel__actions">
        <button type="button" data-switch>Switch</button>
        <button type="button" data-replay class="is-quiet" disabled>Replay</button>
        <button type="button" data-reset class="is-quiet">Reset</button>
      </div>
      <p class="demo-panel__keys"><kbd>1</kbd>–<kbd>6</kbd> / <kbd>M</kbd> mode · <kbd>T</kbd> switch · <kbd>R</kbd> replay · <kbd>D</kbd> panel</p>
    `;

    const modes = el.querySelector<HTMLElement>('.demo-panel__modes');
    for (const [index, m] of TRANSITION_MODES.entries()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'demo-panel__mode-btn';
      btn.setAttribute('role', 'radio');
      btn.innerHTML = `<span class="demo-panel__mode-num">${index + 1}</span><span>${m.label}</span>`;
      btn.addEventListener('click', () => this.setMode(m.id));
      modes?.append(btn);
      this.modeButtons.set(m.id, btn);
    }

    const sliders = el.querySelector<HTMLElement>('.demo-panel__sliders');
    for (const s of SLIDERS) sliders?.append(this.slider(s));

    const slowmo = el.querySelector<HTMLInputElement>('[data-slowmo]');
    if (slowmo) {
      slowmo.checked = inkParams.timeScale === SLOW_MO;
      slowmo.addEventListener('change', () => {
        this.ink.setTimeScale(slowmo.checked ? SLOW_MO : 1);
        this.save();
      });
    }

    const marker = el.querySelector<HTMLInputElement>('[data-marker]');
    if (marker) {
      marker.checked = this.showMarker;
      marker.addEventListener('change', () => {
        this.showMarker = marker.checked;
        this.opts.onMarkerChange(marker.checked);
        this.save();
      });
    }

    this.bindSwitch(el.querySelector('[data-switch]'));

    const replay = el.querySelector<HTMLButtonElement>('[data-replay]');
    if (!replay) throw new Error('demo panel markup');
    this.replayButton = replay;
    replay.addEventListener('click', () => this.replay());

    el.querySelector('[data-reset]')?.addEventListener('click', () => this.reset());
    el.querySelector('[data-close]')?.addEventListener('click', () => this.toggle());

    document.body.append(dock, el);
    this.dock = dock;
    this.el = el;
    this.syncModeUI();
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    this.dock.hidden = this.isOpen || Boolean(this.opts.hideDock);
    if (this.isOpen) this.refresh();
  }

  setMode(mode: TransitionMode): void {
    this.ink.setMode(mode);
    this.syncModeUI();
    this.save();
  }

  cycleMode(): TransitionMode {
    const idx = TRANSITION_MODES.findIndex((m) => m.id === inkParams.mode);
    const next = TRANSITION_MODES[(idx + 1) % TRANSITION_MODES.length]!;
    this.setMode(next.id);
    return next.id;
  }

  replay(): void {
    this.ink.replay();
  }

  /** Re-sync controls that depend on transition state. */
  refresh(): void {
    this.replayButton.disabled = this.ink.lastClick === null;
  }

  private syncModeUI(): void {
    const mode = inkParams.mode;
    const meta = MODE_BY_ID[mode];
    this.dockSelect.value = mode;
    for (const [id, btn] of this.modeButtons) {
      const active = id === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    }
    this.setLabel('tendril', meta.sliders.tendril);
    this.setLabel('noiseScale', meta.sliders.noiseScale);
    this.setLabel('softness', meta.sliders.softness);
    this.setLabel('drift', meta.sliders.drift);
  }

  private bindSwitch(button: Element | null): void {
    button?.addEventListener('click', (e) => {
      const ev = e as MouseEvent;
      this.ink.toggle(ev.detail === 0 ? undefined : { x: ev.clientX, y: ev.clientY });
      this.refresh();
    });
  }

  private setLabel(key: SliderKey, text: string): void {
    const label = this.sliderLabels.get(key);
    if (label) label.textContent = text;
  }

  private slider(def: SliderDef): HTMLElement {
    const row = document.createElement('label');
    row.className = 'demo-panel__row';
    row.innerHTML = `
      <span class="demo-panel__label">${def.label}</span>
      <output class="demo-panel__value"></output>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" />
    `;
    const label = row.querySelector<HTMLElement>('.demo-panel__label');
    const input = row.querySelector('input');
    const output = row.querySelector('output');
    if (label) this.sliderLabels.set(def.key, label);
    if (!input || !output) return row;
    input.dataset.key = def.key;
    input.value = String(inkParams[def.key]);
    output.textContent = def.format(inkParams[def.key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      inkParams[def.key] = v; // read every frame by the renderer; duration applies next click
      output.textContent = def.format(v);
      this.save();
    });
    return row;
  }

  private reset(): void {
    for (const s of SLIDERS) {
      inkParams[s.key] = DEFAULTS[s.key];
      const input = this.el.querySelector<HTMLInputElement>(`input[data-key="${s.key}"]`);
      const output = input?.parentElement?.querySelector('output');
      if (input) input.value = String(DEFAULTS[s.key]);
      if (output) output.textContent = s.format(DEFAULTS[s.key]);
    }
    const slowmo = this.el.querySelector<HTMLInputElement>('[data-slowmo]');
    if (slowmo) slowmo.checked = false;
    this.ink.setTimeScale(1);
    this.save();
  }

  private save(): void {
    try {
      const data: Record<string, unknown> = {
        mode: inkParams.mode,
        timeScale: inkParams.timeScale,
        showMarker: this.showMarker,
      };
      for (const s of SLIDERS) data[s.key] = inkParams[s.key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode): settings just won't persist */
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
