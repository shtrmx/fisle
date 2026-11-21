import * as THREE from 'three';
import {animate, type JSAnimation} from 'animejs';
import {CameraMode} from '@/domain/game/types';

export interface CameraTelemetryCallback {
  (zoom: number, tiltFactor: number): void;
}

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 4.6;
const AUTO_TILT_START_ZOOM = 1.05;
const AUTO_TILT_END_ZOOM = 2.4;
const MIN_POLAR_2D = 0.015; // Virtually flat 2D top-down view
const MAX_POLAR_3D = 0.95; // ~54° tactile orthographic diorama tilt
const CAMERA_RADIUS = 96;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Orthographic 2D-to-3D zoom-coupled camera rig powered by anime.js transitions.
 * - Far zoom: looks straight down (crisp classic 2D Antiyoy view).
 * - Close zoom: smoothly tilts into orthographic 3D diorama projection.
 */
export class OrthographicCameraRig {
  public readonly camera: THREE.OrthographicCamera;
  public readonly target = new THREE.Vector3(0, 0, 0);

  private frustumSize = 24;
  private aspect = 16 / 9;

  private zoomState = {value: 0.82};
  private polarState = {value: MIN_POLAR_2D};
  private azimuthState = {value: 0};
  private panState = {x: 0, z: 0};

  private mode: CameraMode = CameraMode.AUTO;
  private activeTween: JSAnimation | null = null;
  private onTelemetry?: CameraTelemetryCallback;
  private onDirty?: () => void;

  private readonly _offset = new THREE.Vector3();
  private readonly _projCheck = new THREE.Vector3();

  constructor(
    width: number,
    height: number,
    onTelemetry?: CameraTelemetryCallback,
    onDirty?: () => void,
  ) {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this.onTelemetry = onTelemetry;
    this.onDirty = onDirty;

    this.camera = new THREE.OrthographicCamera(
      (-this.frustumSize * this.aspect) / 2,
      (this.frustumSize * this.aspect) / 2,
      this.frustumSize / 2,
      -this.frustumSize / 2,
      0.5,
      420,
    );

    this.applyCameraTransform();
  }

  public getZoom(): number {
    return this.zoomState.value;
  }

  public getTiltFactor(): number {
    return Math.max(
      0,
      Math.min(
        1,
        (this.polarState.value - MIN_POLAR_2D) /
          (MAX_POLAR_3D - MIN_POLAR_2D),
      ),
    );
  }

  public resize(width: number, height: number): void {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.left = (-this.frustumSize * this.aspect) / 2;
    this.camera.right = (this.frustumSize * this.aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.camera.updateProjectionMatrix();
    this.onDirty?.();
  }

  public fitToBoardBounds(maxExtent: number): void {
    this.frustumSize = Math.max(20, maxExtent * 2.05);
    this.camera.left = (-this.frustumSize * this.aspect) / 2;
    this.camera.right = (this.frustumSize * this.aspect) / 2;
    this.camera.top = this.frustumSize / 2;
    this.camera.bottom = -this.frustumSize / 2;
    this.panState.x = 0;
    this.panState.z = 0;
    this.zoomState.value = 0.92;
    this.azimuthState.value = 0;
    this.polarState.value = this.computeTargetPolarForZoom(this.zoomState.value);
    this.applyCameraTransform();
  }

  private computeTargetPolarForZoom(zoom: number): number {
    if (this.mode === CameraMode.TOP_2D) {
      return MIN_POLAR_2D;
    }
    if (this.mode === CameraMode.ORTHO_3D) {
      return MAX_POLAR_3D;
    }
    const factor = smoothstep(AUTO_TILT_START_ZOOM, AUTO_TILT_END_ZOOM, zoom);
    return MIN_POLAR_2D + factor * (MAX_POLAR_3D - MIN_POLAR_2D);
  }

  public cancelTransitions(): void {
    if (this.activeTween) {
      this.activeTween.pause();
      this.activeTween = null;
    }
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.cancelTransitions();

    let nextZoom = this.zoomState.value;
    if (mode === CameraMode.TOP_2D && nextZoom > 1.15) {
      nextZoom = 0.88;
    } else if (mode === CameraMode.ORTHO_3D && nextZoom < 1.5) {
      nextZoom = 1.75;
    }
    const nextPolar = this.computeTargetPolarForZoom(nextZoom);
    const nextAzimuth =
      mode === CameraMode.TOP_2D
        ? 0
        : mode === CameraMode.ORTHO_3D && Math.abs(this.azimuthState.value) < 0.05
          ? 0.42
          : this.azimuthState.value;

    const animProxy = {
      zoom: this.zoomState.value,
      polar: this.polarState.value,
      azimuth: this.azimuthState.value,
    };

    this.activeTween = animate(animProxy, {
      zoom: nextZoom,
      polar: nextPolar,
      azimuth: nextAzimuth,
      duration: 560,
      ease: 'outQuart',
      onUpdate: () => {
        this.zoomState.value = animProxy.zoom;
        this.polarState.value = animProxy.polar;
        this.azimuthState.value = animProxy.azimuth;
        this.applyCameraTransform();
      },
      onComplete: () => {
        this.activeTween = null;
      },
    });
  }

  public setZoomSmooth(targetZoom: number, immediate = false): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
    const targetPolar = this.computeTargetPolarForZoom(clamped);
    // Gently introduce a slight isometric azimuth when zooming into 3D automatically
    const targetAzimuth =
      this.mode === CameraMode.AUTO && clamped < AUTO_TILT_START_ZOOM
        ? this.azimuthState.value * 0.2
        : this.azimuthState.value;

    if (immediate) {
      this.cancelTransitions();
      this.zoomState.value = clamped;
      this.polarState.value = targetPolar;
      this.applyCameraTransform();
      return;
    }

    this.cancelTransitions();
    const proxy = {
      zoom: this.zoomState.value,
      polar: this.polarState.value,
      azimuth: this.azimuthState.value,
    };
    this.activeTween = animate(proxy, {
      zoom: clamped,
      polar: targetPolar,
      azimuth: targetAzimuth,
      duration: 280,
      ease: 'outCubic',
      onUpdate: () => {
        this.zoomState.value = proxy.zoom;
        this.polarState.value = proxy.polar;
        this.azimuthState.value = proxy.azimuth;
        this.applyCameraTransform();
      },
      onComplete: () => {
        this.activeTween = null;
      },
    });
  }

