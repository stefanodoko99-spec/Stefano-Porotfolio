import { CircleGeometry, Color, Mesh, MeshBasicMaterial, Texture, UniformsUtils, Vector2, type WebGLRenderer } from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'

/**
 * The floor: a disc that mirrors the shop, with the pools of neon light the
 * bake left on it painted underneath the reflection.
 *
 * The baked floor has a planar UV (Blender wrote it so), and CircleGeometry's
 * UV is the same planar map, so the runtime can drop the exported floor and
 * put a Reflector of the same radius in its place with the atlas underneath.
 * The reflection fades with distance from the shop so the far floor stays
 * the quiet dark the reference has.
 */
export const FLOOR_RADIUS = 25
export const FLOOR_Y = -2.9
/** the bake lands a little dark for the reference's saturated look; the shop's atlases are lifted by this */
export const BAKE_LIFT = 1.3
/** the floor is not: its pools of light must stay pools, and the dark beyond them must stay dark */
export const FLOOR_LIFT = 1.0

const shader = {
  name: 'BakedReflector',
  uniforms: {
    color: { value: null as unknown as Color },
    tDiffuse: { value: null as unknown as Texture },
    tBaked: { value: null as unknown as Texture },
    textureMatrix: { value: null },
    mirror: { value: 0.24 },
    lift: { value: FLOOR_LIFT },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv4;
    varying vec2 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = uv;
      vUv4 = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tBaked;
    uniform float mirror;
    uniform float lift;
    varying vec4 vUv4;
    varying vec2 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 baked = texture2D(tBaked, vUv);
      vec4 refl = texture2DProj(tDiffuse, vUv4);
      float near = 1.0 - smoothstep(3.0, 10.0, length(vWorld.xz));
      vec3 col = baked.rgb * lift + refl.rgb * color * mirror * (0.35 + 0.65 * near);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
}

export function createFloor(renderer: WebGLRenderer, baked: Texture, mirror: boolean): { mesh: Mesh; resize: (w: number, h: number) => void } {
  const geometry = new CircleGeometry(FLOOR_RADIUS, 72)
  // the atlas was written for the exported disc, whose v runs the glTF way (top row first);
  // CircleGeometry's v runs the other way, so it is flipped to match
  const uv = geometry.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  if (!mirror) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: baked, color: new Color(FLOOR_LIFT, FLOOR_LIFT, FLOOR_LIFT), toneMapped: false }))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = FLOOR_Y
    mesh.name = 'floorFlat'
    return { mesh, resize: () => undefined }
  }
  // the mirror renders at half the canvas size; it follows the renderer's pixel ratio, which resize() may change
  const dpr = () => Math.min(renderer.getPixelRatio(), 1.5)
  const size = renderer.getSize(new Vector2())
  const reflector = new Reflector(geometry, {
    clipBias: 0.003,
    textureWidth: Math.round(size.x * dpr() * 0.5),
    textureHeight: Math.round(size.y * dpr() * 0.5),
    color: 0xb9b9c8,
    shader: { ...shader, uniforms: UniformsUtils.clone(shader.uniforms) },
  })
  const material = reflector.material as unknown as { uniforms: { tBaked: { value: Texture } } }
  material.uniforms.tBaked.value = baked
  reflector.rotation.x = -Math.PI / 2
  reflector.position.y = FLOOR_Y
  reflector.name = 'floorMirror'
  // the mirror pass must not see the floor, and the bloom's black pass must not either
  reflector.userData.skipBloom = true
  return {
    mesh: reflector,
    resize(w, h) {
      reflector.getRenderTarget().setSize(Math.round(w * dpr() * 0.5), Math.round(h * dpr() * 0.5))
    },
  }
}
