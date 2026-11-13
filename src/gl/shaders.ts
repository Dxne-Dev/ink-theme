import { NOISE_CELLS } from './noiseTexture';
import type { TransitionMode } from './params';

/** Fullscreen triangle generated from gl_VertexID — no buffers needed. */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * Shared uniforms, tileable noise samplers, hashing, and document sampling helpers
 * prepended to every transition fragment shader.
 */
const FRAG_PREAMBLE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uFromSize;     // texture px
uniform vec2 uToSize;       // texture px
uniform vec4 uFromMap;      // (texture px per device px, offset x, offset y, flipY)
uniform vec4 uToMap;
uniform float uCanvasScale; // device px per CSS px
uniform vec2 uRes;          // canvas device px

uniform vec2 uCenter;       // CSS px, viewport-relative
uniform float uRadius;      // CSS px, eased base radius
uniform float uCleanup;     // CSS px, extra uniform reach that guarantees full coverage at the end
uniform float uMaxDist;     // CSS px, farthest viewport corner from uCenter
uniform float uLinear;      // linear time progress 0..1
uniform float uTime;        // seconds since click (scaled by slow-mo)
uniform float uRef;         // CSS px, noise reference length (max viewport side)
uniform vec2 uSeed;
uniform mat2 uSeedRot;

uniform float uTendril;     // mode detail / intensity, 0..2.5
uniform float uNoiseScale;  // pattern / noise frequency multiplier
uniform float uSoftness;    // frontier half-width, CSS px
uniform float uDrift;       // time evolution speed
uniform vec3 uRimColor;     // pigment colour pooled at the frontier
uniform float uToDark;      // 1.0 when revealing dark theme, 0.0 when revealing light theme

out vec4 outColor;

uniform sampler2D uNoise;
const float INV_CELLS = 1.0 / ${NOISE_CELLS.toFixed(1)};
const mat2 OCT = mat2(0.8, 0.6, -0.6, 0.8) * 2.03;

float gnoise(vec2 p) {
  return textureLod(uNoise, p * INV_CELLS, 0.0).r * 2.0 - 1.0;
}

float gnoise2(vec2 p) {
  return textureLod(uNoise, p * INV_CELLS, 0.0).g * 2.0 - 1.0;
}

float gnoise3(vec2 p) {
  return textureLod(uNoise, p * INV_CELLS, 0.0).b * 2.0 - 1.0;
}

float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.875;
}

float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.9375;
}

float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * gnoise(p); p = OCT * p + 17.13; a *= 0.5; }
  return s / 0.96875;
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 sampleDoc(sampler2D tex, vec2 size, vec4 map, vec2 devPx) {
  vec2 texPx = devPx * map.x + map.yz;
  if (map.w > 0.5) texPx.y = size.y - texPx.y;
  vec2 uv = clamp(texPx, vec2(0.5), size - 0.5) / size;
  return texture(tex, uv).rgb;
}

vec3 sampleDocRGB(sampler2D tex, vec2 size, vec4 map, vec2 devPx, vec2 offsetCss, vec2 caCss) {
  vec2 base = devPx + offsetCss * uCanvasScale;
  vec2 shift = caCss * uCanvasScale;
  float r = sampleDoc(tex, size, map, base + shift).r;
  float g = sampleDoc(tex, size, map, base).g;
  float b = sampleDoc(tex, size, map, base - shift).b;
  return vec3(r, g, b);
}
`;

/**
 * 1. Ink Bleed: domain-warped organic blob, branching tendrils, paper fibres,
 * diffusion haze, speckles and pooled pigment rim.
 */
const INK_MAIN = /* glsl */ `
const float A_LOBE = 0.22;
const float A_BLOB = 0.20;
const float A_SUM = A_LOBE + A_BLOB;
const float TENDRIL_REACH = 0.24;
const float FIBRE_PX = 1.8;
const float THIN_MAX_PX = 26.0;
const float SPECK_PX = 18.0;
const float HAZE_PX = 16.0;

void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float R = uRadius;
  float cleanup = uCleanup;

  float inner = R * (1.0 - A_SUM) + cleanup - FIBRE_PX - THIN_MAX_PX - uSoftness * 2.0;
  float outer = R * (1.0 + A_SUM) * (1.0 + TENDRIL_REACH * uTendril) + cleanup + FIBRE_PX + SPECK_PX + uSoftness * 2.0;
  if (d < inner) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }
  if (d > outer) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }

  float t = uTime * uDrift;
  vec2 p = rel / uRef;
  vec2 dir = uSeedRot * (rel / max(d, 1e-3));
  float ns = uNoiseScale;

  vec2 q = p * (2.4 * ns) + uSeed;
  vec2 w = vec2(
    fbm3(q + vec2(0.0, 0.31 * t)),
    fbm3(q + vec2(5.2, 1.3) - vec2(0.27 * t, 0.0))
  );

  float blob = fbm5(q + 2.3 * w + vec2(0.12 * t, -0.08 * t));
  vec2 lq = dir * 0.9 + uSeed.yx * 0.37 + vec2(0.06 * t);
  float lobes = gnoise(lq) * 0.75 + gnoise(lq * 2.1 + 9.1) * 0.25;
  float reach = clamp(1.0 + A_LOBE * 1.6 * lobes + A_BLOB * 1.5 * blob, 1.0 - A_SUM, 1.0 + A_SUM);
  float f = d - R * reach;

  float gate = smoothstep(-0.35, 0.4, fbm3(dir * 1.6 + uSeed * 0.61 + 3.7));
  vec2 tq = dir * (2.2 * ns) + (d / uRef) * vec2(2.6, -1.9) * ns + 1.2 * w + uSeed * 1.7 + vec2(0.0, 0.18 * t);
  float n = fbm4(tq);
  float ridgePx = abs(n) * max(d, 24.0) / (4.0 * ns);
  float lenN = gnoise(dir * 3.1 + uSeed * 0.43 + vec2(0.1 * t)) * 0.5 + 0.5;
  float L = uTendril * TENDRIL_REACH * R * gate * (0.35 + 0.65 * lenN);
  float along = clamp(f / max(L, 1.0), 0.0, 1.0);
  float width = clamp(R * 0.022, 1.5, 9.0) * (1.0 - along * along) * gate;
  float ft = max(f - L, ridgePx - width);
  float k = 6.0;
  float hh = clamp(0.5 + 0.5 * (ft - f) / k, 0.0, 1.0);
  f = mix(ft, f, hh) - k * hh * (1.0 - hh);

  vec2 fq = css * 0.34 + uSeed * 13.0;
  float fibre = gnoise2(fq) * 0.65 + gnoise2(OCT * fq + 5.3) * 0.35;
  f += fibre * FIBRE_PX;

  f -= cleanup;

  float soft = max(uSoftness, 0.6);
  float inked = 1.0 - smoothstep(-soft, soft, f);

  float thinW = mix(3.0, THIN_MAX_PX, clamp(blob * 0.8 + 0.3, 0.0, 1.0));
  float density = mix(0.6, 1.0, smoothstep(0.0, thinW, -f));
  float cov = inked * density;

  float hazeW = mix(4.0, HAZE_PX, clamp(0.5 + 0.5 * blob, 0.0, 1.0));
  float haze = (1.0 - smoothstep(0.0, hazeW, f)) * smoothstep(-0.3, 0.6, 0.35 * fibre + w.x);
  cov = max(cov, haze * 0.24 * step(0.0, f));

  float ahead = clamp(f / SPECK_PX, 0.0, 1.0);
  if (f > 0.0 && ahead < 1.0) {
    float sn = gnoise2(css * 0.55 + uSeed * 7.0 + 41.0) * 0.5 + 0.5;
    float th = mix(0.80, 0.96, ahead);
    cov = max(cov, smoothstep(th, th + 0.04, sn) * 0.75 * (1.0 - ahead));
  }

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  float rimX = (f + soft * 1.1) / (soft * 1.4 + 1.2);
  float rim = exp(-rimX * rimX) * inked;
  col = mix(col, uRimColor, rim * 0.45);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 2. Liquid Ripple: concentric shockwave packet with UV refraction, chromatic RGB
 * dispersion and subtle caustic specular highlights.
 */
