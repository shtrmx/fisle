import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {animate} from 'animejs';
import {
  axialToWorld,
  getNeighborKeys,
  HEX_RADIUS,
  hexDistance,
  hexKey,
  parseHexKey,
  worldToAxial,
  type HexKey,
} from '@/domain/hex/hexCoordinates';
import {
  CameraMode,
  EntityType,
  FactionId,
  GameEventType,
  type GameEvent,
  type GameState,
} from '@/domain/game/types';
import {
  CATAPULT_MIN_RANGE,
  FACTION_PALETTES,
  getTradingPostClusterAt,
  isUnit,
  type CoverageAreaKind,
} from '@/domain/game/rules';
import {
  createMaterialLibrary,
  type TabletopMaterialLibrary,
} from '@/infrastructure/three/materials';
import {
  FigurineFactory,
  type FigurineHandle,
} from '@/infrastructure/three/figurineFactory';
import {OrthographicCameraRig} from '@/infrastructure/three/cameraRig';

export interface FloatingPopupEvent {
  id: number;
  text: string;
  screenX: number;
  screenY: number;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface SceneCallbacks {
  onHexClick: (key: HexKey) => void;
  onBackgroundClick?: () => void;
  onHexHover: (key: HexKey | null) => void;
  onCameraTelemetry: (zoom: number, tiltFactor: number) => void;
  onFloatingPopup: (popup: FloatingPopupEvent) => void;
  onContextLost: () => void;
  onBoardReady?: () => void;
}

export interface InteractionHighlights {
  selectedProvinceId: string | null;
  selectedUnitKey: HexKey | null;
  reachableKeys: Iterable<HexKey>;
  catapultTargetKeys: Iterable<HexKey>;
  buildableKeys: Iterable<HexKey>;
  tradingPostPreviewKeys?: Iterable<HexKey>;
  demolishKeys: Iterable<HexKey>;
  landPickEligibleKeys: Iterable<HexKey>;
  landPickSelectedKeys: Iterable<HexKey>;
  visibleHexes: Set<HexKey> | null;
}

interface HexVisualNode {
  key: HexKey;
  worldX: number;
  worldZ: number;
  topY: number;
  faction: FactionId;
  entity: EntityType;
  tradingPostPart?: 'bell' | 'tent1' | 'tent2' | null;
  tradingPostRotY?: number;
  unitMoved: boolean;
  isFogged: boolean;
  figurineRoot: THREE.Group;
  figurine: FigurineHandle | null;
  isAnimatingMove: boolean;
}

const TILE_HEIGHT = 0.28;
const TILE_GAP_SCALE = 0.965;
const FOG_BUCKET_KEY = -1;
const SHADOW_ANIM_INTERVAL_MS = 45;

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

function createHexPrismGeometry(
  radius: number,
  height: number,
): THREE.CylinderGeometry {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.015, height, 6);
  geo.translate(0, height / 2, 0);
  return geo;
}

function createHexRingGeometry(
  innerR: number,
  outerR: number,
): THREE.RingGeometry {
  const geo = new THREE.RingGeometry(innerR, outerR, 6);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 6);
  return geo;
}

export class AntiyoyThreeScene {
  private readonly container: HTMLElement;
  private readonly callbacks: SceneCallbacks;
  private readonly isSoftwareGl: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly cameraRig: OrthographicCameraRig;
  private readonly materials: TabletopMaterialLibrary;
  private readonly figurineFactory: FigurineFactory;

  private readonly tilesGroup = new THREE.Group();
  private readonly bordersGroup = new THREE.Group();
  private readonly overlaysGroup = new THREE.Group();
  private readonly figurinesGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly fxGroup = new THREE.Group();
  private readonly pulseGroup = new THREE.Group();
  private readonly flaresGroup = new THREE.Group();

  private readonly hexNodes = new Map<HexKey, HexVisualNode>();
  private animatedNodes: HexVisualNode[] = [];
  private flareOrbs: Map<
    string,
    {group: THREE.Group; orb: THREE.Object3D; ring: THREE.Object3D; phase: number}
  > = new Map();
  private activePulseCleanup: (() => void) | null = null;
  private activeBorderPulseCleanup: (() => void) | null = null;
  private viewerFaction: FactionId | null = null;
  private activeFxCount = 0;
  private lastShadowAnimUpdateMs = 0;
  private menuShowcaseActive = false;

  private keyLight!: THREE.DirectionalLight;

