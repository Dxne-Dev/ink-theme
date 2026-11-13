import { inkParams, MODE_BY_ID, TRANSITION_MODES, type TransitionMode } from '../gl/params';
import type { InkTransition } from './inkTransition';
import './picker.css';

type Category = 'all' | 'classic' | 'organic' | 'spectacular' | 'flagship';

interface CategoryMeta { id: Category; label: string; desc: string; }

const CATEGORIES: CategoryMeta[] = [
  { id: 'all', label: 'Tous', desc: '22 motifs' },
  { id: 'classic', label: 'Classiques', desc: '6 fondateurs' },
  { id: 'organic', label: 'Organiques', desc: '8 fluides' },
  { id: 'spectacular', label: 'Spectaculaires', desc: '6 impacts' },
  { id: 'flagship', label: 'Flagship', desc: '2 premium' },
];

const CATEGORY_BY_MODE: Record<TransitionMode, Category> = {
  ink: 'classic', ripple: 'classic', ember: 'classic', halftone: 'classic', eclipse: 'classic', crystal: 'classic',
  veil: 'organic', tide: 'organic', smoke: 'organic', marble: 'organic', drip: 'organic', bloom: 'organic', aura: 'organic', storm: 'organic',
  nova: 'spectacular', vortex: 'spectacular', prism: 'spectacular', shatter: 'spectacular', plasma: 'spectacular', glitch: 'spectacular',
  fireworks: 'flagship', chrome: 'flagship',
};

const MODE_ICONS: Record<TransitionMode, string> = {
  ink: '◉', ripple: '◎', ember: '🔥', halftone: '▦', eclipse: '◐', crystal: '⬢',
  veil: '〰', tide: '🌊', smoke: '〰', marble: '⬣', drip: '💧', bloom: '✿', aura: '✧', storm: '⚡',
  nova: '✦', vortex: '🌀', prism: '⬔', shatter: '⬥', plasma: '⚡', glitch: '▞',
  fireworks: '🎆', chrome: '◍',
};

const MODE_DESCS: Record<TransitionMode, string> = {
  ink: 'Encre organique, fibres papier & pigment',
  ripple: 'Onde liquide, réfraction & caustiques',
  ember: 'Papier qui brûle, braise & étincelles',
  halftone: 'Trame print, points & split Riso',
  eclipse: 'Ombre totale, couronne & liseré',
  crystal: 'Facettes Voronoi, réfraction',
  veil: 'Voile soyeux, plis & reflet',
  tide: 'Marée, écume & sable mouillé',
  smoke: 'Volute encens, panache & voile',
  marble: 'Marbre veiné, poli & reflets',
  drip: 'Miel doré, coulures & gouttes',
  bloom: 'Corolle radiale, pétales & nervures',
  aura: 'Aurore boréale, voile & halo',
  storm: 'Front orageux, turbulences & éclairs',
  nova: 'Explosion stellaire, flash & plasma',
  vortex: 'Trou noir, spirale & lentille',
  prism: 'Éclat prismatique, facettes & rainbow',
  shatter: 'Vitre brisée, fissures & éclats',
  plasma: 'Arcs électriques, sursaut & lueur',
  glitch: 'Glitch numérique, RGB split & tearing',
  fireworks: 'Feux multi-burst, trails & étincelles',
  chrome: 'Mercure liquide, miroir & perles',
};

export interface PickerOptions {
  ink: InkTransition;
  onSelect?: (mode: TransitionMode) => void;
}

export class Picker {
  readonly el: HTMLElement;
  private readonly ink: InkTransition;
  private readonly onSelect?: (mode: TransitionMode) => void;
  private currentCategory: Category = 'all';
  private searchQuery = '';
  private isOpen = false;
  private lastFocused: HTMLElement | null = null;