const RIPPLE_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 rawDir = d < 1e-3 ? vec2(1.0, 0.0) : rel / d;
  vec2 dir = uSeedRot * rawDir;

  float front = uRadius + uCleanup * 1.15;
  float endFade = 1.0 - smoothstep(0.84, 0.99, uLinear);
  float startFade = smoothstep(0.0, 0.05, uLinear);
  float life = startFade * endFade;

  float bandWidth = 82.0 + uSoftness * 18.0;
  float wobble = fbm3(dir * (1.8 * uNoiseScale) + uSeed * 0.5 + vec2(0.0, 0.25 * uTime * uDrift))
    * 16.0 * smoothstep(0.0, 48.0, d) * endFade;

  float dist = d - (front + wobble);

  if (dist < -bandWidth * 2.4) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }
  if (dist > bandWidth * 2.2) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }

  float env = exp(-(dist * dist) / (bandWidth * bandWidth * 0.34));
  float surfNoise = gnoise2(rel / uRef * (4.0 * uNoiseScale) + uSeed + vec2(0.0, 0.4 * uTime * uDrift));
  float phase = dist * (0.145 * uNoiseScale) - uTime * uDrift * 7.5 + surfNoise * 0.7;

  float wave = sin(phase) * env;
  float slope = cos(phase) * env;

  float power = clamp(uTendril, 0.0, 2.5);
  vec2 offsetCss = -rawDir * (slope * 18.0 * power * life);
  vec2 caCss = rawDir * (slope * 4.5 * power * life);

  vec3 from = sampleDocRGB(uFrom, uFromSize, uFromMap, devPx, offsetCss, caCss);
  vec3 to = sampleDocRGB(uTo, uToSize, uToMap, devPx, offsetCss, caCss);

  float crest = max(uSoftness * 6.5, 4.0);
  float cov = (1.0 - smoothstep(-crest, crest, dist)) * startFade;
  if (uLinear >= 0.995) cov = 1.0;

  vec3 col = mix(from, to, cov);

  float caustic = pow(max(0.0, wave), 2.5) * min(power, 1.8) * life;
  float trough = pow(max(0.0, -wave), 2.0) * min(power, 1.5) * life;
  vec3 glint = uToDark > 0.5 ? vec3(0.76, 0.88, 1.0) : vec3(1.0, 0.99, 0.95);
  col = mix(col, glint, clamp(caustic * 0.34, 0.0, 0.45));
  col *= 1.0 - clamp(trough * 0.09, 0.0, 0.14);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 3. Ember Burn: organic paper combustion with charred soot border, glowing ember
 * frontier and drifting incandescent sparks.
 */
const EMBER_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (rel / max(d, 1e-3));

  float burnW = 14.0 + uSoftness * 5.2;
  float R = uRadius;
  float cleanup = uCleanup;

  float inner = R * 0.55 + cleanup - burnW * 3.5 - 4.0;
  float outer = R * 1.48 + cleanup + burnW * 2.0 + 4.0;
  if (d < inner) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }
  if (d > outer) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }

  float t = uTime * uDrift;
  float ns = uNoiseScale;
  vec2 p = rel / uRef;
  vec2 q = p * (2.6 * ns) + uSeed;
  vec2 w = vec2(
    fbm3(q + vec2(0.0, 0.35 * t)),
    fbm3(q + vec2(4.7, 1.9) - vec2(0.28 * t, 0.0))
  );

  float jagged = fbm5(q * 1.55 + 2.1 * w - vec2(0.0, 0.25 * t));
  float lobes = gnoise(dir * 1.4 + uSeed.yx * 0.41) * 0.65 + gnoise(dir * 3.4 + 4.2) * 0.35;
  float reach = clamp(1.0 + 0.18 * lobes + 0.28 * jagged, 0.56, 1.44);

  float fibre = gnoise2(css * 0.42 + uSeed * 9.0);
  float f = d - R * reach - cleanup + fibre * 2.6;

  float startGate = smoothstep(0.0, 0.03, uLinear);
  float endFade = 1.0 - smoothstep(0.88, 0.995, uLinear);

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);

  float revealed = (1.0 - smoothstep(-2.0, 2.0, f)) * startGate;

  // Charred paper soot band just ahead of the burn line.
  float charN = clamp(fbm3(q * 3.4 + 8.3) * 0.5 + 0.65, 0.3, 1.3);
  float charW = burnW * charN;
  float charMask = (1.0 - smoothstep(0.0, charW, max(f, 0.0))) * step(0.0, f) * startGate * endFade;
  vec3 ashCol = uToDark > 0.5 ? vec3(0.045, 0.032, 0.028) : vec3(0.20, 0.12, 0.08);
  from = mix(from, ashCol, charMask * 0.9);

  vec3 col = mix(from, to, revealed);

  // Glowing ember edge right along f = 0.
  float heatNoise = clamp(fbm3(q * 5.2 + vec2(0.3 * t, -0.45 * t)) * 0.55 + 0.72, 0.1, 1.35);
  float emberX = (f - 1.2) / max(burnW * 0.26, 2.2);
  float ember = exp(-emberX * emberX) * heatNoise * clamp(uTendril, 0.15, 2.3) * startGate * endFade;

  vec3 emberCol = mix(vec3(0.88, 0.16, 0.02), vec3(1.0, 0.50, 0.07), smoothstep(0.15, 0.65, ember));
  emberCol = mix(emberCol, vec3(1.0, 0.92, 0.66), smoothstep(0.65, 1.15, ember));
  col = min(col + emberCol * ember * 0.92, vec3(1.0));

  // Drifting sparks trailing in the wake behind the burn edge.
  if (f < burnW * 0.5 && f > -burnW * 3.2 && endFade > 0.01) {
    vec2 sp = css * 0.095 + vec2(0.0, t * 1.8) + uSeed * 0.7;
    vec2 cell = floor(sp);
    vec2 fracP = fract(sp);
    vec2 rnd = hash22(cell);
    float sparkGate = step(0.76, hash21(cell + 19.3));
    float sd = length(fracP - (0.2 + 0.6 * rnd));
    float wake = smoothstep(-burnW * 3.2, -burnW * 0.3, f) * (1.0 - smoothstep(0.0, burnW * 0.5, f));
    float twinkle = 0.55 + 0.45 * sin(rnd.x * 30.0 + t * 12.0);
    float spark = (1.0 - smoothstep(0.05, 0.16, sd)) * sparkGate * wake * twinkle * min(uTendril, 2.0) * startGate * endFade;
    col = min(col + vec3(1.0, 0.68, 0.22) * spark * 1.1, vec3(1.0));
  }

  outColor = vec4(col, 1.0);
}
`;

/**
 * 4. Halftone Sweep: editorial risograph dot grid that grows across an organic
 * wave front with subtle RGB print-registration split.
 */
const HALFTONE_MAIN = /* glsl */ `
float dotCoverage(vec2 gp, float t, float pitch) {
  vec2 cell = fract(gp) - 0.5;
  float r = sqrt(clamp(t, 0.0, 1.0)) * 0.735;
  float aa = 1.25 / pitch;
  return 1.0 - smoothstep(r - aa, r + aa, length(cell));
}

