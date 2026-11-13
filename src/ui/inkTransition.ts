import gsap from 'gsap';
import { capturePage, layoutKey, renderScale } from '../capture/capture';
import { inkParams, type TransitionMode } from '../gl/params';
import { InkRenderer, type InkFrame, type InkSource } from '../gl/renderer';
import { applyTheme, getTheme, otherTheme, saveTheme, type Theme } from './theme';
import { ThemeIcon } from './themeIcon';

export interface Point {
  x: number;
  y: number;
}

const EASE = 'power3.out';
const FADE_OUT = 0.15;
const RESIZE_DEBOUNCE_MS = 250;
/** CSS cross-fade used without WebGL2, with reduced motion, or before snapshots are ready. */
const CSS_FADE_S = 0.45;

/**
 * Spread shape over time. `growth`: base radius at progress 1 relative to the farthest
 * corner. `cleanupFrom`: fraction of the (linear) duration after which a uniform extra
 * reach slowly eats whatever the noise left behind, so the page is fully covered exactly
 * at the end. `cleanupReach`: that extra reach at t = 1, relative to the farthest corner.
 */
export const SPREAD = { growth: 0.7, cleanupFrom: 0.45, cleanupReach: 0.4, cleanupPow: 2 };

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Everything needed to reproduce a transition exactly ("replay last click"). */
export interface ClickRecord {
  point: Point;
  seed: InkFrame['seed'];
  from: Theme;
}

const REPLAY_HOLD_MS = 400;

type ActiveFrame = Omit<InkFrame, 'progress' | 'linear' | 'radius' | 'time' | 'cleanup'> & {
  /** Frozen at the start of the transition; slider changes affect the next one. */
  duration: number;
};

/**
 * Orchestrates the theme transition:
 *  1. keeps fresh snapshots of both themes on the GPU (pre-captured, re-captured on layout change)
 *  2. on toggle, covers the page with the "from" image, flips the live DOM underneath,
 *     spreads the ink, then fades the overlay away onto the already-flipped page
 *  3. if toggled mid-spread, freezes the frame on screen and spreads the next ink over it
 *  4. falls back to a CSS colour cross-fade without WebGL2 or with reduced motion
 */
export class InkTransition {
  private readonly renderer: InkRenderer | null;
  private readonly toggleButton: HTMLButtonElement | null;
  private readonly icon: ThemeIcon | null;
  private readonly state = { progress: 0, time: 0 };
  private tween: gsap.core.Tween | null = null;
  private fade: gsap.core.Tween | null = null;
  private frame: ActiveFrame | null = null;
  private cssFadeTimer = 0;
  private replayTimer = 0;
  private last: ClickRecord | null = null;

  private captureGen = 0;
  private capturing = false;
  private captureQueued = false;
  private resizeTimer = 0;
  private readonly events = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private disposed = false;
  private fontsReady = false;

