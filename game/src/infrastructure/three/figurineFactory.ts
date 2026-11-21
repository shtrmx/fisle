import * as THREE from 'three';
import {EntityType, FactionId} from '@/domain/game/types';
import type {TabletopMaterialLibrary} from '@/infrastructure/three/materials';

export interface FigurineHandle {
  group: THREE.Group;
  windmillRotor?: THREE.Object3D;
  bannerFlag?: THREE.Object3D;
  lanternCore?: THREE.Object3D;
  baseY: number;
}

export class FigurineFactory {
  private readonly geos: THREE.BufferGeometry[] = [];

  private readonly unitPlinthGeo: THREE.CylinderGeometry;
  private readonly unitRimGeo: THREE.TorusGeometry;
  private readonly towerBaseGeo: THREE.CylinderGeometry;
  private readonly towerShaftGeo: THREE.CylinderGeometry;
  private readonly crenelGeo: THREE.BoxGeometry;
  private readonly pineTier1Geo: THREE.ConeGeometry;
  private readonly pineTier2Geo: THREE.ConeGeometry;
  private readonly pineTier3Geo: THREE.ConeGeometry;
  private readonly trunkGeo: THREE.CylinderGeometry;
  private readonly palmBaseGeo: THREE.CylinderGeometry;
  private readonly palmSegGeo: THREE.CylinderGeometry;
  private readonly palmFrondInnerGeo: THREE.BoxGeometry;
  private readonly palmFrondTipGeo: THREE.BoxGeometry;
  private readonly palmCocoGeo: THREE.SphereGeometry;

  constructor(private readonly mats: TabletopMaterialLibrary) {
    this.unitPlinthGeo = this.track(new THREE.CylinderGeometry(0.32, 0.36, 0.08, 20));
    this.unitRimGeo = this.track(new THREE.TorusGeometry(0.33, 0.025, 8, 24));
    this.towerBaseGeo = this.track(new THREE.CylinderGeometry(0.42, 0.48, 0.14, 8));
    this.towerShaftGeo = this.track(new THREE.CylinderGeometry(0.28, 0.34, 0.72, 10));
    this.crenelGeo = this.track(new THREE.BoxGeometry(0.11, 0.12, 0.11));
    this.pineTier1Geo = this.track(new THREE.ConeGeometry(0.38, 0.46, 7));
    this.pineTier2Geo = this.track(new THREE.ConeGeometry(0.3, 0.42, 7));
    this.pineTier3Geo = this.track(new THREE.ConeGeometry(0.2, 0.36, 7));
    this.trunkGeo = this.track(new THREE.CylinderGeometry(0.06, 0.09, 0.24, 7));
    this.palmBaseGeo = this.track(new THREE.CylinderGeometry(0.13, 0.17, 0.05, 8));
    this.palmSegGeo = this.track(new THREE.CylinderGeometry(0.058, 0.082, 0.28, 7));
    this.palmFrondInnerGeo = this.track(new THREE.BoxGeometry(0.15, 0.032, 0.27));
    this.palmFrondTipGeo = this.track(new THREE.BoxGeometry(0.11, 0.026, 0.23));
    this.palmCocoGeo = this.track(new THREE.SphereGeometry(0.048, 8, 8));
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private makeMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    return mesh;
  }

  public createFigurine(
    entity: EntityType,
    faction: FactionId,
    variationSeed = 0,
  ): FigurineHandle | null {
    switch (entity) {
      case EntityType.TOWN:
        return this.createTownHall(faction);
      case EntityType.FARM:
        return this.createFarm(faction);
      case EntityType.TRADING_POST:
        return this.createTradingPostPreview(faction);
      case EntityType.TOWER:
        return this.createTower(faction);
      case EntityType.STRONG_TOWER:
        return this.createStrongTower(faction);
      case EntityType.BEACON:
        return this.createBeacon(faction);
      case EntityType.PEASANT:
        return this.createPeasant(faction);
      case EntityType.SPEARMAN:
        return this.createSpearman(faction);
      case EntityType.BARON:
        return this.createBaron(faction);
      case EntityType.KNIGHT:
        return this.createKnight(faction);
      case EntityType.CATAPULT:
        return this.createCatapult(faction);
      case EntityType.PINE:
        return this.createPine(variationSeed);
      case EntityType.PALM:
        return this.createPalm(variationSeed);
      case EntityType.GRAVE:
        return this.createGrave();
      default:
        return null;
    }
  }