void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (rel / max(d, 1e-3));

  float pitch = clamp(18.0 / max(uNoiseScale, 0.35), 7.0, 44.0);
  float band = 72.0 + uSoftness * 42.0;

  float t = uTime * uDrift;
  float wobble = fbm3(dir * 2.2 + uSeed * 0.5 + vec2(0.0, 0.2 * t)) * 34.0 * min(uTendril, 1.6)
    * (1.0 - smoothstep(0.75, 0.98, uLinear));
  float startShift = band * 0.6 * (1.0 - smoothstep(0.0, 0.12, uLinear));
  float front = uRadius + uCleanup - startShift + wobble;

  float wave = clamp(0.5 - (d - front) / band, 0.0, 1.0) * smoothstep(0.0, 0.04, uLinear);
  if (uLinear >= 0.995) wave = 1.0;

  if (wave <= 0.001) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }
  if (wave >= 0.999) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }

  // Classic ~32deg print screen angle with gentle drift phase.
  mat2 rot = mat2(0.848, 0.530, -0.530, 0.848);
  vec2 gp = (rot * css) / pitch + vec2(0.04 * t, -0.02 * t);

  float bandMask = 4.0 * wave * (1.0 - wave);
  vec2 split = vec2(0.13, -0.09) * uTendril * bandMask;

  float covR = dotCoverage(gp + split, wave, pitch);
  float covG = dotCoverage(gp, wave, pitch);
  float covB = dotCoverage(gp - split, wave, pitch);

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, vec3(covR, covG, covB));

  outColor = vec4(col, 1.0);
}
`;

/**
 * 5. Solar Eclipse: astronomical shadow / twilight terminator with animated
 * unit-circle corona streamers and diamond-ring rim.
 */
const ECLIPSE_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);

  float startGate = smoothstep(0.0, 0.04, uLinear);
  float endFade = 1.0 - smoothstep(0.86, 0.99, uLinear);
  float front = uRadius + uCleanup - 14.0 * (1.0 - smoothstep(0.0, 0.08, uLinear));

  float t = uTime * uDrift;
  float ns = uNoiseScale;

  // Seam-free radial corona rays sampled on unit direction.
  float rayA = fbm4(dir * (3.0 * ns) + uSeed * 0.65 + vec2(0.0, 0.16 * t));
  float rayB = gnoise2(dir * (8.5 * ns) - vec2(0.22 * t, 0.11 * t));
  float streamers = pow(clamp(0.5 + 0.5 * rayA, 0.0, 1.0), 1.65) * (0.65 + 0.35 * rayB);

  float limbWobble = rayA * 8.0 * smoothstep(0.0, 36.0, d) * endFade;
  float f = d - (front + limbWobble);

  float soft = max(uSoftness * 5.5, 4.0);
  float coronaReach = (24.0 + uSoftness * 14.0) * (0.45 + 0.95 * streamers * clamp(uTendril, 0.0, 2.4));

  if (f < -soft * 2.5) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }
  if (f > coronaReach * 4.5 + soft) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);

  float cov = (1.0 - smoothstep(-soft, soft, f)) * startGate;
  if (uLinear >= 0.995) cov = 1.0;

  vec3 col = mix(from, to, cov);

  // Outer corona + crisp chromosphere rim.
  float corona = exp(-max(f, 0.0) / max(coronaReach, 1.0))
    * smoothstep(-soft * 1.4, soft * 0.4, f);
  float rimSigma = max(uSoftness * 2.2, 2.5);
  float rim = exp(-(f * f) / (rimSigma * rimSigma));

  vec3 twilightCol = uToDark > 0.5 ? vec3(0.32, 0.22, 0.68) : vec3(1.0, 0.48, 0.22);
  vec3 rimCol = uToDark > 0.5 ? vec3(1.0, 0.80, 0.45) : vec3(1.0, 0.92, 0.70);

  vec3 glow = twilightCol * corona * (0.35 + 0.55 * streamers)
    + rimCol * rim * (0.45 + 0.4 * clamp(uTendril, 0.0, 2.0));
  glow *= startGate * endFade;

  // Screen blend keeps highlights luminous without harsh clipping.
  col = 1.0 - (1.0 - col) * (1.0 - clamp(glow, 0.0, 0.92));

  outColor = vec4(col, 1.0);
}
`;

/**
 * 6. Frost & Crystal: Voronoi polygonal shards that flip facet-by-facet with
 * per-shard refraction and icy bevel highlights.
 */
