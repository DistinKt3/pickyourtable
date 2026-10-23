import * as THREE from "three";

/**
 * Materials for the diorama. Everything solid uses one clay material type whose
 * roughness, metalness and glow come from a per-vertex `pbr` attribute, so a whole
 * table (top, base, chairs, plates) is one mesh and one draw call. Per-table state
 * (desaturate, dim, opacity) are uniforms on that table's material instance; all
 * instances share one compiled program.
 */

const NOISE_GLSL = `
float pytHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float pytNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pytHash(i), pytHash(i + vec2(1.0, 0.0)), u.x), mix(pytHash(i + vec2(0.0, 1.0)), pytHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

export interface SharedUniforms {
  uInteriorRect: { value: THREE.Vector4 };
  uInteriorColor: { value: THREE.Color };
  uInteriorStrength: { value: number };
  uGlow: { value: number };
  /** How far the walls have risen above the cutaway height, in meters. */
  uRise: { value: number };
}

export interface ClayUniforms extends SharedUniforms {
  uSat: { value: number };
  uDim: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uInteriorRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uInteriorColor: { value: new THREE.Color(0, 0, 0) },
    uInteriorStrength: { value: 0 },
    uGlow: { value: 0 },
    uRise: { value: 0 },
  };
}

export type ClayMaterial = THREE.MeshStandardMaterial & { userData: { uniforms: ClayUniforms } };

const PATTERN_GLSL = `
float pytGroove(float coord, float halfWidth) {
  float fw = fwidth(coord);
  float d = abs(fract(coord + 0.5) - 0.5);
  float g = 1.0 - smoothstep(halfWidth - fw, halfWidth + fw, d);
  // Too fine to resolve: settle to the average instead of shimmering.
  return mix(g, halfWidth * 2.0, smoothstep(0.18, 0.45, fw));
}
float pytTone(vec2 cell) { return pytHash(cell) - 0.5; }
vec3 pytPattern(vec3 base, float kind, vec3 wp) {
  if (kind < 0.5) return base;
  vec2 p = wp.xz;
  float shade = 0.0;
  if (kind < 1.5 || (kind > 4.5 && kind < 5.5)) {
    // Deck boards 14 cm wide, joints every 2.4 m, staggered.
    vec2 q = kind < 1.5 ? p : p.yx;
    float row = floor(q.x / 0.14);
    float along = q.y / 2.4 + pytHash(vec2(row, 3.0));
    shade -= pytGroove(q.x / 0.14, 0.022) * 0.16;
    shade -= pytGroove(along, 0.0018) * 0.12;
    shade += pytTone(vec2(row, floor(along))) * 0.07;
  } else if (kind < 2.5) {
    // Kitchen tiles, 30 cm.
    vec2 q = p / 0.3;
    shade -= max(pytGroove(q.x, 0.008), pytGroove(q.y, 0.008)) * 0.12;
    shade += pytTone(floor(q)) * 0.03;
  } else if (kind < 3.5) {
    // Stone pavers in a running bond, 80 x 40 cm.
    float row = floor(p.y / 0.4);
    float x = p.x / 0.8 + 0.5 * mod(row, 2.0);
    shade -= max(pytGroove(p.y / 0.4, 0.009), pytGroove(x, 0.0045)) * 0.13;
    shade += pytTone(vec2(floor(x), row)) * 0.05;
  } else {
    // Lawn: soft mottling at two scales.
    shade += (pytNoise(p * 0.7) - 0.5) * 0.10 + (pytNoise(p * 2.9 + 7.0) - 0.5) * 0.06;
  }
  return base * (1.0 + shade);
}
`;

export function createClayMaterial(
  shared: SharedUniforms,
  opts: { transparent?: boolean; side?: THREE.Side } = {},
): ClayMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    transparent: opts.transparent ?? false,
    side: opts.side ?? THREE.FrontSide,
  }) as ClayMaterial;
  const uniforms: ClayUniforms = { ...shared, uSat: { value: 1 }, uDim: { value: 1 } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 pbr;
attribute float rise;
attribute float pattern;
uniform float uRise;
varying vec3 vPbr;
varying float vPattern;
varying vec3 vClayWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
transformed.y += rise * uRise;
vPbr = pbr;
vPattern = pattern;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vClayWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uSat;
uniform float uDim;
uniform float uGlow;
uniform vec4 uInteriorRect;
uniform vec3 uInteriorColor;
uniform float uInteriorStrength;
varying vec3 vPbr;
varying float vPattern;
varying vec3 vClayWorld;
${NOISE_GLSL}
${PATTERN_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
diffuseColor.rgb = pytPattern(diffuseColor.rgb, vPattern, vClayWorld);
float clayLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = mix(vec3(clayLuma), diffuseColor.rgb, uSat) * uDim;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = vPbr.x;`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
metalnessFactor = vPbr.y;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vPbr.z * uGlow;
vec2 inRect = step(uInteriorRect.xy, vClayWorld.xz) * step(vClayWorld.xz, uInteriorRect.zw);
totalEmissiveRadiance += diffuseColor.rgb * uInteriorColor * uInteriorStrength * inRect.x * inRect.y;`,
      );
  };
  m.customProgramCacheKey = () => (m.transparent ? "pyt-clay-t" : "pyt-clay");
  return m;
}

/* ------------------------------------------------------------------ Ground */

export interface FadeUniforms {
  /** The site on the floor: minX, minZ, maxX, maxZ. */
  uFadeRect: { value: THREE.Vector4 };
  /** Distance outside the site where the diorama fades into the page (start, end). */
  uFade: { value: THREE.Vector2 };
  /** Atmospheric haze toward the horizon for seat views (start, end). */
  uHaze: { value: THREE.Vector2 };
  uHazeColor: { value: THREE.Color };
  /** 1 in the diorama, 0 at eye level, where the horizon shows instead. */
  uBgMix: { value: number };
}

export function createFadeUniforms(): FadeUniforms {
  return {
    uFadeRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFade: { value: new THREE.Vector2(1, 10) },
    uHaze: { value: new THREE.Vector2(60, 900) },
    uHazeColor: { value: new THREE.Color("#e9ece8") },
    uBgMix: { value: 1 },
  };
}

const FADE_GLSL = `
uniform vec4 uFadeRect;
uniform vec2 uFade;
uniform vec2 uHaze;
uniform vec3 uHazeColor;
uniform float uBgMix;
float pytFadeAlpha(vec3 wp) {
  vec2 c = (uFadeRect.xy + uFadeRect.zw) * 0.5;
  vec2 h = (uFadeRect.zw - uFadeRect.xy) * 0.5;
  vec2 q = abs(wp.xz - c) - h;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float f = smoothstep(uFade.x, uFade.y, d);
  return 1.0 - f * f * (3.0 - 2.0 * f) * uBgMix;
}
float pytHaze(vec3 wp) {
  float d = distance(wp.xz, cameraPosition.xz);
  return smoothstep(uHaze.x, uHaze.y, d) * (1.0 - uBgMix);
}
`;

/**
 * Lit ground (stone promenade or lawn) that fades into the page around the site, and
 * into haze at the horizon when seen from a seat. Writes coverage to alpha (no
 * blending); the backdrop pass composites it over the page color.
 */
export function createGroundMaterial(fade: FadeUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  m.blending = THREE.NoBlending;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float pattern;\nvarying float vPattern;\nvarying vec3 vGroundWorld;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPattern = pattern;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying float vPattern;\nvarying vec3 vGroundWorld;\n${FADE_GLSL}\n${NOISE_GLSL}\n${PATTERN_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = pytPattern(diffuseColor.rgb, vPattern, vGroundWorld);",
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, pytHaze(vGroundWorld));
gl_FragColor.a = pytFadeAlpha(vGroundWorld);`,
      );
  };
  m.customProgramCacheKey = () => "pyt-ground";
  return m;
}

