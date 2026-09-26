import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ================================================================
   0. Boot / renderer / camera
================================================================ */
const loadingEl = document.getElementById('loading');
if (!window.WebGL2RenderingContext) {
  loadingEl.querySelector('p').textContent = 'WebGL2 is required to view this scene.';
  throw new Error('WebGL2 unavailable');
}

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x02030a, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(3.6, 2.15, 4.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 3.0;
controls.maxDistance = 11;
controls.maxPolarAngle = 1.45;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;

/* ================================================================
   1. Ocean waves — one definition shared by GLSL and JS
================================================================ */
const WAVE_SCALE = 0.55;
const WAVE_SPEED = 0.70;
const WAVES = [
  { dir: [ 1.0,  0.35], len: 11.0, q: 0.10 },
  { dir: [ 0.4, -0.9 ], len:  6.5, q: 0.09 },
  { dir: [-0.7,  0.6 ], len:  3.6, q: 0.07 },
  { dir: [ 0.9, -0.4 ], len:  2.0, q: 0.05 },
];
const WP = WAVES.map(w => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  const dx = w.dir[0] / l, dz = w.dir[1] / l;
  const k = (Math.PI * 2) / w.len;
  return { dx, dz, k, a: (w.q * WAVE_SCALE) / k, c: Math.sqrt(9.8 / k) * WAVE_SPEED };
});
function waterHeight(x, z, t) {
  let y = 0;
  for (const w of WP) y += w.a * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * t));
  return y;
}
const waveCalls = WP.map(w =>
  `  addWave(vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), ${w.k.toFixed(4)}, ${w.a.toFixed(5)}, ${w.c.toFixed(4)}, wp.xz, uTime, disp, tang, binm);`
).join('\n');

/* ================================================================
   2. Night sky (cloudless): gradient, stars, milky way, moon
================================================================ */
const MOON_DIR = new THREE.Vector3(-0.42, 0.50, -0.63).normalize();

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;
const skyFrag = /* glsl */`
uniform float uTime;
uniform vec3 uMoonDir;
varying vec3 vDir;

float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 starLayer(vec3 d, float scale, float thresh, float bright, float seed){
  vec3 cell = floor(d * scale + seed);
  vec3 f = fract(d * scale + seed);
  float rnd = hash13(cell);
  vec3 col = vec3(0.0);
  if (rnd > thresh){
    vec3 c = vec3(hash13(cell + 11.13), hash13(cell + 27.77), hash13(cell + 43.31));
    float sd = length(f - c);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * hash13(cell + 57.0)) + rnd * 44.0);
    float mag = pow(hash13(cell + 71.0), 4.0);
    col = vec3(0.75, 0.82, 1.0) * smoothstep(0.30, 0.0, sd) * tw * bright * (0.25 + 2.4 * mag);
  }
  return col;
}
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(vec3(0.030, 0.052, 0.115), vec3(0.003, 0.006, 0.022), pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(vec3(0.018, 0.030, 0.070), col, smoothstep(-0.2, 0.03, h));
  // faint milky way
  vec3 mwN = normalize(vec3(0.35, 0.9, 0.28));
  float band = exp(-pow(dot(d, mwN), 2.0) * 9.0);
  float mw = 0.5 * vnoise(vec2(d.x * 3.1 + d.z * 2.2, d.y * 3.3 - d.z * 1.6))
           + 0.5 * vnoise(vec2(d.z * 6.3 + 4.7, d.x * 5.1 + d.y * 3.9));
  col += vec3(0.085, 0.10, 0.175) * band * (0.30 + 0.70 * mw);
  // stars
  col += starLayer(d, 150.0, 0.9965, 0.85, 0.0);
  col += starLayer(d, 330.0, 0.9972, 0.35, 3.7);
  // moon
  float md = dot(d, uMoonDir);
  float disc = smoothstep(0.99974, 0.99987, md);
  float limb = clamp((md - 0.99974) / 0.00013, 0.0, 1.0);
  col += vec3(1.10, 1.07, 0.96) * 3.0 * disc * (0.72 + 0.28 * sqrt(limb));
  col += vec3(0.42, 0.47, 0.65) * pow(max(md, 0.0), 320.0) * 0.85;
  col += vec3(0.16, 0.20, 0.33) * pow(max(md, 0.0), 16.0) * 0.06;
  gl_FragColor = vec4(col, 1.0);
}
`;
const skyGeo = new THREE.SphereGeometry(600, 48, 32);
const skyMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uMoonDir: { value: MOON_DIR } },
  vertexShader: skyVert,
  fragmentShader: skyFrag,
  side: THREE.BackSide,
  depthWrite: false,
});
const skyMesh = new THREE.Mesh(skyGeo, skyMat);
skyMesh.frustumCulled = false;
skyMesh.renderOrder = -10;
scene.add(skyMesh);