  private readonly tileGeometry: THREE.CylinderGeometry;
  private readonly waterTileGeometry: THREE.CylinderGeometry;
  private readonly highlightRingGeo: THREE.RingGeometry;
  private readonly haloRingGeo: THREE.RingGeometry;
  private readonly provinceRingGeo: THREE.RingGeometry;
  private readonly pulseDiscGeo: THREE.CircleGeometry;
  private readonly borderBarGeo: THREE.BoxGeometry;
  private readonly boulderGeo: THREE.DodecahedronGeometry;
  private readonly flareBeamGeo: THREE.CylinderGeometry;
  private readonly flareOrbGeo: THREE.OctahedronGeometry;
  private readonly flareRingGeo: THREE.TorusGeometry;
  private readonly borderMaterial: THREE.MeshBasicMaterial;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly pickPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -TILE_HEIGHT,
  );
  private readonly _pickHit = new THREE.Vector3();
  private readonly _projVec = new THREE.Vector3();
  private readonly _dummy = new THREE.Object3D();

  private readonly clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  private isPointerDown = false;
  private isRightDrag = false;
  private didDrag = false;
  private hadPinch = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private readonly activePointers = new Map<number, {x: number; y: number}>();
  private lastPinchDist = 0;
  private lastPinchMidX = 0;
  private lastPinchMidY = 0;
  private lastPinchAngle = 0;
  private pinchAngleValid = false;
  private pinchRotateAccum = 0;
  private pinchRotating = false;
  private lastHoverRaycastTime = 0;
  private hoveredKey: HexKey | null = null;
  private popupCounter = 1;

  // Dynamic interaction state
  private selectedProvinceId: string | null = null;
  private selectedUnitKey: HexKey | null = null;
  private reachableKeys = new Set<HexKey>();
  private catapultTargetKeys = new Set<HexKey>();
  private buildableKeys = new Set<HexKey>();
  private tradingPostPreviewKeys = new Set<HexKey>();
  private demolishKeys = new Set<HexKey>();
  private landPickEligibleKeys = new Set<HexKey>();
  private landPickSelectedKeys = new Set<HexKey>();
  private visibleHexes: Set<HexKey> | null = null;
  private lastGameState: GameState | null = null;

  constructor(container: HTMLElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    const pixelRatio = this.computeOptimalPixelRatio(width, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#090b0f');

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    this.cameraRig = new OrthographicCameraRig(
      width,
      height,
      callbacks.onCameraTelemetry,
    );

    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.materials = createMaterialLibrary(maxAniso);
    this.figurineFactory = new FigurineFactory(this.materials);

    this.tileGeometry = createHexPrismGeometry(
      HEX_RADIUS * TILE_GAP_SCALE,
      TILE_HEIGHT,
    );
    this.waterTileGeometry = createHexPrismGeometry(
      HEX_RADIUS * 0.978,
      0.16,
    );
    this.highlightRingGeo = createHexRingGeometry(
      HEX_RADIUS * 0.65,
      HEX_RADIUS * 0.89,
    );
    this.haloRingGeo = createHexRingGeometry(
      HEX_RADIUS * 0.58,
      HEX_RADIUS * 0.94,
    );
    this.provinceRingGeo = createHexRingGeometry(
      HEX_RADIUS * 0.86,
      HEX_RADIUS * 0.94,
    );
    this.pulseDiscGeo = new THREE.CircleGeometry(HEX_RADIUS * 0.92, 6);
    this.pulseDiscGeo.rotateX(-Math.PI / 2);
    this.pulseDiscGeo.rotateY(Math.PI / 6);
    this.borderBarGeo = new THREE.BoxGeometry(HEX_RADIUS * 0.96, 0.016, 0.072);
    this.boulderGeo = new THREE.DodecahedronGeometry(0.18, 0);
    // Beam cone strictly stays underneath the floating orb (height 1.20, orb center at 1.56, bottom >= 1.25)
    this.flareBeamGeo = new THREE.CylinderGeometry(0.11, 0.62, 1.2, 14, 1, true);
    this.flareOrbGeo = new THREE.OctahedronGeometry(0.24, 0);
    this.flareRingGeo = new THREE.TorusGeometry(0.36, 0.036, 8, 20);
    this.borderMaterial = new THREE.MeshBasicMaterial({
      color: '#1e293b',
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });

    this.setupLighting();
    this.scene.add(this.waterGroup);
    this.scene.add(this.tilesGroup);
    this.scene.add(this.bordersGroup);
    this.scene.add(this.overlaysGroup);
    this.scene.add(this.pulseGroup);
    this.scene.add(this.figurinesGroup);
    this.scene.add(this.flaresGroup);
    this.scene.add(this.fxGroup);

    this.bindEvents();
    this.startLoop();
  }

  private computeOptimalPixelRatio(width: number, height: number): number {
    if (this.isSoftwareGl) return 1;
    const rawDpr = Math.min(window.devicePixelRatio || 1, 2);
    // Keep desktop 2K/4K viewports within a fast pixel budget while preserving crisp native MSAA
    const maxBackingPixels = 3_000_000;
    const area = Math.max(1, width * height);
    const areaCap = Math.sqrt(maxBackingPixels / area);
    return Math.max(1, Math.min(rawDpr, areaCap));
  }

  private setupLighting(): void {
    const keyLight = new THREE.DirectionalLight('#fff4de', 2.05);
    keyLight.position.set(36, 58, 28);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.width = 1536;
    keyLight.shadow.mapSize.height = 1536;
    const d = 36;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 4;
    keyLight.shadow.camera.far = 170;
    keyLight.shadow.bias = -0.0006;
    keyLight.shadow.normalBias = 0.025;
    this.keyLight = keyLight;
    this.scene.add(keyLight);

    const hemi = new THREE.HemisphereLight('#bfd9f5', '#3d4c5c', 0.95);
    this.scene.add(hemi);

    const rimLight = new THREE.DirectionalLight('#9cc9f7', 0.55);
    rimLight.position.set(-24, 18, -22);
    this.scene.add(rimLight);
  }

  private markShadowsDirty(): void {
    if (!this.isSoftwareGl) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  private clearInstancedGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.InstancedMesh) {
        child.dispose();
      }
    }
  }

  private rebuildAnimatedNodesList(): void {
    const list: HexVisualNode[] = [];
    for (const node of this.hexNodes.values()) {
      if (!node.figurine || node.isFogged) continue;
      if (
        node.figurine.windmillRotor ||
        node.figurine.bannerFlag ||
        node.figurine.lanternCore ||
        isUnit(node.entity)
      ) {
        list.push(node);
      }
    }
    this.animatedNodes = list;
  }

  /**
   * Batches all land hex prisms into at most 8 InstancedMesh draw calls
   * (1 per active faction + 1 for Fog of War).
   */
  private rebuildTileInstances(): void {
    this.clearInstancedGroup(this.tilesGroup);

    const buckets = new Map<number, HexVisualNode[]>();
    for (const node of this.hexNodes.values()) {
      const bucketId = node.isFogged ? FOG_BUCKET_KEY : node.faction;
      let arr = buckets.get(bucketId);
      if (!arr) {
        arr = [];
        buckets.set(bucketId, arr);
      }
      arr.push(node);
    }

    const dummy = this._dummy;
    dummy.rotation.set(0, 0, 0);

    for (const [bucketId, nodes] of buckets.entries()) {
      if (nodes.length === 0) continue;
      const mats =
        bucketId === FOG_BUCKET_KEY
          ? [
              this.materials.fogTileSide,
              this.materials.fogTileTop,
              this.materials.fogTileSide,
            ]
          : [
              this.materials.tileSideByFaction[bucketId as FactionId],
              this.materials.tileTopByFaction[bucketId as FactionId],
              this.materials.tileSideByFaction[bucketId as FactionId],
            ];

      const inst = new THREE.InstancedMesh(this.tileGeometry, mats, nodes.length);
      inst.castShadow = false;
      inst.receiveShadow = true;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        dummy.position.set(node.worldX, 0, node.worldZ);
        dummy.scale.set(1, node.topY / TILE_HEIGHT, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      inst.matrixAutoUpdate = false;
      inst.updateMatrix();
      this.tilesGroup.add(inst);
    }
  }

  private resolveTradingPostVisual(
    state: GameState,
    key: HexKey,
  ): {part: 'bell' | 'tent1' | 'tent2'; rotY: number} | null {
    const cluster = getTradingPostClusterAt(state, key);
    if (!cluster) return null;
    const idx = cluster.hexKeys.indexOf(key);
    if (idx < 0) return null;

    let avgX = 0;
    let avgZ = 0;
    for (const hk of cluster.hexKeys) {
      const coord = parseHexKey(hk);
      const w = axialToWorld(coord.q, coord.r);
      avgX += w.x;
      avgZ += w.z;
    }
    avgX /= cluster.hexKeys.length;
    avgZ /= cluster.hexKeys.length;

    const curCoord = parseHexKey(key);
    const curW = axialToWorld(curCoord.q, curCoord.r);
    const rotY = Math.atan2(avgX - curW.x, avgZ - curW.z);
    const part: 'bell' | 'tent1' | 'tent2' =
      idx === 0 ? 'bell' : idx === 1 ? 'tent1' : 'tent2';
    return {part, rotY};
  }

  public rebuildBoard(
    state: GameState,
    visibleHexes: Set<HexKey> | null,
    viewerFaction?: FactionId,
  ): void {
    this.clearBoard();
    this.lastGameState = state;
    this.visibleHexes = visibleHexes;
    this.viewerFaction = viewerFaction ?? null;

    let maxExtent = 8;
    for (const cell of Object.values(state.cells)) {
      const world = axialToWorld(cell.q, cell.r);
      maxExtent = Math.max(
        maxExtent,
        Math.abs(world.x) + 1.5,
        Math.abs(world.z) + 1.5,
      );

      const topY = TILE_HEIGHT + cell.elevation;
      const isFogged =
        this.visibleHexes !== null && !this.visibleHexes.has(cell.key);

      const figurineRoot = new THREE.Group();
      figurineRoot.position.set(world.x, 0, world.z);
      this.figurinesGroup.add(figurineRoot);

      const node: HexVisualNode = {
        key: cell.key,
        worldX: world.x,
        worldZ: world.z,
        topY,
        faction: cell.faction,
        entity: EntityType.NONE,
        tradingPostPart: null,
        tradingPostRotY: 0,
        unitMoved: cell.unitMoved,
        isFogged,
        figurineRoot,
        figurine: null,
        isAnimatingMove: false,
      };
      this.hexNodes.set(cell.key, node);

      if (cell.entity !== EntityType.NONE) {
        const tpVisual =
          cell.entity === EntityType.TRADING_POST
            ? this.resolveTradingPostVisual(state, cell.key)
            : null;
        this.attachFigurineToNode(
          node,
          cell.entity,
          cell.faction,
          false,
          tpVisual,
        );
        if (node.figurine) {
          node.figurine.group.visible = !isFogged;
        }
      }
    }

    this.rebuildTileInstances();
    this.buildWaterHexes(state);
    this.refreshFactionBorders(state);
    this.syncFlares(state);
    this.rebuildAnimatedNodesList();
    const shadowHalf = Math.max(26, maxExtent + 5);
    this.keyLight.shadow.camera.left = -shadowHalf;
    this.keyLight.shadow.camera.right = shadowHalf;
    this.keyLight.shadow.camera.top = shadowHalf;
    this.keyLight.shadow.camera.bottom = -shadowHalf;
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.cameraRig.fitToBoardBounds(maxExtent + 2.2);
    this.markShadowsDirty();

    // Subtle lift-in on the batched tilesGroup (1 transform instead of 550 individual tweens!)
    this.tilesGroup.position.y = -0.22;
    this.figurinesGroup.position.y = -0.22;
    animate(this.tilesGroup.position, {
      y: 0,
      duration: 320,
      ease: 'outCubic',
    });
    animate(this.figurinesGroup.position, {
      y: 0,
      duration: 320,
      ease: 'outCubic',
    });

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.cameraRig.camera);
    }
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.callbacks.onBoardReady?.();
  }

  /**
   * Batches all empty interior hexes (rivers, lakes) and an organic irregular
   * ocean shoreline (distance <= 3 from any land hex) into a single InstancedMesh.
   */
  private buildWaterHexes(state: GameState): void {
    this.clearInstancedGroup(this.waterGroup);

    const waterKeys = new Set<HexKey>();
    const positions: Array<{x: number; z: number}> = [];
    const COAST_MARGIN = 2;

    for (const cell of Object.values(state.cells)) {
      for (let dq = -COAST_MARGIN; dq <= COAST_MARGIN; dq++) {
        const drMin = Math.max(-COAST_MARGIN, -dq - COAST_MARGIN);
        const drMax = Math.min(COAST_MARGIN, -dq + COAST_MARGIN);
        for (let dr = drMin; dr <= drMax; dr++) {
          const q = cell.q + dq;
          const r = cell.r + dr;
          const key = hexKey(q, r);
          if (state.cells[key] || waterKeys.has(key)) continue;
          waterKeys.add(key);
          positions.push(axialToWorld(q, r));
        }
      }
    }

    if (positions.length === 0) return;

    const waterMesh = new THREE.InstancedMesh(
      this.waterTileGeometry,
      [
        this.materials.waterHexDeepSide,
        this.materials.waterHexDeepTop,
        this.materials.waterHexDeepSide,
      ],
      positions.length,
    );
    waterMesh.castShadow = false;
    waterMesh.receiveShadow = true;

    const dummy = this._dummy;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    for (let i = 0; i < positions.length; i++) {
      dummy.position.set(positions[i].x, 0, positions[i].z);
      dummy.updateMatrix();
      waterMesh.setMatrixAt(i, dummy.matrix);
    }
    waterMesh.instanceMatrix.needsUpdate = true;
    waterMesh.frustumCulled = false;
    waterMesh.matrixAutoUpdate = false;
    waterMesh.updateMatrix();
    this.waterGroup.add(waterMesh);
  }

  private clearBoard(): void {
    this.clearInstancedGroup(this.tilesGroup);
    this.clearInstancedGroup(this.bordersGroup);
    this.clearInstancedGroup(this.overlaysGroup);
    this.clearInstancedGroup(this.waterGroup);
    this.clearActivePulse();
    this.clearActiveBorderPulse();

    while (this.figurinesGroup.children.length > 0) {
      this.figurinesGroup.remove(this.figurinesGroup.children[0]);
    }
    while (this.flaresGroup.children.length > 0) {
      this.flaresGroup.remove(this.flaresGroup.children[0]);
    }
    this.hexNodes.clear();
    this.animatedNodes = [];
    this.flareOrbs.clear();
  }

  private attachFigurineToNode(
    node: HexVisualNode,
    entity: EntityType,
    faction: FactionId,
    animatePop: boolean,
    tpVisual?: {part: 'bell' | 'tent1' | 'tent2'; rotY: number} | null,
  ): void {
    if (node.figurine) {
      node.figurineRoot.remove(node.figurine.group);
      node.figurine = null;
    }
    node.entity = entity;
    node.tradingPostPart = tpVisual?.part ?? null;
    node.tradingPostRotY = tpVisual?.rotY ?? 0;
    if (entity === EntityType.NONE) return;

    const seed =
      Math.abs(
        node.key
          .split('')
          .reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7),
      ) % 997;
    const handle =
      entity === EntityType.TRADING_POST && tpVisual
        ? this.figurineFactory.createTradingPostPart(tpVisual.part, faction)
        : this.figurineFactory.createFigurine(entity, faction, seed);
    if (!handle) return;

    handle.baseY = node.topY;
    handle.group.position.set(0, node.topY, 0);
    if (entity === EntityType.TRADING_POST && tpVisual) {
      handle.group.rotation.y = tpVisual.rotY;
    }
    handle.group.visible = !node.isFogged;
    node.figurineRoot.add(handle.group);
    node.figurine = handle;

    if (animatePop && !node.isFogged) {
      handle.group.scale.set(0.05, 0.05, 0.05);
      animate(handle.group.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 320,
        ease: 'outBack',
      });
    }
  }

  private playCatapultBoulderFx(fromKey: HexKey, toKey: HexKey): void {
    const fromNode = this.hexNodes.get(fromKey);
    const toNode = this.hexNodes.get(toKey);
    if (!fromNode || !toNode) return;

    const fromVisible =
      this.visibleHexes === null || this.visibleHexes.has(fromKey);
    const toVisible =
      this.visibleHexes === null || this.visibleHexes.has(toKey);

    // Completely hide projectiles fired inside Fog of War
    if (!fromVisible && !toVisible) return;

    const spawnImpactRing = (): void => {
      if (!toVisible) {
        this.activeFxCount = Math.max(0, this.activeFxCount - 1);
        this.markShadowsDirty();
        return;
      }
      const ring = new THREE.Mesh(
        this.highlightRingGeo,
        this.materials.highlightCatapult,
      );
      ring.position.set(toNode.worldX, toNode.topY + 0.08, toNode.worldZ);
      ring.scale.setScalar(0.3);
      this.fxGroup.add(ring);

      animate(ring.scale, {
        x: 1.55,
        y: 1.55,
        z: 1.55,
        duration: 340,
        ease: 'outCubic',
        onComplete: () => {
          this.fxGroup.remove(ring);
          this.activeFxCount = Math.max(0, this.activeFxCount - 1);
          this.markShadowsDirty();
        },
      });
    };

    // If the catapult itself is hidden in Fog of War, only show the impact on the visible target
    if (!fromVisible && toVisible) {
      this.activeFxCount++;
      spawnImpactRing();
      return;
    }

    const boulder = new THREE.Mesh(this.boulderGeo, this.materials.stoneLight);
    boulder.castShadow = !this.isSoftwareGl;
    const sx = fromNode.worldX;
    const sy = fromNode.topY + 0.75;
    const sz = fromNode.worldZ;
    const tx = toNode.worldX;
    const ty = toNode.topY + 0.25;
    const tz = toNode.worldZ;

    boulder.position.set(sx, sy, sz);
    this.fxGroup.add(boulder);
    this.activeFxCount++;

    const flight = {t: 0};
    animate(flight, {
      t: 1,
      duration: 440,
      ease: 'inOutQuad',
      onUpdate: () => {
        const p = flight.t;
        boulder.position.x = sx + (tx - sx) * p;
        boulder.position.z = sz + (tz - sz) * p;
        boulder.position.y =
          sy + (ty - sy) * p + Math.sin(p * Math.PI) * 2.6;
        boulder.rotation.x += 0.2;
        boulder.rotation.z += 0.14;
      },
      onComplete: () => {
        this.fxGroup.remove(boulder);
        spawnImpactRing();
      },
    });
  }

  private upsertMarkerOrb(
    id: string,
    node: HexVisualNode,
    beamMat: THREE.Material,
    orbMat: THREE.Material,
    ringMat: THREE.Material,
    phase: number,
  ): void {
    if (this.flareOrbs.has(id)) return;

    const g = new THREE.Group();
    g.position.set(node.worldX, node.topY + 0.04, node.worldZ);

    const beam = new THREE.Mesh(this.flareBeamGeo, beamMat);
    beam.position.y = 0.6;
    g.add(beam);

    const orb = new THREE.Mesh(this.flareOrbGeo, orbMat);
    orb.position.y = 1.56;
    g.add(orb);

    const ring = new THREE.Mesh(this.flareRingGeo, ringMat);
    ring.position.y = 1.56;
    ring.rotation.x = Math.PI / 3;
    g.add(ring);

    this.flaresGroup.add(g);
    this.flareOrbs.set(id, {group: g, orb, ring, phase});
  }

  private syncFlares(state: GameState): void {
    const desiredIds = new Set<string>();
    let idx = 0;

    for (const flare of state.flares) {
      if (flare.turnsRemaining <= 0) continue;
      const node = this.hexNodes.get(flare.centerKey);
      if (!node) continue;
      const id = `flare:${flare.centerKey}`;
      desiredIds.add(id);
      this.upsertMarkerOrb(
        id,
        node,
        this.materials.flareBeam,
        this.materials.flareOrbMat,
        this.materials.flareRingMat,
        idx++ * 0.85,
      );
    }

    for (const reg of state.regenerators ?? []) {
      const node = this.hexNodes.get(reg.centerKey);
      if (!node) continue;
      if (this.visibleHexes && !this.visibleHexes.has(reg.centerKey)) continue;
      const id = `reg:${reg.centerKey}`;
      desiredIds.add(id);
      this.upsertMarkerOrb(
        id,
        node,
        this.materials.regeneratorBeam,
        this.materials.regeneratorOrbMat,
        this.materials.regeneratorRingMat,
        idx++ * 0.85,
      );
    }

    for (const [id, entry] of this.flareOrbs.entries()) {
      if (!desiredIds.has(id)) {
        this.flaresGroup.remove(entry.group);
        this.flareOrbs.delete(id);
      }
    }
  }

  public syncState(
    state: GameState,
    events: GameEvent[],
    visibleHexes: Set<HexKey> | null,
    viewerFaction?: FactionId,
  ): void {
    this.lastGameState = state;
    this.visibleHexes = visibleHexes;
    if (viewerFaction !== undefined) {
      this.viewerFaction = viewerFaction;
    }

    const movedTargets = new Map<HexKey, GameEvent>();
    const capturedTargets = new Set<HexKey>();
    const poppedTargets = new Set<HexKey>();

    for (const ev of events) {
      if (ev.type === GameEventType.UNIT_MOVED && ev.toKey) {
        movedTargets.set(ev.toKey, ev);
      } else if (ev.type === GameEventType.HEX_CAPTURED && ev.toKey) {
        capturedTargets.add(ev.toKey);
      } else if (
        (ev.type === GameEventType.BUILDING_BUILT ||
          ev.type === GameEventType.UNIT_BOUGHT ||
          ev.type === GameEventType.UNIT_MERGED ||
          ev.type === GameEventType.TREE_GROWN) &&
        ev.toKey
      ) {
        poppedTargets.add(ev.toKey);
        if (
          ev.type === GameEventType.BUILDING_BUILT &&
          ev.entity === EntityType.TRADING_POST &&
          ev.path
        ) {
          for (const pk of ev.path) {
            poppedTargets.add(pk);
          }
        }
      } else if (
        ev.type === GameEventType.CATAPULT_FIRED &&
        ev.fromKey &&
        ev.toKey
      ) {
        this.playCatapultBoulderFx(ev.fromKey, ev.toKey);
      }

      if (ev.toKey && ev.amount !== undefined && ev.amount !== 0) {
        const isVisible =
          this.visibleHexes === null || this.visibleHexes.has(ev.toKey);
        if (isVisible) {
          this.emitFloatingPopup(
            ev.toKey,
            ev.amount > 0 ? `+${ev.amount}` : `${ev.amount}`,
            ev.amount > 0 ? 'positive' : 'negative',
          );
        }
      } else if (ev.type === GameEventType.PROVINCE_BANKRUPT && ev.toKey) {
        const isVisible =
          this.visibleHexes === null || this.visibleHexes.has(ev.toKey);
        if (isVisible) {
          this.emitFloatingPopup(ev.toKey, 'Банкротство!', 'negative');
        }
      } else if (ev.type === GameEventType.CATAPULT_FIRED && ev.toKey && ev.note) {
        const isVisible =
          this.visibleHexes === null || this.visibleHexes.has(ev.toKey);
        if (isVisible) {
          this.emitFloatingPopup(ev.toKey, ev.note, 'neutral');
        }
      }
    }

    let tilesDirty = false;
    let bordersDirty = false;

    for (const cell of Object.values(state.cells)) {
      const node = this.hexNodes.get(cell.key);
      if (!node) continue;

      const nextFogged =
        this.visibleHexes !== null && !this.visibleHexes.has(cell.key);
      const factionChanged = node.faction !== cell.faction;
      const fogChanged = node.isFogged !== nextFogged;

      node.faction = cell.faction;
      node.isFogged = nextFogged;
      node.unitMoved = cell.unitMoved;

      if (factionChanged || fogChanged) {
        tilesDirty = true;
        bordersDirty = true;
      }

      const tpVisual =
        cell.entity === EntityType.TRADING_POST
          ? this.resolveTradingPostVisual(state, cell.key)
          : null;
      const tpChanged =
        cell.entity === EntityType.TRADING_POST &&
        (node.tradingPostPart !== (tpVisual?.part ?? null) ||
          Math.abs((node.tradingPostRotY ?? 0) - (tpVisual?.rotY ?? 0)) > 0.01);

      const needsRebuild =
        node.entity !== cell.entity ||
        tpChanged ||
        (node.figurine !== null && capturedTargets.has(cell.key));

      if (needsRebuild) {
        const shouldPop =
          poppedTargets.has(cell.key) && !movedTargets.has(cell.key);
        this.attachFigurineToNode(
          node,
          cell.entity,
          cell.faction,
          shouldPop,
          tpVisual,
        );
      }

      if (node.figurine) {
        node.figurine.group.visible = !nextFogged;
      }

      const moveEvent = movedTargets.get(cell.key);
      if (moveEvent && moveEvent.fromKey && node.figurine && !nextFogged) {
        const fromNode = this.hexNodes.get(moveEvent.fromKey);
        if (fromNode) {
          const dx = fromNode.worldX - node.worldX;
          const dz = fromNode.worldZ - node.worldZ;
          const figGroup = node.figurine.group;
          figGroup.position.set(dx, node.topY, dz);
          const hop = {t: 0};
          node.isAnimatingMove = true;
          this.activeFxCount++;
          animate(hop, {
            t: 1,
            duration: 300,
            ease: 'outCubic',
            onUpdate: () => {
              const p = hop.t;
              figGroup.position.x = dx * (1 - p);
              figGroup.position.z = dz * (1 - p);
              figGroup.position.y = node.topY + Math.sin(p * Math.PI) * 0.55;
            },
            onComplete: () => {
              node.isAnimatingMove = false;
              figGroup.position.set(0, node.topY, 0);
              this.activeFxCount = Math.max(0, this.activeFxCount - 1);
              this.markShadowsDirty();
            },
          });
        }
      }
    }

    if (tilesDirty) {
      this.rebuildTileInstances();
    }
    if (bordersDirty) {
      this.refreshFactionBorders(state);
    }
    this.syncFlares(state);
    this.rebuildAnimatedNodesList();
    this.applyHighlights(state);
    this.markShadowsDirty();
  }

  /**
   * Batches all faction territory borders into 1 single InstancedMesh draw call.
   */
  private refreshFactionBorders(state: GameState): void {
    this.clearInstancedGroup(this.bordersGroup);

    const edgeAngles = [
      Math.PI / 2,
      Math.PI / 6,
      -Math.PI / 6,
      -Math.PI / 2,
      (-5 * Math.PI) / 6,
      (5 * Math.PI) / 6,
    ];
    const apothem = HEX_RADIUS * 0.855;

    const transforms: Array<{x: number; y: number; z: number; rotY: number}> = [];

    for (const cell of Object.values(state.cells)) {
      const node = this.hexNodes.get(cell.key);
      if (!node || node.isFogged || cell.faction === FactionId.NEUTRAL) continue;

      const neighbors = getNeighborKeys(cell.key);
      for (let dirIdx = 0; dirIdx < neighbors.length; dirIdx++) {
        const neighbor = state.cells[neighbors[dirIdx]];
        if (!neighbor || neighbor.faction !== cell.faction) {
          const angle = edgeAngles[dirIdx];
          transforms.push({
            x: node.worldX + Math.sin(angle) * apothem,
            y: node.topY + 0.008,
            z: node.worldZ - Math.cos(angle) * apothem,
            rotY: -angle,
          });
        }
      }
    }

    if (transforms.length === 0) return;

    const borderInst = new THREE.InstancedMesh(
      this.borderBarGeo,
      this.borderMaterial,
      transforms.length,
    );
    borderInst.castShadow = false;
    borderInst.receiveShadow = false;
    borderInst.frustumCulled = false;
    borderInst.renderOrder = 1;

    const dummy = this._dummy;
    dummy.scale.set(1, 1, 1);

    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.updateMatrix();
      borderInst.setMatrixAt(i, dummy.matrix);
    }
    borderInst.instanceMatrix.needsUpdate = true;
    borderInst.matrixAutoUpdate = false;
    borderInst.updateMatrix();
    this.bordersGroup.add(borderInst);
  }

  public updateInteractionHighlights(
    state: GameState,
    highlights: InteractionHighlights,
  ): void {
    this.selectedProvinceId = highlights.selectedProvinceId;
    this.selectedUnitKey = highlights.selectedUnitKey;
    this.reachableKeys = new Set(highlights.reachableKeys);
    this.catapultTargetKeys = new Set(highlights.catapultTargetKeys);
    this.buildableKeys = new Set(highlights.buildableKeys);
    this.tradingPostPreviewKeys = new Set(
      highlights.tradingPostPreviewKeys ?? [],
    );
    this.demolishKeys = new Set(highlights.demolishKeys);
    this.landPickEligibleKeys = new Set(highlights.landPickEligibleKeys);
    this.landPickSelectedKeys = new Set(highlights.landPickSelectedKeys);
    this.visibleHexes = highlights.visibleHexes;
    this.applyHighlights(state);
  }

  /**
   * Batches province rings, high-contrast translucent fill discs, dark contrast
   * halo rings, and vivid top highlight rings into minimal InstancedMeshes so
   * selections are unmistakably visible on white, light-grey, and yellow tiles.
   */
  private applyHighlights(state: GameState): void {
    this.clearInstancedGroup(this.overlaysGroup);

    const provinceNodes: HexVisualNode[] = [];
    const haloNodes: HexVisualNode[] = [];
    const fillBuckets = new Map<THREE.Material, HexVisualNode[]>();
    const ringBuckets = new Map<THREE.Material, HexVisualNode[]>();

    const pushToBucket = (
      bucket: Map<THREE.Material, HexVisualNode[]>,
      mat: THREE.Material,
      node: HexVisualNode,
    ): void => {
      let arr = bucket.get(mat);
      if (!arr) {
        arr = [];
        bucket.set(mat, arr);
      }
      arr.push(node);
    };

    const pushHighlight = (
      ringMat: THREE.Material,
      node: HexVisualNode,
      fillMat?: THREE.Material,
      withDarkHalo = true,
    ): void => {
      pushToBucket(ringBuckets, ringMat, node);
      if (fillMat) {
        pushToBucket(fillBuckets, fillMat, node);
      }
      if (withDarkHalo) {
        haloNodes.push(node);
      }
    };

    const selProvinceFaction =
      this.selectedProvinceId !== null
        ? state.provinces[this.selectedProvinceId]?.faction
        : undefined;
    const selUnitFaction = this.selectedUnitKey
      ? state.cells[this.selectedUnitKey]?.faction
      : undefined;

    for (const [key, node] of this.hexNodes.entries()) {
      const cell = state.cells[key];
      if (!cell) continue;

      if (
        !node.isFogged &&
        this.selectedProvinceId !== null &&
        cell.provinceId === this.selectedProvinceId
      ) {
        provinceNodes.push(node);
      }

      if (this.landPickSelectedKeys.has(key)) {
        pushHighlight(
          this.materials.highlightBuild,
          node,
          this.materials.highlightBuildFill,
          true,
        );
      } else if (this.landPickEligibleKeys.has(key)) {
        pushHighlight(
          this.materials.highlightBuyLand,
          node,
          this.materials.highlightBuyLandFill,
          true,
        );
      } else if (key === this.selectedUnitKey) {
        pushHighlight(
          this.materials.highlightSelect,
          node,
          this.materials.highlightMoveFill,
          true,
        );
      } else if (this.catapultTargetKeys.has(key)) {
        pushHighlight(
          this.materials.highlightCatapult,
          node,
          this.materials.highlightCatapultFill,
          true,
        );
      } else if (this.demolishKeys.has(key)) {
        pushHighlight(
          this.materials.highlightDemolish,
          node,
          this.materials.highlightDemolishFill,
          true,
        );
      } else if (this.tradingPostPreviewKeys.has(key)) {
        pushHighlight(
          this.materials.highlightSelect,
          node,
          this.materials.highlightBuildFill,
          true,
        );
      } else if (this.buildableKeys.has(key)) {
        const isHostile =
          selProvinceFaction !== undefined && selProvinceFaction !== cell.faction;
        pushHighlight(
          isHostile ? this.materials.highlightAttack : this.materials.highlightBuild,
          node,
          isHostile
            ? this.materials.highlightAttackFill
            : this.materials.highlightBuildFill,
          true,
        );
      } else if (this.reachableKeys.has(key)) {
        const isHostile =
          selUnitFaction !== undefined && selUnitFaction !== cell.faction;
        pushHighlight(
          isHostile ? this.materials.highlightAttack : this.materials.highlightMove,
          node,
          isHostile
            ? this.materials.highlightAttackFill
            : this.materials.highlightMoveFill,
          true,
        );
      } else if (key === this.hoveredKey) {
        pushHighlight(this.materials.highlightHover, node, undefined, false);
      }
    }

    const dummy = this._dummy;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    if (provinceNodes.length > 0) {
      const provInst = new THREE.InstancedMesh(
        this.provinceRingGeo,
        this.materials.provinceTintRing,
        provinceNodes.length,
      );
      for (let i = 0; i < provinceNodes.length; i++) {
        const n = provinceNodes[i];
        dummy.position.set(n.worldX, n.topY + 0.022, n.worldZ);
        dummy.updateMatrix();
        provInst.setMatrixAt(i, dummy.matrix);
      }
      provInst.instanceMatrix.needsUpdate = true;
      provInst.frustumCulled = false;
      provInst.renderOrder = 2;
      provInst.matrixAutoUpdate = false;
      provInst.updateMatrix();
      this.overlaysGroup.add(provInst);
    }

    // Translucent tinted hex fills underneath rings for immediate readability
    for (const [mat, nodes] of fillBuckets.entries()) {
      const fillInst = new THREE.InstancedMesh(
        this.pulseDiscGeo,
        mat,
        nodes.length,
      );
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        dummy.position.set(n.worldX, n.topY + 0.03, n.worldZ);
        dummy.updateMatrix();
        fillInst.setMatrixAt(i, dummy.matrix);
      }
      fillInst.instanceMatrix.needsUpdate = true;
      fillInst.frustumCulled = false;
      fillInst.renderOrder = 3;
      fillInst.matrixAutoUpdate = false;
      fillInst.updateMatrix();
      this.overlaysGroup.add(fillInst);
    }

    // Dark charcoal outer halo behind all active rings so vivid colors pop on yellow/white tiles
    if (haloNodes.length > 0) {
      const haloInst = new THREE.InstancedMesh(
        this.haloRingGeo,
        this.materials.highlightDarkHalo,
        haloNodes.length,
      );
      for (let i = 0; i < haloNodes.length; i++) {
        const n = haloNodes[i];
        dummy.position.set(n.worldX, n.topY + 0.04, n.worldZ);
        dummy.updateMatrix();
        haloInst.setMatrixAt(i, dummy.matrix);
      }
      haloInst.instanceMatrix.needsUpdate = true;
      haloInst.frustumCulled = false;
      haloInst.renderOrder = 4;
      haloInst.matrixAutoUpdate = false;
      haloInst.updateMatrix();
      this.overlaysGroup.add(haloInst);
    }

    // Vivid colored top rings — strictly above borderBar and dark halo in every browser
    for (const [mat, nodes] of ringBuckets.entries()) {
      const hlInst = new THREE.InstancedMesh(
        this.highlightRingGeo,
        mat,
        nodes.length,
      );
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        dummy.position.set(n.worldX, n.topY + 0.055, n.worldZ);
        dummy.updateMatrix();
        hlInst.setMatrixAt(i, dummy.matrix);
      }
      hlInst.instanceMatrix.needsUpdate = true;
      hlInst.frustumCulled = false;
      hlInst.renderOrder = 5;
      hlInst.matrixAutoUpdate = false;
      hlInst.updateMatrix();
      this.overlaysGroup.add(hlInst);
    }
  }

  private emitFloatingPopup(
    key: HexKey,
    text: string,
    tone: 'positive' | 'negative' | 'neutral',
  ): void {
    const node = this.hexNodes.get(key);
    if (!node) return;
    this._projVec.set(node.worldX, node.topY + 0.9, node.worldZ);
    this._projVec.project(this.cameraRig.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const screenX = ((this._projVec.x + 1) / 2) * rect.width;
    const screenY = ((-this._projVec.y + 1) / 2) * rect.height;
    this.callbacks.onFloatingPopup({
      id: this.popupCounter++,
      text,
      screenX,
      screenY,
      tone,
    });
  }

  public projectHexToScreen(
    key: HexKey,
    yOffset = 1.9,
  ): {x: number; y: number} | null {
    const node = this.hexNodes.get(key);
    if (!node) return null;
    this._projVec.set(node.worldX, node.topY + yOffset, node.worldZ);
    this._projVec.project(this.cameraRig.camera);
    if (this._projVec.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((this._projVec.x + 1) / 2) * rect.width,
      y: ((-this._projVec.y + 1) / 2) * rect.height,
    };
  }

  private clearActivePulse(): void {
    if (this.activePulseCleanup) {
      this.activePulseCleanup();
      this.activePulseCleanup = null;
    }
  }

  private clearActiveBorderPulse(): void {
    if (this.activeBorderPulseCleanup) {
      this.activeBorderPulseCleanup();
      this.activeBorderPulseCleanup = null;
    }
  }

  /**
   * Softly illuminates the outer territory borders of a faction for 1 second
   * using that faction's vibrant palette color (e.g. on turn handoff / hotseat).
   */
  public pulseFactionBorders(state: GameState, factionId: FactionId): void {
    this.clearActiveBorderPulse();
    if (factionId === FactionId.NEUTRAL) return;

    const edgeAngles = [
      Math.PI / 2,
      Math.PI / 6,
      -Math.PI / 6,
      -Math.PI / 2,
      (-5 * Math.PI) / 6,
      (5 * Math.PI) / 6,
    ];
    const apothem = HEX_RADIUS * 0.855;
    const transforms: Array<{x: number; y: number; z: number; rotY: number}> =
      [];

    for (const cell of Object.values(state.cells)) {
      if (cell.faction !== factionId) continue;
      const node = this.hexNodes.get(cell.key);
      if (!node || node.isFogged) continue;

      const neighbors = getNeighborKeys(cell.key);
      for (let dirIdx = 0; dirIdx < neighbors.length; dirIdx++) {
        const neighbor = state.cells[neighbors[dirIdx]];
        if (!neighbor || neighbor.faction !== factionId) {
          const angle = edgeAngles[dirIdx];
          transforms.push({
            x: node.worldX + Math.sin(angle) * apothem,
            y: node.topY + 0.022,
            z: node.worldZ - Math.cos(angle) * apothem,
            rotY: -angle,
          });
        }
      }
    }

    if (transforms.length === 0) return;

    const palette = FACTION_PALETTES[factionId];
    const glowColor = new THREE.Color(palette.bannerHex).lerp(
      new THREE.Color('#ffffff'),
      0.24,
    );
    const mat = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });

    const borderGlowInst = new THREE.InstancedMesh(
      this.borderBarGeo,
      mat,
      transforms.length,
    );
    borderGlowInst.castShadow = false;
    borderGlowInst.receiveShadow = false;
    borderGlowInst.frustumCulled = false;
    borderGlowInst.renderOrder = 9;

    const dummy = this._dummy;
    dummy.scale.set(1.06, 2.2, 2.15);
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, t.rotY, 0);
      dummy.updateMatrix();
      borderGlowInst.setMatrixAt(i, dummy.matrix);
    }
    borderGlowInst.instanceMatrix.needsUpdate = true;
    borderGlowInst.matrixAutoUpdate = false;
    borderGlowInst.updateMatrix();
    this.pulseGroup.add(borderGlowInst);

    let cancelled = false;
    let timerId = 0;
    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      window.clearTimeout(timerId);
      this.pulseGroup.remove(borderGlowInst);
      borderGlowInst.dispose();
      mat.dispose();
    };
    this.activeBorderPulseCleanup = cleanup;

    const driver = {v: 0};
    animate(driver, {
      v: [0, 1, 0.85, 0],
      duration: 2400,
      ease: 'inOutSine',
      onUpdate: () => {
        if (cancelled) return;
        mat.opacity = driver.v * 0.9;
      },
    });

    timerId = window.setTimeout(() => {
      if (this.activeBorderPulseCleanup === cleanup) {
        cleanup();
        this.activeBorderPulseCleanup = null;
      }
    }, 2480);
  }

  /**
   * Displays a high-contrast 2.9-second expanding radial pulse animation over the
   * coverage zone of a defensive structure, catapult, beacon, or illumination flare.
   * Uses deep saturated colors backed by dark charcoal halos so it stands out
   * clearly on light-grey, white, and yellow tiles alike.
   */
  public showAreaPulse(
    centerKey: HexKey,
    radius: number,
    kind: CoverageAreaKind,
  ): void {
    this.clearActivePulse();
    if (!this.hexNodes.has(centerKey)) return;

    const palette =
      kind === 'defense'
        ? {fill: '#1d4ed8', ring: '#38bdf8'}
        : kind === 'catapult'
          ? {fill: '#c2410c', ring: '#ff6b00'}
          : kind === 'beacon'
            ? {fill: '#0369a1', ring: '#22d3ee'}
            : kind === 'regenerator'
              ? {fill: '#15803d', ring: '#4ade80'}
              : kind === 'economy'
                ? {fill: '#b45309', ring: '#fbbf24'}
                : {fill: '#7e22ce', ring: '#c084fc'};

    const centerCoord = parseHexKey(centerKey);
    const ringsByDist = new Map<number, HexVisualNode[]>();

    // For a Trading Post ('economy'), highlight the full 3-hex cluster (ring 0) + its farm synergy ring (ring 1)
    const tpCluster =
      kind === 'economy' && this.lastGameState
        ? getTradingPostClusterAt(this.lastGameState, centerKey)
        : null;

    if (tpCluster) {
      const clusterSet = new Set<HexKey>(tpCluster.hexKeys);
      const ring0: HexVisualNode[] = [];
      const ring1: HexVisualNode[] = [];
      const visitedAdj = new Set<HexKey>();

      for (const hk of tpCluster.hexKeys) {
        const n = this.hexNodes.get(hk);
        if (n) ring0.push(n);
        for (const nk of getNeighborKeys(hk)) {
          if (clusterSet.has(nk) || visitedAdj.has(nk)) continue;
          visitedAdj.add(nk);
          const adjNode = this.hexNodes.get(nk);
          if (adjNode) ring1.push(adjNode);
        }
      }
      if (ring0.length > 0) ringsByDist.set(0, ring0);
      if (ring1.length > 0) ringsByDist.set(1, ring1);
    } else {
      for (const [key, node] of this.hexNodes.entries()) {
        const dist = hexDistance(centerCoord, parseHexKey(key));
        if (dist > radius) continue;
        // Catapult bombardment range starts at 2 (never hits adjacent hexes) and must not overlap movement hexes
        if (kind === 'catapult') {
          if (dist < CATAPULT_MIN_RANGE) continue;
          if (this.selectedUnitKey === centerKey && this.reachableKeys.has(key)) {
            continue;
          }
        }
        let arr = ringsByDist.get(dist);
        if (!arr) {
          arr = [];
          ringsByDist.set(dist, arr);
        }
        arr.push(node);
      }
    }

    if (ringsByDist.size === 0) return;

    const createdMeshes: THREE.InstancedMesh[] = [];
    const createdMats: THREE.MeshBasicMaterial[] = [];
    const dummy = this._dummy;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    let cancelled = false;
    const cleanup = () => {
      if (cancelled) return;
      cancelled = true;
      for (const m of createdMeshes) {
        this.pulseGroup.remove(m);
        m.dispose();
      }
      for (const mat of createdMats) {
        mat.dispose();
      }
    };
    this.activePulseCleanup = cleanup;

    let maxDelay = 0;
    for (const [dist, nodes] of ringsByDist.entries()) {
      const fillMat = new THREE.MeshBasicMaterial({
        color: palette.fill,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const haloMat = new THREE.MeshBasicMaterial({
        color: '#090d16',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        color: palette.ring,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      createdMats.push(fillMat, haloMat, ringMat);

      const fillInst = new THREE.InstancedMesh(
        this.pulseDiscGeo,
        fillMat,
        nodes.length,
      );
      const haloInst = new THREE.InstancedMesh(
        this.haloRingGeo,
        haloMat,
        nodes.length,
      );
      const ringInst = new THREE.InstancedMesh(
        this.highlightRingGeo,
        ringMat,
        nodes.length,
      );

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        dummy.position.set(n.worldX, n.topY + 0.062, n.worldZ);
        dummy.updateMatrix();
        fillInst.setMatrixAt(i, dummy.matrix);
        dummy.position.set(n.worldX, n.topY + 0.072, n.worldZ);
        dummy.updateMatrix();
        haloInst.setMatrixAt(i, dummy.matrix);
        dummy.position.set(n.worldX, n.topY + 0.084, n.worldZ);
        dummy.updateMatrix();
        ringInst.setMatrixAt(i, dummy.matrix);
      }
      fillInst.instanceMatrix.needsUpdate = true;
      haloInst.instanceMatrix.needsUpdate = true;
      ringInst.instanceMatrix.needsUpdate = true;
      fillInst.frustumCulled = false;
      haloInst.frustumCulled = false;
      ringInst.frustumCulled = false;
      fillInst.renderOrder = 6;
      haloInst.renderOrder = 7;
      ringInst.renderOrder = 8;
      fillInst.matrixAutoUpdate = false;
      haloInst.matrixAutoUpdate = false;
      ringInst.matrixAutoUpdate = false;
      fillInst.updateMatrix();
      haloInst.updateMatrix();
      ringInst.updateMatrix();

      this.pulseGroup.add(fillInst);
      this.pulseGroup.add(haloInst);
      this.pulseGroup.add(ringInst);
      createdMeshes.push(fillInst, haloInst, ringInst);

      const delay = dist * 65;
      if (delay > maxDelay) maxDelay = delay;

      const driver = {v: 0};
      animate(driver, {
        v: [0, 1, 0.65, 0.92, 0],
        duration: 2800,
        delay,
        ease: 'inOutSine',
        onUpdate: () => {
          if (cancelled) return;
          fillMat.opacity = driver.v * 0.42;
          haloMat.opacity = driver.v * 0.78;
          ringMat.opacity = driver.v * 0.98;
        },
      });
    }

    const totalTimer = window.setTimeout(() => {
      if (this.activePulseCleanup === cleanup) {
        cleanup();
        this.activePulseCleanup = null;
      }
    }, 2950 + maxDelay);

    const prevCleanup = cleanup;
    this.activePulseCleanup = () => {
      window.clearTimeout(totalTimer);
      prevCleanup();
    };
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraRig.setMode(mode);
  }

  public setMenuShowcaseMode(enabled: boolean): void {
    this.menuShowcaseActive = enabled;
    this.cameraRig.setMenuShowcaseMode(enabled);
  }

  public setCameraZoom(zoom: number): void {
    this.cameraRig.setZoomSmooth(zoom);
  }

  public panCameraByPixels(dxPx: number, dyPx: number): void {
    this.cameraRig.panByScreenDelta(dxPx, dyPx, this.container.clientHeight);
  }

  public orbitCameraByRadians(deltaRadians: number): void {
    this.cameraRig.orbitByDelta(deltaRadians);
  }

  public zoomCameraByFactor(factor: number, immediate = false): void {
    this.cameraRig.zoomByFactor(factor, immediate);
  }

  public resetCameraView(): void {
    this.cameraRig.resetView();
  }

  public focusOnHex(key: HexKey, minZoom?: number): void {
    const node = this.hexNodes.get(key);
    if (!node) return;
    this.cameraRig.focusOnWorldPoint(node.worldX, node.worldZ, minZoom);
  }

  /**
   * Smoothly glides the camera to the faction's primary territory ONLY if none
   * of its owned hexes are currently comfortably inside the camera viewport.
   */
  public focusFactionIfOffscreen(
    state: GameState,
    factionId: FactionId,
  ): boolean {
    if (factionId === FactionId.NEUTRAL) return false;

    const ownedNodes: HexVisualNode[] = [];
    for (const cell of Object.values(state.cells)) {
      if (cell.faction !== factionId) continue;
      const node = this.hexNodes.get(cell.key);
      if (!node || node.isFogged) continue;
      ownedNodes.push(node);
    }

    if (ownedNodes.length === 0) return false;

    const alreadyVisible = ownedNodes.some((node) =>
      this.cameraRig.isWorldPointInView(
        node.worldX,
        node.topY,
        node.worldZ,
        0.78,
        0.72,
      ),
    );
    if (alreadyVisible) return false;

    // Pick anchor: largest province's town, else largest province centroid, else overall centroid
    const factionProvinces = Object.values(state.provinces)
      .filter((p) => p.faction === factionId && p.hexKeys.length > 0)
      .sort((a, b) => b.hexKeys.length - a.hexKeys.length);

    let anchorX = 0;
    let anchorZ = 0;
    let foundAnchor = false;

    if (factionProvinces.length > 0) {
      const mainProv = factionProvinces[0];
      const townNode = mainProv.townKey
        ? this.hexNodes.get(mainProv.townKey)
        : undefined;
      if (townNode) {
        anchorX = townNode.worldX;
        anchorZ = townNode.worldZ;
        foundAnchor = true;
      } else {
        let count = 0;
        for (const k of mainProv.hexKeys) {
          const n = this.hexNodes.get(k);
          if (!n) continue;
          anchorX += n.worldX;
          anchorZ += n.worldZ;
          count++;
        }
        if (count > 0) {
          anchorX /= count;
          anchorZ /= count;
          foundAnchor = true;
        }
      }
    }

    if (!foundAnchor) {
      for (const n of ownedNodes) {
        anchorX += n.worldX;
        anchorZ += n.worldZ;
      }
      anchorX /= ownedNodes.length;
      anchorZ /= ownedNodes.length;
    }

    this.cameraRig.focusOnWorldPoint(anchorX, anchorZ, 1.25, 620);
    return true;
  }

  /**
   * O(1) mathematical hex picking via ray-plane intersection + cube rounding.
   * Zero mesh raycasting overhead regardless of map size!
   */
  private pickHexAtClientPoint(clientX: number, clientY: number): HexKey | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.cameraRig.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointerNdc, this.cameraRig.camera);

    if (!this.raycaster.ray.intersectPlane(this.pickPlane, this._pickHit)) {
      return null;
    }

    const axial = worldToAxial(this._pickHit.x, this._pickHit.z, HEX_RADIUS);
    const exactKey = hexKey(axial.q, axial.r);
    if (this.hexNodes.has(exactKey)) {
      return exactKey;
    }

    // Fallback check on nearest neighbor in case of slight elevation parallax in 3D view
    let bestKey: HexKey | null = null;
    let bestDistSq = HEX_RADIUS * HEX_RADIUS * 1.15;
    for (const nk of getNeighborKeys(exactKey)) {
      const node = this.hexNodes.get(nk);
      if (!node) continue;
      const dx = this._pickHit.x - node.worldX;
      const dz = this._pickHit.z - node.worldZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestKey = nk;
      }
    }
    return bestKey;
  }

  private computePinchMetrics(): {
    dist: number;
    midX: number;
    midY: number;
    angle: number;
  } | null {
    if (this.activePointers.size < 2) return null;
    const pts = [...this.activePointers.values()];
    const a = pts[0];
    const b = pts[1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      dist: Math.hypot(dx, dy),
      midX: (a.x + b.x) * 0.5,
      midY: (a.y + b.y) * 0.5,
      angle: Math.atan2(dy, dx),
    };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.activePointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if (this.activePointers.size >= 2) {
      this.hadPinch = true;
      this.didDrag = true;
      const metrics = this.computePinchMetrics();
      if (metrics) {
        this.lastPinchDist = metrics.dist;
        this.lastPinchMidX = metrics.midX;
        this.lastPinchMidY = metrics.midY;
        this.lastPinchAngle = metrics.angle;
        this.pinchAngleValid = true;
        this.pinchRotateAccum = 0;
        this.pinchRotating = false;
      }
      return;
    }

    this.isPointerDown = true;
    this.isRightDrag = e.button === 2 || e.shiftKey;
    this.didDrag = false;
    this.hadPinch = false;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
    }

    if (this.activePointers.size >= 2) {
      const metrics = this.computePinchMetrics();
      if (metrics) {
        if (this.lastPinchDist > 6 && metrics.dist > 6) {
          const ratio = metrics.dist / this.lastPinchDist;
          this.cameraRig.setZoomSmooth(
            this.cameraRig.getZoom() * ratio,
            true,
          );
        }

        // Two-finger twist rotation (clockwise fingers -> clockwise board)
        if (this.pinchAngleValid && metrics.dist > 14) {
          let deltaAngle = metrics.angle - this.lastPinchAngle;
          if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
          else if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

          if (!this.pinchRotating) {
            this.pinchRotateAccum += deltaAngle;
            if (Math.abs(this.pinchRotateAccum) >= 0.055) {
              this.pinchRotating = true;
              this.cameraRig.orbitByDelta(this.pinchRotateAccum);
            }
          } else if (Math.abs(deltaAngle) > 0.0005) {
            this.cameraRig.orbitByDelta(deltaAngle);
          }
        }

        const panDx = metrics.midX - this.lastPinchMidX;
        const panDy = metrics.midY - this.lastPinchMidY;
        if (Math.abs(panDx) > 0.2 || Math.abs(panDy) > 0.2) {
          this.cameraRig.panByScreenDelta(
            panDx,
            panDy,
            this.container.clientHeight,
          );
        }
        this.lastPinchDist = metrics.dist;
        this.lastPinchMidX = metrics.midX;
        this.lastPinchMidY = metrics.midY;
        this.lastPinchAngle = metrics.angle;
        this.pinchAngleValid = true;
      }
      return;
    }

    if (this.isPointerDown && !this.hadPinch) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      if (
        Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 8
      ) {
        this.didDrag = true;
      }

      if (this.didDrag) {
        if (this.isRightDrag) {
          this.cameraRig.orbitByDelta(-dx * 0.0075);
        } else {
          this.cameraRig.panByScreenDelta(dx, dy, this.container.clientHeight);
        }
        return;
      }
    }

    if (e.pointerType === 'touch') return;

    const now = performance.now();
    if (now - this.lastHoverRaycastTime < 20) return;
    this.lastHoverRaycastTime = now;

    const hitKey = this.pickHexAtClientPoint(e.clientX, e.clientY);
    if (hitKey !== this.hoveredKey) {
      this.hoveredKey = hitKey;
      this.renderer.domElement.style.cursor = hitKey ? 'pointer' : 'grab';
      this.callbacks.onHexHover(hitKey);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const wasTracked = this.activePointers.delete(e.pointerId);
    if (!wasTracked && !this.isPointerDown) return;

    if (this.activePointers.size > 0) {
      const remaining = [...this.activePointers.values()][0];
      this.lastPointerX = remaining.x;
      this.lastPointerY = remaining.y;
      const metrics = this.computePinchMetrics();
      if (metrics) {
        this.lastPinchDist = metrics.dist;
        this.lastPinchMidX = metrics.midX;
        this.lastPinchMidY = metrics.midY;
        this.lastPinchAngle = metrics.angle;
        this.pinchAngleValid = true;
      } else {
        this.lastPinchDist = 0;
        this.pinchAngleValid = false;
        this.pinchRotating = false;
        this.pinchRotateAccum = 0;
      }
      return;
    }

    const wasClick =
      e.type !== 'pointercancel' &&
      !this.didDrag &&
      !this.hadPinch &&
      (e.button === 0 || e.pointerType === 'touch');

    this.isPointerDown = false;
    this.isRightDrag = false;
    this.hadPinch = false;
    this.lastPinchDist = 0;
    this.pinchAngleValid = false;
    this.pinchRotating = false;
    this.pinchRotateAccum = 0;

    if (wasClick) {
      const hitKey = this.pickHexAtClientPoint(e.clientX, e.clientY);
      if (hitKey) {
        this.callbacks.onHexClick(hitKey);
      } else {
        this.callbacks.onBackgroundClick?.();
      }
    }
  };

  private readonly onTouchPinchGuard = (e: TouchEvent): void => {
    if (e.touches.length >= 2) {
      e.preventDefault();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.88 : 1.14;
    this.cameraRig.setZoomSmooth(this.cameraRig.getZoom() * factor);
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly onResize = (): void => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const pixelRatio = this.computeOptimalPixelRatio(w, h);
    this.cameraRig.resize(w, h);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h);
  };

  private readonly onWebglContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onContextLost();
  };

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('touchstart', this.onTouchPinchGuard, {
      passive: false,
    });
    dom.addEventListener('touchmove', this.onTouchPinchGuard, {passive: false});
    dom.addEventListener('wheel', this.onWheel, {passive: false});
    dom.addEventListener('contextmenu', this.onContextMenu);
    dom.addEventListener('webglcontextlost', this.onWebglContextLost);
    window.addEventListener('resize', this.onResize);
  }

  private afterSoftwareDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const status = sync
        ? gl.getSyncParameter(sync, gl.SYNC_STATUS)
        : gl.SIGNALED;
      if (status === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      if (document.hidden) {
        this.frameId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(0.1, this.clock.getDelta());
      const elapsed = this.clock.elapsedTime;

      if (this.menuShowcaseActive) {
        this.cameraRig.advanceShowcaseOrbit(dt * 0.08);
      }

      const animList = this.animatedNodes;
      for (let i = 0; i < animList.length; i++) {
        const node = animList[i];
        const fig = node.figurine!;
        if (fig.windmillRotor) {
          fig.windmillRotor.rotation.z -= dt * 1.35;
        }
        if (fig.bannerFlag) {
          fig.bannerFlag.rotation.y =
            Math.sin(elapsed * 3.1 + node.worldX) * 0.24;
        }
        if (fig.lanternCore) {
          fig.lanternCore.rotation.y += dt * 1.2;
        }
        if (!node.isAnimatingMove) {
          if (isUnit(node.entity) && !node.unitMoved) {
            const phase = elapsed * 4.2 + node.worldX * 0.7;
            const hop = Math.max(0, Math.sin(phase)) * 0.11;
            fig.group.position.y = fig.baseY + hop;
          } else if (isUnit(node.entity) && node.unitMoved) {
            fig.group.position.y = fig.baseY;
          }
        }
      }

      // Spin vivid flare & regenerator orbs cleanly above their light cones
      for (const {orb, ring, phase} of this.flareOrbs.values()) {
        const y = 1.56 + Math.sin(elapsed * 2.5 + phase) * 0.07;
        orb.rotation.y = elapsed * 1.6 + phase;
        orb.position.y = y;
        ring.rotation.z = -elapsed * 1.1 + phase;
        ring.position.y = y;
      }

      // Throttled shadow update ONLY during active combat/move FX (~22 Hz)
      if (!this.isSoftwareGl && this.activeFxCount > 0) {
        const now = performance.now();
        if (now - this.lastShadowAnimUpdateMs > SHADOW_ANIM_INTERVAL_MS) {
          this.lastShadowAnimUpdateMs = now;
          this.renderer.shadowMap.needsUpdate = true;
        }
      }

      this.renderer.render(this.scene, this.cameraRig.camera);

      if (this.isSoftwareGl) {
        this.afterSoftwareDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    dom.removeEventListener('touchstart', this.onTouchPinchGuard);
    dom.removeEventListener('touchmove', this.onTouchPinchGuard);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    dom.removeEventListener('webglcontextlost', this.onWebglContextLost);
    window.removeEventListener('resize', this.onResize);

    this.cameraRig.dispose();
    this.clearBoard();
    this.tileGeometry.dispose();
    this.waterTileGeometry.dispose();
    this.highlightRingGeo.dispose();
    this.haloRingGeo.dispose();
    this.provinceRingGeo.dispose();
    this.pulseDiscGeo.dispose();
    this.borderBarGeo.dispose();
    this.boulderGeo.dispose();
    this.flareBeamGeo.dispose();
    this.flareOrbGeo.dispose();
    this.flareRingGeo.dispose();
    this.borderMaterial.dispose();
    this.figurineFactory.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