/* ------------------------------------------------------------------- Water */

export interface WaterUniforms extends FadeUniforms {
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  /** Water line: a point on the shore and the direction out to sea, on the floor. */
  uShore: { value: THREE.Vector4 };
  uExposure: { value: number };
}

const SKY_GLSL = `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
vec3 pytSky(vec3 dir) {
  float h = clamp(dir.y, -1.0, 1.0);
  float t = pow(max(h, 0.0), 0.55);
  return mix(uSkyHorizon, uSkyZenith, t);
}
`;

export function createWaterMaterial(fade: FadeUniforms): THREE.ShaderMaterial & { uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    ...fade,
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uSkyZenith: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uShore: { value: new THREE.Vector4(0, 0, 0, -1) },
    uExposure: { value: 1 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    blending: THREE.NoBlending,
    vertexShader: `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uShore;
uniform float uExposure;
varying vec3 vWorld;
${FADE_GLSL}
${SKY_GLSL}
${NOISE_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float off = max(0.0, dot(vWorld.xz - uShore.xy, uShore.zw));
  // Gentle, static ripples: two octaves of value noise stretched along the shore.
  vec2 q = vWorld.xz * vec2(0.55, 1.6);
  float n = pytNoise(q) * 0.65 + pytNoise(q * 2.7 + 3.1) * 0.35;
  vec2 q2 = vWorld.xz * vec2(0.55, 1.6) + vec2(0.37, 0.11);
  float n2 = pytNoise(q2) * 0.65 + pytNoise(q2 * 2.7 + 3.1) * 0.35;
  float rippleFade = 1.0 - smoothstep(30.0, 140.0, distance(vWorld.xz, cameraPosition.xz));
  vec3 N = normalize(vec3((n - 0.5) * 0.09 * rippleFade, 1.0, (n2 - 0.5) * 0.09 * rippleFade));
  float shoreMix = smoothstep(0.0, 22.0, off);
  vec3 base = mix(uShallow, uDeep, shoreMix);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 sky = pytSky(R);
  vec3 col = mix(base, sky, clamp(0.12 + fres * 0.8, 0.0, 1.0));
  float spec = pow(max(dot(R, normalize(uSunDir)), 0.0), 180.0);
  col += uSunColor * spec * 0.6;
  // Darken a touch right at the quay so the edge reads.
  col *= mix(0.86, 1.0, smoothstep(0.0, 1.2, off));
  col *= uExposure;
  col = mix(col, uHazeColor, pytHaze(vWorld));
  gl_FragColor = vec4(col, pytFadeAlpha(vWorld));
}`,
  }) as THREE.ShaderMaterial & { uniforms: WaterUniforms };
  return m;
}

