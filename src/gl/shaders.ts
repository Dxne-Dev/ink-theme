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

const FRAG_BODIES: Record<TransitionMode, string> = {
  ink: INK_MAIN,
  ripple: RIPPLE_MAIN,
  ember: EMBER_MAIN,
  halftone: HALFTONE_MAIN,
  eclipse: ECLIPSE_MAIN,
  crystal: CRYSTAL_MAIN,
};

export function buildFragmentShader(mode: TransitionMode): string {
  return FRAG_PREAMBLE + FRAG_BODIES[mode];
}