  private createTownHall(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const plinth = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.56, 0.62, 0.12, 6)),
      this.mats.stoneDark,
    );
    plinth.position.y = 0.06;
    group.add(plinth);

    const hall = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.56, 0.42, 0.48)),
      this.mats.stoneLight,
    );
    hall.position.set(-0.04, 0.33, 0);
    group.add(hall);

    const roof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.46, 0.36, 4)),
      this.mats.roofTerracotta,
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(-0.04, 0.72, 0);
    group.add(roof);

    const belfry = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.24, 0.64, 0.24)),
      this.mats.stoneLight,
    );
    belfry.position.set(0.24, 0.44, -0.14);
    group.add(belfry);

    const spire = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.19, 0.28, 4)),
      bannerMat,
    );
    spire.rotation.y = Math.PI / 4;
    spire.position.set(0.24, 0.9, -0.14);
    group.add(spire);

    const door = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.16, 0.22, 0.05)),
      this.mats.woodDark,
      false,
    );
    door.position.set(-0.04, 0.23, 0.245);
    group.add(door);

    const pole = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.015, 0.018, 0.42, 6)),
      this.mats.brassBurnished,
    );
    pole.position.set(0.24, 1.18, -0.14);
    group.add(pole);

    const flagPivot = new THREE.Group();
    flagPivot.position.set(0.24, 1.32, -0.14);
    const flag = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.26, 0.13, 0.025)),
      bannerMat,
    );
    flag.position.x = 0.13;
    flagPivot.add(flag);
    group.add(flagPivot);

    return {group, bannerFlag: flagPivot, baseY: 0};
  }

  private createFarm(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const soil = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.55, 0.58, 0.05, 6)),
      this.mats.soilDark,
    );
    soil.position.y = 0.025;
    group.add(soil);

    for (let i = -1; i <= 1; i++) {
      const row = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.56, 0.07, 0.09)),
        this.mats.hayGold,
        false,
      );
      row.position.set(-0.05, 0.08, 0.22 + i * 0.12);
      group.add(row);
    }

    const millBody = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.15, 0.23, 0.56, 8)),
      this.mats.ivoryPawn,
    );
    millBody.position.set(0.14, 0.32, -0.16);
    group.add(millBody);

    const millCap = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.18, 0.2, 8)),
      bannerMat,
    );
    millCap.position.set(0.14, 0.7, -0.16);
    group.add(millCap);

    const rotor = new THREE.Group();
    rotor.position.set(0.14, 0.54, 0.02);
    const hub = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8)),
      this.mats.woodDark,
    );
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);

    const bladeGeo = this.track(new THREE.BoxGeometry(0.11, 0.42, 0.024));
    for (let i = 0; i < 4; i++) {
      const blade = this.makeMesh(bladeGeo, this.mats.woodWarm);
      const angle = (i * Math.PI) / 2;
      blade.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0.024);
      blade.rotation.z = angle - Math.PI / 2;
      rotor.add(blade);
    }
    group.add(rotor);

    const bale = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 10)),
      this.mats.hayGold,
    );
    bale.rotation.z = Math.PI / 2;
    bale.position.set(-0.24, 0.14, -0.14);
    group.add(bale);

    return {group, windmillRotor: rotor, baseY: 0};
  }

  /**
   * Builds one of the 3 specialized hex pieces of a Trading Post cluster:
   * - 'bell': Tall stone & timber Bell Tower (Колокольня) with hanging brass bell
   * - 'tent1': Striped Merchant Pavilion Tents & grain stalls (Шатры)
   * - 'tent2': Grand Market Marquee Tent, awning & cargo crates (Торговый ряд)
   */
  public createTradingPostPart(
    part: 'bell' | 'tent1' | 'tent2',
    faction: FactionId,
  ): FigurineHandle {
    if (part === 'bell') return this.createTradingPostBellTower(faction);
    if (part === 'tent1') return this.createTradingPostTents(faction, 1);
    return this.createTradingPostTents(faction, 2);
  }

  private createTradingPostBellTower(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    // 1. Cobble hexagonal market plinth
    const plinth = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.58, 0.62, 0.08, 6)),
      this.mats.stoneDark,
    );
    plinth.position.y = 0.04;
    group.add(plinth);

    const plazaPad = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.46, 0.48, 0.04, 6)),
      this.mats.stoneLight,
      false,
    );
    plazaPad.position.y = 0.09;
    group.add(plazaPad);

    // 2. Lower stone tower body with timber arch door
    const lowerShaft = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.38, 0.56, 0.38)),
      this.mats.stoneLight,
    );
    lowerShaft.position.set(0, 0.38, -0.06);
    group.add(lowerShaft);

    const trimRing = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.44, 0.06, 0.44)),
      this.mats.stoneDark,
    );
    trimRing.position.set(0, 0.67, -0.06);
    group.add(trimRing);

    const archDoor = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.14, 0.24, 0.04)),
      this.mats.woodDark,
      false,
    );
    archDoor.position.set(0, 0.23, 0.14);
    group.add(archDoor);

    // 3. Open belfry chamber (4 corner pillars + hanging brass bell)
    const pillarGeo = this.track(new THREE.BoxGeometry(0.065, 0.34, 0.065));
    const pillarOffsets = [
      [-0.145, -0.205],
      [0.145, -0.205],
      [-0.145, 0.085],
      [0.145, 0.085],
    ];
    for (const [px, pz] of pillarOffsets) {
      const pillar = this.makeMesh(pillarGeo, this.mats.woodDark);
      pillar.position.set(px, 0.86, pz);
      group.add(pillar);
    }

    const bellCrossbar = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.32, 0.045, 0.06)),
      this.mats.woodWarm,
    );
    bellCrossbar.position.set(0, 0.99, -0.06);
    group.add(bellCrossbar);

    const bellBody = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.11, 0.19, 12)),
      this.mats.brassBurnished,
    );
    bellBody.position.set(0, 0.87, -0.06);
    group.add(bellBody);

    const bellClapper = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.036, 8, 8)),
      this.mats.brassBurnished,
    );
    bellClapper.position.set(0, 0.76, -0.06);
    group.add(bellClapper);

    // 4. Belfry cornice, terracotta spire roof & waving guild flag
    const cornice = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.45, 0.055, 0.45)),
      this.mats.stoneDark,
    );
    cornice.position.set(0, 1.05, -0.06);
    group.add(cornice);

    const spireRoof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.36, 0.44, 4)),
      this.mats.roofTerracotta,
    );
    spireRoof.rotation.y = Math.PI / 4;
    spireRoof.position.set(0, 1.29, -0.06);
    group.add(spireRoof);

    const pole = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.014, 0.018, 0.34, 6)),
      this.mats.brassBurnished,
    );
    pole.position.set(0, 1.62, -0.06);
    group.add(pole);

    const flagPivot = new THREE.Group();
    flagPivot.position.set(0, 1.72, -0.06);
    const flag = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.24, 0.11, 0.024)),
      bannerMat,
    );
    flag.position.x = 0.12;
    flagPivot.add(flag);
    group.add(flagPivot);

    // 5. Small merchant stall crates at the front plaza
    const crate1 = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.13, 0.11, 0.13)),
      this.mats.woodWarm,
    );
    crate1.position.set(-0.24, 0.16, 0.22);
    crate1.rotation.y = 0.25;
    group.add(crate1);

    const sack = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.075, 10, 8)),
      this.mats.hayGold,
    );
    sack.scale.set(1.1, 0.85, 1.0);
    sack.position.set(0.22, 0.16, 0.24);
    group.add(sack);

    return {group, bannerFlag: flagPivot, baseY: 0};
  }

  private createTradingPostTents(
    faction: FactionId,
    variant: 1 | 2,
  ): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    // Cobble market apron
    const apron = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.57, 0.61, 0.06, 6)),
      this.mats.stoneDark,
    );
    apron.position.y = 0.03;
    group.add(apron);

    const cobble = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.49, 0.51, 0.03, 6)),
      this.mats.stoneLight,
      false,
    );
    cobble.position.y = 0.07;
    group.add(cobble);

    if (variant === 1) {
      // Main grand pavilion tent (faction banner + ivory stripes)
      const poleGeo = this.track(new THREE.CylinderGeometry(0.018, 0.02, 0.34, 6));
      const pCoords = [
        [-0.28, -0.22],
        [0.14, -0.22],
        [-0.28, 0.12],
        [0.14, 0.12],
      ];
      for (const [px, pz] of pCoords) {
        const pole = this.makeMesh(poleGeo, this.mats.woodDark);
        pole.position.set(px, 0.24, pz);
        group.add(pole);
      }

      const canopyBase = this.makeMesh(
        this.track(new THREE.ConeGeometry(0.36, 0.28, 4)),
        bannerMat,
      );
      canopyBase.rotation.y = Math.PI / 4;
      canopyBase.scale.set(1.08, 1, 0.92);
      canopyBase.position.set(-0.07, 0.52, -0.05);
      group.add(canopyBase);

      const canopyTrim = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.47, 0.06, 0.39)),
        this.mats.ivoryPawn,
      );
      canopyTrim.position.set(-0.07, 0.38, -0.05);
      group.add(canopyTrim);

      const spire = this.makeMesh(
        this.track(new THREE.SphereGeometry(0.04, 8, 8)),
        this.mats.brassBurnished,
      );
      spire.position.set(-0.07, 0.68, -0.05);
      group.add(spire);

      // Merchant table & grain display beneath pavilion
      const counter = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.32, 0.12, 0.14)),
        this.mats.woodWarm,
      );
      counter.position.set(-0.07, 0.14, -0.02);
      group.add(counter);

      // Secondary ivory market stall angled at the side
      const stallGroup = new THREE.Group();
      stallGroup.position.set(0.24, 0.08, 0.16);
      stallGroup.rotation.y = -0.52;

      const stallRoof = this.makeMesh(
        this.track(new THREE.ConeGeometry(0.22, 0.2, 4)),
        this.mats.ivoryPawn,
      );
      stallRoof.rotation.y = Math.PI / 4;
      stallRoof.position.y = 0.36;
      stallGroup.add(stallRoof);

      const stallCap = this.makeMesh(
        this.track(new THREE.ConeGeometry(0.11, 0.11, 4)),
        this.mats.roofTerracotta,
      );
      stallCap.rotation.y = Math.PI / 4;
      stallCap.position.y = 0.44;
      stallGroup.add(stallCap);

      const stallTable = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.24, 0.14, 0.18)),
        this.mats.woodWarm,
      );
      stallTable.position.y = 0.07;
      stallGroup.add(stallTable);
      group.add(stallGroup);

      // Golden sacks & barrel
      const barrel = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.065, 0.065, 0.14, 10)),
        this.mats.woodDark,
      );
      barrel.position.set(-0.18, 0.15, 0.28);
      group.add(barrel);

      const grainPile = this.makeMesh(
        this.track(new THREE.SphereGeometry(0.08, 10, 8)),
        this.mats.hayGold,
      );
      grainPile.scale.set(1.2, 0.75, 1);
      grainPile.position.set(-0.02, 0.14, 0.3);
      group.add(grainPile);
    } else {
      // Variant 2: Round grand guild marquee tent + side terracotta awning + cargo
      const tentWall = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.26, 0.29, 0.28, 8)),
        this.mats.ivoryPawn,
      );
      tentWall.position.set(0.08, 0.22, -0.08);
      group.add(tentWall);

      const tentRoof = this.makeMesh(
        this.track(new THREE.ConeGeometry(0.35, 0.34, 8)),
        bannerMat,
      );
      tentRoof.position.set(0.08, 0.51, -0.08);
      group.add(tentRoof);

      const tentRim = this.makeMesh(
        this.track(new THREE.TorusGeometry(0.29, 0.028, 8, 16)),
        this.mats.brassBurnished,
      );
      tentRim.rotation.x = Math.PI / 2;
      tentRim.position.set(0.08, 0.36, -0.08);
      group.add(tentRim);

      const tentFinial = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.014, 0.018, 0.2, 6)),
        this.mats.brassBurnished,
      );
      tentFinial.position.set(0.08, 0.74, -0.08);
      group.add(tentFinial);

      // Side merchant canopy tent
      const sideTent = new THREE.Group();
      sideTent.position.set(-0.24, 0.08, 0.18);
      sideTent.rotation.y = 0.45;

      const awning = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.3, 0.045, 0.24)),
        this.mats.roofTerracotta,
      );
      awning.position.set(0, 0.28, 0);
      awning.rotation.x = 0.24;
      sideTent.add(awning);

      const p1 = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.016, 0.018, 0.28, 6)),
        this.mats.woodDark,
      );
      p1.position.set(-0.12, 0.14, -0.08);
      sideTent.add(p1);

      const p2 = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.016, 0.018, 0.28, 6)),
        this.mats.woodDark,
      );
      p2.position.set(0.12, 0.14, -0.08);
      sideTent.add(p2);

      const goods = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.24, 0.11, 0.14)),
        this.mats.hayGold,
      );
      goods.position.set(0, 0.06, 0.02);
      sideTent.add(goods);
      group.add(sideTent);

      // Stacked trade crates & brass urn
      const crate = this.makeMesh(
        this.track(new THREE.BoxGeometry(0.14, 0.12, 0.14)),
        this.mats.woodWarm,
      );
      crate.position.set(0.22, 0.14, 0.26);
      crate.rotation.y = -0.3;
      group.add(crate);

      const urn = this.makeMesh(
        this.track(new THREE.CylinderGeometry(0.045, 0.06, 0.13, 10)),
        this.mats.brassBurnished,
      );
      urn.position.set(0.06, 0.15, 0.31);
      group.add(urn);
    }

    return {group, baseY: 0};
  }

  /**
   * Compact single-hex diorama combining the Bell Tower and two Market Tents
   * for 3D UI dock previews and the Info dialog.
   */
  private createTradingPostPreview(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const plinth = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.58, 0.62, 0.08, 6)),
      this.mats.stoneDark,
    );
    plinth.position.y = 0.04;
    group.add(plinth);

    // Miniature Bell Tower (back-left)
    const shaft = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.28, 0.5, 0.28)),
      this.mats.stoneLight,
    );
    shaft.position.set(-0.14, 0.33, -0.14);
    group.add(shaft);

    const bell = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.085, 0.14, 10)),
      this.mats.brassBurnished,
    );
    bell.position.set(-0.14, 0.68, -0.14);
    group.add(bell);

    const pGeo = this.track(new THREE.BoxGeometry(0.045, 0.24, 0.045));
    for (const [dx, dz] of [
      [-0.1, -0.1],
      [0.1, -0.1],
      [-0.1, 0.1],
      [0.1, 0.1],
    ]) {
      const p = this.makeMesh(pGeo, this.mats.woodDark);
      p.position.set(-0.14 + dx, 0.69, -0.14 + dz);
      group.add(p);
    }

    const roof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.26, 0.32, 4)),
      this.mats.roofTerracotta,
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(-0.14, 0.96, -0.14);
    group.add(roof);

    // Market Tent 1 (front-right, faction banner marquee)
    const t1Wall = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.17, 0.19, 0.19, 8)),
      this.mats.ivoryPawn,
    );
    t1Wall.position.set(0.22, 0.18, 0.08);
    group.add(t1Wall);

    const t1Roof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.24, 0.24, 8)),
      bannerMat,
    );
    t1Roof.position.set(0.22, 0.38, 0.08);
    group.add(t1Roof);

    // Market Tent 2 (front-left, ivory pavilion)
    const t2Roof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.2, 0.2, 4)),
      this.mats.ivoryPawn,
    );
    t2Roof.rotation.y = Math.PI / 4;
    t2Roof.position.set(-0.16, 0.32, 0.26);
    group.add(t2Roof);

    const t2Table = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.2, 0.14, 0.16)),
      this.mats.woodWarm,
    );
    t2Table.position.set(-0.16, 0.15, 0.26);
    group.add(t2Table);

    const haySack = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.07, 8, 8)),
      this.mats.hayGold,
    );
    haySack.position.set(0.05, 0.14, 0.3);
    group.add(haySack);

    return {group, baseY: 0};
  }

  private createTower(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(this.towerBaseGeo, this.mats.stoneDark);
    base.position.y = 0.07;
    group.add(base);

    const shaft = this.makeMesh(this.towerShaftGeo, this.mats.stoneLight);
    shaft.position.y = 0.5;
    group.add(shaft);

    const collar = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.35, 0.31, 0.12, 10)),
      this.mats.stoneDark,
    );
    collar.position.y = 0.88;
    group.add(collar);

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const merlon = this.makeMesh(this.crenelGeo, this.mats.stoneLight);
      merlon.position.set(Math.cos(angle) * 0.27, 0.99, Math.sin(angle) * 0.27);
      merlon.rotation.y = -angle;
      group.add(merlon);
    }

    const shield = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.18, 0.24, 0.04)),
      bannerMat,
    );
    shield.position.set(0, 0.56, 0.31);
    group.add(shield);

    return {group, baseY: 0};
  }

  private createStrongTower(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.52, 0.58, 0.18, 6)),
      this.mats.stoneDark,
    );
    base.position.y = 0.09;
    group.add(base);

    const keep = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.54, 0.84, 0.54)),
      this.mats.stoneLight,
    );
    keep.position.y = 0.58;
    group.add(keep);

    const turretGeo = this.track(new THREE.CylinderGeometry(0.11, 0.13, 0.96, 8));
    const capGeo = this.track(new THREE.ConeGeometry(0.14, 0.22, 8));
    const offsets = [
      [-0.27, -0.27],
      [0.27, -0.27],
      [-0.27, 0.27],
      [0.27, 0.27],
    ];
    for (const [ox, oz] of offsets) {
      const turret = this.makeMesh(turretGeo, this.mats.stoneDark);
      turret.position.set(ox, 0.58, oz);
      group.add(turret);

      const cap = this.makeMesh(capGeo, this.mats.roofTerracotta);
      cap.position.set(ox, 1.17, oz);
      group.add(cap);
    }

    const roof = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.32, 0.32, 4)),
      bannerMat,
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 1.16;
    group.add(roof);

    const finial = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.06, 10, 10)),
      this.mats.brassBurnished,
    );
    finial.position.y = 1.34;
    group.add(finial);

    return {group, baseY: 0};
  }

  /**
   * Composite 8-part Illumination Beacon / Watch Lantern Tower.
   */
  private createBeacon(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    // 1. Stone pedestal
    const plinth = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.36, 0.44, 0.14, 8)),
      this.mats.stoneDark,
    );
    plinth.position.y = 0.07;
    group.add(plinth);

    // 2. Slender carved stone column
    const column = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.14, 0.24, 0.68, 8)),
      this.mats.stoneLight,
    );
    column.position.y = 0.46;
    group.add(column);

    // 3. Brazier platform
    const platform = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.28, 0.2, 0.08, 8)),
      this.mats.brassBurnished,
    );
    platform.position.y = 0.82;
    group.add(platform);

    // 4. Glowing amber lantern crystal core
    const lanternCore = this.makeMesh(
      this.track(new THREE.OctahedronGeometry(0.18, 0)),
      this.mats.lanternGlow,
      false,
    );
    lanternCore.position.y = 1.03;
    group.add(lanternCore);

    // 5-8. Four bronze lantern cage ribs
    const strutGeo = this.track(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 6));
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + Math.PI / 4;
      const strut = this.makeMesh(strutGeo, this.mats.woodDark);
      strut.position.set(Math.cos(ang) * 0.2, 1.02, Math.sin(ang) * 0.2);
      group.add(strut);
    }

    // 9. Faction-colored beacon roof hood
    const cap = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.28, 0.22, 8)),
      bannerMat,
    );
    cap.position.y = 1.29;
    group.add(cap);

    return {group, lanternCore, baseY: 0};
  }

  /**
   * Composite 11-part Wheeled Siege Catapult with throwing arm & stone boulder.
   */
  private createCatapult(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    // 1. Timber siege chassis beams (left + right + cross)
    const beamGeo = this.track(new THREE.BoxGeometry(0.1, 0.09, 0.72));
    const leftBeam = this.makeMesh(beamGeo, this.mats.woodWarm);
    leftBeam.position.set(-0.22, 0.16, 0);
    group.add(leftBeam);

    const rightBeam = this.makeMesh(beamGeo, this.mats.woodWarm);
    rightBeam.position.set(0.22, 0.16, 0);
    group.add(rightBeam);

    const deck = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.52, 0.06, 0.56)),
      this.mats.woodDark,
    );
    deck.position.set(0, 0.2, 0);
    group.add(deck);

    // 2-5. Four wooden carriage wheels with steel axles
    const wheelGeo = this.track(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12));
    const hubGeo = this.track(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8));
    const wheelCoords = [
      [-0.31, 0.22],
      [0.31, 0.22],
      [-0.31, -0.22],
      [0.31, -0.22],
    ];
    for (const [wx, wz] of wheelCoords) {
      const wheel = this.makeMesh(wheelGeo, this.mats.woodDark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.14, wz);
      group.add(wheel);

      const hub = this.makeMesh(hubGeo, this.mats.steelBright);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx, 0.14, wz);
      group.add(hub);
    }

    // 6-7. Upright torsion frame posts + crossbar
    const postGeo = this.track(new THREE.BoxGeometry(0.08, 0.42, 0.09));
    const leftPost = this.makeMesh(postGeo, this.mats.woodWarm);
    leftPost.position.set(-0.21, 0.4, 0.12);
    group.add(leftPost);

    const rightPost = this.makeMesh(postGeo, this.mats.woodWarm);
    rightPost.position.set(0.21, 0.4, 0.12);
    group.add(rightPost);

    const crossbar = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.52, 0.08, 0.09)),
      this.mats.brassBurnished,
    );
    crossbar.position.set(0, 0.58, 0.12);
    group.add(crossbar);

    // 8. Angled throwing arm
    const arm = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.08, 0.08, 0.72)),
      this.mats.woodWarm,
    );
    arm.position.set(0, 0.44, -0.05);
    arm.rotation.x = 0.56;
    group.add(arm);

    // 9. Cup + loaded stone boulder
    const cup = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.14, 0.09, 0.1, 10)),
      this.mats.steelDark,
    );
    cup.position.set(0, 0.64, -0.34);
    group.add(cup);

    const boulder = this.makeMesh(
      this.track(new THREE.DodecahedronGeometry(0.11, 0)),
      this.mats.ivoryPawn,
    );
    boulder.position.set(0, 0.72, -0.34);
    group.add(boulder);

    // 10. Faction shield/pennant mounted on front
    const banner = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.36, 0.18, 0.04)),
      bannerMat,
    );
    banner.position.set(0, 0.34, 0.34);
    group.add(banner);

    return {group, baseY: 0};
  }

  private createPeasant(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(this.unitPlinthGeo, this.mats.woodDark);
    base.position.y = 0.04;
    group.add(base);

    const torso = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.16, 0.25, 0.4, 12)),
      bannerMat,
    );
    torso.position.y = 0.28;
    group.add(torso);

    const belt = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.21, 0.22, 0.06, 12)),
      this.mats.woodDark,
    );
    belt.position.y = 0.22;
    group.add(belt);

    const head = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.145, 14, 12)),
      this.mats.skinWarm,
    );
    head.position.y = 0.58;
    group.add(head);

    const brim = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.31, 0.33, 0.045, 16)),
      this.mats.hayGold,
    );
    brim.position.y = 0.68;
    group.add(brim);

    const hatBand = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.178, 0.18, 0.04, 14)),
      this.mats.woodDark,
    );
    hatBand.position.y = 0.715;
    group.add(hatBand);

    const hatCrown = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.14, 0.17, 0.13, 14)),
      this.mats.hayGold,
    );
    hatCrown.position.y = 0.77;
    group.add(hatCrown);

    // Chunky wooden pitchfork (instant peasant silhouette)
    const forkPivot = new THREE.Group();
    forkPivot.position.set(0.25, 0.44, 0.08);
    forkPivot.rotation.z = -0.16;

    const staff = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.032, 0.034, 0.72, 8)),
      this.mats.woodWarm,
    );
    forkPivot.add(staff);

    const forkBar = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.22, 0.04, 0.04)),
      this.mats.steelDark,
    );
    forkBar.position.y = 0.36;
    forkPivot.add(forkBar);

    const prongGeo = this.track(new THREE.BoxGeometry(0.032, 0.18, 0.032));
    for (const px of [-0.09, 0, 0.09]) {
      const prong = this.makeMesh(prongGeo, this.mats.steelBright);
      prong.position.set(px, 0.46, 0);
      forkPivot.add(prong);
    }
    group.add(forkPivot);

    return {group, baseY: 0};
  }

  private createSpearman(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(this.unitPlinthGeo, this.mats.stoneDark);
    base.position.y = 0.04;
    group.add(base);

    const rim = this.makeMesh(this.unitRimGeo, bannerMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.08;
    group.add(rim);

    const torso = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.19, 0.24, 0.46, 12)),
      this.mats.steelDark,
    );
    torso.position.y = 0.31;
    group.add(torso);

    const head = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.135, 14, 12)),
      this.mats.skinWarm,
    );
    head.position.y = 0.62;
    group.add(head);

    const helmet = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.19, 0.27, 12)),
      this.mats.steelPolished,
    );
    helmet.position.y = 0.78;
    group.add(helmet);

    const helmBand = this.makeMesh(
      this.track(new THREE.TorusGeometry(0.175, 0.025, 8, 18)),
      this.mats.brassBurnished,
    );
    helmBand.rotation.x = Math.PI / 2;
    helmBand.position.y = 0.67;
    group.add(helmBand);

    // Bold kite shield + golden boss
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(-0.22, 0.38, 0.16);
    shieldGroup.rotation.y = 0.36;

    const shield = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.3, 0.42, 0.065)),
      bannerMat,
    );
    shieldGroup.add(shield);

    const boss = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.065, 10, 10)),
      this.mats.brassBurnished,
    );
    boss.position.z = 0.035;
    shieldGroup.add(boss);
    group.add(shieldGroup);

    // Thick visible spear shaft & gleaming bright spearhead
    const shaft = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.034, 0.036, 0.98, 8)),
      this.mats.woodWarm,
    );
    shaft.position.set(0.25, 0.56, 0.06);
    shaft.rotation.z = -0.1;
    group.add(shaft);

    const spearTip = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.095, 0.28, 4)),
      this.mats.steelBright,
    );
    spearTip.position.set(0.3, 1.15, 0.06);
    spearTip.rotation.z = -0.1;
    group.add(spearTip);

    return {group, baseY: 0};
  }

  private createBaron(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.38, 0.42, 0.1, 20)),
      this.mats.stoneDark,
    );
    base.position.y = 0.05;
    group.add(base);

    const rim = this.makeMesh(
      this.track(new THREE.TorusGeometry(0.39, 0.036, 8, 24)),
      this.mats.brassBurnished,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.095;
    group.add(rim);

    const torso = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.24, 0.27, 0.5, 12)),
      this.mats.steelDark,
    );
    torso.position.y = 0.35;
    group.add(torso);

    const pauldronGeo = this.track(new THREE.SphereGeometry(0.14, 12, 10));
    const leftPauldron = this.makeMesh(pauldronGeo, this.mats.brassBurnished);
    leftPauldron.position.set(-0.26, 0.54, 0);
    group.add(leftPauldron);
    const rightPauldron = this.makeMesh(pauldronGeo, this.mats.brassBurnished);
    rightPauldron.position.set(0.26, 0.54, 0);
    group.add(rightPauldron);

    const cape = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.46, 0.54, 0.08)),
      bannerMat,
    );
    cape.position.set(0, 0.35, -0.22);
    cape.rotation.x = 0.2;
    group.add(cape);

    const helm = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.165, 0.175, 0.28, 12)),
      this.mats.steelPolished,
    );
    helm.position.y = 0.74;
    group.add(helm);

    const visor = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.24, 0.055, 0.06)),
      this.mats.woodDark,
    );
    visor.position.set(0, 0.74, 0.155);
    group.add(visor);

    const crownBand = this.makeMesh(
      this.track(new THREE.TorusGeometry(0.17, 0.032, 8, 16)),
      this.mats.brassBurnished,
    );
    crownBand.rotation.x = Math.PI / 2;
    crownBand.position.y = 0.87;
    group.add(crownBand);

    const crest = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.08, 0.18, 0.34)),
      bannerMat,
    );
    crest.position.set(0, 0.96, -0.02);
    group.add(crest);

    // Gleaming bright broadsword with golden crossguard
    const blade = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.1, 0.66, 0.04)),
      this.mats.steelBright,
    );
    blade.position.set(0.34, 0.72, 0.16);
    blade.rotation.z = -0.24;
    group.add(blade);

    const guard = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.26, 0.06, 0.07)),
      this.mats.brassBurnished,
    );
    guard.position.set(0.26, 0.42, 0.16);
    guard.rotation.z = -0.24;
    group.add(guard);

    return {group, baseY: 0};
  }

  private createKnight(faction: FactionId): FigurineHandle {
    const group = new THREE.Group();
    const bannerMat = this.mats.bannerByFaction[faction];

    const base = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.44, 0.48, 0.1, 24)),
      this.mats.stoneDark,
    );
    base.position.y = 0.05;
    group.add(base);

    const rim = this.makeMesh(
      this.track(new THREE.TorusGeometry(0.45, 0.036, 8, 28)),
      this.mats.brassBurnished,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.095;
    group.add(rim);

    const horseBody = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.34, 0.3, 0.64)),
      this.mats.horseCoat,
    );
    horseBody.position.set(0, 0.38, -0.02);
    group.add(horseBody);

    const barding = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.38, 0.28, 0.58)),
      bannerMat,
    );
    barding.position.set(0, 0.32, -0.02);
    group.add(barding);

    const legGeo = this.track(new THREE.CylinderGeometry(0.05, 0.045, 0.26, 8));
    const legPos = [
      [-0.12, 0.22],
      [0.12, 0.22],
      [-0.12, -0.24],
      [0.12, -0.24],
    ];
    for (const [lx, lz] of legPos) {
      const leg = this.makeMesh(legGeo, this.mats.horseCoat);
      leg.position.set(lx, 0.18, lz);
      group.add(leg);
    }

    const horseNeck = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.2, 0.34, 0.2)),
      this.mats.horseCoat,
    );
    horseNeck.position.set(0, 0.58, 0.28);
    horseNeck.rotation.x = 0.3;
    group.add(horseNeck);

    const horseHead = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.18, 0.17, 0.28)),
      this.mats.steelBright,
    );
    horseHead.position.set(0, 0.72, 0.4);
    horseHead.rotation.x = 0.42;
    group.add(horseHead);

    const rider = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.16, 0.2, 0.38, 10)),
      this.mats.steelDark,
    );
    rider.position.set(0, 0.7, -0.05);
    group.add(rider);

    const helm = this.makeMesh(
      this.track(new THREE.SphereGeometry(0.145, 12, 12)),
      this.mats.steelBright,
    );
    helm.position.set(0, 0.98, -0.05);
    group.add(helm);

    const plume = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.1, 0.34, 8)),
      bannerMat,
    );
    plume.position.set(0, 1.16, -0.11);
    plume.rotation.x = -0.45;
    group.add(plume);

    // Bold golden tournament lance + faction pennant
    const lance = this.makeMesh(
      this.track(new THREE.ConeGeometry(0.058, 1.18, 8)),
      this.mats.brassBurnished,
    );
    lance.position.set(0.25, 0.88, 0.24);
    lance.rotation.x = Math.PI / 2 - 0.35;
    group.add(lance);

    const pennant = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.03, 0.18, 0.26)),
      bannerMat,
    );
    pennant.position.set(0.25, 0.95, 0.58);
    group.add(pennant);

    return {group, baseY: 0};
  }

  private createPine(variationSeed: number): FigurineHandle {
    const group = new THREE.Group();
    const scaleJitter = 0.9 + ((variationSeed * 37) % 100) / 450;

    const trunk = this.makeMesh(this.trunkGeo, this.mats.woodDark);
    trunk.position.y = 0.12;
    group.add(trunk);

    const tier1 = this.makeMesh(this.pineTier1Geo, this.mats.pineFoliageDark);
    tier1.position.y = 0.38;
    tier1.rotation.y = variationSeed * 1.1;
    group.add(tier1);

    const tier2 = this.makeMesh(this.pineTier2Geo, this.mats.pineFoliageMid);
    tier2.position.y = 0.62;
    tier2.rotation.y = variationSeed * 1.1 + 0.5;
    group.add(tier2);

    const tier3 = this.makeMesh(this.pineTier3Geo, this.mats.pineFoliageDark);
    tier3.position.y = 0.84;
    tier3.rotation.y = variationSeed * 1.1 + 1.0;
    group.add(tier3);

    group.scale.setScalar(scaleJitter);
    return {group, baseY: 0};
  }

  private createPalm(variationSeed: number): FigurineHandle {
    const group = new THREE.Group();

    const base = this.makeMesh(this.palmBaseGeo, this.mats.soilDark);
    base.position.set(0, 0.025, 0);
    group.add(base);

    const seg1 = this.makeMesh(this.palmSegGeo, this.mats.palmTrunk);
    seg1.position.set(0, 0.14, 0);
    seg1.rotation.z = 0.12;
    group.add(seg1);

    const seg2 = this.makeMesh(this.palmSegGeo, this.mats.palmTrunk);
    seg2.position.set(-0.04, 0.39, 0);
    seg2.rotation.z = 0.2;
    group.add(seg2);

    const seg3 = this.makeMesh(this.palmSegGeo, this.mats.palmTrunk);
    seg3.position.set(-0.1, 0.63, 0);
    seg3.rotation.z = 0.1;
    group.add(seg3);

    for (let i = 0; i < 6; i++) {
      const isDarkTier = i % 2 === 1;
      const angle = (i / 6) * Math.PI * 2 + variationSeed;
      const frondMat = isDarkTier
        ? this.mats.palmFoliageDark
        : this.mats.palmFoliage;

      const frondPivot = new THREE.Group();
      frondPivot.position.set(-0.12, isDarkTier ? 0.74 : 0.78, 0);
      frondPivot.rotation.y = angle;

      const inner = this.makeMesh(this.palmFrondInnerGeo, frondMat);
      inner.position.set(0, 0.01, 0.13);
      inner.rotation.x = isDarkTier ? 0.22 : 0.12;
      frondPivot.add(inner);

      const tip = this.makeMesh(this.palmFrondTipGeo, frondMat);
      tip.position.set(0, isDarkTier ? -0.09 : -0.07, 0.34);
      tip.rotation.x = isDarkTier ? 0.68 : 0.56;
      frondPivot.add(tip);

      group.add(frondPivot);
    }

    const cocoOffsets: readonly [number, number, number][] = [
      [-0.08, 0.71, 0.05],
      [-0.15, 0.7, 0.04],
      [-0.12, 0.7, -0.05],
    ];
    for (const [cx, cy, cz] of cocoOffsets) {
      const coco = this.makeMesh(this.palmCocoGeo, this.mats.woodDark);
      coco.position.set(cx, cy, cz);
      group.add(coco);
    }

    group.rotation.y = variationSeed * 2.1;
    return {group, baseY: 0};
  }

  private createGrave(): FigurineHandle {
    const group = new THREE.Group();

    const mound = this.makeMesh(
      this.track(new THREE.CylinderGeometry(0.28, 0.35, 0.08, 10)),
      this.mats.soilDark,
    );
    mound.position.y = 0.04;
    group.add(mound);

    const stone = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.26, 0.34, 0.09)),
      this.mats.stoneLight,
    );
    stone.position.set(0, 0.23, -0.06);
    stone.rotation.x = -0.08;
    group.add(stone);

    const vBar = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.04, 0.16, 0.03)),
      this.mats.stoneDark,
      false,
    );
    vBar.position.set(0, 0.25, -0.005);
    group.add(vBar);

    const hBar = this.makeMesh(
      this.track(new THREE.BoxGeometry(0.11, 0.04, 0.03)),
      this.mats.stoneDark,
      false,
    );
    hBar.position.set(0, 0.28, -0.005);
    group.add(hBar);

    return {group, baseY: 0};
  }

  public dispose(): void {
    this.geos.forEach((g) => g.dispose());
    this.geos.length = 0;
  }
}
