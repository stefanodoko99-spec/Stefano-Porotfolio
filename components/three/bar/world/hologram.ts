import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, Vector3 } from 'three'

import { BLOOM_LAYER } from '../bloom'

/**
 * The hologram over the pedestal on the roof: a bowl of ramen drawn in cyan
 * points, the way the reference projects one. The bowl turns slowly, noodles
 * rise and fall inside it, steam drifts up and fades. It sits on the bloom
 * layer, so it glows.
 */
export type Hologram = {
  points: Points
  update: (t: number) => void
  /** point sizes are in device pixels, so they follow the renderer's pixel ratio */
  setPixelRatio: (ratio: number) => void
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute float aKind;   // 0 bowl, 1 noodle, 2 steam
  attribute float aSeed;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vec3 p = position;
    float a = uTime * 0.45;
    float c = cos(a), s = sin(a);
    p.xz = mat2(c, -s, s, c) * p.xz;
    float alpha = 1.0;
    if (aKind > 1.5) {
      float life = fract(uTime * 0.22 + aSeed);
      p.y += life * 1.1;
      p.x += sin(uTime * 1.3 + aSeed * 40.0) * 0.06 * life;
      p.z += cos(uTime * 1.1 + aSeed * 30.0) * 0.06 * life;
      alpha = (1.0 - life) * smoothstep(0.0, 0.15, life) * 0.8;
    } else if (aKind > 0.5) {
      p.y += sin(uTime * 2.0 + aSeed * 20.0) * 0.05;
      alpha = 0.9;
    } else {
      alpha = 0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 60.0 + p.y * 8.0);
    }
    // a scan line runs up the bowl
    float scan = smoothstep(0.0, 0.08, abs(fract(uTime * 0.5) * 1.6 - p.y - 0.2)) * 0.5 + 0.5;
    vAlpha = alpha * scan;
    vKind = aKind;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (aKind > 1.5 ? 2.4 : 1.7) * (16.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vKind;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float soft = 1.0 - smoothstep(0.15, 0.5, r);
    gl_FragColor = vec4(uColor * (vKind > 0.5 ? 1.15 : 1.0), soft * vAlpha);
  }
`

export function createHologram(at: Vector3, pixelRatio: number): Hologram {
  const positions: number[] = []
  const kinds: number[] = []
  const seeds: number[] = []
  const push = (x: number, y: number, z: number, kind: number) => {
    positions.push(x, y, z)
    kinds.push(kind)
    seeds.push(Math.random())
  }
  // the bowl: a widening cup, denser at the rim
  for (let i = 0; i < 1500; i++) {
    const h = Math.pow(Math.random(), 0.7)
    const r = 0.12 + 0.55 * Math.sqrt(h)
    const a = Math.random() * Math.PI * 2
    push(Math.cos(a) * r, h * 0.62, Math.sin(a) * r, 0)
  }
  for (let i = 0; i < 260; i++) {
    const a = (i / 260) * Math.PI * 2
    push(Math.cos(a) * 0.68, 0.64, Math.sin(a) * 0.68, 0)
  }
  // the noodles: wavy strands lying across the top, a few lifted by chopsticks
  for (let strand = 0; strand < 9; strand++) {
    const phase = strand * 1.7
    const lift = strand < 3
    for (let i = 0; i < 70; i++) {
      const t = i / 70
      const x = (t - 0.5) * 1.1 + Math.sin(phase) * 0.1
      const z = Math.sin(t * 9 + phase) * 0.12 + (strand - 4) * 0.08
      const y = lift ? 0.66 + t * 0.9 : 0.66 + Math.sin(t * 6 + phase) * 0.02
      push(x, y, z, 1)
    }
  }
  // the chopsticks: two straight lines
  for (let i = 0; i < 60; i++) {
    const t = i / 60
    push(0.05 + t * 0.35, 0.7 + t * 1.15, -0.05 + t * 0.1, 1)
    push(0.12 + t * 0.35, 0.7 + t * 1.15, 0.05 + t * 0.1, 1)
  }
  // the steam
  for (let i = 0; i < 320; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * 0.45
    push(Math.cos(a) * r, 0.7, Math.sin(a) * r, 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aKind', new Float32BufferAttribute(kinds, 1))
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color('#3cf5ff') },
      uScale: { value: pixelRatio },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const points = new Points(geometry, material)
  points.position.copy(at)
  points.name = 'hologram'
  points.layers.enable(BLOOM_LAYER)
  points.frustumCulled = false
  return {
    points,
    update(t) {
      material.uniforms.uTime.value = t
    },
    setPixelRatio(ratio) {
      material.uniforms.uScale.value = ratio
    },
  }
}
