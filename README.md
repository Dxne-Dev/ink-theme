# Ink Theme — WebGL2 Light/Dark Transitions

Real-time WebGL2 & GLSL light/dark theme transitions powered by full-document GPU snapshots, GSAP choreography, and a live interactive control panel.

Built by **Dxne-Dev** on top of the original WebGL2 ink-bleed prototype (`codemure-official/ink-bleed-theme-changer`), extended with **6 shader transition modes**, a compact **mode selector**, and a one-click **AI integration prompt** generator.

---

## Transition Modes

| # | ID | Mode | Effect |
| - | --- | --- | --- |
| 1 | `ink` | **Ink Bleed** | Domain-warped organic ink spread with tendrils, paper fibres, haze, speckles, and pooled pigment rim. |
| 2 | `ripple` | **Liquid Ripple** | Concentric shockwave packet with UV refraction, RGB chromatic dispersion, and specular caustics. |
| 3 | `ember` | **Ember Burn** | Organic paper combustion with charred soot border, glowing ember frontier, and drifting sparks. |
| 4 | `halftone` | **Halftone Sweep** | Editorial print-screen dot grid growing across an organic wave with RGB risograph split. |
| 5 | `eclipse` | **Solar Eclipse** | Expanding umbral shadow with seam-free animated corona rays and twilight rim. |
| 6 | `crystal` | **Frost & Crystal** | Voronoi polygonal shards flipping facet-by-facet with per-shard prism refraction and icy bevels. |

---

## Quick Start

```bash
git clone https://github.com/Dxne-Dev/ink-theme.git
cd ink-theme
npm install
npm run dev
```

Available scripts in `package.json`:

- `npm run dev` — Start Vite dev server (default `http://localhost:5173/`)
- `npm run build` — Run TypeScript typechecking (`tsc`) and production bundle (`vite build`)
- `npm run preview` — Preview the production build locally

---

## Controls, Shortcuts & URL Flags

### Keyboard Shortcuts
- `1` – `6` : Select transition mode directly
- `M` : Cycle to the next transition mode
- `T` : Toggle light/dark theme from the toggle button
- `R` : Replay the last click (same origin point and random seed) using the active mode
- `D` : Expand or collapse the full control panel

### URL Query Parameters
- `?mode=ember` — Pre-select a mode (`ink`, `ripple`, `ember`, `halftone`, `eclipse`, `crystal`)
- `?panel=1` — Open the full control panel on load
- `?auto=1` — Demo mode (triggers a toggle from a random viewport coordinate every ~3 s)
- `?clean=1` — Hide the collapsed bottom-left dock for clean screen recordings
- `?gl=0` — Force the CSS cross-fade fallback

### One-Click AI Integration Prompt
Open the **Transition controls** panel (`D` or `Controls`), tune your preferred mode and sliders (`Duration`, effect intensity, scale, softness, drift speed, `Slow motion 0.25×`), then click the **`>_` AI integration prompt** box or **`Copy`**.

The button copies a ready-to-paste prompt containing the repository URL, selected mode, exact slider values, and integration instructions for any AI coding assistant (Cursor, Claude Code, Antigravity, Copilot, etc.) to port the effect into React, Next.js, Vue, Astro, or vanilla sites.

---

## How It Works

1. **Offscreen Dual-Theme Capture (`src/capture/capture.ts`)**
   - Lazy-loads `html2canvas` after fonts settle and captures full-document snapshots for both `light` (`#f6f4ef`) and `dark` (`#0b0b0f`) themes via `onclone` without flashing the live page.
   - Automatically invalidates and re-captures on layout changes (`ResizeObserver` + `resize`).
2. **Precomputed Tileable Noise (`src/gl/noiseTexture.ts`)**
   - Generates a seamless `256×256` RGBA gradient-noise texture (`32×32` lattice cells) once at startup so shaders sample smooth FBM noise in a single bilinear fetch per octave.
3. **WebGL2 Shader Pipeline (`src/gl/shaders.ts`, `src/gl/renderer.ts`, `src/gl/program.ts`)**
   - Compiles one fullscreen fragment shader per mode (`src/gl/shaders.ts`) sharing common noise, hashing, and scroll-aware document sampling helpers.
   - Tracks `window.scrollX` / `window.scrollY` in shader space so transitions stay glued to the page while scrolling.
   - Uses two ping-pong offscreen `WebGLFramebuffer` textures (`InkRenderer.freeze`) when interrupted mid-transition so rapid consecutive clicks layer smoothly over the frozen composite frame.
4. **Orchestration & Synchronized Toggle (`src/ui/inkTransition.ts`, `src/ui/themeIcon.ts`)**
   - Covers the viewport with the `"from"` texture, switches `document.documentElement.dataset.theme` underneath, drives the shader progress with GSAP (`power3.out`), then fades the overlay out (`0.15s`) onto the live DOM.
   - Keeps `#theme-toggle` above the canvas (`data-ink-live`) and morphs its SVG sun/moon geometry (`MorphSVGPlugin`) when the transition wave reaches the button.
   - Gracefully falls back to a CSS color cross-fade (`crossFade`) if WebGL2 is unavailable, context is lost, or `prefers-reduced-motion: reduce` is active.

---

## Project Structure

```text
src/
├── main.ts                 # App bootstrap, URL params, keyboard shortcuts
├── capture/
│   └── capture.ts          # Lazy html2canvas full-document snapshots
├── gl/
│   ├── params.ts           # Mode definitions, slider labels, live inkParams state
│   ├── noiseTexture.ts     # 256x256 tileable 4-channel gradient noise texture
│   ├── program.ts          # WebGL2 shader compilation and uniform lookup cache
│   ├── shaders.ts          # Shared GLSL preamble + 6 transition fragment shaders
│   └── renderer.ts         # WebGL2 context, textures, ping-pong composite FBOs
├── ui/
│   ├── theme.ts            # Light/dark dataset.theme helpers
│   ├── themeIcon.ts        # GSAP MorphSVG sun <-> moon icon choreography
│   ├── inkTransition.ts    # Snapshot scheduling, GSAP tweening, CSS fallback
│   ├── demoPanel.ts        # Dock, mode selector, live sliders, AI prompt copier
│   ├── demoPanel.css       # Theme-independent dock & panel styles
│   └── autoMode.ts         # Hands-free ?auto=1 toggle loop & tap marker
├── page/
│   ├── mount.ts            # Synchronous static markup injection + local time
│   ├── page.html           # Portfolio layout (Dxne-Dev)
│   └── page.css            # Page tokens, typography, CSS card thumbnails, canvas rules
└── dev/
    └── probe.ts            # Dev-only window.__probe helpers (frame stepping, bench)
```

---

## Integration Notes for External Sites

- **Capture exclusions:** Add `data-html2canvas-ignore` to fixed overlays (like the WebGL canvas and control panel) so they are never baked into snapshots. Add `data-ink-live` to elements rendered above the canvas (such as the theme toggle button).
- **`html2canvas` CSS compatibility:** Avoid `oklch()`, `color-mix()`, `backdrop-filter`, CSS `filter`, and `mix-blend-mode` on captured elements, and ensure theme color changes are instant (without global CSS `transition` rules) while snapshots are taken.
- **Theme convention:** By default `src/ui/theme.ts` and `src/capture/capture.ts` toggle `html[data-theme="light" | "dark"]`. For `.dark` class setups (e.g. Tailwind), update `applyTheme`, `onclone`, and `BACKGROUND` accordingly.

