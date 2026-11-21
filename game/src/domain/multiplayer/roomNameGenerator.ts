const ROOM_ADJECTIVES: readonly string[] = [
  'Epic',
  'Crimson',
  'Golden',
  'Iron',
  'Silent',
  'Azure',
  'Shadow',
  'Amber',
  'Frost',
  'Cobalt',
  'Emerald',
  'Solar',
  'Royal',
  'Silver',
  'Obsidian',
  'Noble',
  'Wild',
  'Crystal',
  'Ancient',
  'Northern',
  'Verdant',
  'Ashen',
  'Radiant',
  'Sunken',
  'Swift',
  'Misty',
  'Scarlet',
  'Gilded',
  'Stormy',
  'velvet'.replace(/^./, (c) => c.toUpperCase()),
  'High',
  'Brave',
];

const ROOM_NOUNS: readonly string[] = [
  'Peak',
  'Storm',
  'Ridge',
  'Crown',
  'Keep',
  'Fjord',
  'Vale',
  'Spire',
  'Citadel',
  'Harbor',
  'Crest',
  'Bastion',
  'Coast',
  'Isle',
  'Canyon',
  'Throne',
  'Glade',
  'Reach',
  'Watch',
  'Mesa',
  'Haven',
  'Forge',
  'Tower',
  'Bay',
  'Steppe',
  'Pass',
  'Cliff',
  'Grove',
  'Shores',
  'Stronghold',
  'Vanguard',
  'Frontier',
];

/**
 * Generates a memorable, human-readable room name such as `Epic-Peak` or `Crimson-Storm`.
 * Avoids collisions with any active room names passed in `existingNames`.
 */
export function generateRoomName(
  existingNames?: ReadonlySet<string>,
): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const adj =
      ROOM_ADJECTIVES[Math.floor(Math.random() * ROOM_ADJECTIVES.length)];
    const noun = ROOM_NOUNS[Math.floor(Math.random() * ROOM_NOUNS.length)];
    const candidate = `${adj}-${noun}`;
    if (!existingNames || !existingNames.has(candidate)) {
      return candidate;
    }
  }
  const adj =
    ROOM_ADJECTIVES[Math.floor(Math.random() * ROOM_ADJECTIVES.length)];
  const noun = ROOM_NOUNS[Math.floor(Math.random() * ROOM_NOUNS.length)];
  const suffix = Math.floor(10 + Math.random() * 90);
  return `${adj}-${noun}-${suffix}`;
}