// Bake the sky into an environment map so glass/wood pick up real reflections.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(skyGeo, skyMat));
scene.environment = pmrem.fromScene(envScene, 0.04, 1, 1200).texture;
pmrem.dispose();

/* ================================================================
   3. Ocean surface (Gerstner swells + glitter + bottle glow)
================================================================ */
const waterVert = /* glsl */`
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormalW;

void addWave(vec2 d, float k, float a, float c, vec2 xz, float t,
             inout vec3 disp, inout vec3 tang, inout vec3 binm){
  float f = k * (dot(d, xz) - c * t);
  float s = sin(f), co = cos(f);
  float q = a * k;
  disp.x += d.x * a * co;
  disp.y += a * s;
  disp.z += d.y * a * co;
  tang += vec3(-d.x*d.x*q*s,  d.x*q*co, -d.x*d.y*q*s);
  binm += vec3(-d.x*d.y*q*s,  d.y*q*co, -d.y*d.y*q*s);
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 binm = vec3(0.0, 0.0, 1.0);
${waveCalls}
  wp.xyz += disp;
  vWorldPos = wp.xyz;
  vNormalW = normalize(cross(binm, tang));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const waterFrag = /* glsl */`
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uBottleLight;
uniform vec3 uGlowColor;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec3 vWorldPos;
varying vec3 vNormalW;

void main(){
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = length(vWorldPos - cameraPosition);
  float df = exp(-dist * 0.03);
  vec2 p = vWorldPos.xz;
  float t = uTime;
  // fine ripple detail normal
  vec3 dn;
  dn.x = sin(p.x*2.9 + t*1.2) + 0.6*sin(p.x*6.1 - t*1.8 + p.y*1.9) + 0.35*sin((p.x+p.y)*11.7 + t*2.4);
  dn.y = 0.0;
  dn.z = sin(p.y*2.5 - t*1.1) + 0.6*sin(p.y*5.7 + t*1.6 + p.x*1.3) + 0.35*sin((p.y-p.x)*10.3 - t*2.2);
  vec3 N = normalize(vNormalW + dn * (0.09 * df));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.02;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
  float mr = max(dot(normalize(R), uMoonDir), 0.0);
  sky += vec3(0.85, 0.90, 1.0) * (pow(mr, 700.0) * 2.4 + pow(mr, 48.0) * 0.10);

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(uDeep, sky, clamp(fres, 0.0, 1.0));

  // moon glitter
  vec3 H = normalize(V + uMoonDir);
  col += vec3(0.90, 0.93, 1.0) * pow(max(dot(N, H), 0.0), 540.0) * 2.2;

  // warm glow bleeding from the bottle
  vec3 toB = uBottleLight - vWorldPos;
  float bd = length(toB);
  vec3 L = toB / max(bd, 0.001);
  float atten = 1.0 / (1.0 + bd * bd * 0.11);
  col += uGlowColor * max(dot(N, L), 0.0) * atten * 0.5;
  vec3 Hb = normalize(V + L);
  col += uGlowColor * pow(max(dot(N, Hb), 0.0), 170.0) * atten * 1.5;

  float fog = 1.0 - exp(-dist * 0.010);
  col = mix(col, uHorizon * 0.85, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;
const waterUniforms = {
  uTime:        { value: 0 },
  uMoonDir:     { value: MOON_DIR },
  uBottleLight: { value: new THREE.Vector3(0, 1.05, 0) },
  uGlowColor:   { value: new THREE.Color(1.0, 0.5, 0.15).multiplyScalar(1.35) },
  uDeep:        { value: new THREE.Color(0x05101e) },
  uHorizon:     { value: new THREE.Color(0x0a1526) },
  uZenith:      { value: new THREE.Color(0x02040c) },
};
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 700, 210, 210),
  new THREE.ShaderMaterial({ uniforms: waterUniforms, vertexShader: waterVert, fragmentShader: waterFrag })
);
water.rotation.x = -Math.PI / 2;
water.frustumCulled = false;
scene.add(water);

