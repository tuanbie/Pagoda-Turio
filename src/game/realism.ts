/**
 * Realism layer for the HIGH and ULTRA graphics tiers.
 *
 * Self-contained: it only needs three + three/addons and the files in public/ultra/
 * (CC0 textures from ambientCG / Poly Haven, see public/ultra/CREDITS.md).
 *
 * How Game / World should call it
 * -------------------------------
 *   import { sharpenTextures, loadUltraTextures, loadSkyEnvironment, createPost } from './realism.ts';
 *
 *   // HIGH and ULTRA, once World has built its materials (cheap, sync):
 *   sharpenTextures(renderer, Object.values(world.m));
 *
 *   // ULTRA only, fire-and-forget after the first frame (the procedural look stays until
 *   // the photo textures arrive, and stays for any set whose files are missing):
 *   void loadUltraTextures(world.m, renderer);   // textures are freed when the material is disposed
 *   loadSkyEnvironment(renderer, scene).then((rt) => {
 *     // rt.texture is already scene.environment. The caller owns rt: dispose the previous env
 *     // render target, keep this one and call rt.dispose() when the world goes away (or right
 *     // away if the world was replaced meanwhile). Scale it with the time of day, e.g.
 *     // scene.environmentIntensity = THREE.MathUtils.lerp(0.08, 1, daylight);
 *   });
 *
 *   // ULTRA (ultra: true -> GTAO) or HIGH (ultra: false -> bloom + SMAA only):
 *   const post = createPost(renderer, scene, camera, { ultra: true });
 *   // resize handler:  renderer.setSize(w, h); post.setSize(w, h);
 *   // frame loop:      post.render();   // instead of renderer.render(scene, camera)
 *   // tier change:     post.dispose();
 *   // Pixel-ratio changes on the renderer are picked up automatically by post.render().
 *   // Keep renderer.toneMapping / toneMappingExposure as they are: OutputPass applies them.
 *
 * Materials named in ULTRA_SETS (key = World.m key) get WORLD-SPACE TRIPLANAR mapping via
 * onBeforeCompile, because the procedural geometry's UVs are 0..1 per box regardless of size.
 * Works with plain meshes, merged geometry, InstancedMesh and BatchedMesh; fog and shadows
 * are untouched. MeshLambertMaterial (LOW tier) is skipped.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// ---------------------------------------------------------------------------------------------
// texture sets
// ---------------------------------------------------------------------------------------------

export interface UltraSet {
  /** folder under public/ultra/ */
  dir: string;
  /** metres covered by one repeat of the texture */
  tile: number;
  /** normal-map strength */
  normal?: number;
  /** 0..1, low-frequency brightness variation that hides tiling on large areas */
  macro?: number;
  /** triplanar blend sharpness (higher = crisper seams on slopes, less ghosting) */
  sharp?: number;
  /** does the folder contain ao.jpg */
  ao?: boolean;
}

/** World.m key -> texture set. Metres-per-tile mostly match the scanned sample's real size. */
export const ULTRA_SETS: Record<string, UltraSet> = {
  grass: { dir: 'grass', tile: 3, macro: 0.6, ao: true },
  paving: { dir: 'paving', tile: 2, macro: 0.3, ao: true },
  stone: { dir: 'stone', tile: 1.5, macro: 0.25, ao: true },
  stoneDark: { dir: 'stoneDark', tile: 2, macro: 0.25, ao: true },
  plaster: { dir: 'plaster', tile: 2.5, normal: 0.7, macro: 0.2, ao: true },
  floor: { dir: 'floor', tile: 1.9, ao: true },
  woodDark: { dir: 'woodDark', tile: 1.2 },
  roof: { dir: 'roof', tile: 2, sharp: 8, ao: true },
  bark: { dir: 'bark', tile: 1.5, ao: true },
  soil: { dir: 'soil', tile: 2, macro: 0.4, ao: true },
  limestone: { dir: 'limestone', tile: 2, macro: 0.2, ao: true },
  marble: { dir: 'marble', tile: 2.1, normal: 0.5 },
  slateRoof: { dir: 'slateRoof', tile: 2.5, sharp: 8, ao: true },
  pew: { dir: 'pew', tile: 0.8 },
  gravel: { dir: 'gravel', tile: 1.5, macro: 0.4, ao: true },
};

const ULTRA_BASE = `${import.meta.env.BASE_URL ?? '/'}ultra/`;
const WHITE = new THREE.Color(1, 1, 1);
const TP_FLAG = '__triplanar';

const MAP_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'alphaMap',
  'lightMap',
  'displacementMap',
  'specularMap',
] as const;