const CRYSTAL_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;

  float startGate = smoothstep(0.0, 0.04, uLinear);
  float endFade = 1.0 - smoothstep(0.86, 0.99, uLinear);
  float cellSize = clamp(56.0 / max(uNoiseScale, 0.35), 20.0, 140.0);

  float maxJitter = 75.0 + uSoftness * 22.0;
  float front = uRadius + uCleanup - maxJitter * (1.0 - smoothstep(0.0, 0.1, uLinear));
  float dRough = length(css - uCenter);
  float roughMargin = cellSize * 1.6 + maxJitter + 24.0;

  if (dRough < front - roughMargin) {
    outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0);
    return;
  }
  if (dRough > front + roughMargin) {
    outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0);
    return;
  }

  // Slight lattice rotation so vertical/horizontal UI lines meet angled shards.
  mat2 rot = mat2(0.951, 0.309, -0.309, 0.951);
  vec2 x = (rot * css) / cellSize + uSeed * 0.25;
  vec2 n = floor(x);
  vec2 f = fract(x);

  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  vec2 bestCell = vec2(0.0);
  float md = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = n + g;
      vec2 o = hash22(cell);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      float d2 = dot(r, r);
      if (d2 < md) {
        md = d2;
        mr = r;
        mg = g;
        bestCell = cell;
      }
    }
  }

  // Exact Voronoi border distance in cell units -> CSS px.
  float edgeCell = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      vec2 diff = r - mr;
      if (dot(diff, diff) > 1e-5) {
        edgeCell = min(edgeCell, dot(0.5 * (mr + r), normalize(diff)));
      }
    }
  }
  float edgePx = edgeCell * cellSize;

  // Recover the facet seed in viewport CSS px without inverting rot.
  mat2 invRot = mat2(0.951, -0.309, 0.309, 0.951);
  vec2 facetCss = css + (invRot * mr) * cellSize;
  float facetD = length(facetCss - uCenter);

  float fh = hash21(bestCell);
  vec2 fRand = hash22(bestCell + 13.7) * 2.0 - 1.0;
  vec2 fDir = length(fRand) < 1e-3 ? vec2(1.0, 0.0) : normalize(fRand);

  float cluster = fbm3((facetCss - uCenter) / uRef * 3.0 + uSeed) * 42.0;
  float jitter = ((fh - 0.5) * (34.0 + uSoftness * 34.0) + cluster)
    * (1.0 - smoothstep(0.75, 0.96, uLinear));
  float facetDist = facetD - front + jitter;

  float flip = (1.0 - smoothstep(-9.0, 9.0, facetDist)) * startGate;
  if (uLinear >= 0.995) flip = 1.0;

  float flipPeak = 4.0 * flip * (1.0 - flip);
  float trail = smoothstep(-(cellSize * 1.4 + uSoftness * 18.0), 0.0, facetDist)
    * (1.0 - smoothstep(0.0, 28.0, facetDist));
  float facetEnv = max(flipPeak, trail * 0.72) * startGate * endFade;

  vec2 refractCss = fDir * (9.5 * uTendril * facetEnv);
  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx + refractCss * uCanvasScale);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx + refractCss * uCanvasScale);
  vec3 col = mix(from, to, flip);

  float edgeW = 1.5 + uSoftness * 0.55;
  float bevel = (1.0 - smoothstep(0.0, edgeW, edgePx)) * facetEnv;
  float shimmer = 0.65 + 0.35 * sin(fh * 24.0 + uTime * uDrift * 6.5);
  vec3 iceCol = uToDark > 0.5 ? vec3(0.74, 0.90, 1.0) : vec3(0.45, 0.72, 0.98);

  col = mix(col, iceCol, clamp(bevel * shimmer * (0.45 + 0.3 * min(uTendril, 1.8)), 0.0, 0.88));
  col = mix(col, iceCol, clamp(facetEnv * 0.08 * shimmer, 0.0, 0.14));

  outColor = vec4(col, 1.0);
}
`;


/**
 * 7. Silk Veil: translucent silk fabric unfolding with diagonal folds and soft sheen.
 * Organic drape, gentle sway, luminous silk highlight along the leading edge.
 */
const VEIL_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.0, 2.0);

  // Silk veil has a wider, softer leading edge
  float inner = R * 0.72 + cleanup - soft * 3.0 - 12.0;
  float outer = R * 1.35 + cleanup + soft * 3.0 + 24.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  vec2 q = p * (2.2 * ns) + uSeed;
  // gentle undulation of the veil surface
  float warp = fbm3(q + vec2(0.18 * t, -0.12 * t)) * 0.45;
  float lobes = gnoise(dir * 1.5 + uSeed.yx * 0.5) * 0.5 + gnoise(dir * 3.0 + 5.7) * 0.25;
  float reach = 1.0 + 0.14 * lobes + 0.18 * warp;
  float f = d - R * reach - cleanup;

  // Diagonal silk folds — frequency and amplitude tied to sliders
  vec2 foldDir = normalize(vec2(0.68, -0.73));
  float foldPhase = dot(rel, foldDir) * 0.035 * ns + fbm3(p * 1.8 * ns + vec2(0.22 * t)) * 2.2;
  float foldFreq = 1.1 + uTendril * 0.6;
  float folds = sin(foldPhase * foldFreq) * (5.0 + uTendril * 4.0) * smoothstep(0.0, 60.0, d);
  // secondary finer creases
  folds += sin(foldPhase * foldFreq * 2.3 + 1.4) * (2.0 + uTendril) * 0.35;
  f += folds;

  // subtle fibre grain along the silk
  f += gnoise2(css * 0.38 + uSeed * 8.0) * 0.8;

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // luminous silk sheen at the frontier
  float sheen = exp(-pow((f + soft * 0.2) / max(soft, 1.0), 2.0)) * cov;
  vec3 silkCol = uToDark > 0.5 ? vec3(1.0, 0.96, 0.88) : vec3(0.98, 0.97, 1.0);
  col = mix(col, silkCol, sheen * 0.32 * clamp(uTendril, 0.3, 1.8));

  // faint secondary highlight trailing behind
  float trail = exp(-pow((f + soft * 1.8) / max(soft * 1.6, 1.0), 2.0)) * (1.0 - cov) * 0.18;
  col += silkCol * trail * 0.35;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 8. Tide Wash: ocean tide rolling in with frothy foam crest and wet-sand darkening.
 */
const TIDE_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.8, 2.5);

  float inner = R * 0.62 + cleanup - soft * 2.0 - 10.0;
  float outer = R * 1.42 + cleanup + soft * 2.5 + 20.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  // swell undulation — long wavelength
  vec2 swellQ = p * (1.4 * ns) + uSeed + vec2(0.14 * t, -0.08 * t);
  float swell = fbm3(swellQ) * 0.55 + fbm3(swellQ * 1.9 + 4.2) * 0.25;
  // shorter chop
  float chop = gnoise(dir * 2.2 + vec2(0.2 * t)) * 0.35 + gnoise2(p * 3.5 * ns + vec2(t * 0.3)) * 0.2;
  float reach = 1.0 + 0.12 * swell + 0.08 * chop;
  float f = d - R * reach - cleanup;

  // foam texture — bubbly cellular noise just ahead/behind the front
  float foamPhase = fbm3(p * (6.0 * ns) + vec2(t * 0.25, t * 0.18));
  float foamBand = exp(-pow(f / max(soft * 0.7, 1.0), 2.0));
  float foam = smoothstep(0.35, 0.85, foamPhase * 0.5 + 0.5) * foamBand * clamp(uTendril, 0.2, 2.0);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);

  // wet sand darkening just ahead of tide — only when revealing light->dark? use generic
  float wetMask = (1.0 - smoothstep(0.0, soft * 1.6, f)) * step(0.0, f) * (1.0 - cov) * 0.5;
  from = mix(from, from * 0.72 + vec3(0.04, 0.06, 0.08) * 0.18, wetMask);

  vec3 col = mix(from, to, cov);

  // foam crest — bright, slightly warm
  vec3 foamCol = vec3(0.98, 0.96, 0.92);
  col = mix(col, foamCol, foam * 0.62);
  // subtle translucent wash behind foam
  col = mix(col, to * 0.5 + from * 0.5, foamBand * 0.08 * (1.0 - cov));

  outColor = vec4(col, 1.0);
}
`;

/**
 * 9. Smoke Curl: incense-like plume curling upward with soft billowing.
 */
const SMOKE_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 rawDir = d < 1e-3 ? vec2(0.0, -1.0) : rel / d;
  vec2 dir = uSeedRot * rawDir;
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.5, 2.0);

  float inner = R * 0.58 + cleanup - soft * 2.5 - 16.0;
  float outer = R * 1.48 + cleanup + soft * 2.5 + 32.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  // smoke rises — bias upward in CSS space (y decreases upward on screen? devPx y flipped but css y increases downward)
  // so smoke rises toward -y in css
  float rise = (uCenter.y - css.y) * 0.004 * uDrift;
  vec2 driftQ = p * (2.0 * ns) + uSeed + vec2(0.12 * t + rise * 0.5, -0.18 * t + rise);
  vec2 curlWarp = vec2(fbm3(driftQ + 1.3), fbm3(driftQ + 5.7)) * 0.85;
  float billow = fbm4(p * (1.8 * ns) + curlWarp + vec2(0.0, 0.12 * t));
  float curl = gnoise(dir * 2.5 + vec2(0.25 * t)) * 0.4 + gnoise2(p * 3.2 * ns + vec2(t * 0.2)) * 0.3;

  float reach = 1.0 + 0.18 * billow + 0.10 * curl;
  // smoke tends to elongate upward — stretch y slightly
  float stretch = clamp((uCenter.y - css.y) * 0.0015 * uTendril, -0.12, 0.18);
  reach += stretch;

  float f = d - R * reach - cleanup;
  // add wispy tendrils
  float wisps = fbm3(p * (4.5 * ns) + curlWarp * 1.8 + vec2(0.0, t * 0.35)) * 6.0 * uTendril * 0.18;
  f += wisps * smoothstep(0.0, 80.0, d);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // smoky veil — translucent grey haze trailing the front
  float haze = exp(-pow(max(f, 0.0) / max(soft * 2.2, 1.0), 2.0)) * (1.0 - cov) * 0.45 * clamp(uTendril, 0.3, 2.0);
  vec3 smokeCol = uToDark > 0.5 ? vec3(0.52, 0.54, 0.58) : vec3(0.88, 0.86, 0.82);
  col = mix(col, smokeCol, haze * 0.55);
  // inner darker core
  float core = exp(-pow(f / max(soft * 0.8, 1.0), 2.0)) * cov * 0.12;
  col -= core * 0.18;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 10. Marble Vein: Calacatta marble with sweeping mineral veins and soft polish.
 */