/* ================================================================
   4. Lights
================================================================ */
scene.add(new THREE.AmbientLight(0x24304f, 0.55));
const moonLight = new THREE.DirectionalLight(0xa9c2ff, 1.5);
moonLight.position.copy(MOON_DIR).multiplyScalar(40);
scene.add(moonLight);

/* ================================================================
   5. Bottle shape — curved spine swept with a varying radius,
      giving the signature horn/flask silhouette
================================================================ */
const SPINE = new THREE.CatmullRomCurve3([
  new THREE.Vector3( 0.00, 0.00, 0),
  new THREE.Vector3( 0.07, 0.30, 0),
  new THREE.Vector3( 0.11, 0.70, 0),
  new THREE.Vector3( 0.07, 1.10, 0),
  new THREE.Vector3(-0.05, 1.45, 0),
  new THREE.Vector3(-0.19, 1.72, 0),
  new THREE.Vector3(-0.28, 1.92, 0),
  new THREE.Vector3(-0.32, 2.08, 0),
], false, 'centripetal');

const RADIUS_KEYS = [
  [0.000, 0.001], [0.020, 0.200], [0.050, 0.420], [0.090, 0.560],
  [0.150, 0.640], [0.230, 0.672], [0.330, 0.640], [0.450, 0.565],
  [0.580, 0.470], [0.700, 0.360], [0.800, 0.262], [0.870, 0.205],
  [0.920, 0.176], [0.960, 0.166], [0.985, 0.176], [1.000, 0.165],
];
const FLATTEN = 0.82; // slight flask-like flattening of the cross-section

