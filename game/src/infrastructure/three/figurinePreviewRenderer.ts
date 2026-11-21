import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {
  EntityType,
  FactionId,
  type ActiveToolType,
} from '@/domain/game/types';
import {
  createMaterialLibrary,
  type TabletopMaterialLibrary,
} from '@/infrastructure/three/materials';
import {
  FigurineFactory,
  type FigurineHandle,
} from '@/infrastructure/three/figurineFactory';

export type PreviewToolId = Exclude<ActiveToolType, null>;

interface PreviewSlot {
  id: string;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D | null;
  tool: PreviewToolId;
  faction: FactionId;
  stage: THREE.Group;
  handle: FigurineHandle | null;
  extraSpinObj?: THREE.Object3D;
  angle: number;
}

const RENDER_SIZE = 224;
const TURNTABLE_SPEED_RAD_PER_SEC = 0.36;
const PREVIEW_MIN_INTERVAL_MS = 33;

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/**
 * Shared single-context Three.js turntable renderer for rotating 3D dock figurines.
 * Renders all active dock preview slots through one lightweight offscreen WebGL context
 * and blits them onto 2D canvases so the browser never runs out of WebGL contexts.
 */
class FigurinePreviewRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private materials: TabletopMaterialLibrary | null = null;
  private factory: FigurineFactory | null = null;
  private readonly extraGeos: THREE.BufferGeometry[] = [];
  private readonly extraMats: THREE.Material[] = [];

  private readonly slots = new Map<string, PreviewSlot>();
  private isSoftwareGl = false;
  private loopTimer = 0;
  private rafId = 0;
  private lastTickMs = 0;
  private running = false;

  private ensureInitialized(): boolean {
    if (this.renderer && this.scene && this.camera && this.factory) {
      return true;
    }

    try {
      this.isSoftwareGl = detectSoftwareWebGL();
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !this.isSoftwareGl,
        powerPreference: 'default',
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);
      renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = !this.isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();

      // Studio 3-point lighting with stronger key-to-fill contrast for crisp form definition
      const keyLight = new THREE.DirectionalLight('#fff8eb', 2.25);
      keyLight.position.set(2.8, 4.8, 3.2);
      keyLight.castShadow = !this.isSoftwareGl;
      keyLight.shadow.mapSize.width = 512;
      keyLight.shadow.mapSize.height = 512;
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 14;
      keyLight.shadow.camera.left = -2;
      keyLight.shadow.camera.right = 2;
      keyLight.shadow.camera.top = 2;
      keyLight.shadow.camera.bottom = -2;
      keyLight.shadow.bias = -0.001;
      scene.add(keyLight);

      const hemiLight = new THREE.HemisphereLight('#cbd5e1', '#1e293b', 0.68);
      scene.add(hemiLight);

      const rimLight = new THREE.DirectionalLight('#93c5fd', 0.85);
      rimLight.position.set(-3.2, 2.8, -2.6);
      scene.add(rimLight);

      // Subtle shadow-catching ground disc for grounding depth
      const shadowPlane = new THREE.Mesh(
        this.trackGeo(new THREE.CircleGeometry(0.92, 28)),
        this.trackMat(
          new THREE.ShadowMaterial({
            opacity: 0.4,
          }),
        ),
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = -0.64;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
      camera.position.set(0, 1.0, 3.05);
      camera.lookAt(0, -0.02, 0);

      const materials = createMaterialLibrary(
        renderer.capabilities.getMaxAnisotropy(),
      );
      const factory = new FigurineFactory(materials);

      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.materials = materials;
      this.factory = factory;
      return true;
    } catch {
      return false;
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.extraGeos.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.extraMats.push(m);
    return m;
  }

  private createExtraToolModel(
    tool: 'FLARE' | 'REGENERATOR' | 'DEMOLISH',
  ): {group: THREE.Group; spinObj?: THREE.Object3D} {
    const mats = this.materials!;
    const group = new THREE.Group();

    if (tool === 'FLARE' || tool === 'REGENERATOR') {
      const isRegen = tool === 'REGENERATOR';
      // Illuminated floating lantern with radiant halo ring (violet for Flare, emerald green for Regenerator)
      const base = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.32, 0.38, 0.1, 16)),
        mats.stoneDark,
      );
      base.position.y = 0.05;
      group.add(base);

      const stand = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.08, 0.15, 0.16, 8)),
        isRegen ? mats.regeneratorRingMat : mats.brassBurnished,
      );
      stand.position.y = 0.15;
      group.add(stand);

      // Tapered light cone strictly underneath the floating orb (y = 0.10 .. 0.66)
      const beam = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.08, 0.34, 0.56, 14, 1, true)),
        isRegen ? mats.regeneratorBeam : mats.flareBeam,
      );
      beam.position.y = 0.38;
      group.add(beam);

      const halo = new THREE.Mesh(
        this.trackGeo(new THREE.TorusGeometry(0.32, 0.034, 8, 24)),
        isRegen ? mats.regeneratorRingMat : mats.flareRingMat,
      );
      halo.position.y = 0.92;
      halo.rotation.x = Math.PI / 3;
      group.add(halo);

      const orb = new THREE.Mesh(
        this.trackGeo(new THREE.OctahedronGeometry(0.21, 0)),
        isRegen ? mats.regeneratorOrbMat : mats.flareOrbMat,
      );
      orb.position.y = 0.92;
      group.add(orb);

      return {group, spinObj: orb};
    }

    if (tool === 'DEMOLISH') {
      // Sculpted demolition warhammer resting against a stone masonry block + gold refund coin
      const stoneBlock = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.46, 0.3, 0.42)),
        mats.stoneLight,
      );
      stoneBlock.position.set(-0.08, 0.15, 0);
      group.add(stoneBlock);

      const crackedTop = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.22, 0.14, 0.2)),
        mats.stoneDark,
      );
      crackedTop.position.set(-0.14, 0.36, -0.06);
      crackedTop.rotation.z = 0.18;
      group.add(crackedTop);

      const hammerPivot = new THREE.Group();
      hammerPivot.position.set(0.14, 0.44, 0.04);
      hammerPivot.rotation.z = -0.42;

      const handle = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.038, 0.044, 0.78, 8)),
        mats.woodDark,
      );
      hammerPivot.add(handle);

      const head = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.36, 0.16, 0.16)),
        mats.steelBright,
      );
      head.position.y = 0.34;
      hammerPivot.add(head);

      const accentBand = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.12, 0.18, 0.18)),
        this.trackMat(
          new THREE.MeshStandardMaterial({
            color: '#e11d48',
            roughness: 0.45,
            metalness: 0.25,
          }),
        ),
      );
      accentBand.position.y = 0.34;
      hammerPivot.add(accentBand);
      group.add(hammerPivot);

      const coin = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.045, 16)),
        mats.brassBurnished,
      );
      coin.rotation.x = Math.PI / 2;
      coin.position.set(0.24, 0.14, 0.26);
      group.add(coin);

      return {group};
    }

    return {group};
  }

  private buildNormalizedStage(
    tool: PreviewToolId,
    faction: FactionId,
  ): {
    stage: THREE.Group;
    handle: FigurineHandle | null;
    extraSpinObj?: THREE.Object3D;
  } {
    const stage = new THREE.Group();
    let modelGroup: THREE.Group | null = null;
    let handle: FigurineHandle | null = null;
    let extraSpinObj: THREE.Object3D | undefined;

    if (tool === 'FLARE' || tool === 'REGENERATOR' || tool === 'DEMOLISH') {
      const built = this.createExtraToolModel(tool);
      modelGroup = built.group;
      extraSpinObj = built.spinObj;
    } else {
      handle = this.factory!.createFigurine(tool as EntityType, faction, 17);
      modelGroup = handle?.group ?? null;
    }

    if (modelGroup) {
      const box = new THREE.Box3().setFromObject(modelGroup);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxDim = Math.max(0.4, size.x, size.y, size.z);
      const scale = 1.26 / maxDim;
      modelGroup.scale.setScalar(scale);
      // Sit figurine flush on shadow catcher plane (y = -0.64) while filling frame cleanly
      modelGroup.position.set(
        -center.x * scale,
        -box.min.y * scale - 0.64,
        -center.z * scale,
      );
      modelGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
      stage.add(modelGroup);
    }

    return {stage, handle, extraSpinObj};
  }

  public registerSlot(
    id: string,
    canvas: HTMLCanvasElement,
    tool: PreviewToolId,
    faction: FactionId,
  ): void {
    if (!this.ensureInitialized()) return;

    const built = this.buildNormalizedStage(tool, faction);
    const slot: PreviewSlot = {
      id,
      canvas,
      ctx2d: canvas.getContext('2d'),
      tool,
      faction,
      stage: built.stage,
      handle: built.handle,
      extraSpinObj: built.extraSpinObj,
      angle: 0.45,
    };
    this.slots.set(id, slot);
    this.renderSingleSlot(slot);
    this.ensureLoopRunning();
  }

  public updateSlot(
    id: string,
    tool: PreviewToolId,
    faction: FactionId,
  ): void {
    const slot = this.slots.get(id);
    if (!slot || !this.ensureInitialized()) return;
    if (slot.tool === tool && slot.faction === faction) return;

    const built = this.buildNormalizedStage(tool, faction);
    slot.tool = tool;
    slot.faction = faction;
    slot.stage = built.stage;
    slot.handle = built.handle;
    slot.extraSpinObj = built.extraSpinObj;
    this.renderSingleSlot(slot);
  }

  public unregisterSlot(id: string): void {
    this.slots.delete(id);
    if (this.slots.size === 0) {
      this.stopLoop();
    }
  }

  private renderSingleSlot(slot: PreviewSlot): void {
    if (!this.renderer || !this.scene || !this.camera || !slot.ctx2d) return;

    slot.stage.rotation.y = slot.angle;
    this.scene.add(slot.stage);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(slot.stage);

    const w = slot.canvas.width;
    const h = slot.canvas.height;
    slot.ctx2d.imageSmoothingEnabled = true;
    slot.ctx2d.imageSmoothingQuality = 'high';
    slot.ctx2d.clearRect(0, 0, w, h);
    slot.ctx2d.drawImage(this.renderer.domElement, 0, 0, w, h);
  }

  private ensureLoopRunning(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickMs = performance.now();

    const step = () => {
      if (!this.running || this.slots.size === 0) {
        this.running = false;
        return;
      }
      const now = performance.now();
      const elapsedMs = now - this.lastTickMs;
      if (!this.isSoftwareGl && elapsedMs < PREVIEW_MIN_INTERVAL_MS) {
        this.rafId = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(0.12, elapsedMs / 1000);
      this.lastTickMs = now;

      for (const slot of this.slots.values()) {
        slot.angle += dt * TURNTABLE_SPEED_RAD_PER_SEC;
        if (slot.handle?.windmillRotor) {
          slot.handle.windmillRotor.rotation.z -= dt * 1.1;
        }
        if (slot.handle?.lanternCore) {
          slot.handle.lanternCore.rotation.y += dt * 0.9;
        }
        if (slot.extraSpinObj) {
          slot.extraSpinObj.rotation.y += dt * 1.0;
        }
        this.renderSingleSlot(slot);
      }

      if (this.isSoftwareGl) {
        this.loopTimer = window.setTimeout(step, 95);
      } else {
        this.rafId = requestAnimationFrame(step);
      }
    };

    if (this.isSoftwareGl) {
      this.loopTimer = window.setTimeout(step, 95);
    } else {
      this.rafId = requestAnimationFrame(step);
    }
  }

  private stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.clearTimeout(this.loopTimer);
  }
}

export const figurinePreviewRenderer = new FigurinePreviewRenderer();