/** Max anisotropic filtering on every texture of every material (HIGH and ULTRA). */
export function sharpenTextures(renderer: THREE.WebGLRenderer, materials: Iterable<THREE.Material>): void {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const seen = new Set<THREE.Texture>();
  const touch = (t: unknown) => {
    if (!(t instanceof THREE.Texture) || seen.has(t)) return;
    seen.add(t);
    if (t.anisotropy !== aniso) {
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
  };
  for (const m of materials) {
    const rec = m as unknown as Record<string, unknown>;
    for (const slot of MAP_SLOTS) touch(rec[slot]);
    const extra = m.userData[TP_FLAG] as { textures?: THREE.Texture[] } | undefined;
    extra?.textures?.forEach(touch);
  }
}

interface LoadedSet {
  color: THREE.Texture;
  normal: THREE.Texture | null;
  rough: THREE.Texture | null;
  ao: THREE.Texture | null;
}

let warnedMissing = false;

async function loadSet(set: UltraSet, aniso: number): Promise<LoadedSet | null> {
  const loader = new THREE.TextureLoader();
  const get = async (file: string, srgb: boolean): Promise<THREE.Texture | null> => {
    try {
      const t = await loader.loadAsync(`${ULTRA_BASE}${set.dir}/${file}`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      return t;
    } catch {
      return null;
    }
  };
  const [color, normal, rough, ao] = await Promise.all([
    get('color.jpg', true),
    get('normal.jpg', false),
    get('roughness.jpg', false),
    set.ao ? get('ao.jpg', false) : Promise.resolve(null),
  ]);
  if (!color || !normal || !rough || (set.ao && !ao)) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(`[realism] some ultra textures are missing (first: ${set.dir}); keeping the procedural look for those`);
    }
  }
  if (!color) {
    normal?.dispose();
    rough?.dispose();
    ao?.dispose();
    return null;
  }
  return { color, normal, rough, ao };
}

/**
 * ULTRA: swap the procedural canvas textures for photo-scanned PBR sets, mapped triplanar in
 * world space. Resolves when every set has loaded (or failed); never rejects.
 */