function radiusAt(t) {
  const k = RADIUS_KEYS;
  if (t <= k[0][0]) return k[0][1];
  if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
  let i = 0;
  while (i < k.length - 2 && t > k[i + 1][0]) i++;
  const p0 = k[Math.max(0, i - 1)][1], p1 = k[i][1];
  const p2 = k[i + 1][1], p3 = k[Math.min(k.length - 1, i + 2)][1];
  const u = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
  const u2 = u * u, u3 = u2 * u;
  return Math.max(0.0001, 0.5 * ((2 * p1) + (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3));
}

function buildBottleGeometry({ tubular = 120, radial = 64, tMax = 1, radiusScale = 1, capTop = true } = {}) {
  const pos = [], uv = [], aT = [], idx = [];
  const S = new THREE.Vector3(), T = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = (tMax * i) / tubular;
    SPINE.getPoint(t, S);
    SPINE.getTangent(t, T);
    const nx = -T.y, ny = T.x; // spine is planar, so the frame is stable
    const r = radiusAt(t) * radiusScale;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(S.x + nx * c * r, S.y + ny * c * r, S.z + s * r * FLATTEN);
      uv.push(j / radial, t);
      aT.push(t);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  if (capTop) {
    SPINE.getPoint(tMax, S);
    const cIdx = pos.length / 3;
    pos.push(S.x, S.y, S.z);
    uv.push(0.5, tMax);
    aT.push(tMax);
    const ring = tubular * (radial + 1);
    for (let j = 0; j < radial; j++) idx.push(ring + j, ring + j + 1, cIdx);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Surface frame helper so the sigil sits flush on the glass.
function surfaceFrame(t) {
  const S = SPINE.getPoint(t);
  const T = SPINE.getTangent(t).normalize();
  const r = radiusAt(t);
  const front = new THREE.Vector3(S.x, S.y, S.z + r * FLATTEN);
  const t2 = Math.min(1, t + 0.012);
  const S2 = SPINE.getPoint(t2);
  const front2 = new THREE.Vector3(S2.x, S2.y, S2.z + radiusAt(t2) * FLATTEN);
  const upSurf = front2.clone().sub(front).normalize();
  const side = new THREE.Vector3(-T.y, T.x, 0).multiplyScalar(r);
  const normal = new THREE.Vector3().crossVectors(upSurf, side).normalize();
  if (normal.z < 0) normal.negate();
  const xAxis = new THREE.Vector3().crossVectors(upSurf, normal).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  return { pos: front, quat: new THREE.Quaternion().setFromRotationMatrix(m), normal };
}

const bottleGroup = new THREE.Group();
scene.add(bottleGroup);

/* ---------------- glass shell ---------------- */
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.05,
  metalness: 0,
  transmission: 1.0,
  thickness: 0.55,
  ior: 1.45,
  attenuationColor: new THREE.Color(0xffc890),
  attenuationDistance: 2.5,
  clearcoat: 0.5,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.4,
  side: THREE.DoubleSide,
});
const glassMesh = new THREE.Mesh(buildBottleGeometry(), glassMat);
bottleGroup.add(glassMesh);

/* ---------------- glowing liquid (mango gradient) ---------------- */
const liquidVert = /* glsl */`
attribute float aT;
varying float vT;
varying vec3 vPosL;
varying vec3 vPosW;
varying vec3 vNormW;
void main(){
  vT = aT;
  vPosL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const liquidFrag = /* glsl */`
uniform float uTime;
varying float vT;
varying vec3 vPosL;
varying vec3 vPosW;
varying vec3 vNormW;

float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){
    v += a * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
void main(){
  vec3 cBot = vec3(1.00, 0.30, 0.03); // deep orange
  vec3 cMid = vec3(1.00, 0.60, 0.09); // mango
  vec3 cTop = vec3(1.00, 0.90, 0.38); // banana yellow
  float g = clamp(vT, 0.0, 1.0);
  vec3 col = mix(cBot, cMid, smoothstep(0.02, 0.55, g));
  col = mix(col, cTop, smoothstep(0.50, 0.97, g));

  // slow magical swirl
  vec2 p1 = vPosL.xy * 1.9 + vec2(uTime * 0.05, -uTime * 0.09);
  vec2 p2 = vec2(vPosL.z * 2.4, vPosL.y * 1.4) + vec2(-uTime * 0.06, uTime * 0.04);
  float n = fbm(p1 + fbm(p2) * 0.9);
  col *= 0.80 + 0.45 * n;

  // rising flecks of starlight inside the liquid
  float fl = noise(vPosL.xy * 15.0 + vec2(3.7, -uTime * 0.55))
           * noise(vPosL.zy * 12.0 + vec2(-uTime * 0.45, 8.2));
  col += vec3(1.0, 0.85, 0.45) * smoothstep(0.55, 0.85, fl * 1.9) * 1.5;

  // rim glow
  vec3 V = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - abs(dot(normalize(vNormW), V)), 2.2);
  col += vec3(1.0, 0.70, 0.24) * fres * 1.05;

  col *= 2.0; // HDR push for the bloom pass
  gl_FragColor = vec4(col, 1.0);
}
`;
const liquidMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: liquidVert,
  fragmentShader: liquidFrag,
  side: THREE.DoubleSide,
});
const liquidMesh = new THREE.Mesh(
  buildBottleGeometry({ tMax: 0.93, radiusScale: 0.925 }),
  liquidMat
);
bottleGroup.add(liquidMesh);

/* ---------------- wood texture (procedural) ---------------- */
function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7c5434';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256;
    g.strokeStyle = `rgba(${30 + Math.random() * 40 | 0}, ${18 + Math.random() * 26 | 0}, ${8 + Math.random() * 16 | 0}, ${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) {
      g.lineTo(x + Math.sin(y * 0.05 + i) * 4 + (Math.random() - 0.5) * 3, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const woodTex = makeWoodTexture();
const corkMat = new THREE.MeshStandardMaterial({
  map: woodTex, bumpMap: woodTex, bumpScale: 0.35,
  color: 0xd8b28a, roughness: 0.72, envMapIntensity: 0.35,
});
const baseMat = new THREE.MeshStandardMaterial({
  map: woodTex, bumpMap: woodTex, bumpScale: 0.35,
  color: 0xb08a64, roughness: 0.80, envMapIntensity: 0.30,
});
const stripeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.62) }); // HDR banana glow

/* ---------------- cork (tilted with the neck) ---------------- */
const neckTop = SPINE.getPoint(1);
const neckTan = SPINE.getTangent(1).normalize();
const corkGroup = new THREE.Group();
corkGroup.position.copy(neckTop).addScaledVector(neckTan, -0.03);
corkGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), neckTan);
bottleGroup.add(corkGroup);

const corkPts = [
  [0.001, 0.000], [0.150, 0.000], [0.176, 0.020], [0.196, 0.060],
  [0.206, 0.120], [0.212, 0.200], [0.216, 0.280], [0.206, 0.340],
  [0.172, 0.395], [0.100, 0.425], [0.001, 0.440],
].map(p => new THREE.Vector2(p[0], p[1]));
corkGroup.add(new THREE.Mesh(new THREE.LatheGeometry(corkPts, 56), corkMat));

