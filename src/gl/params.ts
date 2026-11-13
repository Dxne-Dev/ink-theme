import type { Theme } from '../ui/theme';

export type TransitionMode =
  | 'ink'
  | 'ripple'
  | 'ember'
  | 'halftone'
  | 'eclipse'
  | 'crystal'
  // organic extension — 8 new fluid motifs
  | 'veil'
  | 'tide'
  | 'smoke'
  | 'marble'
  | 'drip'
  | 'bloom'
  | 'aura'
  | 'storm'
  // spectacular extension — 6 high-impact motifs
  | 'nova'
  | 'vortex'
  | 'prism'
  | 'shatter'
  | 'plasma'
  | 'glitch';

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
  {
    id: 'veil',
    label: 'Silk Veil',
    shortLabel: 'Veil',
    sliders: {
      tendril: 'Drape',
      noiseScale: 'Fold scale',
      softness: 'Silk softness',
      drift: 'Sway',
    },
  },
  {
    id: 'tide',
    label: 'Tide Wash',
    shortLabel: 'Tide',
    sliders: {
      tendril: 'Foam',
      noiseScale: 'Swell',
      softness: 'Shore width',
      drift: 'Current',
    },
  },
  {
    id: 'smoke',
    label: 'Smoke Curl',
    shortLabel: 'Smoke',
    sliders: {
      tendril: 'Plume',
      noiseScale: 'Curl scale',
      softness: 'Haze',
      drift: 'Rise',
    },
  },
  {
    id: 'marble',
    label: 'Marble Vein',
    shortLabel: 'Marble',
    sliders: {
      tendril: 'Vein ink',
      noiseScale: 'Grain',
      softness: 'Polish',
      drift: 'Flow',
    },
  },
  {
    id: 'drip',
    label: 'Honey Drip',
    shortLabel: 'Drip',
    sliders: {
      tendril: 'Drip length',
      noiseScale: 'Viscosity',
      softness: 'Edge width',
      drift: 'Flow speed',
    },
  },
  {
    id: 'bloom',
    label: 'Petal Bloom',
    shortLabel: 'Bloom',
    sliders: {
      tendril: 'Petal count',
      noiseScale: 'Petal curl',
      softness: 'Bloom softness',
      drift: 'Sway speed',
    },
  },
  {
    id: 'aura',
    label: 'Aura Glow',
    shortLabel: 'Aura',
    sliders: {
      tendril: 'Halo',
      noiseScale: 'Aura detail',
      softness: 'Glow width',
      drift: 'Pulse',
    },
  },
  {
    id: 'storm',
    label: 'Storm Cloud',
    shortLabel: 'Storm',
    sliders: {
      tendril: 'Turbulence',
      noiseScale: 'Cloud scale',
      softness: 'Front softness',
      drift: 'Wind',
    },
  },
  {
    id: 'nova',
    label: 'Supernova',
    shortLabel: 'Nova',
    sliders: {
      tendril: 'Blast power',
      noiseScale: 'Ray chaos',
      softness: 'Flash width',
      drift: 'Burn speed',
    },
  },
  {
    id: 'vortex',
    label: 'Black Vortex',
    shortLabel: 'Vortex',
    sliders: {
      tendril: 'Spiral arms',
      noiseScale: 'Warp',
      softness: 'Event horizon',
      drift: 'Spin',
    },
  },
  {
    id: 'prism',
    label: 'Prism Burst',
    shortLabel: 'Prism',
    sliders: {
      tendril: 'Dispersion',
      noiseScale: 'Prism scale',
      softness: 'Edge glow',
      drift: 'Spectrum drift',
    },
  },
  {
    id: 'shatter',
    label: 'Glass Shatter',
    shortLabel: 'Shatter',
    sliders: {
      tendril: 'Crack spread',
      noiseScale: 'Shard scale',
      softness: 'Impact softness',
      drift: 'Tremor',
    },
  },
  {
    id: 'plasma',
    label: 'Plasma Surge',
    shortLabel: 'Plasma',
    sliders: {
      tendril: 'Arc intensity',
      noiseScale: 'Plasma grain',
      softness: 'Discharge',
      drift: 'Surge speed',
    },
  },
  {
    id: 'glitch',
    label: 'Digital Glitch',
    shortLabel: 'Glitch',
    sliders: {
      tendril: 'Glitch chaos',
      noiseScale: 'Block scale',
      softness: 'Tear softness',
      drift: 'Flicker',
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
  veil: TRANSITION_MODES[6]!,
  tide: TRANSITION_MODES[7]!,
  smoke: TRANSITION_MODES[8]!,
  marble: TRANSITION_MODES[9]!,
  drip: TRANSITION_MODES[10]!,
  bloom: TRANSITION_MODES[11]!,
  aura: TRANSITION_MODES[12]!,
  storm: TRANSITION_MODES[13]!,
  nova: TRANSITION_MODES[14]!,
  vortex: TRANSITION_MODES[15]!,
  prism: TRANSITION_MODES[16]!,
  shatter: TRANSITION_MODES[17]!,
  plasma: TRANSITION_MODES[18]!,
  glitch: TRANSITION_MODES[19]!,
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