const MARBLE_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift * 0.35;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.8, 1.5);

  float inner = R * 0.68 + cleanup - soft * 2.0 - 10.0;
  float outer = R * 1.38 + cleanup + soft * 2.5 + 18.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  // marble grain — layered warping
  vec2 q = p * (1.9 * ns) + uSeed;
  vec2 warb = vec2(fbm3(q + vec2(0.12*t, -0.08*t)), fbm3(q + vec2(4.2, 1.1) + vec2(-0.09*t, 0.14*t))) * 0.9;
  float grain = fbm5(q * 1.6 + warb * 1.4);
  float veins = sin((p.x * 2.8 + p.y * 1.9) * ns * 2.2 + grain * 3.5 + t * 0.6 + uSeed.x * 4.0);
  veins = pow(abs(veins), 0.7 + uTendril * 0.35);

  float lobes = gnoise(dir * 1.6 + uSeed.yx * 0.4) * 0.35 + fbm3(dir * 2.8 + 3.3) * 0.2;
  float reach = 1.0 + 0.10 * lobes + 0.14 * grain;
  // marble veins create thin peninsulas — modulate front with vein ridges
  float veinRidge = (1.0 - veins) * 10.0 * uTendril * 0.35 * smoothstep(0.0, 90.0, d);
  float f = d - R * reach - cleanup - veinRidge;

  // secondary micro-veins
  float micro = sin((p.x * 5.0 - p.y * 2.2) * ns * 1.5 + grain * 2.0);
  f += micro * 1.2 * smoothstep(0.0, 70.0, d) * clamp(uTendril, 0.2, 1.5);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // marble polish highlight along vein ridges
  float polish = exp(-pow((f + soft * 0.3) / max(soft, 1.0), 2.0)) * cov * (0.45 + veins * 0.35) * clamp(uTendril, 0.2, 1.8);
  vec3 veinCol = uToDark > 0.5 ? vec3(0.62, 0.58, 0.66) : vec3(0.42, 0.42, 0.46);
  col = mix(col, veinCol, polish * 0.28);
  // subtle warm undertone in the marble
  col = mix(col, col * vec3(1.02, 1.0, 0.96), polish * 0.18);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 11. Honey Drip: viscous honey/golden syrup dripping down with gravity tendrils.
 */
const DRIP_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.6, 1.2);

  float inner = R * 0.60 + cleanup - soft * 2.0 - 14.0;
  float outer = R * 1.55 + cleanup + soft * 2.5 + 36.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  vec2 q = p * (2.4 * ns) + uSeed;
  float flow = fbm3(q + vec2(0.0, 0.15 * t));
  float wobble = gnoise((d < 1e-3 ? vec2(1.0, 0.0) : rel / d) + uSeed * 0.6 + vec2(0.15 * t)) * 0.35;

  // gravity — drips elongate downward (positive css y)
  float down = max(0.0, rel.y) / max(uRef, 1.0);
  float gravityStrength = (0.18 + uTendril * 0.22) * smoothstep(0.0, 0.6, down) * R;
  float dripPhase = css.x * 0.045 * ns + uSeed.x * 5.0 + flow * 2.0;
  float dripMask = pow(abs(sin(dripPhase)), 2.5 + uTendril) * 0.85 + pow(abs(sin(dripPhase * 1.7 + 1.2)), 6.0) * 0.45;
  // drips only matter below center and get longer with distance/time
  float dripLen = gravityStrength * dripMask * (0.7 + down * 1.4) * (1.0 + flow * 0.4);
  // drip speed — grow with time
  dripLen *= (1.0 + uLinear * 0.6 + t * 0.08 * clamp(uTendril, 0.2, 1.6));

  float reach = 1.0 + 0.10 * flow + 0.06 * wobble;
  float f = d - R * reach - cleanup - dripLen;

  // secondary droplets along drip tips
  float dropN = hash21(floor(css * 0.08 + vec2(t * 0.5, t * 0.8) + uSeed * 3.0));
  float drops = step(0.78, dropN) * step(f, 6.0) * step(0.0, f) * smoothstep(0.0, 0.4, down);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // honey amber highlight along the drip edge
  float honey = exp(-pow((f + soft * 0.4) / max(soft, 1.0), 2.0)) * cov * (0.7 + dripMask * 0.5);
  vec3 honeyCol = vec3(0.98, 0.72, 0.18);
  honeyCol = mix(honeyCol, vec3(1.0, 0.88, 0.45), uToDark);
  col = mix(col, honeyCol, honey * 0.38 * clamp(uTendril, 0.3, 2.0));
  // droplet glint
  col += vec3(1.0, 0.95, 0.7) * drops * 0.55 * cov;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 12. Petal Bloom: floral petals unfurling radially with soft curl.
 */
const BLOOM_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float ang = atan(rel.y, rel.x);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.9, 1.5);

  float inner = R * 0.55 + cleanup - soft * 2.0 - 12.0;
  float outer = R * 1.50 + cleanup + soft * 2.5 + 28.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // petal count driven by tendril (5 to ~11 petals)
  float petalCount = 5.0 + floor(clamp(uTendril, 0.0, 2.5) * 2.4);
  float normAng = ang * 0.15915494; // / (2pi)
  float petalPhase = fract(normAng * petalCount + uSeed.x * 0.4 + t * 0.02 * uTendril);
  // petal shape — pointed ellipse
  float petalShape = pow(abs(sin(petalPhase * 3.14159)), 0.9 + 0.2 * ns);
  petalShape = pow(petalShape, 1.2);

  // curl along petal length — tips curl back
  float along = d / max(R, 1.0);
  float curl = sin(along * 3.14159 * 0.85 + petalPhase * 0.8) * 0.22 * ns;

  float baseNoise = fbm3(rel / uRef * (2.0 * ns) + uSeed + vec2(0.1 * t));
  float reach = 0.85 + petalShape * 0.38 + curl * 0.12 + baseNoise * 0.06;
  float f = d - R * reach - cleanup;

  // soft petal edge irregularity
  f += gnoise2(petalPhase * 4.0 + vec2(along * 3.0)) * 1.1;

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // petal vein highlight
  float vein = exp(-pow((f + soft * 0.6) / max(soft * 0.9, 1.0), 2.0)) * cov * (0.5 + petalShape * 0.5);
  vec3 petalCol = uToDark > 0.5 ? vec3(0.96, 0.62, 0.78) : vec3(0.98, 0.55, 0.68);
  col = mix(col, petalCol, vein * 0.22 * clamp(uTendril * 0.5, 0.2, 1.2));
  // soft center bloom
  float centerGlow = exp(-pow(d / max(R * 0.35, 1.0), 2.0)) * (1.0 - cov) * 0.08;
  col += petalCol * centerGlow * 0.35;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 13. Aura Glow: aurora borealis-like luminous veil with pulsing halo.
 */
const AURA_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.4, 2.0);

  float inner = R * 0.60 + cleanup - soft * 2.5 - 14.0;
  float outer = R * 1.60 + cleanup + soft * 2.5 + 40.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  float ang = atan(rel.y, rel.x);
  // aurora curtain folds — vertical curtains wrapping radially
  float curtains = sin(ang * (3.0 + uTendril) + p.y * 4.0 * ns + t * 0.7) * 0.5 + 0.5;
  curtains = pow(curtains, 1.1 + ns * 0.25);
  float warp = fbm4(p * (2.0 * ns) + uSeed + vec2(0.12 * t, -0.10 * t));
  float reach = 1.0 + 0.16 * warp + 0.11 * (curtains - 0.5);
  float f = d - R * reach - cleanup;

  // shimmer along curtains
  float shimmer = gnoise2(p * (5.0 * ns) + vec2(t * 0.35, t * 0.22)) * 4.0 * curtains;
  f += shimmer * 0.6 * smoothstep(0.0, 100.0, d);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // aurora glow — colorful halo straddling the edge
  float glow = exp(-pow(max(f, 0.0) / max(soft * 1.8, 1.0), 2.0)) * smoothstep(-soft * 0.5, soft, f + soft) * clamp(uTendril, 0.3, 2.0);
  float pulse = 0.85 + 0.15 * sin(t * 1.8 + curtains * 6.0);
  vec3 auroraA = uToDark > 0.5 ? vec3(0.22, 0.88, 0.72) : vec3(0.18, 0.78, 0.62);
  vec3 auroraB = uToDark > 0.5 ? vec3(0.48, 0.42, 0.92) : vec3(0.72, 0.38, 0.88);
  vec3 aurora = mix(auroraA, auroraB, curtains * 0.6 + warp * 0.2 + 0.2);
  col = mix(col, aurora, glow * 0.42 * pulse);
  // inner rim light
  float rim = exp(-pow((f + soft * 0.3) / max(soft * 0.85, 1.0), 2.0)) * cov * 0.55;
  col = mix(col, aurora * 1.6 + vec3(0.9), rim * 0.22);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 14. Storm Cloud: roiling storm front with turbulent billows and distant lightning flash.
 */
