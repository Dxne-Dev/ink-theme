import gsap from 'gsap';
import { inkParams } from '../gl/params';
import type { InkTransition, Point } from './inkTransition';

const BASE_INTERVAL_MS = 3000;
const FIRST_DELAY_MS = 1200;

/** A small ring that pulses where the "tap" lands, so viewers see where the drop hit. */
export function showTapMarker(p: Point): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('div');
  el.className = 'tap-marker';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-html2canvas-ignore', '');
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  document.body.append(el);
  gsap.fromTo(
    el,
    { scale: 0.55, opacity: 0.95 },
    {
      scale: 1.7,
      opacity: 0,
      duration: 0.6,
      ease: 'power2.out',
      onComplete: () => el.remove(),
    },
  ).timeScale(inkParams.timeScale);
}

/**
 * ?auto=1: toggles every 3s from a random point, for hands-free recording. The interval
 * stretches in slow motion so each spread finishes before the next begins. Pauses while
 * the tab is hidden.
 */
export function startAutoMode(ink: InkTransition, marker: () => boolean, onToggle?: () => void): () => void {
  let timer = 0;

  const interval = (): number => {
    const spreadMs = ((inkParams.duration + 0.15) / inkParams.timeScale) * 1000;
    return Math.max(BASE_INTERVAL_MS, spreadMs + 900);
  };

  const randomPoint = (): Point => {
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    // Keep away from the edges: a drop near the middle reads better on camera.
    return { x: w * (0.12 + Math.random() * 0.76), y: h * (0.15 + Math.random() * 0.7) };
  };

  const tick = (): void => {
    if (!document.hidden) {
      const p = randomPoint();
      if (marker()) showTapMarker(p);
      ink.toggle(p);
      onToggle?.();
    }
    timer = window.setTimeout(tick, interval());
  };

  timer = window.setTimeout(tick, FIRST_DELAY_MS);
  return () => window.clearTimeout(timer);
}
