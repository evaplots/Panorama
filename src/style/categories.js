// Single source of truth for the painter's five-category mapping.
// See DATA-CONTRACTS.md "Ground category mapping".
//
// The five categories are deliberately coarse — they parameterise sun-phase
// tinting and (later) wave patterns / silhouettes. Per-tag colour lookup still
// goes through GROUND_COVER_COLOURS in src/config.js; categories are an
// orthogonal classification, not a replacement.

const TAG_TO_CATEGORY = {
  'natural=water':       'water',
  'natural=wetland':     'water',
  'natural=glacier':     'water',
  'waterway=riverbank':  'water',

  'natural=beach':       'beach',
  'natural=sand':        'beach',

  'natural=wood':        'forest',
  'landuse=forest':      'forest',

  'landuse=residential': 'urban',
  'landuse=commercial':  'urban',
  'landuse=industrial':  'urban',
  'landuse=cemetery':    'urban',
  'landuse=brownfield':  'urban',

  'landuse=farmland':    'farmland',
  'landuse=orchard':     'farmland',
  'landuse=vineyard':    'farmland',
  'landuse=meadow':      'farmland',
  'landuse=grass':       'farmland',
  'natural=grassland':   'farmland',
  'natural=heath':       'farmland',
  'leisure=park':        'farmland',
  'leisure=garden':      'farmland',
  'leisure=pitch':       'farmland',
  'leisure=golf_course': 'farmland',
};

// Same priority order as GROUND_COVER_PRIORITY (natural/waterway > leisure > landuse).
// Reused here so a polygon tagged both `landuse=residential` and `leisure=park`
// resolves to 'farmland' (park wins over residential), matching the ground-cover
// rendering choice in the 3D scene.
const KEY_PRIORITY = {
  natural: 1,
  waterway: 1,
  leisure: 2,
  landuse: 3,
};

/**
 * Resolve a tags object to one of the five painter categories, or null if no
 * tag matches. Highest-priority key wins (ties broken by first-seen order).
 *
 * @param {Object<string,string>} tags
 * @returns {'water'|'forest'|'urban'|'farmland'|'beach'|null}
 */
export function categorise(tags) {
  if (!tags) return null;
  let best = null;
  let bestPriority = Infinity;
  for (const [key, value] of Object.entries(tags)) {
    const cat = TAG_TO_CATEGORY[`${key}=${value}`];
    if (!cat) continue;
    const priority = KEY_PRIORITY[key] ?? 99;
    if (priority < bestPriority) {
      bestPriority = priority;
      best = cat;
    }
  }
  return best;
}

export const CATEGORIES = ['water', 'forest', 'urban', 'farmland', 'beach'];
