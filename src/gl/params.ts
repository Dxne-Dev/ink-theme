import type { Theme } from '../ui/theme';

export type TransitionMode = 'ink' | 'ripple' | 'ember' | 'halftone' | 'eclipse' | 'crystal';

export interface ModeSliderLabels {
  tendril: string;
  noiseScale: string;
  softness: string;
  drift: string;
}

export interface ModeMeta {
  id: TransitionMode;
  label: string;
  shortLabel: string;
  sliders: ModeSliderLabels;
}

export const TRANSITION_MODES: readonly ModeMeta[] = [
  {
    id: 'ink',
    label: 'Ink Bleed',
    shortLabel: 'Ink',
    sliders: {
      tendril: 'Tendrils',
      noiseScale: 'Noise scale',
      softness: 'Edge softness',
      drift: 'Drift speed',
    },
  },
  {
    id: 'ripple',
    label: 'Liquid Ripple',
    shortLabel: 'Ripple',
    sliders: {
      tendril: 'Wave power',
      noiseScale: 'Turbulence',
      softness: 'Crest width',
      drift: 'Wave shimmer',
    },
  },
  {
    id: 'ember',
    label: 'Ember Burn',
    shortLabel: 'Ember',
    sliders: {
      tendril: 'Ember glow',
      noiseScale: 'Char scale',
      softness: 'Burn width',
      drift: 'Flicker speed',
    },
  },
  {
    id: 'halftone',
    label: 'Halftone Sweep',
    shortLabel: 'Halftone',
    sliders: {
      tendril: 'Riso split',
      noiseScale: 'Dot scale',
      softness: 'Band width',
      drift: 'Screen drift',
    },
  },
  {
    id: 'eclipse',
    label: 'Solar Eclipse',
    shortLabel: 'Eclipse',
    sliders: {
      tendril: 'Corona rays',
      noiseScale: 'Ray detail',
      softness: 'Twilight width',
      drift: 'Corona speed',
    },
  },
  {
    id: 'crystal',
    label: 'Frost & Crystal',
    shortLabel: 'Crystal',
    sliders: {
      tendril: 'Prism edge',
      noiseScale: 'Facet scale',
      softness: 'Wave span',
      drift: 'Glint speed',
    },
  },
];

export const MODE_BY_ID: Record<TransitionMode, ModeMeta> = {
  ink: TRANSITION_MODES[0]!,
  ripple: TRANSITION_MODES[1]!,
  ember: TRANSITION_MODES[2]!,
  halftone: TRANSITION_MODES[3]!,
  eclipse: TRANSITION_MODES[4]!,
  crystal: TRANSITION_MODES[5]!,
};

export function isTransitionMode(value: string): value is TransitionMode {
  return Object.hasOwn(MODE_BY_ID, value);
}

/** Live-tunable look of the transition. Mutated by the demo panel. */
export interface InkParams {
  /** Active shader transition preset. */
  mode: TransitionMode;
  /** Seconds for the spread (before the 150ms fade). */
  duration: number;
  /** Effect-specific detail / intensity multiplier. */
  tendril: number;
  /** Pattern / noise frequency multiplier. */
  noiseScale: number;
  /** Frontier half-width in CSS px. */
  softness: number;
  /** Speed at which the pattern evolves during the spread. */
  drift: number;
  /** Global playback rate (0.25 for slow motion). */
  timeScale: number;
}

export const inkParams: InkParams = {
  mode: 'ink',
  duration: 1.4,
  tendril: 1,
  noiseScale: 1,
  softness: 1.4,
  drift: 1,
  timeScale: 1,
};

/** Pigment colour pooled at the frontier, keyed by the theme being revealed. */
export const RIM_COLOR: Record<Theme, [number, number, number]> = {
  dark: [0.0, 0.0, 0.01], // ink: a touch denser than the #0b0b0f page
  light: [1.0, 0.996, 0.985], // bleach: a touch brighter than #f6f4ef
};
