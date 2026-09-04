import { Layers, Mesh, MeshBasicMaterial, ShaderMaterial, Vector2, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

/**
 * Selective bloom, the way the reference's neon glows: the glowing things live
 * on a second layer, the scene is rendered once with everything else painted
 * black to make the bloom, then once normally, and the two are added.
 *
 * Anything with `userData.skipBloom` (the click targets, the mirror floor) is
 * hidden for the black pass rather than painted black, or it would occlude
 * the neon behind it. Points, lines and sprites that do not glow are hidden
 * too, since a black mesh material cannot stand in for them.
 *
 * The scene's split into glowing / painted black / hidden is fixed once the
 * shop is loaded, so it is gathered once (call `refresh()` after adding to the
 * scene) rather than walked every frame.
 *
 * The mix pass takes a ShaderMaterial rather than a shader object on purpose:
 * handed an object, ShaderPass clones the uniforms and the bloom texture never
 * reaches the shader.
 */
export const BLOOM_LAYER = 1

export type Bloom = {
  render: () => void
  resize: (width: number, height: number) => void
  refresh: () => void
  setStrength: (value: number) => void
}

type Renderable = Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean }

export function createBloom(renderer: WebGLRenderer, scene: Scene, camera: Camera, divisor: number, strength = 1.3, smaa = false): Bloom {
  const layer = new Layers()
  layer.set(BLOOM_LAYER)
  const dark = new MeshBasicMaterial({ color: 'black' })

  const size = renderer.getSize(new Vector2())
  const dpr = () => renderer.getPixelRatio()
  // a short radius keeps the glow close to the tube: a bright core, a halo, and dark around it
  const bloomPass = new UnrealBloomPass(new Vector2((size.x * dpr()) / divisor, (size.y * dpr()) / divisor), strength, 0.05, 0.0)
  const bloomComposer = new EffectComposer(renderer)
  bloomComposer.renderToScreen = false
  bloomComposer.addPass(new RenderPass(scene, camera))
  bloomComposer.addPass(bloomPass)
  // addPass and setSize both hand every pass the composer's full size, and the bloom pass
  // only reads its own resolution in the constructor: it is sized down again after each
  const sizeBloom = (width: number, height: number) => bloomPass.setSize((width * dpr()) / divisor, (height * dpr()) / divisor)
  sizeBloom(size.x, size.y)

  const mix = new ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        vec4 col = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
        float vignette = 1.0 - 0.35 * smoothstep(0.35, 1.2, length((vUv - 0.5) * vec2(1.5, 1.2)));
        gl_FragColor = vec4(col.rgb * vignette, col.a);
      }
    `,
  })
  const finalComposer = new EffectComposer(renderer)
  finalComposer.addPass(new RenderPass(scene, camera))
  finalComposer.addPass(new ShaderPass(mix, 'baseTexture'))
  // the composer's targets are not multisampled, so the edges are smoothed on the linear image,
  // before the output pass encodes it, the way three's own example orders them
  if (smaa) finalComposer.addPass(new SMAAPass(size.x * dpr(), size.y * dpr()))
  finalComposer.addPass(new OutputPass())

  let dim: Mesh[] = []
  let hide: Object3D[] = []
  const restore: (Material | Material[])[] = []
  const wasVisible: boolean[] = []

  function refresh(): void {
    dim = []
    hide = []
    scene.traverse((object: Renderable) => {
      if (object.userData.skipBloom) {
        hide.push(object)
        return
      }
      const renderable = object.isMesh || object.isPoints || object.isLine || object.isSprite
      if (!renderable || layer.test(object.layers)) return
      if (object.isMesh) dim.push(object as Mesh)
      else hide.push(object)
    })
  }
  refresh()

  return {
    render() {
      for (const object of hide) {
        wasVisible.push(object.visible)
        object.visible = false
      }
      for (const mesh of dim) {
        restore.push(mesh.material)
        mesh.material = dark
      }
      bloomComposer.render()
      dim.forEach((mesh, i) => (mesh.material = restore[i]))
      restore.length = 0
      hide.forEach((object, i) => (object.visible = wasVisible[i]))
      wasVisible.length = 0
      finalComposer.render()
    },
    resize(width, height) {
      bloomComposer.setPixelRatio(dpr())
      finalComposer.setPixelRatio(dpr())
      bloomComposer.setSize(width, height)
      finalComposer.setSize(width, height)
      sizeBloom(width, height)
    },
    refresh,
    setStrength(value) {
      bloomPass.strength = value
    },
  }
}