  public isWorldPointInView(
    x: number,
    y: number,
    z: number,
    ndcLimitX = 0.78,
    ndcLimitY = 0.72,
  ): boolean {
    this.camera.updateMatrixWorld();
    this._projCheck.set(x, y, z).project(this.camera);
    return (
      this._projCheck.z >= -1 &&
      this._projCheck.z <= 1 &&
      Math.abs(this._projCheck.x) <= ndcLimitX &&
      Math.abs(this._projCheck.y) <= ndcLimitY
    );
  }

  public focusOnWorldPoint(
    x: number,
    z: number,
    minZoom?: number,
    duration = 480,
  ): void {
    this.cancelTransitions();
    const nextZoom =
      minZoom !== undefined
        ? Math.max(this.zoomState.value, Math.min(MAX_ZOOM, minZoom))
        : this.zoomState.value;
    const nextPolar = this.computeTargetPolarForZoom(nextZoom);

    const proxy = {
      x: this.panState.x,
      z: this.panState.z,
      zoom: this.zoomState.value,
      polar: this.polarState.value,
    };

    this.activeTween = animate(proxy, {
      x,
      z,
      zoom: nextZoom,
      polar: nextPolar,
      duration,
      ease: 'outQuart',
      onUpdate: () => {
        this.panState.x = proxy.x;
        this.panState.z = proxy.z;
        this.zoomState.value = proxy.zoom;
        this.polarState.value = proxy.polar;
        this.applyCameraTransform();
      },
      onComplete: () => {
        this.activeTween = null;
      },
    });
  }

  public panByScreenDelta(dxPx: number, dyPx: number, viewportHeight: number): void {
    this.cancelTransitions();
    const worldUnitsPerPixel =
      this.frustumSize / (Math.max(1, viewportHeight) * this.zoomState.value);

    // Move along camera's projected horizontal plane vectors
    const sinA = Math.sin(this.azimuthState.value);
    const cosA = Math.cos(this.azimuthState.value);

    const moveRight = -dxPx * worldUnitsPerPixel;
    const moveForward = -dyPx * worldUnitsPerPixel / Math.max(0.35, Math.cos(this.polarState.value));

    this.panState.x += moveRight * cosA + moveForward * sinA;
    this.panState.z += -moveRight * sinA + moveForward * cosA;

    const clampLimit = this.frustumSize * 0.72;
    this.panState.x = Math.max(-clampLimit, Math.min(clampLimit, this.panState.x));
    this.panState.z = Math.max(-clampLimit, Math.min(clampLimit, this.panState.z));
    this.applyCameraTransform();
  }

  public orbitByDelta(deltaRadians: number): void {
    this.cancelTransitions();
    this.azimuthState.value += deltaRadians;
    this.applyCameraTransform();
  }

  public zoomByFactor(factor: number, immediate = false): void {
    this.setZoomSmooth(this.zoomState.value * factor, immediate);
  }

  public resetView(): void {
    this.cancelTransitions();
    const targetZoom = 0.92;
    const targetPolar = this.computeTargetPolarForZoom(targetZoom);
    const proxy = {
      x: this.panState.x,
      z: this.panState.z,
      zoom: this.zoomState.value,
      polar: this.polarState.value,
      azimuth: this.azimuthState.value,
    };
    this.activeTween = animate(proxy, {
      x: 0,
      z: 0,
      zoom: targetZoom,
      polar: targetPolar,
      azimuth: 0,
      duration: 460,
      ease: 'outQuart',
      onUpdate: () => {
        this.panState.x = proxy.x;
        this.panState.z = proxy.z;
        this.zoomState.value = proxy.zoom;
        this.polarState.value = proxy.polar;
        this.azimuthState.value = proxy.azimuth;
        this.applyCameraTransform();
      },
      onComplete: () => {
        this.activeTween = null;
      },
    });
  }

  public applyCameraTransform(): void {
    this.target.set(this.panState.x, 0, this.panState.z);
    const polar = this.polarState.value;
    const azimuth = this.azimuthState.value;

    const horizDist = CAMERA_RADIUS * Math.sin(polar);
    const height = CAMERA_RADIUS * Math.cos(polar);

    this._offset.set(
      horizDist * Math.sin(azimuth),
      height,
      horizDist * Math.cos(azimuth),
    );

    this.camera.position.copy(this.target).add(this._offset);
    this.camera.lookAt(this.target);
    this.camera.zoom = this.zoomState.value;
    this.camera.updateProjectionMatrix();

    this.onTelemetry?.(this.zoomState.value, this.getTiltFactor());
    this.onDirty?.();
  }

  public dispose(): void {
    this.cancelTransitions();
  }
}