for (const [y, R] of [[0.12, 0.200], [0.30, 0.205]]) {
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(R, 0.016, 10, 48), stripeMat);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = y;
  corkGroup.add(stripe);
}

/* ---------------- wooden base with glowing stripe ---------------- */
const basePts = [
  [0.001, -0.140], [0.400, -0.140], [0.560, -0.120], [0.640, -0.065],
  [0.668, -0.005], [0.660, 0.050], [0.605, 0.100], [0.520, 0.135], [0.400, 0.150],
].map(p => new THREE.Vector2(p[0], p[1]));
bottleGroup.add(new THREE.Mesh(new THREE.LatheGeometry(basePts, 64), baseMat));

const baseStripe = new THREE.Mesh(new THREE.TorusGeometry(0.660, 0.018, 10, 64), stripeMat);
baseStripe.rotation.x = Math.PI / 2;
baseStripe.position.y = -0.02;
bottleGroup.add(baseStripe);

/* ---------------- starlight sigil (extruded 4-point star) ---------------- */
function createStarGeometry(scale, depth) {
  const s = new THREE.Shape();
  const k = 0.16; // concavity of the star edges
  s.moveTo(0, 1);
  s.quadraticCurveTo(k, k, 1, 0);
  s.quadraticCurveTo(k, -k, 0, -1);
  s.quadraticCurveTo(-k, -k, -1, 0);
  s.quadraticCurveTo(-k, k, 0, 1);
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: depth * 0.28,
    bevelSize: 0.05, bevelSegments: 3, curveSegments: 18,
  });
  g.center();
  g.scale(scale, scale, scale);
  return g;
}
const sigilMat = new THREE.MeshStandardMaterial({
  color: 0x8a6414,
  emissive: new THREE.Color(1.95, 1.60, 0.50),
  emissiveIntensity: 1.5,
  roughness: 0.32,
  metalness: 0.05,
  envMapIntensity: 0.6,
});
const sigilFrame = surfaceFrame(0.55);
const sigil = new THREE.Mesh(createStarGeometry(0.30, 0.24), sigilMat);
sigil.position.copy(sigilFrame.pos).addScaledVector(sigilFrame.normal, 0.02);
sigil.quaternion.copy(sigilFrame.quat);
bottleGroup.add(sigil);

/* ---------------- glow lights inside the bottle ---------------- */
const interiorLight = new THREE.PointLight(0xff9430, 18, 9, 2);
interiorLight.position.set(0.05, 0.95, 0);
bottleGroup.add(interiorLight);

const sigilLight = new THREE.PointLight(0xffd777, 2.5, 3.0, 2);
sigilLight.position.copy(sigilFrame.pos).addScaledVector(sigilFrame.normal, 0.25);
bottleGroup.add(sigilLight);

/* ---------------- soft halo sprite behind the silhouette ---------------- */
function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,235,170,0.55)');
  grad.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowSpriteTex = makeGlowSprite();
const halo = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowSpriteTex, color: new THREE.Color(1.25, 0.75, 0.28),
  transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
}));
halo.scale.set(4.4, 4.4, 1);
halo.position.set(0, 1.15, 0);
bottleGroup.add(halo);

/* ================================================================
   6. Floating sparkles (3D stars + tetra triangles) and motes
================================================================ */
const sparkleStarMat = new THREE.MeshStandardMaterial({
  color: 0x6e5210, emissive: new THREE.Color(1.90, 1.55, 0.50),
  emissiveIntensity: 1.25, roughness: 0.3, metalness: 0.1,
});
const sparkleTriMat = new THREE.MeshStandardMaterial({
  color: 0x6e5210, emissive: new THREE.Color(1.75, 1.45, 0.55),
  emissiveIntensity: 1.25, roughness: 0.3, metalness: 0.1,
});
const triGeo = new THREE.TetrahedronGeometry(0.06);
const miniStarGeo = createStarGeometry(0.11, 0.30);

const sparkles = [];
for (let i = 0; i < 22; i++) {
  const useStar = i % 3 === 0;
  const mesh = new THREE.Mesh(useStar ? miniStarGeo : triGeo, useStar ? sparkleStarMat : sparkleTriMat);
  sparkles.push({
    mesh,
    R: 1.15 + Math.random() * 1.05,
    y: 0.35 + Math.random() * 2.1,
    a: Math.random() * Math.PI * 2,
    w: (0.08 + Math.random() * 0.16) * (Math.random() < 0.5 ? -1 : 1),
    bobA: 0.06 + Math.random() * 0.12,
    bobF: 0.6 + Math.random() * 1.2,
    phase: Math.random() * Math.PI * 2,
    spin: 0.4 + Math.random() * 0.8,
    base: 0.75 + Math.random() * 0.6,
  });
  bottleGroup.add(mesh);
}

