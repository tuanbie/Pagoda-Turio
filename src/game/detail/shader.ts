import * as THREE from 'three';

/**
 * Tiny shader patches on top of three's built-in materials (so lighting, fog and shadows
 * keep working). All animation is done on the GPU from one shared clock: no per-frame
 * allocations, no per-instance CPU work for grass, leaves, banners, wings or fish tails.
 */

/** seconds, advanced by World.update */
export const TIME = { value: 0 };
/** sky colour near the horizon / zenith (World.setHour keeps these in sync) */
export const SKY_LOW = { value: new THREE.Color('#e7e1cd') };
export const SKY_HIGH = { value: new THREE.Color('#6e9cc6') };

type Patch = (s: THREE.WebGLProgramParametersWithUniforms) => void;

/** chain a patch onto a material (keeps any earlier patch) and give it its own program key */
export function patch<M extends THREE.Material>(m: M, key: string, fn: Patch): M {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    fn(s);
  };
  m.customProgramCacheKey = () => prevKey() + '|' + key;
  return m;
}

const PROJECT = '#include <project_vertex>';
/** like project_vertex, but runs `code` on `wp` (model space after instancing = world space for our meshes) */
const projectWith = (code: string) => `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{ vec3 wp = mvPosition.xyz; ${code} mvPosition.xyz = wp; }
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

export interface WindOpts {
  /** sway amplitude in metres at full height */
  amp: number;
  /** world height where sway starts / reaches full strength */
  y0: number;
  y1: number;
  /** exponent of the height falloff (2 = bends like a stalk) */
  pow?: number;
  /** base frequency (rad/s) */
  freq?: number;
}

/** Vertex wind: things bend more the higher they are (grass, bamboo, crowns, flowers). */
export function wind<M extends THREE.Material>(m: M, o: WindOpts): M {
  const p = o.pow ?? 2;
  const f = o.freq ?? 1.3;
  const key = `wind${o.amp},${o.y0},${o.y1},${p},${f}`;
  return patch(m, key, (s) => {
    s.uniforms.uTime = TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      PROJECT,
      projectWith(`
        float hk = pow(clamp((wp.y - ${o.y0.toFixed(3)}) / ${(o.y1 - o.y0).toFixed(3)}, 0.0, 1.0), ${p.toFixed(2)});
        float ph = wp.x * 0.11 + wp.z * 0.07;
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + wp.x * 0.013);
        wp.x += (sin(uTime * ${f.toFixed(2)} + ph) + 0.35 * sin(uTime * ${(f * 2.7).toFixed(2)} + ph * 3.1)) * ${o.amp.toFixed(3)} * hk * gust;
        wp.z += cos(uTime * ${(f * 0.83).toFixed(2)} + ph * 1.3) * ${(o.amp * 0.6).toFixed(3)} * hk * gust;`),
    );
  });
}

/** Same displacement for the shadow pass, so swaying things cast matching shadows. */
export function windDepth(o: WindOpts) {
  return wind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), o);
}

/**
 * Wing flap for instanced flyers: local vertices with |x| > root bend up and down.
 * Each instance gets its own phase from gl_InstanceID.
 */
export function flap<M extends THREE.Material>(m: M, speed: number, amp: number, root = 0.02): M {
  return patch(m, `flap${speed},${amp},${root}`, (s) => {
    s.uniforms.uTime = TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float ax = max(abs(transformed.x) - ${root.toFixed(3)}, 0.0);
        float iid = float(gl_InstanceID);
        transformed.y += sin(uTime * ${speed.toFixed(2)} + iid * 1.93) * ${amp.toFixed(3)} * ax;
      }`,
    );
  });
}

