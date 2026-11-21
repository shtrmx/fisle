import * as THREE from 'three';
import {FACTION_PALETTES} from '@/domain/game/rules';
import {FactionId} from '@/domain/game/types';

export interface TabletopMaterialLibrary {
  tileTopByFaction: Record<FactionId, THREE.MeshStandardMaterial>;
  tileSideByFaction: Record<FactionId, THREE.MeshStandardMaterial>;
  fogTileTop: THREE.MeshStandardMaterial;
  fogTileSide: THREE.MeshStandardMaterial;
  bannerByFaction: Record<FactionId, THREE.MeshStandardMaterial>;
  accentByFaction: Record<FactionId, THREE.MeshStandardMaterial>;
  stoneLight: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  woodWarm: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  roofTerracotta: THREE.MeshStandardMaterial;
  hayGold: THREE.MeshStandardMaterial;
  steelPolished: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  steelBright: THREE.MeshStandardMaterial;
  brassBurnished: THREE.MeshStandardMaterial;
  ivoryPawn: THREE.MeshStandardMaterial;
  skinWarm: THREE.MeshStandardMaterial;
  horseCoat: THREE.MeshStandardMaterial;
  pineFoliageDark: THREE.MeshStandardMaterial;
  pineFoliageMid: THREE.MeshStandardMaterial;
  palmFoliage: THREE.MeshStandardMaterial;
  palmFoliageDark: THREE.MeshStandardMaterial;
  palmTrunk: THREE.MeshStandardMaterial;
  soilDark: THREE.MeshStandardMaterial;
  lanternGlow: THREE.MeshStandardMaterial;
  flareOrbMat: THREE.MeshStandardMaterial;
  flareRingMat: THREE.MeshStandardMaterial;
  flareBeam: THREE.MeshBasicMaterial;
  regeneratorOrbMat: THREE.MeshStandardMaterial;
  regeneratorRingMat: THREE.MeshStandardMaterial;
  regeneratorBeam: THREE.MeshBasicMaterial;
  highlightMove: THREE.MeshBasicMaterial;
  highlightMoveFill: THREE.MeshBasicMaterial;
  highlightAttack: THREE.MeshBasicMaterial;
  highlightAttackFill: THREE.MeshBasicMaterial;
  highlightCatapult: THREE.MeshBasicMaterial;
  highlightCatapultFill: THREE.MeshBasicMaterial;
  highlightBuild: THREE.MeshBasicMaterial;
  highlightBuildFill: THREE.MeshBasicMaterial;
  highlightDemolish: THREE.MeshBasicMaterial;
  highlightDemolishFill: THREE.MeshBasicMaterial;
  highlightBuyLand: THREE.MeshBasicMaterial;
  highlightBuyLandFill: THREE.MeshBasicMaterial;
  highlightSelect: THREE.MeshBasicMaterial;
  highlightHover: THREE.MeshBasicMaterial;
  highlightDarkHalo: THREE.MeshBasicMaterial;
  provinceTintRing: THREE.MeshBasicMaterial;
  waterSurface: THREE.MeshStandardMaterial;
  waterHexShallowTop: THREE.MeshStandardMaterial;
  waterHexShallowSide: THREE.MeshStandardMaterial;
  waterHexDeepTop: THREE.MeshStandardMaterial;
  waterHexDeepSide: THREE.MeshStandardMaterial;
  shoreFoam: THREE.MeshBasicMaterial;
  textures: THREE.Texture[];
  dispose: () => void;
}

function createTileGrainTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f2f0eb';
  ctx.fillRect(0, 0, size, size);

  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const alpha = 0.025 + rand() * 0.04;
    ctx.fillStyle =
      rand() > 0.5
        ? `rgba(255, 255, 255, ${alpha})`
        : `rgba(40, 44, 52, ${alpha})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createMaterialLibrary(
  maxAnisotropy: number,
): TabletopMaterialLibrary {
  const tileGrain = createTileGrainTexture(maxAnisotropy);
  const textures: THREE.Texture[] = [tileGrain];
  const allMaterials: THREE.Material[] = [];

  const register = <T extends THREE.Material>(mat: T): T => {
    allMaterials.push(mat);
    return mat;
  };

  const tileTopByFaction = {} as Record<FactionId, THREE.MeshStandardMaterial>;
  const tileSideByFaction = {} as Record<FactionId, THREE.MeshStandardMaterial>;
  const bannerByFaction = {} as Record<FactionId, THREE.MeshStandardMaterial>;
  const accentByFaction = {} as Record<FactionId, THREE.MeshStandardMaterial>;

  for (const rawId of Object.keys(FACTION_PALETTES)) {
    const fId = Number(rawId) as FactionId;
    const p = FACTION_PALETTES[fId];
    tileTopByFaction[fId] = register(
      new THREE.MeshStandardMaterial({
        color: p.tileHex,
        map: tileGrain,
        roughness: 0.82,
        metalness: 0.04,
      }),
    );
    tileSideByFaction[fId] = register(
      new THREE.MeshStandardMaterial({
        color: p.tileSideHex,
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    bannerByFaction[fId] = register(
      new THREE.MeshStandardMaterial({
        color: p.bannerHex,
        roughness: 0.52,
        metalness: 0.08,
      }),
    );
    accentByFaction[fId] = register(
      new THREE.MeshStandardMaterial({
        color: p.accentHex,
        roughness: 0.48,
        metalness: 0.14,
      }),
    );
  }

  // Unexplored Fog of War: dark matte charcoal, visibly lighter than water
  const fogTileTop = register(
    new THREE.MeshStandardMaterial({
      color: '#2c313b',
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.14,
    }),
  );
  const fogTileSide = register(
    new THREE.MeshStandardMaterial({
      color: '#20252e',
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.1,
    }),
  );

  const stoneLight = register(
    new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.84,
      metalness: 0.04,
    }),
  );
  const stoneDark = register(
    new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.88,
      metalness: 0.08,
    }),
  );
  const woodWarm = register(
    new THREE.MeshStandardMaterial({
      color: '#b45309',
      roughness: 0.66,
      metalness: 0.04,
    }),
  );
  const woodDark = register(
    new THREE.MeshStandardMaterial({
      color: '#3b2314',
      roughness: 0.78,
      metalness: 0.05,
    }),
  );
  const roofTerracotta = register(
    new THREE.MeshStandardMaterial({
      color: '#c2410c',
      roughness: 0.65,
      metalness: 0.05,
    }),
  );
  const hayGold = register(
    new THREE.MeshStandardMaterial({
      color: '#eab308',
      roughness: 0.78,
      metalness: 0.02,
    }),
  );
  const steelPolished = register(
    new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.34,
      metalness: 0.52,
    }),
  );
  const steelDark = register(
    new THREE.MeshStandardMaterial({
      color: '#293548',
      roughness: 0.4,
      metalness: 0.56,
    }),
  );
  const steelBright = register(
    new THREE.MeshStandardMaterial({
      color: '#f1f5f9',
      roughness: 0.24,
      metalness: 0.62,
    }),
  );
  const brassBurnished = register(
    new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      roughness: 0.3,
      metalness: 0.58,
    }),
  );
  const ivoryPawn = register(
    new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.48,
      metalness: 0.04,
    }),
  );
  const skinWarm = register(
    new THREE.MeshStandardMaterial({
      color: '#f0b98a',
      roughness: 0.62,
      metalness: 0.02,
    }),
  );
  const horseCoat = register(
    new THREE.MeshStandardMaterial({
      color: '#4a2511',
      roughness: 0.66,
      metalness: 0.05,
    }),
  );
  const pineFoliageDark = register(
    new THREE.MeshStandardMaterial({
      color: '#14532d',
      roughness: 0.84,
      metalness: 0.02,
    }),
  );
  const pineFoliageMid = register(
    new THREE.MeshStandardMaterial({
      color: '#16a34a',
      roughness: 0.78,
      metalness: 0.02,
    }),
  );
  const palmFoliage = register(
    new THREE.MeshStandardMaterial({
      color: '#156534',
      roughness: 0.86,
      metalness: 0.02,
    }),
  );
  const palmFoliageDark = register(
    new THREE.MeshStandardMaterial({
      color: '#0b3d20',
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  const palmTrunk = register(
    new THREE.MeshStandardMaterial({
      color: '#6b3a1a',
      roughness: 0.84,
      metalness: 0.04,
    }),
  );
  const soilDark = register(
    new THREE.MeshStandardMaterial({
      color: '#3f2e1e',
      roughness: 0.94,
      metalness: 0.02,
    }),
  );
  // Crisp ice-cyan crystal core for Beacon & Flare figurines (distinct from gold/stone)
  const lanternGlow = register(
    new THREE.MeshStandardMaterial({
      color: '#e0f2fe',
      emissive: '#38bdf8',
      emissiveIntensity: 0.95,
      roughness: 0.25,
      metalness: 0.1,
    }),
  );
  // Vivid royal violet flare orb + deep indigo ring so spinning flares stand out on light tiles & fog
  const flareOrbMat = register(
    new THREE.MeshStandardMaterial({
      color: '#a855f7',
      emissive: '#7e22ce',
      emissiveIntensity: 1.15,
      roughness: 0.22,
      metalness: 0.2,
    }),
  );
  const flareRingMat = register(
    new THREE.MeshStandardMaterial({
      color: '#1e1b4b',
      roughness: 0.42,
      metalness: 0.48,
    }),
  );
  const flareBeam = register(
    new THREE.MeshBasicMaterial({
      color: '#a855f7',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  // Vivid emerald green Regenerator orb + deep forest ring + radiant green beam
  const regeneratorOrbMat = register(
    new THREE.MeshStandardMaterial({
      color: '#22c55e',
      emissive: '#16a34a',
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.18,
    }),
  );
  const regeneratorRingMat = register(
    new THREE.MeshStandardMaterial({
      color: '#064e3b',
      roughness: 0.4,
      metalness: 0.48,
    }),
  );
  const regeneratorBeam = register(
    new THREE.MeshBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  // High-contrast highlight rings + translucent fills (paired with dark halo so readable on white, grey, and yellow!)
  // Explicit renderOrder + Y separation in antiyoyScene.ts guarantees rings always draw strictly above halos/borders across all GPUs/browsers.
  const highlightDarkHalo = register(
    new THREE.MeshBasicMaterial({
      color: '#090d16',
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightMove = register(
    new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightMoveFill = register(
    new THREE.MeshBasicMaterial({
      color: '#0284c7',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightAttack = register(
    new THREE.MeshBasicMaterial({
      color: '#ff2e55',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightAttackFill = register(
    new THREE.MeshBasicMaterial({
      color: '#be123c',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightCatapult = register(
    new THREE.MeshBasicMaterial({
      color: '#ff6b00',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightCatapultFill = register(
    new THREE.MeshBasicMaterial({
      color: '#c2410c',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightBuild = register(
    new THREE.MeshBasicMaterial({
      color: '#00e676',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightBuildFill = register(
    new THREE.MeshBasicMaterial({
      color: '#047857',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightDemolish = register(
    new THREE.MeshBasicMaterial({
      color: '#f43f5e',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightDemolishFill = register(
    new THREE.MeshBasicMaterial({
      color: '#9f1239',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightBuyLand = register(
    new THREE.MeshBasicMaterial({
      color: '#a855f7',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightBuyLandFill = register(
    new THREE.MeshBasicMaterial({
      color: '#7e22ce',
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightSelect = register(
    new THREE.MeshBasicMaterial({
      color: '#06b6d4',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const highlightHover = register(
    new THREE.MeshBasicMaterial({
      color: '#0f172a',
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const provinceTintRing = register(
    new THREE.MeshBasicMaterial({
      color: '#0f172a',
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  const waterSurface = register(
    new THREE.MeshStandardMaterial({
      color: '#090b0f',
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.04,
    }),
  );

  // Plain matte dark grey water — consistently darker than Fog of War (#2c313b)
  const waterHexShallowTop = register(
    new THREE.MeshStandardMaterial({
      color: '#14171d',
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.08,
    }),
  );

  const waterHexShallowSide = register(
    new THREE.MeshStandardMaterial({
      color: '#0d1015',
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.06,
    }),
  );

  const waterHexDeepTop = register(
    new THREE.MeshStandardMaterial({
      color: '#14171d',
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.08,
    }),
  );

  const waterHexDeepSide = register(
    new THREE.MeshStandardMaterial({
      color: '#0d1015',
      roughness: 0.96,
      metalness: 0.0,
      envMapIntensity: 0.06,
    }),
  );

  const shoreFoam = register(
    new THREE.MeshBasicMaterial({
      color: '#64748b',
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    }),
  );

  return {
    tileTopByFaction,
    tileSideByFaction,
    fogTileTop,
    fogTileSide,
    bannerByFaction,
    accentByFaction,
    stoneLight,
    stoneDark,
    woodWarm,
    woodDark,
    roofTerracotta,
    hayGold,
    steelPolished,
    steelDark,
    steelBright,
    brassBurnished,
    ivoryPawn,
    skinWarm,
    horseCoat,
    pineFoliageDark,
    pineFoliageMid,
    palmFoliage,
    palmFoliageDark,
    palmTrunk,
    soilDark,
    lanternGlow,
    flareOrbMat,
    flareRingMat,
    flareBeam,
    regeneratorOrbMat,
    regeneratorRingMat,
    regeneratorBeam,
    highlightMove,
    highlightMoveFill,
    highlightAttack,
    highlightAttackFill,
    highlightCatapult,
    highlightCatapultFill,
    highlightBuild,
    highlightBuildFill,
    highlightDemolish,
    highlightDemolishFill,
    highlightBuyLand,
    highlightBuyLandFill,
    highlightSelect,
    highlightHover,
    highlightDarkHalo,
    provinceTintRing,
    waterSurface,
    waterHexShallowTop,
    waterHexShallowSide,
    waterHexDeepTop,
    waterHexDeepSide,
    shoreFoam,
    textures,
    dispose: () => {
      allMaterials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