const STORM_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = uSeedRot * (d < 1e-3 ? vec2(1.0, 0.0) : rel / d);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.2, 1.8);

  float inner = R * 0.58 + cleanup - soft * 2.5 - 18.0;
  float outer = R * 1.52 + cleanup + soft * 2.5 + 36.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef;
  // large-scale storm circulation
  vec2 swirl = vec2(-rel.y, rel.x) * 0.0012 * ns;
  vec2 q = p * (1.8 * ns) + uSeed + swirl * t * 0.6;
  float turb = fbm5(q + vec2(0.14 * t, -0.11 * t));
  float billow = fbm4(q * 1.7 + vec2(3.2, -1.8) + vec2(0.08 * t));
  float gust = gnoise(dir * 2.0 + vec2(0.22 * t)) * 0.4 + gnoise2(p * 3.0 * ns + vec2(t * 0.25)) * 0.25;

  float reach = 1.0 + 0.20 * turb + 0.12 * billow + 0.08 * gust;
  float f = d - R * reach - cleanup;

  // turbulent edge breakup
  float breakup = fbm3(p * (3.8 * ns) + turb * 1.2 + vec2(0.0, t * 0.18)) * 8.0 * uTendril * 0.22;
  f += breakup * smoothstep(0.0, 90.0, d);

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // storm shading — dark billowing underside
  float shade = exp(-pow(max(f, 0.0) / max(soft * 2.0, 1.0), 2.0)) * (0.5 + turb * 0.3) * (1.0 - cov) * clamp(uTendril, 0.4, 2.0);
  vec3 stormCol = uToDark > 0.5 ? vec3(0.28, 0.30, 0.38) : vec3(0.42, 0.40, 0.48);
  col = mix(col, stormCol, shade * 0.35);
  // lightning flash — rare bright crack along turbulent ridges
  float flashN = fbm3(p * (9.0 * ns) + vec2(t * 0.6));
  float flash = pow(max(0.0, flashN - 0.42), 2.2) * exp(-pow(f / max(soft, 1.0), 2.0)) * cov * uTendril * 0.6;
  flash *= 0.6 + 0.4 * sin(t * 7.0 + hash21(uSeed) * 20.0);
  col = mix(col, vec3(0.95, 0.96, 1.0), flash * 0.72);

  outColor = vec4(col, 1.0);
}
`;


/**
 * 15. Supernova: star exploding — searing white flash, radiating spikes, plasma wash.
 */
const NOVA_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float ang = atan(rel.y, rel.x);
  vec2 dir = d < 1e-3 ? vec2(1.0,0.0) : rel / d;
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 2.2, 1.8);

  float inner = R * 0.58 + cleanup - soft*2.5 - 12.0;
  float outer = R * 1.55 + cleanup + soft*3.0 + 42.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // star spike rays — 6-fold + noise chaos
  float baseAng = ang + uSeed.x * 3.0;
  float rayN = fbm3(vec2(cos(baseAng), sin(baseAng)) * (2.8*ns) + vec2(t*0.22));
  float rayCount = 5.0 + floor(clamp(uTendril,0.0,2.5)*1.8); // 5..9 spikes
  float rayPhase = fract(baseAng * 0.15915494 * rayCount);
  float spike = pow(abs(sin(rayPhase * 3.14159)), 2.8 - ns*0.15) * (0.7 + rayN*0.45);
  spike = pow(spike, 1.15) * (18.0 + uTendril*10.0) * smoothstep(0.0, 80.0, d);

  float warp = fbm4(rel/uRef*(2.2*ns) + uSeed + vec2(t*0.18));
  float reach = 1.0 + 0.12*warp + 0.06*rayN;
  float f = d - R*reach - cleanup - spike;

  // secondary flash ring
  float ring = exp(-pow((d - R*0.55)/max(18.0, soft*3.0), 2.0)) * 0.25 * (1.0 - smoothstep(0.4,0.9,uLinear));

  float cov = 1.0 - smoothstep(-soft, soft, f);
  cov = max(cov, ring);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx);
  vec3 col = mix(from, to, cov);

  // searing flash
  float flash = exp(-pow((f+soft*0.2)/max(soft,1.0),2.0)) * cov;
  float flash2 = exp(-pow(max(f,0.0)/max(soft*1.6,1.0),2.0)) * smoothstep(-soft*0.8, soft*0.4, f+soft) * 0.6;
  vec3 hot = vec3(1.0, 0.92, 0.75);
  vec3 plasma = mix(vec3(1.0,0.42,0.12), vec3(0.98,0.18,0.02), smoothstep(0.2,0.8, flash));
  col = mix(col, plasma, flash * 0.65);
  col = mix(col, hot, flash2 * 0.38 * clamp(uTendril,0.4,2.0));
  // outer blast glow
  float blast = exp(-pow(max(f,0.0)/max(soft*2.2,1.0),2.0)) * (0.5 + spike*0.015);
  col = 1.0 - (1.0 - col) * (1.0 - vec3(1.0,0.55,0.18) * blast * 0.55);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 16. Black Vortex: swirling black-hole accretion with lensed shimmer.
 */
const VORTEX_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  vec2 dir = d < 1e-3 ? vec2(1.0,0.0) : rel / d;
  float ang = atan(rel.y, rel.x);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.9, 1.4);

  float inner = R * 0.52 + cleanup - soft*2.2 - 14.0;
  float outer = R * 1.60 + cleanup + soft*2.8 + 36.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // spiral twist — angle twists with 1/d + time
  float twist = t * 2.2 * clamp(uTendril*0.45, 0.25, 1.2) + 2.8 / max(d*0.02, 0.4);
  float spiralAng = ang + twist * (1.0 + 0.4 / max(d*0.008+0.6, 0.3));
  vec2 spiralDir = vec2(cos(spiralAng), sin(spiralAng));

  vec2 p = rel / uRef;
  float arms = 2.0 + floor(clamp(uTendril,0.0,2.5)*1.2); // 2..5 arms
  float armPhase = fract(spiralAng * 0.15915494 * arms);
  float armMask = pow(abs(sin(armPhase*3.14159)), 1.6 + ns*0.2);

  float turb = fbm4(p*(1.9*ns) + vec2(t*0.16, -t*0.12) + spiralDir*0.35);
  float warp = gnoise(spiralDir*2.2 + vec2(t*0.2)) * 0.35 + turb*0.45;

  float reach = 1.0 + 0.14*warp + armMask * 0.18 * (0.6 + uTendril*0.18);
  float f = d - R*reach - cleanup;

  // lensing warp of sampled textures near the edge — bend UV along spiral
  vec2 lens = spiralDir * armMask * 8.0 * exp(-pow(f/max(soft,1.0),2.0));

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx + lens * uCanvasScale);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx + lens * uCanvasScale);
  vec3 col = mix(from, to, cov);

  // accretion glow — hot inner rim
  float rim = exp(-pow((f+soft*0.25)/max(soft*0.85,1.0),2.0)) * cov;
  float armGlow = armMask * rim * 0.85;
  vec3 accHot = uToDark > 0.5 ? vec3(0.95,0.42,0.12) : vec3(0.96,0.32,0.08);
  vec3 accCool = uToDark > 0.5 ? vec3(0.32,0.58,1.0) : vec3(0.18,0.62,1.0);
  col = mix(col, accHot, armGlow * 0.62);
  col = mix(col, accCool, exp(-pow(max(f,0.0)/max(soft*2.4,1.0),2.0)) * armMask * 0.18);
  // event horizon dark ring
  float horizon = exp(-pow((f)/max(soft*0.6,1.0),2.0)) * cov * 0.18;
  col -= horizon * 0.35;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 17. Prism Burst: faceted crystal prism shattering with rainbow dispersion.
 */
const PRISM_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float ang = atan(rel.y, rel.x);
  vec2 dir = d < 1e-3 ? vec2(1.0,0.0) : rel / d;
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.7, 1.2);

  float inner = R * 0.55 + cleanup - soft*2.2 - 16.0;
  float outer = R * 1.58 + cleanup + soft*2.8 + 44.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // faceted angular shards
  float facets = 6.0 + floor(clamp(ns,0.4,2.5)*2.0); // 6..10
  float facPhase = fract(ang * 0.15915494 * facets + uSeed.x*0.7 + t*0.04);
  float shard = pow(abs(sin(facPhase*3.14159)), 0.85);
  shard = pow(shard, 0.9 + uTendril*0.22);

  // radial spikes
  float spikeFreq = 3.0 + uTendril*1.2;
  float rays = sin(ang * spikeFreq + fbm3(dir*2.2 + vec2(t*0.18)) * 2.0) * 0.5 + 0.5;
  rays = pow(rays, 1.8) * (10.0 + uTendril*8.0) * smoothstep(0.0, 60.0, d);

  vec2 p = rel / uRef;
  float turb = fbm3(p*(2.0*ns) + vec2(t*0.14, -t*0.1));
  float reach = 1.0 + 0.11*turb + shard*0.14;
  float f = d - R*reach - cleanup - rays * 0.55;

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  // strong prismatic dispersion — sample RGB at different offsets
  float prismAmt = (6.0 + uTendril*4.0) * exp(-pow(f/max(soft*1.2,1.0),2.0)) * cov;
  vec2 prismDir = dir * prismAmt;
  vec3 from = sampleDocRGB(uFrom, uFromSize, uFromMap, devPx, vec2(0.0), prismDir * 0.65);
  vec3 to = sampleDocRGB(uTo, uToSize, uToMap, devPx, vec2(0.0), prismDir * 0.65);

  // chromatic faceting — alternate hues per facet
  float hueShift = facPhase * 6.283;
  vec3 prismHue = vec3(0.5 + 0.5*cos(hueShift), 0.5 + 0.5*cos(hueShift + 2.09), 0.5 + 0.5*cos(hueShift + 4.18));
  from = mix(from, from * prismHue * 1.25, prismAmt * 0.035 * shard);
  to = mix(to, to * prismHue * 1.25, prismAmt * 0.035 * shard);

  vec3 col = mix(from, to, cov);

  float prismGlow = exp(-pow((f+soft*0.3)/max(soft,1.0),2.0)) * cov * (0.55 + rays*0.015);
  col = mix(col, prismHue, prismGlow * 0.28);
  // bright shard edges
  float edge = exp(-pow(f/max(soft*0.7,1.0),2.0)) * shard * cov * 0.7;
  col += vec3(1.0) * edge * 0.42;

  outColor = vec4(col, 1.0);
}
`;

