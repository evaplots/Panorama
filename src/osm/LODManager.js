/**
 * LOD config for OSM features. Phase 1.5 consumed `groundCover`; Phase 2
 * adds `buildings` tiers. Phase 3+ will fill in `vegetation`.
 */
export const LODManager = {
  getLODConfig(preset) {
    return {
      near: preset.lod.near,
      mid:  preset.lod.mid,
      far:  preset.lod.far,
      groundCover: {
        // Phase 5 polish: Douglas–Peucker simplify polygons whose centroid is past `far`.
        simplifyBeyondM: preset.lod.far,
      },
      buildings: {
        // Phase 2: full extrusion within `near`, simplified within `mid`, dropped beyond.
        // Phase 3 will preserve `landmarks` past `mid`.
        fullDetailWithinM: preset.lod.near,
        simplifiedWithinM: preset.lod.mid,
      },
    };
  },
};