  constructor(opts: PickerOptions) {
    this.ink = opts.ink;
    this.onSelect = opts.onSelect;

    const el = document.createElement('div');
    el.className = 'picker';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Sélecteur de motifs');
    el.setAttribute('data-html2canvas-ignore', '');
    el.lang = 'fr';
    el.innerHTML = `
      <div class="picker__backdrop" data-close></div>
      <div class="picker__panel" role="document">
        <header class="picker__head">
          <div class="picker__title">
            <h2>Picker <span>${TRANSITION_MODES.length} motifs</span></h2>
            <p>Choisis ton effet — <kbd>P</kbd> pour ouvrir, <kbd>Échap</kbd> pour fermer, <kbd>1-9</kbd> <kbd>0</kbd> <kbd>M</kbd> pour naviguer</p>
          </div>
          <button type="button" class="picker__close" aria-label="Fermer" data-close>×</button>
        </header>

        <div class="picker__toolbar">
          <div class="picker__cats" role="tablist" aria-label="Catégories"></div>
          <div class="picker__search">
            <input type="search" placeholder="Rechercher (ink, chrome, feu…)" aria-label="Rechercher un motif" />
            <span class="picker__count" aria-live="polite"></span>
          </div>
        </div>

        <div class="picker__grid" role="listbox" aria-label="Motifs disponibles"></div>

        <footer class="picker__foot">
          <span class="picker__hint">
            <kbd>↵</kbd> sélectionner + switch &nbsp;·&nbsp; <kbd>←→↑↓</kbd> naviguer &nbsp;·&nbsp; <kbd>Espace</kbd> prévisualiser
          </span>
          <span class="picker__active"></span>
        </footer>
      </div>
    `;

    document.body.append(el);
    this.el = el;

    this.buildCategories();
    this.bindEvents();
    this.render();
    this.syncActive();
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.lastFocused = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    document.body.classList.add('picker-open');
    // focus search or first card
    requestAnimationFrame(() => {
      const input = this.el.querySelector<HTMLInputElement>('.picker__search input');
      input?.focus();
    });
    this.syncActive();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    document.body.classList.remove('picker-open');
    this.lastFocused?.focus?.();
  }

  private buildCategories(): void {
    const cats = this.el.querySelector('.picker__cats')!;
    for (const c of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker__cat';
      btn.setAttribute('role', 'tab');
      btn.dataset.cat = c.id;
      btn.innerHTML = `<strong>${c.label}</strong><span>${c.desc}</span>`;
      btn.addEventListener('click', () => {
        this.currentCategory = c.id;
        this.render();
      });
      cats.append(btn);
    }
    this.syncCats();
  }

  private syncCats(): void {
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('.picker__cat')) {
      const active = btn.dataset.cat === this.currentCategory;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
  }