/**
 * 18. Glass Shatter: impact-cracked glass with shard displacement.
 */
const SHATTER_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.8, 1.2);

  float inner = R * 0.58 + cleanup - soft*2.0 - 16.0;
  float outer = R * 1.50 + cleanup + soft*2.5 + 38.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // crack network — Voronoi-like but cheap: use layered noise ridges
  vec2 p = rel / uRef * (1.6 * ns) + uSeed;
  float crack = 0.0;
  float amp = 0.5;
  vec2 cq = p;
  for (int i=0; i<3; i++) {
    float n = gnoise(cq + vec2(t*0.08));
    crack += amp * (1.0 - abs(n));
    cq = OCT * cq + 3.7;
    amp *= 0.5;
  }
  crack = crack / 0.875;
  // radial impact rays
  float ang = atan(rel.y, rel.x);
  float rays = sin(ang * (7.0 + uTendril*2.5) + hash21(vec2(floor(ang*2.8))) * 4.0);
  rays = pow(max(rays*0.5+0.5, 0.0), 6.0) * smoothstep(0.0, 120.0, d) * (12.0 + uTendril*8.0);

  float turb = fbm3(p + vec2(t*0.12)) * 0.45;
  float reach = 1.0 + 0.10*turb + crack*0.08 * clamp(uTendril*0.35,0.1,0.8);
  float f = d - R*reach - cleanup - rays;

  // crack line distance — thin dark lines
  float crackLine = 1.0 - smoothstep(0.0, 0.018 + soft*0.0015, abs(crack - 0.5));
  crackLine *= smoothstep(0.0, 60.0, R - d + cleanup + 20.0) * (1.0 - smoothstep(-soft*1.5, soft*1.5, f));

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  // shard displacement — jitter UV per Voronoi cell
  vec2 shardJitter = (hash22(floor(css * 0.04 * ns + uSeed*2.0)) * 2.0 - 1.0) * crackLine * 14.0 * (1.0 - cov*0.5);
  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx + shardJitter * uCanvasScale);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx + shardJitter * uCanvasScale);
  vec3 col = mix(from, to, cov);

  // impact flash at center
  float impact = exp(-pow(d / max(R*0.18, 10.0), 2.0)) * (1.0 - smoothstep(0.25,0.85,uLinear)) * 0.9;
  col = mix(col, vec3(1.0), impact * 0.65);
  // crack highlights
  float crackGlow = crackLine * exp(-pow((f+soft*0.5)/max(soft,1.0),2.0)) * cov;
  col = mix(col, vec3(1.0,0.94,0.72), crackGlow * 0.55);
  // shard edge bevel
  col = mix(col, vec3(1.0), crackLine * cov * 0.12);

  outColor = vec4(col, 1.0);
}

`;

/**
 * 19. Plasma Surge: electric plasma arcs lashing across the screen.
 */
const PLASMA_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float ang = atan(rel.y, rel.x);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.6, 1.0);

  float inner = R * 0.55 + cleanup - soft*2.2 - 14.0;
  float outer = R * 1.58 + cleanup + soft*2.8 + 40.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  vec2 p = rel / uRef * (2.2 * ns) + uSeed;

  // plasma tendrils — lightning-like branching
  float branches = 3.0 + floor(clamp(uTendril,0.0,2.5)*1.6);
  float branchPhase = fract(ang * 0.15915494 * branches + uSeed.x*0.5 + t*0.06);
  float lightning = pow(abs(sin(branchPhase*3.14159)), 1.4);
  lightning = pow(lightning, 2.2) * (16.0 + uTendril*12.0) * smoothstep(0.0, 70.0, d);

  float turb = fbm4(p + vec2(t*0.22, -t*0.18));
  float fil = gnoise(p*3.2 + vec2(t*0.3)) * 0.35 + gnoise2(p*5.0 + vec2(-t*0.25, t*0.18)) * 0.25;
  float elec = sin(d*0.04*ns + t*6.0 + turb*4.0) * 0.5 + 0.5;
  elec = pow(elec, 1.5) * 6.0 * smoothstep(0.0, 100.0, d) * clamp(uTendril*0.5,0.3,1.3);

  float reach = 1.0 + 0.13*turb + 0.07*fil;
  float f = d - R*reach - cleanup - lightning - elec;

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  // electric displacement
  vec2 arcDir = normalize(vec2(sin(ang + t*0.8), cos(ang*1.3 + t*0.6)));
  vec2 arcOff = arcDir * lightning * 0.25 * exp(-pow(f/max(soft,1.0),2.0)) * cov;
  vec3 from = sampleDoc(uFrom, uFromSize, uFromMap, devPx + arcOff * uCanvasScale);
  vec3 to = sampleDoc(uTo, uToSize, uToMap, devPx + arcOff * uCanvasScale);
  vec3 col = mix(from, to, cov);

  // plasma glow — cyan/magenta arcs
  float arcGlow = exp(-pow((f+soft*0.2)/max(soft*0.9,1.0),2.0)) * cov * (0.6 + lightning*0.012);
  float flicker = 0.75 + 0.25 * sin(t*18.0 + hash21(vec2(ang*2.0, d*0.01))*10.0);
  vec3 plasmaA = vec3(0.15, 0.72, 1.0);
  vec3 plasmaB = vec3(0.92, 0.18, 0.88);
  vec3 plasmaC = vec3(0.98, 0.95, 0.35);
  float plasmaMix = fract(ang*0.15 + t*0.12 + turb*0.3);
  vec3 plasmaCol = mix(plasmaA, plasmaB, smoothstep(0.0,0.6, plasmaMix));
  plasmaCol = mix(plasmaCol, plasmaC, smoothstep(0.6,1.0, plasmaMix) * 0.45);
  col = mix(col, plasmaCol, arcGlow * 0.68 * flicker);
  col += plasmaCol * arcGlow * 0.35 * flicker;
  // bright core
  float core = exp(-pow(f/max(soft*0.55,1.0),2.0)) * cov * 0.85;
  col = mix(col, vec3(1.0), core * 0.42);

  outColor = vec4(col, 1.0);
}
`;