/* --------------------------------------------------------------------- Sky */

export interface SkyUniforms {
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uHazeColor: { value: THREE.Color };
  uFar: { value: THREE.Color };
  uBgMix: { value: number };
  /** 0 none, 1 a far shore (water), 2 a tree line (garden). */
  uSilhouette: { value: number };
  uExposure: { value: number };
}

export function createSkyMaterial(): THREE.ShaderMaterial & { uniforms: SkyUniforms } {
  const uniforms: SkyUniforms = {
    uSkyZenith: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uHazeColor: { value: new THREE.Color() },
    uFar: { value: new THREE.Color() },
    uBgMix: { value: 1 },
    uSilhouette: { value: 0 },
    uExposure: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.NoBlending,
    vertexShader: `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w;
}`,
    fragmentShader: `
uniform vec3 uHazeColor;
uniform vec3 uFar;
uniform float uBgMix;
uniform float uSilhouette;
uniform float uExposure;
varying vec3 vDir;
${SKY_GLSL}
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = pytSky(d);
  // A band of haze sitting on the horizon.
  col = mix(col, uHazeColor, (1.0 - smoothstep(0.0, 0.12, abs(d.y))) * 0.65);
  if (uSilhouette > 0.5) {
    float az = atan(d.x, -d.z);
    float ridge;
    if (uSilhouette < 1.5) {
      ridge = 0.010 + 0.016 * pytNoise(vec2(az * 3.0, 1.7)) + 0.008 * pytNoise(vec2(az * 11.0, 4.2));
    } else {
      ridge = 0.022 + 0.018 * pytNoise(vec2(az * 9.0, 2.3)) + 0.012 * pytNoise(vec2(az * 31.0, 7.1));
    }
    float land = 1.0 - smoothstep(ridge - 0.002, ridge + 0.002, d.y);
    land *= step(-0.002, d.y);
    col = mix(col, uFar, land * 0.55);
  }
  col *= uExposure;
  gl_FragColor = vec4(col, 1.0 - uBgMix);
}`,
  }) as THREE.ShaderMaterial & { uniforms: SkyUniforms };
}