  private bindEvents(): void {
    this.el.querySelector('.picker__backdrop')?.addEventListener('click', () => this.close());
    this.el.querySelector('.picker__close')?.addEventListener('click', () => this.close());

    const input = this.el.querySelector<HTMLInputElement>('.picker__search input')!;
    input.addEventListener('input', () => {
      this.searchQuery = input.value.trim().toLowerCase();
      this.render();
    });

    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        this.navigateGrid(e.key);
        e.preventDefault();
      }
    });

    // close on backdrop click already, but also handle picker__panel not closing
    this.el.querySelector('.picker__panel')?.addEventListener('click', (e) => e.stopPropagation());
  }

  private filteredModes(): typeof TRANSITION_MODES {
    let list = [...TRANSITION_MODES];
    if (this.currentCategory !== 'all') {
      list = list.filter(m => CATEGORY_BY_MODE[m.id] === this.currentCategory);
    }
    if (this.searchQuery) {
      const q = this.searchQuery;
      list = list.filter(m =>
        m.label.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        MODE_DESCS[m.id].toLowerCase().includes(q) ||
        CATEGORY_BY_MODE[m.id].includes(q)
      );
    }
    return list as typeof TRANSITION_MODES;
  }

  private render(): void {
    this.syncCats();
    const grid = this.el.querySelector('.picker__grid')!;
    grid.innerHTML = '';
    const modes = this.filteredModes();

    const count = this.el.querySelector('.picker__count')!;
    count.textContent = `${modes.length} / ${TRANSITION_MODES.length}`;

    if (modes.length === 0) {
      grid.innerHTML = `<p class="picker__empty">Aucun motif pour “${this.searchQuery}” — efface ta recherche.</p>`;
      return;
    }

    for (const [idx, m] of modes.entries()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'picker__card';
      card.setAttribute('role', 'option');
      const cat = CATEGORY_BY_MODE[m.id];
      card.dataset.mode = m.id;
      card.dataset.cat = cat;
      card.setAttribute('aria-selected', String(m.id === inkParams.mode));
      if (m.id === inkParams.mode) card.classList.add('is-active');

      card.innerHTML = `
        <span class="picker__thumb picker__thumb--${m.id}" aria-hidden="true">
          <span class="picker__icon">${MODE_ICONS[m.id]}</span>
          <span class="picker__num">${String(idx + 1).padStart(2, '0')}</span>
        </span>
        <span class="picker__meta">
          <strong>${m.label}</strong>
          <span class="picker__id">${m.id} · ${cat}</span>
          <span class="picker__desc">${MODE_DESCS[m.id]}</span>
        </span>
        <span class="picker__go" aria-hidden="true">→</span>
      `;

      card.addEventListener('click', () => this.select(m.id, true));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.select(m.id, true); }
        if (e.key === ' ') { e.preventDefault(); this.preview(m.id); }
      });
      // preview on hover (no switch, just set mode temporarily)
      card.addEventListener('mouseenter', () => this.preview(m.id));
      card.addEventListener('focus', () => this.preview(m.id));

      grid.append(card);
    }
  }

  private preview(mode: TransitionMode): void {
    // live preview: just update the mode without triggering a theme switch
    // demopanel will catch via sync
    this.ink.setMode(mode);
    this.syncActive();
    // also update cards active state without full re-render (cheap)
    for (const card of this.el.querySelectorAll<HTMLButtonElement>('.picker__card')) {
      const active = card.dataset.mode === mode;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-selected', String(active));
    }
  }

  private select(mode: TransitionMode, doSwitch = false): void {
    this.ink.setMode(mode);
    this.onSelect?.(mode);
    this.syncActive();
    this.render();
    if (doSwitch) {
      // trigger a theme toggle to showcase the picked motif
      this.ink.toggle();
    }
    // keep picker open for browsing; user closes with Esc or backdrop
  }

  private syncActive(): void {
    const active = MODE_BY_ID[inkParams.mode];
    const foot = this.el.querySelector('.picker__active');
    if (foot && active) {
      foot.textContent = `Actif : ${active.label} (${active.id})`;
    }
    // sync category active state
    for (const card of this.el.querySelectorAll<HTMLButtonElement>('.picker__card')) {
      const isActive = card.dataset.mode === inkParams.mode;
      card.classList.toggle('is-active', isActive);
    }
  }

  private navigateGrid(key: string): void {
    const cards = [...this.el.querySelectorAll<HTMLButtonElement>('.picker__card')];
    if (cards.length === 0) return;
    const idx = cards.findIndex(c => c === document.activeElement);
    let next = 0;
    const cols = window.innerWidth < 640 ? 1 : window.innerWidth < 900 ? 2 : 3;
    if (idx === -1) next = 0;
    else if (key === 'ArrowRight') next = (idx + 1) % cards.length;
    else if (key === 'ArrowLeft') next = (idx - 1 + cards.length) % cards.length;
    else if (key === 'ArrowDown') next = Math.min(idx + cols, cards.length - 1);
    else if (key === 'ArrowUp') next = Math.max(idx - cols, 0);
    cards[next]?.focus();
  }
}