/**
 * 20. Digital Glitch: RGB split, scanlines, block tearing.
 */
const GLITCH_MAIN = /* glsl */ `
void main() {
  vec2 devPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = devPx / uCanvasScale;
  vec2 rel = css - uCenter;
  float d = length(rel);
  float ang = atan(rel.y, rel.x);
  float R = uRadius;
  float cleanup = uCleanup;
  float t = uTime * uDrift;
  float ns = uNoiseScale;
  float soft = max(uSoftness * 1.6, 1.0);

  float inner = R * 0.60 + cleanup - soft*1.8 - 10.0;
  float outer = R * 1.52 + cleanup + soft*2.2 + 32.0;
  if (d < inner) { outColor = vec4(sampleDoc(uTo, uToSize, uToMap, devPx), 1.0); return; }
  if (d > outer) { outColor = vec4(sampleDoc(uFrom, uFromSize, uFromMap, devPx), 1.0); return; }

  // block glitch tiling
  vec2 blockUV = floor(css * 0.03 * ns + vec2(t*1.2, t*0.7) + uSeed*4.0);
  float blockRand = hash21(blockUV);
  float blockThr = 0.68 - clamp(uTendril*0.08, 0.0, 0.18);
  float isBlock = step(blockThr, blockRand);

  // horizontal tear bands
  float band = fract(css.y * 0.008 * ns + t*0.9 + hash21(vec2(floor(css.y*0.04), 0.0))*2.0);
  float tear = step(0.92, band + hash21(vec2(floor(css.y*0.12 + t*8.0), 0.0))*0.18) * isBlock * 0.65;

  float turb = fbm3(rel/uRef*(1.8*ns) + uSeed + vec2(t*0.2)) * 0.5 + 0.5;
  float reach = 1.0 + 0.10*turb + tear*0.08;
  float f = d - R*reach - cleanup;

  // scanlines — only inside revealed region
  float scan = sin(css.y * 0.35) * 0.5 + 0.5;
  scan = pow(scan, 1.2) * 0.08;

  float cov = 1.0 - smoothstep(-soft, soft, f);
  if (uLinear >= 0.995) cov = 1.0;

  // RGB split amount modulated by distance to edge and tendril
  float splitAmt = (6.0 + uTendril*6.0) * exp(-pow(f/max(soft*1.1,1.0),2.0)) * cov + tear*14.0;
  float flicker = step(0.82, fract(t*7.5 + blockRand*3.0)) * 0.5;
  splitAmt += flicker * 5.0;

  vec2 splitX = vec2(splitAmt, 0.0);
  // displaced channel sampling
  vec3 from;
  vec3 to;
  {
    vec2 base = devPx;
    float rF = sampleDoc(uFrom, uFromSize, uFromMap, base + splitX * uCanvasScale).r;
    float gF = sampleDoc(uFrom, uFromSize, uFromMap, base).g;
    float bF = sampleDoc(uFrom, uFromSize, uFromMap, base - splitX * uCanvasScale).b;
    from = vec3(rF,gF,bF);
    float rT = sampleDoc(uTo, uToSize, uToMap, base + splitX * uCanvasScale).r;
    float gT = sampleDoc(uTo, uToSize, uToMap, base).g;
    float bT = sampleDoc(uTo, uToSize, uToMap, base - splitX * uCanvasScale).b;
    to = vec3(rT,gT,bT);
  }

  // block displacement — horizontal slip
  float slip = (hash21(blockUV + 7.3) * 2.0 - 1.0) * isBlock * step(f, soft*0.6) * 18.0 * cov;
  vec2 slipOff = vec2(slip, 0.0) * uCanvasScale;
  // re-sample with slip for extra destruction (blend 50/50)
  {
    vec3 fromSlip = vec3(
      sampleDoc(uFrom, uFromSize, uFromMap, devPx + slipOff + splitX * uCanvasScale).r,
      sampleDoc(uFrom, uFromSize, uFromMap, devPx + slipOff).g,
      sampleDoc(uFrom, uFromSize, uFromMap, devPx + slipOff - splitX * uCanvasScale).b
    );
    vec3 toSlip = vec3(
      sampleDoc(uTo, uToSize, uToMap, devPx + slipOff + splitX * uCanvasScale).r,
      sampleDoc(uTo, uToSize, uToMap, devPx + slipOff).g,
      sampleDoc(uTo, uToSize, uToMap, devPx + slipOff - splitX * uCanvasScale).b
    );
    from = mix(from, fromSlip, isBlock * cov * 0.55);
    to = mix(to, toSlip, isBlock * cov * 0.55);
  }

  vec3 col = mix(from, to, cov);
  // scanline darkening + chromatic aberration fringe
  col -= scan * cov * 0.9;
  float fringe = exp(-pow((f+soft*0.4)/max(soft,1.0),2.0)) * cov;
  col += vec3(0.95,0.15,0.12) * fringe * 0.18 * step(0.5, fract(ang*0.3 + t));
  col += vec3(0.12,0.85,1.0) * fringe * 0.16 * step(0.5, 1.0 - fract(ang*0.3 + t));

  // block tint
  col = mix(col, col * vec3(1.08,1.0,0.92), isBlock * cov * 0.12);

  outColor = vec4(col, 1.0);
}
`;

const FRAG_BODIES: Record<TransitionMode, string> = {
  ink: INK_MAIN,
  ripple: RIPPLE_MAIN,
  ember: EMBER_MAIN,
  halftone: HALFTONE_MAIN,
  eclipse: ECLIPSE_MAIN,
  crystal: CRYSTAL_MAIN,
  veil: VEIL_MAIN,
  tide: TIDE_MAIN,
  smoke: SMOKE_MAIN,
  marble: MARBLE_MAIN,
  drip: DRIP_MAIN,
  bloom: BLOOM_MAIN,
  aura: AURA_MAIN,
  storm: STORM_MAIN,
  nova: NOVA_MAIN,
  vortex: VORTEX_MAIN,
  prism: PRISM_MAIN,
  shatter: SHATTER_MAIN,
  plasma: PLASMA_MAIN,
  glitch: GLITCH_MAIN,
};

export function buildFragmentShader(mode: TransitionMode): string {
  return FRAG_PREAMBLE + FRAG_BODIES[mode];
}