// drifting ember motes
const moteCount = 90;
const motePos = new Float32Array(moteCount * 3);
const moteData = [];
for (let i = 0; i < moteCount; i++) {
  moteData.push({
    R: 0.9 + Math.random() * 1.7,
    a: Math.random() * Math.PI * 2,
    w: (Math.random() - 0.5) * 0.15,
    y: Math.random() * 2.9,
    v: 0.05 + Math.random() * 0.11,
  });
}
const motesGeo = new THREE.BufferGeometry();
motesGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({
  size: 0.08, map: glowSpriteTex, color: new THREE.Color(1.6, 1.3, 0.5),
  transparent: true, opacity: 0.9, depthWrite: false,
  blending: THREE.AdditiveBlending, sizeAttenuation: true,
}));
motes.frustumCulled = false;
bottleGroup.add(motes);

/* ================================================================
   7. Post-processing (HDR bloom)
================================================================ */
const dbs = renderer.getDrawingBufferSize(new THREE.Vector2());
const composerTarget = new THREE.WebGLRenderTarget(dbs.x, dbs.y, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(dbs.x, dbs.y), 0.85, 0.55, 0.55);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
});

/* ================================================================
   8. Animation loop — the bottle rides the same waves as the ocean
================================================================ */
const clock = new THREE.Clock();
const upVec = new THREE.Vector3(0, 1, 0);
const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const yawQ = new THREE.Quaternion();
let frames = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  controls.update();

  skyMat.uniforms.uTime.value = t;
  waterUniforms.uTime.value = t;
  liquidMat.uniforms.uTime.value = t;

  // buoyancy: height + gentle tilt from the wave normal + slow yaw sway
  const h = waterHeight(0, 0, t);
  bottleGroup.position.y = h * 0.9 - 0.02;
  const e = 0.4;
  const nx = waterHeight(e, 0, t) - waterHeight(-e, 0, t);
  const nz = waterHeight(0, e, t) - waterHeight(0, -e, t);
  tmpN.set(-nx, 2 * e, -nz).normalize().lerp(upVec, 0.5).normalize();
  yawQ.setFromAxisAngle(upVec, Math.sin(t * 0.1) * 0.15);
  tmpQ.setFromUnitVectors(upVec, tmpN).multiply(yawQ);
  bottleGroup.quaternion.slerp(tmpQ, 1 - Math.exp(-dt * 2.2));

  // the water shader needs the glow source position
  waterUniforms.uBottleLight.value.set(
    bottleGroup.position.x, bottleGroup.position.y + 1.05, bottleGroup.position.z);

  // sigil heartbeat
  const pulse = 1.0 + 0.22 * Math.sin(t * 1.7);
  sigilMat.emissiveIntensity = 1.5 * pulse;
  sigilLight.intensity = 2.5 * pulse;
  interiorLight.intensity = 18 + Math.sin(t * 3.1) * 1.5 + Math.sin(t * 7.7) * 0.8;

  // sparkles orbit, bob, twinkle
  for (const s of sparkles) {
    s.a += s.w * dt;
    s.mesh.position.set(
      Math.cos(s.a) * s.R,
      s.y + Math.sin(t * s.bobF + s.phase) * s.bobA,
      Math.sin(s.a) * s.R);
    s.mesh.rotation.x += dt * s.spin;
    s.mesh.rotation.y += dt * s.spin * 0.7;
    s.mesh.scale.setScalar(s.base * (0.7 + 0.3 * Math.sin(t * 2.4 + s.phase)));
  }

  // motes rise and wrap
  for (let i = 0; i < moteCount; i++) {
    const m = moteData[i];
    m.y += m.v * dt;
    m.a += m.w * dt;
    if (m.y > 2.9) { m.y = 0.03; m.R = 0.9 + Math.random() * 1.7; }
    motePos[i * 3] = Math.cos(m.a) * m.R;
    motePos[i * 3 + 1] = m.y;
    motePos[i * 3 + 2] = Math.sin(m.a) * m.R;
  }
  motesGeo.attributes.position.needsUpdate = true;

  composer.render();

  if (++frames === 4) loadingEl.classList.add('done');
}
animate();