/** Tail wag for fish: body sways side to side, more toward the tail (local -z). */
export function swim<M extends THREE.Material>(m: M): M {
  return patch(m, 'swim', (s) => {
    s.uniforms.uTime = TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float iid = float(gl_InstanceID);
        float back = clamp(0.12 - transformed.z, 0.0, 1.0);
        transformed.x += sin(uTime * 7.0 + iid * 2.3 + transformed.z * 7.0) * 0.11 * back * back;
      }`,
    );
  });
}

/** Hanging cloth (banners): waves grow toward the free bottom end (uv.y = 0). */
export function cloth<M extends THREE.Material>(m: M, amp = 0.18): M {
  return patch(m, `cloth${amp}`, (s) => {
    s.uniforms.uTime = TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float iid = float(gl_InstanceID);
        float free = 1.0 - uv.y;
        float w = sin(uTime * 2.1 + iid * 1.7 + uv.y * 5.0) + 0.4 * sin(uTime * 4.3 + iid + uv.y * 11.0 + uv.x * 3.0);
        transformed.z += w * ${amp.toFixed(3)} * free;
        transformed.x += sin(uTime * 1.3 + iid) * 0.05 * free * free;
      }`,
    );
  });
}

/**
 * Lotus flowers open by day and close at night. Petal vertices fold toward the axis
 * (scaled by their height above the base) as `open` falls.
 */
export const LOTUS_OPEN = { value: 1 };
export function lotusBloom<M extends THREE.Material>(m: M): M {
  return patch(m, 'lotus', (s) => {
    s.uniforms.uTime = TIME;
    s.uniforms.uOpen = LOTUS_OPEN;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uOpen;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float iid = float(gl_InstanceID);
        float o = clamp(uOpen * (0.85 + 0.15 * sin(uTime * 0.05 + iid * 2.1)), 0.0, 1.0);
        float h = max(transformed.y, 0.0);
        float pull = (1.0 - o) * clamp(h * 4.0, 0.0, 1.0);
        transformed.xz *= 1.0 - 0.6 * pull;
        transformed.y += 0.06 * pull;
      }`,
    );
  });
}

/** Animated two-layer ripple normals + a fresnel mix toward the sky colour (water). */
export function waterSurface<M extends THREE.MeshStandardMaterial>(m: M, strength = 0.45): M {
  return patch(m, 'water', (s) => {
    s.uniforms.uTime = TIME;
    s.uniforms.uSkyLow = SKY_LOW;
    s.uniforms.uSkyHigh = SKY_HIGH;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uSkyLow;\nuniform vec3 uSkyHigh;')
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n1 = texture2D( normalMap, vNormalMapUv + vec2( uTime * 0.011, uTime * 0.007 ) ).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D( normalMap, vNormalMapUv * 1.73 + vec2( -uTime * 0.009, uTime * 0.013 ) ).xyz * 2.0 - 1.0;
          vec3 mapN = normalize( vec3( n1.xy + n2.xy, n1.z * n2.z ) );
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
        #endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize( vViewPosition );
          float fres = pow( 1.0 - clamp( dot( normal, V ), 0.0, 1.0 ), 3.0 );
          vec3 sky = mix( uSkyLow, uSkyHigh, clamp( 0.35 + fres * 0.2, 0.0, 1.0 ) );
          outgoingLight = mix( outgoingLight, sky, clamp( fres * ${strength.toFixed(2)} + 0.12, 0.0, 0.85 ) );
        }
        #include <opaque_fragment>`,
      );
  });
}

/** Points with a per-particle size (attribute aSize) — alpha comes from an RGBA colour attribute. */
export function sizedPoints<M extends THREE.PointsMaterial>(m: M): M {
  return patch(m, 'sized', (s) => {
    s.vertexShader = s.vertexShader.replace('uniform float size;', 'uniform float size;\nattribute float aSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  });
}

/** Slow drifting motes (dust in the hall light): GPU-only drift around each point's home. */
export function drift<M extends THREE.PointsMaterial>(m: M, amp = 0.25): M {
  return patch(m, `drift${amp}`, (s) => {
    s.uniforms.uTime = TIME;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed += vec3( sin( uTime * 0.21 + position.y * 3.1 + position.z ), sin( uTime * 0.13 + position.x * 2.3 ) * 0.6, cos( uTime * 0.17 + position.z * 2.7 + position.x ) ) * ${amp.toFixed(3)};`,
    );
  });
}
