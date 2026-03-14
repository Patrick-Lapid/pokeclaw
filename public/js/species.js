// POKECLAW — Species Definitions
// 24 species roster for the gacha/collection system

var SPECIES = [
  // Common (rarity 0) — 10 species, 60% total roll chance
  { id: 0,  dexNum: '0001', name: 'Bulbasaur',  type: 'grass',    rarity: 0 },
  { id: 1,  dexNum: '0004', name: 'Charmander', type: 'fire',     rarity: 0 },
  { id: 2,  dexNum: '0007', name: 'Squirtle',   type: 'water',    rarity: 0 },
  { id: 3,  dexNum: '0025', name: 'Pikachu',    type: 'electric', rarity: 0 },
  { id: 4,  dexNum: '0039', name: 'Jigglypuff', type: 'fairy',    rarity: 0 },
  { id: 5,  dexNum: '0052', name: 'Meowth',     type: 'normal',   rarity: 0 },
  { id: 6,  dexNum: '0054', name: 'Psyduck',    type: 'water',    rarity: 0 },
  { id: 7,  dexNum: '0066', name: 'Machop',     type: 'fighting', rarity: 0 },
  { id: 8,  dexNum: '0074', name: 'Geodude',    type: 'rock',     rarity: 0 },
  { id: 9,  dexNum: '0133', name: 'Eevee',      type: 'normal',   rarity: 0 },
  // Uncommon (rarity 1) — 8 species, 28% total roll chance
  { id: 10, dexNum: '0058', name: 'Growlithe',  type: 'fire',     rarity: 1 },
  { id: 11, dexNum: '0063', name: 'Abra',       type: 'psychic',  rarity: 1 },
  { id: 12, dexNum: '0092', name: 'Gastly',     type: 'ghost',    rarity: 1 },
  { id: 13, dexNum: '0123', name: 'Scyther',    type: 'bug',      rarity: 1 },
  { id: 14, dexNum: '0143', name: 'Snorlax',    type: 'normal',   rarity: 1 },
  { id: 15, dexNum: '0147', name: 'Dratini',    type: 'dragon',   rarity: 1 },
  { id: 16, dexNum: '0175', name: 'Togepi',     type: 'fairy',    rarity: 1 },
  { id: 17, dexNum: '0246', name: 'Larvitar',   type: 'rock',     rarity: 1 },
  // Rare (rarity 2) — 4 species, 10% total roll chance
  { id: 18, dexNum: '0006', name: 'Charizard',  type: 'fire',     rarity: 2 },
  { id: 19, dexNum: '0094', name: 'Gengar',     type: 'ghost',    rarity: 2 },
  { id: 20, dexNum: '0149', name: 'Dragonite',  type: 'dragon',   rarity: 2 },
  { id: 21, dexNum: '0248', name: 'Tyranitar',  type: 'dark',     rarity: 2 },
  // Legendary (rarity 3) — 2 species, 2% total roll chance
  { id: 22, dexNum: '0150', name: 'Mewtwo',     type: 'psychic',  rarity: 3 },
  { id: 23, dexNum: '0151', name: 'Mew',        type: 'psychic',  rarity: 3 }
]

var RARITY_NAMES = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY']
var RARITY_COLORS = ['#ffffff', '#48d848', '#4488ff', '#f0c040']

// Per-species weight by rarity tier
// Total: 10×0.06 + 8×0.035 + 4×0.025 + 2×0.01 = 1.0
var RARITY_WEIGHTS = [0.06, 0.035, 0.025, 0.01]