/* ------------------------------------------------------------------- Glass */

/** Window glass: nearly clear face-on, more reflective at grazing angles. Rises with the walls. */
export function createGlassMaterial(
  shared: Pick<SharedUniforms, "uRise">,
  color: string,
  opacity: number,
): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRise = shared.uRise;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float rise;\nuniform float uRise;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += rise * uRise;");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
float glassFres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
gl_FragColor.a = clamp(diffuseColor.a + glassFres * 0.5, 0.0, 0.85);`,
    );
  };
  m.customProgramCacheKey = () => "pyt-glass";
  return m;
}

/* ------------------------------------------------------------------- Rings */

/**
 * Floor rings for every table in one instanced draw: a quad per table whose fragment
 * shader draws the ring path (circle or rounded rectangle) as a crisp line a couple of
 * pixels wide at any zoom, a hatched band for "wrong size", and a soft inner tint for
 * the selected table.
 */
export function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: `
attribute vec4 aShape;   // halfW, halfD, corner (rect) or radius (circle), kind (0 circle, 1 rect)
attribute vec4 aColor;   // rgb, alpha
attribute vec4 aStyle;   // line px, hatch 0..1, fill 0..1, glow 0..1
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
varying vec4 vStyle;
void main() {
  vLocal = position.xz * vec2(aShape.x, aShape.y);
  vShape = aShape;
  vColor = aColor;
  vStyle = aStyle;
  vec3 p = vec3(position.x * aShape.x, 0.0, position.z * aShape.y);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `
uniform float uPixelRatio;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
varying vec4 vStyle;
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  if (vColor.a <= 0.001) discard;
  // The quad is padded 0.25 m beyond the ring so the line and glow fit.
  float pad = 0.25;
  float sd;
  float along;
  if (vShape.w < 0.5) {
    float r = vShape.z;
    sd = length(vLocal) - r;
    along = atan(vLocal.y, vLocal.x) * r;
  } else {
    vec2 b = vec2(vShape.x - pad, vShape.y - pad);
    sd = sdRoundRect(vLocal, b, vShape.z);
    along = vLocal.x + vLocal.y;
  }
  float px = fwidth(sd);
  float halfLine = max(px * vStyle.x * 0.5 * uPixelRatio, 0.006);
  halfLine = min(halfLine, 0.045);
  float line = 1.0 - smoothstep(halfLine - px, halfLine + px, abs(sd));
  float alpha = line;
  if (vStyle.y > 0.0) {
    // A hatched band: fine diagonal ticks just inside the ring path.
    float band = halfLine * 3.2;
    float inBand = 1.0 - smoothstep(band - px, band + px, abs(sd + band * 0.4));
    float period = 0.11;
    float coord = (along - sd * 1.0) / period;
    float fw = fwidth(coord);
    float tick = smoothstep(0.5 - fw, 0.5 + fw, abs(fract(coord) - 0.5) * 2.0);
    // Ticks too fine to resolve blend to an even tone instead of shimmering.
    tick = mix(tick, 0.45, smoothstep(0.25, 0.6, fw));
    alpha = max(line * 0.55, inBand * tick) * vStyle.y + line * (1.0 - vStyle.y);
  }
  float inside = 1.0 - smoothstep(-px, px, sd);
  alpha = max(alpha, inside * vStyle.z * 0.10);
  float glow = (1.0 - smoothstep(0.0, 0.12, abs(sd))) * vStyle.w * 0.22;
  alpha = max(alpha, glow);
  gl_FragColor = vec4(vColor.rgb, alpha * vColor.a);
}`,
  });
}
