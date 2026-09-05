import { AdditiveBlending, type Blending, BufferGeometry, Color, Float32BufferAttribute, Group, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three'

import { BLOOM_LAYER } from '../bloom'

/**
 * The hologram over the pedestal on the roof: a scoop of soft-serve on a
 * waffle cone, drawn in cyan points. The cone and swirl turn slowly, a few
 * sparkles rise off the peak and fade. It sits on the bloom layer, so it
 * glows.
 *
 * The cone and scoop draw with ordinary alpha blending, not additive: with
 * thousands of overlapping point sprites, additive blending sums every
 * overlap, so the cone and scoop washed out to a solid white blob no matter
 * how low each point's own alpha was set — the more points sat over one
 * screen pixel, the brighter it got, without limit. Alpha blending caps at
 * the point's own colour regardless of overlap count, which is what actually
 * keeps the shape a shape instead of a glow with no object inside it. The
 * sparkles keep additive blending — a small accent, not the whole cloud, so
 * they can glow past white without taking the rest of the shape down with it.
 */
export type Hologram = {
  points: Group
  update: (t: number) => void
  /** point sizes are in device pixels, so they follow the renderer's pixel ratio */
  setPixelRatio: (ratio: number) => void
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute float aKind;   // 0 cone, 1 swirl, 2 sparkle
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
      // a sparkle rising off the peak — a short, tight rise so its glow
      // stays close to the scoop instead of spreading past its silhouette
      float life = fract(uTime * 0.22 + aSeed);
      p.y += life * 0.55;
      p.x += sin(uTime * 1.3 + aSeed * 40.0) * 0.03 * life;
      p.z += cos(uTime * 1.1 + aSeed * 30.0) * 0.03 * life;
      alpha = (1.0 - life) * smoothstep(0.0, 0.15, life) * 0.65;
    } else if (aKind > 0.5) {
      p.y += sin(uTime * 2.0 + aSeed * 20.0) * 0.04;
      alpha = 0.8;
    } else {
      alpha = 0.5 + 0.35 * sin(uTime * 3.0 + aSeed * 60.0 + p.y * 8.0);
    }
    // a scan line runs up the cone and scoop
    float scan = smoothstep(0.0, 0.08, abs(fract(uTime * 0.5) * 1.9 - p.y - 0.3)) * 0.5 + 0.5;
    vAlpha = alpha * scan;
    vKind = aKind;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uScale * (aKind > 1.5 ? 1.8 : 1.5) * (12.0 / max(0.1, -mv.z));
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
    // a harder edge than a typical soft point sprite: the shape the points
    // draw is the point, not a halo escaping past it
    float soft = 1.0 - smoothstep(0.32, 0.5, r);
    gl_FragColor = vec4(uColor * (vKind > 0.5 ? 1.15 : 1.0), soft * vAlpha);
  }
`

function makeMaterial(pixelRatio: number, blending: Blending): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color('#3cf5ff') },
      uScale: { value: pixelRatio },
    },
    transparent: true,
    depthWrite: false,
    blending,
  })
}

export function createHologram(at: Vector3, pixelRatio: number): Hologram {
  const solidPositions: number[] = []
  const solidKinds: number[] = []
  const solidSeeds: number[] = []
  const pushSolid = (x: number, y: number, z: number, kind: number) => {
    solidPositions.push(x, y, z)
    solidKinds.push(kind)
    solidSeeds.push(Math.random())
  }
  // the waffle cone: apex down, widening to the rim where the scoop sits
  const coneTip = -0.55
  const coneRim = 0.15
  const coneR = 0.42
  for (let i = 0; i < 1400; i++) {
    const t = Math.pow(Math.random(), 0.6)
    const a = Math.random() * Math.PI * 2
    pushSolid(Math.cos(a) * coneR * t, coneTip + t * (coneRim - coneTip), Math.sin(a) * coneR * t, 0)
  }
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2
    pushSolid(Math.cos(a) * coneR, coneRim, Math.sin(a) * coneR, 0)
  }
  // the scoop: a soft-serve swirl tapering from the cone's rim to a peak,
  // its spiral ridges drawn as a radius rippled by angle and height
  const scoopTop = 1.35
  for (let i = 0; i < 1700; i++) {
    const t = Math.random()
    const y = coneRim + t * (scoopTop - coneRim)
    const base = coneR * (1 - t) * (1 - t)
    const a = Math.random() * Math.PI * 2
    const ripple = 1 + 0.16 * Math.sin(a * 5 - t * 14)
    const r = base * ripple
    pushSolid(Math.cos(a) * r, y, Math.sin(a) * r, 1)
  }

  const sparklePositions: number[] = []
  const sparkleKinds: number[] = []
  const sparkleSeeds: number[] = []
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * 0.14
    sparklePositions.push(Math.cos(a) * r, scoopTop - 0.05, Math.sin(a) * r)
    sparkleKinds.push(2)
    sparkleSeeds.push(Math.random())
  }

  const solidGeometry = new BufferGeometry()
  solidGeometry.setAttribute('position', new Float32BufferAttribute(solidPositions, 3))
  solidGeometry.setAttribute('aKind', new Float32BufferAttribute(solidKinds, 1))
  solidGeometry.setAttribute('aSeed', new Float32BufferAttribute(solidSeeds, 1))
  const solidMaterial = makeMaterial(pixelRatio, NormalBlending)
  const solidPoints = new Points(solidGeometry, solidMaterial)

  const sparkleGeometry = new BufferGeometry()
  sparkleGeometry.setAttribute('position', new Float32BufferAttribute(sparklePositions, 3))
  sparkleGeometry.setAttribute('aKind', new Float32BufferAttribute(sparkleKinds, 1))
  sparkleGeometry.setAttribute('aSeed', new Float32BufferAttribute(sparkleSeeds, 1))
  const sparkleMaterial = makeMaterial(pixelRatio, AdditiveBlending)
  const sparklePoints = new Points(sparkleGeometry, sparkleMaterial)

  const group = new Group()
  group.add(solidPoints, sparklePoints)
  group.position.copy(at)
  group.name = 'hologram'
  group.traverse((o) => o.layers.enable(BLOOM_LAYER))
  solidPoints.frustumCulled = false
  sparklePoints.frustumCulled = false
  return {
    points: group,
    update(t) {
      solidMaterial.uniforms.uTime.value = t
      sparkleMaterial.uniforms.uTime.value = t
    },
    setPixelRatio(ratio) {
      solidMaterial.uniforms.uScale.value = ratio
      sparkleMaterial.uniforms.uScale.value = ratio
    },
  }
}