  constructor(
    canvas: HTMLCanvasElement,
    toggleButton: HTMLButtonElement | null,
    opts: { webgl?: boolean; observeChanges?: boolean } = {},
  ) {
    this.toggleButton = toggleButton;
    this.icon = toggleButton ? new ThemeIcon(toggleButton) : null;
    this.icon?.set(getTheme());

    this.renderer = opts.webgl === false ? null : InkRenderer.create(canvas);
    document.documentElement.dataset.ink = this.renderer ? 'webgl' : 'css';

    // Stop an in-flight animation immediately if the preference changes.
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) {
        this.cancel();
        window.clearTimeout(this.cssFadeTimer);
        document.documentElement.classList.remove('theme-fade');
        this.icon?.set(getTheme());
      }
      this.invalidate();
    }, { signal: this.events.signal });

    if (!this.renderer) return;
    this.renderer.resize(renderScale());
    this.renderer.watchContext(
      () => {
        this.captureGen++;
        this.captureQueued = true;
        this.cancel();
        this.icon?.set(getTheme());
      },
      () => this.invalidate(),
      this.events.signal,
    );

    window.addEventListener('resize', () => {
      this.renderer?.resize(renderScale());
      if (this.frame) this.draw();
      this.invalidate();
    }, { signal: this.events.signal });

    // A size-only key cannot detect changes to text, colors, or same-sized images.
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.invalidate());
      this.resizeObserver.observe(document.body);
    }
    if (opts.observeChanges !== false) {
      this.mutationObserver = new MutationObserver((records) => {
        if (records.some(affectsCapture)) this.invalidate();
      });
      this.mutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'src', 'srcset', 'sizes', 'width', 'height', 'open', 'value', 'checked', 'disabled'],
      });
      const onContentChange = (event: Event): void => {
        if (event.target instanceof Node && !isCaptureIgnored(event.target)) this.invalidate();
      };
      document.body.addEventListener('input', onContentChange, { capture: true, signal: this.events.signal });
      document.body.addEventListener('change', onContentChange, { capture: true, signal: this.events.signal });
      document.body.addEventListener('load', (event) => {
        if (event.target instanceof HTMLImageElement && !isCaptureIgnored(event.target)) this.invalidate();
      }, { capture: true, signal: this.events.signal });
    }
    document.fonts.addEventListener('loadingdone', () => this.invalidate(), { signal: this.events.signal });
    void document.fonts.ready.then(() => {
      if (this.disposed) return;
      this.fontsReady = true;
      this.invalidate();
    });
  }

  get isWebGL(): boolean {
    return this.renderer !== null && !this.renderer.isLost;
  }

  get isAnimating(): boolean {
    return this.frame !== null;
  }

  /** The most recent click, for "replay last click". */
  get lastClick(): ClickRecord | null {
    return this.last;
  }

  get mode(): TransitionMode {
    return inkParams.mode;
  }

  setMode(mode: TransitionMode): void {
    if (!this.disposed) inkParams.mode = mode;
  }

  /**
   * Mark both snapshots stale, including after changes that do not affect layout.
   * Call this for external rendering changes that DOM observation cannot detect.
   */
  invalidate(): void {
    if (this.disposed || !this.renderer) return;
    this.captureGen++;
    this.captureQueued = true;
    this.renderer.invalidate();
    this.scheduleCapture(RESIZE_DEBOUNCE_MS);
  }

  /** Stop animations and observers and release WebGL resources when unmounting. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.captureGen++;
    this.captureQueued = false;
    this.events.abort();
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.cssFadeTimer);
    window.clearTimeout(this.replayTimer);
    this.cancel();
    this.icon?.set(getTheme());
    this.renderer?.dispose();
    document.documentElement.classList.remove('theme-fade');
    document.documentElement.style.removeProperty('--theme-fade');
  }

  /**
   * Toggle the theme, spreading from `point` (viewport CSS px) or from the toggle button.
   * `seed` reproduces a previous spread exactly.
   */
  toggle(point?: Point, seed?: InkFrame['seed'], opts: { persist?: boolean } = {}): void {
    if (this.disposed) return;
    window.clearTimeout(this.replayTimer);
    // The live DOM always holds the latest target, so this is right even mid-transition.
    const current = getTheme();
    const to = otherTheme(current);
    const center = point ?? this.toggleCenter();
    const frameSeed = seed ?? randomSeed();
    this.last = { point: center, seed: frameSeed, from: current };
    if (opts.persist !== false) saveTheme(to);

    const renderer = this.renderer;
    const scale = renderScale();
    const key = layoutKey(scale);
    const interrupting = this.frame !== null;

    const canAnimate =
      renderer !== null &&
      renderer.supportsMode(inkParams.mode) &&
      !reducedMotion.matches &&
      !this.capturing &&
      !document.documentElement.classList.contains('theme-fade') &&
      renderer.hasValid(to, key) &&
      (interrupting || renderer.hasValid(current, key));

    if (!canAnimate || !renderer) {
      this.cancel();
      this.crossFade(to);
      if (this.capturing) this.invalidate();
      else if (renderer && !reducedMotion.matches) this.scheduleCapture(0);
      return;
    }

    // Interrupted: freeze exactly what is on screen and spread the new ink over it.
    let from: InkSource = current;
    if (interrupting) {
      this.tween?.kill();
      this.fade?.kill();
      this.tween = this.fade = null;
      renderer.resize(scale);
      const frozen = this.currentFrame();
      try {
        if (frozen && renderer.freeze(frozen)) from = 'composite';
      } catch (err) {
        console.warn('[ink] could not freeze the previous frame', err);
      }
      if (from !== 'composite' && !renderer.hasValid(current, key)) {
        this.cancel();
        this.crossFade(to);
        return;
      }
    }

    const maxDist = farthestCorner(center);
    const duration = inkParams.duration;
    this.frame = { mode: inkParams.mode, from, to, center, maxDist, seed: frameSeed, duration };
    this.state.progress = 0;
    this.state.time = 0;

    const chromeFrom = this.icon?.readChrome();
    renderer.resize(scale);
    if (!this.draw()) {
      this.cancel();
      this.crossFade(to);
      return;
    }
    // Same task: the overlay (showing "from") and the flipped DOM hit the screen together.
    gsap.set(renderer.canvas, { opacity: 1 });
    renderer.canvas.classList.add('is-active');
    applyTheme(to, this.toggleButton);

    this.icon?.morphTo(to, {
      duration,
      ease: EASE,
      timeScale: inkParams.timeScale,
      chromeFrom,
      chromeDelay: this.inkArrival(center, maxDist, this.toggleCenter()) * duration,
    });

    this.tween = gsap.to(this.state, {
      progress: 1,
      duration,
      ease: EASE,
      onUpdate: () => {
        // Tween-local seconds: slow motion slows the drift too, so it looks identical.
        this.state.time = this.tween?.time() ?? 0;
        if (!this.draw()) {
          this.cancel();
          this.icon?.set(getTheme());
        }
      },
      onComplete: () => this.finish(),
    });
    this.tween.timeScale(inkParams.timeScale);
  }

  /**
   * Re-run the last click: snap back to the theme it started from, hold briefly (a clean
   * first frame for the recording), then spread again with the same point and seed.
   */
  replay(): boolean {
    const last = this.last;
    if (this.disposed || !last) return false;
    window.clearTimeout(this.replayTimer);
    this.cancel();
    this.icon?.kill();
    if (getTheme() !== last.from) {
      applyTheme(last.from, this.toggleButton);
      this.icon?.set(last.from);
    }
    this.replayTimer = window.setTimeout(() => this.toggle(last.point, last.seed), REPLAY_HOLD_MS);
    return true;
  }

  /** Live playback rate (slow motion), applied to a running transition too. */
  setTimeScale(scale: number): void {
    inkParams.timeScale = scale;
    this.tween?.timeScale(scale);
    this.fade?.timeScale(scale);
    this.icon?.setTimeScale(scale);
  }

  private currentFrame(): InkFrame | null {
    if (!this.frame) return null;
    const { progress, time } = this.state;
    const { maxDist, duration } = this.frame;
    const linear = Math.min(1, time / duration);
    const ramp = Math.max(0, (linear - SPREAD.cleanupFrom) / (1 - SPREAD.cleanupFrom));
    // Second term only acts in the last ~3% (≈40ms): a guarantee for unlucky seeds so the
    // final frame is exactly the "to" snapshot before the fade (measured residual is 0).
    const cleanup =
      ramp ** SPREAD.cleanupPow * maxDist * SPREAD.cleanupReach + Math.max(0, (linear - 0.97) / 0.03) * maxDist;
    return { ...this.frame, progress, linear, time, radius: progress * maxDist * SPREAD.growth, cleanup };
  }

  private draw(): boolean {
    const frame = this.currentFrame();
    return Boolean(this.renderer && frame && this.renderer.draw(frame));
  }

  private finish(): void {
    const canvas = this.renderer?.canvas;
    this.tween = null;
    if (!canvas) return;
    this.fade = gsap
      .to(canvas, { opacity: 0, duration: FADE_OUT, ease: 'none', onComplete: () => this.hide() })
      .timeScale(inkParams.timeScale);
  }

  private hide(): void {
    this.fade = null;
    this.frame = null;
    this.renderer?.canvas.classList.remove('is-active');
    if (this.captureQueued) this.scheduleCapture(0);
  }

  private cancel(): void {
    if (!this.frame) return;
    this.tween?.kill();
    this.fade?.kill();
    this.tween = null;
    this.hide();
  }

  /** CSS fallback, or an instantaneous change when reduced motion is requested. */
  private crossFade(to: Theme): void {
    const root = document.documentElement;
    window.clearTimeout(this.cssFadeTimer);
    if (reducedMotion.matches) {
      root.classList.remove('theme-fade');
      root.style.removeProperty('--theme-fade');
      applyTheme(to, this.toggleButton);
      this.icon?.set(to);
      return;
    }
    root.classList.add('theme-fade');
    root.style.setProperty('--theme-fade', `${CSS_FADE_S}s`);
    applyTheme(to, this.toggleButton);
    this.icon?.morphTo(to, { duration: CSS_FADE_S * 1.6, ease: 'power2.inOut', timeScale: 1 });
    this.cssFadeTimer = window.setTimeout(() => {
      root.classList.remove('theme-fade');
      root.style.removeProperty('--theme-fade');
      if (this.captureQueued) this.scheduleCapture(0);
    }, CSS_FADE_S * 1000 + 50);
  }

  /**
   * Fraction of the duration at which the base ink front reaches `target` (the eased
   * radius inverted; slightly early, since the noise lets the front lead).
   */
  private inkArrival(center: Point, maxDist: number, target: Point): number {
    const dist = Math.hypot(target.x - center.x, target.y - center.y);
    if (dist < 28) return 0;
    const p = Math.min(1, dist / (maxDist * SPREAD.growth * 1.15));
    // Inverse of power3.out, capped: the end-of-spread cleanup sweeps the last corners by ~85%.
    return Math.min(0.85, 1 - Math.cbrt(1 - p));
  }

  private toggleCenter(): Point {
    const r = this.toggleButton?.getBoundingClientRect();
    if (!r) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // ---------- Capture scheduling ----------

  private scheduleCapture(delay: number): void {
    if (this.disposed) return;
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => void this.captureAll(), delay);
  }

  private async captureAll(): Promise<void> {
    const renderer = this.renderer;
    if (this.disposed || !this.fontsReady || !renderer || renderer.isLost || reducedMotion.matches) return;

    // Capturing blocks the main thread; never do it mid-animation (or mid CSS fade, which
    // would bake half-transitioned colours into the snapshot).
    if (this.capturing || this.frame || document.documentElement.classList.contains('theme-fade')) {
      this.captureQueued = true;
      return;
    }

    const scale = renderScale();
    const key = layoutKey(scale);
    const current = getTheme();
    const themes: Theme[] = [current, otherTheme(current)].filter((t) => !renderer.hasValid(t, key));
    this.captureQueued = false;
    if (themes.length === 0) return;

    const gen = ++this.captureGen;
    this.capturing = true;
    try {
      for (const theme of themes) {
        const snap = await capturePage(theme, scale, renderer.maxTextureSize);
        if (this.disposed || renderer.isLost || reducedMotion.matches || gen !== this.captureGen) {
          // An invalidation during capture must be retried after this capture settles.
          if (!this.disposed) this.captureQueued = true;
          break;
        }
        if (snap.key !== layoutKey(renderScale())) {
          // Layout changed while capturing; this snapshot is already stale.
          this.captureQueued = true;
          renderer.invalidate();
          break;
        }
        renderer.upload(snap);
        if (import.meta.env.DEV) {
          console.debug(
            `[ink] captured ${theme} ${snap.canvas.width}×${snap.canvas.height} in ${snap.ms.toFixed(0)}ms`,
          );
        }
      }
    } catch (err) {
      console.error('[ink] capture failed', err);
    } finally {
      this.capturing = false;
    }
    if (this.captureQueued && !this.disposed && !renderer.isLost && !reducedMotion.matches) {
      this.scheduleCapture(RESIZE_DEBOUNCE_MS);
    }
  }
}

/** Ignore live overlays and html2canvas's temporary measurement nodes. */
function isCaptureIgnored(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;
  if (element.closest('[data-html2canvas-ignore], [data-ink-live], .html2canvas-container, boundtest')) return true;
  // html2canvas briefly appends hidden font-metric containers directly to body.
  return element instanceof HTMLElement && !element.isConnected && element.style.visibility === 'hidden';
}

function affectsCapture(record: MutationRecord): boolean {
  if (!record.target.isConnected || isCaptureIgnored(record.target)) return false;
  if (record.type !== 'childList') return true;
  return [...record.addedNodes, ...record.removedNodes].some((node) => !isCaptureIgnored(node));
}

function farthestCorner(p: Point): number {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return Math.max(Math.hypot(p.x, p.y), Math.hypot(w - p.x, p.y), Math.hypot(p.x, h - p.y), Math.hypot(w - p.x, h - p.y)) + 4;
}

function randomSeed(): InkFrame['seed'] {
  return { x: Math.random() * 64 - 32, y: Math.random() * 64 - 32, angle: Math.random() * Math.PI * 2 };
}