export async function loadUltraTextures(
  materials: Record<string, THREE.MeshStandardMaterial>,
  renderer: THREE.WebGLRenderer,
): Promise<void> {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const jobs: Promise<void>[] = [];
  for (const [key, m] of Object.entries(materials)) {
    const set = ULTRA_SETS[key];
    // Lambert stand-ins on LOW are cast to MeshStandardMaterial in World: skip those
    if (!set || !m || !(m as THREE.Material as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
    if (m.userData[TP_FLAG]) continue;
    // the world may be torn down (tier / place switch) before the files arrive
    let disposed = false;
    const onDispose = () => {
      disposed = true;
    };
    m.addEventListener('dispose', onDispose);
    jobs.push(
      loadSet(set, aniso)
        .then((tex) => {
          m.removeEventListener('dispose', onDispose);
          if (!tex) return;
          if (disposed) {
            for (const t of [tex.color, tex.normal, tex.rough, tex.ao]) t?.dispose();
            return;
          }
          applyTriplanar(m, set, tex);
        })
        .catch((e) => console.warn('[realism] texture set failed', key, e)),
    );
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------------------------------------
// triplanar shader patch
// ---------------------------------------------------------------------------------------------

const VERT_HEAD = /* glsl */ `
varying vec3 vTpPos;
varying vec3 vTpNrm;
// normal through an R*S matrix: inverse-transpose without an inverse
vec3 tpXformN( mat4 m, vec3 n ) {
  mat3 r = mat3( m );
  vec3 s2 = vec3( dot( r[0], r[0] ), dot( r[1], r[1] ), dot( r[2], r[2] ) );
  return r * ( n / max( s2, vec3( 1e-8 ) ) );
}
`;

const VERT_BODY = /* glsl */ `
{
  vec4 tpp = vec4( transformed, 1.0 );
  vec3 tpn = objectNormal;
  #ifdef USE_BATCHING
    tpp = batchingMatrix * tpp;
    tpn = tpXformN( batchingMatrix, tpn );
  #endif
  #ifdef USE_INSTANCING
    tpp = instanceMatrix * tpp;
    tpn = tpXformN( instanceMatrix, tpn );
  #endif
  vTpPos = ( modelMatrix * tpp ).xyz;
  vTpNrm = tpXformN( modelMatrix, tpn );
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vTpPos;
varying vec3 vTpNrm;
uniform sampler2D tpMap;
uniform sampler2D tpNormalMap;
uniform sampler2D tpRoughMap;
uniform sampler2D tpAoMap;
uniform float tpScale;
uniform float tpSharp;
uniform float tpMacro;
uniform float tpNormalScale;
vec4 tpTex( sampler2D t, vec2 ux, vec2 uy, vec2 uz, vec3 w ) {
  return texture( t, ux ) * w.x + texture( t, uy ) * w.y + texture( t, uz ) * w.z;
}
`;

// replaces map_fragment; also sets up the projection used by the later chunks
const FRAG_MAP = /* glsl */ `
vec3 tpN = normalize( vTpNrm );
vec3 tpW = pow( abs( tpN ), vec3( tpSharp ) );
tpW /= max( tpW.x + tpW.y + tpW.z, 1e-5 );
vec3 tpS = vec3( tpN.x < 0.0 ? -1.0 : 1.0, tpN.y < 0.0 ? -1.0 : 1.0, tpN.z < 0.0 ? -1.0 : 1.0 );
vec3 tpP = vTpPos * tpScale;
// u flipped per side so the tangent frames are right-handed on all six faces
vec2 tpUvX = vec2( -tpS.x * tpP.z, tpP.y );
vec2 tpUvY = vec2( -tpS.y * tpP.x, tpP.z );
vec2 tpUvZ = vec2( tpS.z * tpP.x, tpP.y );
{
  vec4 tpCol = tpTex( tpMap, tpUvX, tpUvY, tpUvZ, tpW );
  if ( tpMacro > 0.0 ) {
    const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
    vec3 big = tpTex( tpMap, tpUvX * 0.137 + 0.31, tpUvY * 0.137 + 0.57, tpUvZ * 0.137 + 0.13, tpW ).rgb;
    float mean = max( dot( textureLod( tpMap, vec2( 0.5 ), 16.0 ).rgb, LUMA ), 1e-3 );
    tpCol.rgb *= mix( 1.0, clamp( dot( big, LUMA ) / mean, 0.6, 1.45 ), tpMacro );
  }
  diffuseColor.rgb *= tpCol.rgb;
}
`;

const FRAG_ROUGH = /* glsl */ `
float roughnessFactor = roughness * tpTex( tpRoughMap, tpUvX, tpUvY, tpUvZ, tpW ).g;
`;

// replaces normal_fragment_maps: UDN blend of the three tangent-space normals in world space
const FRAG_NORMAL = /* glsl */ `
{
  vec3 nx = texture( tpNormalMap, tpUvX ).xyz * 2.0 - 1.0;
  vec3 ny = texture( tpNormalMap, tpUvY ).xyz * 2.0 - 1.0;
  vec3 nz = texture( tpNormalMap, tpUvZ ).xyz * 2.0 - 1.0;
  nx.xy *= tpNormalScale; ny.xy *= tpNormalScale; nz.xy *= tpNormalScale;
  vec3 wn = tpN
    + vec3( 0.0, nx.y, -tpS.x * nx.x ) * tpW.x
    + vec3( -tpS.y * ny.x, 0.0, ny.y ) * tpW.y
    + vec3( tpS.z * nz.x, nz.y, 0.0 ) * tpW.z;
  normal = normalize( ( viewMatrix * vec4( normalize( wn ), 0.0 ) ).xyz ) * faceDirection;
}
`;

const FRAG_AO = /* glsl */ `
{
  float tpAo = tpTex( tpAoMap, tpUvX, tpUvY, tpUvZ, tpW ).r;
  reflectedLight.indirectDiffuse *= tpAo;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float tpNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( tpNV, tpAo, material.roughness );
  #endif
}
`;

function applyTriplanar(m: THREE.MeshStandardMaterial, set: UltraSet, tex: LoadedSet): void {
  const hasN = !!tex.normal;
  const hasR = !!tex.rough;
  const hasAo = !!tex.ao;
  const uniforms = {
    tpMap: { value: tex.color },
    tpNormalMap: { value: tex.normal },
    tpRoughMap: { value: tex.rough },
    tpAoMap: { value: tex.ao },
    tpScale: { value: 1 / set.tile },
    tpSharp: { value: set.sharp ?? 4 },
    tpMacro: { value: set.macro ?? 0 },
    tpNormalScale: { value: set.normal ?? 1 },
  };
  const textures = [tex.color, tex.normal, tex.rough, tex.ao].filter((t): t is THREE.Texture => !!t);
  m.userData[TP_FLAG] = { uniforms, textures };
  // World / ChurchWorld dispose() only sees the standard map slots, so free the photo set here
  m.addEventListener('dispose', () => textures.forEach((t) => t.dispose()));

  // photo colour shows through; the old colour survives as a 30% tint
  m.color.lerp(WHITE, 0.7);
  const oldMap = m.map;
  m.map = null; // sampled ourselves, triplanar
  oldMap?.dispose(); // free the uploaded procedural canvas (re-uploads if another material still uses it)
  if (hasR) m.roughness = 1;

  const key = `tp${hasN ? 'N' : ''}${hasR ? 'R' : ''}${hasAo ? 'A' : ''}`;
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_BODY}`);
    let f = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <map_fragment>', FRAG_MAP);
    if (hasR) f = f.replace('#include <roughnessmap_fragment>', FRAG_ROUGH);
    if (hasN) f = f.replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    if (hasAo) f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
    s.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey()}|${key}`;
  m.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------
// image-based lighting
// ---------------------------------------------------------------------------------------------

/**
 * PMREM-filtered HDRI as scene.environment (the procedural sky dome stays the background).
 * Resolves to the PMREM render target (rt.texture is the new scene.environment), or null on
 * failure. The caller owns it: rt.dispose() frees the GPU memory (texture.dispose() on a
 * render-target texture does not), and the previous environment's target is not touched here.
 */
export async function loadSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  file = 'day.hdr',
): Promise<THREE.WebGLRenderTarget | null> {
  try {
    const hdr = await new RGBELoader().loadAsync(`${ULTRA_BASE}sky/${file}`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    let rt: THREE.WebGLRenderTarget;
    try {
      rt = pmrem.fromEquirectangular(hdr);
    } finally {
      hdr.dispose(); // the source DataTexture is not needed once PMREM has filtered it
      pmrem.dispose();
    }
    scene.environment = rt.texture;
    return rt;
  } catch (e) {
    console.warn('[realism] HDRI environment unavailable, keeping the current lighting', e);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// post-processing
// ---------------------------------------------------------------------------------------------

export interface Post {
  render(): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

/**
 * RenderPass -> GTAO (ultra only) -> subtle bloom -> SMAA -> OutputPass (tone mapping +
 * sRGB from the renderer's settings). Sizes are CSS pixels; the renderer's pixel ratio is
 * applied (and re-read every frame, so dynamic-resolution changes just work).
 */
export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: { ultra: boolean },
): Post {
  const size = renderer.getSize(new THREE.Vector2());
  let pr = renderer.getPixelRatio();
  const w = Math.max(1, size.x);
  const h = Math.max(1, size.y);

  // HalfFloat keeps HDR highlights for bloom; no MSAA (SMAA does the edges)
  const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);

  composer.addPass(new RenderPass(scene, camera));

  let gtao: GTAOPass | null = null;
  if (opts.ultra) {
    gtao = new GTAOPass(scene, camera, w * pr, h * pr);
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // The G-buffer is drawn with an opaque MeshNormalMaterial override, so sprites (name labels:
    // no normals -> NaN) and see-through cards (light shafts, rays) would become solid occluders.
    // Hide them for that render; restoreVisibility() puts back the flags the base call cached.
    const baseHide = gtao.overrideVisibility.bind(gtao);
    gtao.overrideVisibility = () => {
      baseHide();
      scene.traverse((o) => {
        if (!o.visible) return;
        if ((o as THREE.Sprite).isSprite) {
          o.visible = false;
          return;
        }
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        const ms = Array.isArray(mat) ? mat : [mat];
        if (
          ms.length > 0 &&
          ms.every((x) => (x.transparent && !x.depthWrite) || x.blending === THREE.AdditiveBlending)
        ) {
          o.visible = false;
        }
      });
    };
    composer.addPass(gtao);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(w * pr, h * pr), 0.25, 0.4, 0.9);
  composer.addPass(bloom);

  const smaa = new SMAAPass(w * pr, h * pr);
  composer.addPass(smaa);

  const output = new OutputPass();
  composer.addPass(output);

  return {
    render() {
      const p = renderer.getPixelRatio();
      if (p !== pr) {
        pr = p;
        composer.setPixelRatio(p); // also resizes every pass
      }
      // GTAO re-renders the scene for its G-buffer; without this the shadow map (4096 on
      // ultra) would be redrawn there too. RenderPass consumes needsUpdate, GTAO then skips it.
      const sm = renderer.shadowMap;
      const auto = sm.autoUpdate;
      if (auto) {
        sm.autoUpdate = false;
        sm.needsUpdate = true;
      }
      try {
        composer.render();
      } finally {
        sm.autoUpdate = auto;
      }
    },
    setSize(nw: number, nh: number) {
      pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(Math.max(1, nw), Math.max(1, nh));
    },
    dispose() {
      gtao?.dispose();
      bloom.dispose();
      smaa.dispose();
      output.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
