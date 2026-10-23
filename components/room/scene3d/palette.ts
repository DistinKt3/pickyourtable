/**
 * The diorama's material and light palette. One matte clay family of warm off-whites
 * and stone tones, plus the venue accent used sparingly. Dark mode is a designed dusk
 * (deeper clay, warm interior light, darker water and sky), not an inversion.
 *
 * Colors are sRGB hex; three converts them to linear when they are set.
 */

export type Theme = "light" | "dark";

export type FloorKind = "dining" | "kitchen" | "terrace" | "service" | "promenade" | "garden";

export interface Palette {
  theme: Theme;
  /** Page background the diorama fades into (matches --surface-0). */
  background: string;
  floor: Record<FloorKind, string>;
  /** Interior warmth added to surfaces under the roof (dusk only). */
  interiorGlow: string;
  interiorGlowStrength: number;
  ground: Record<"stone" | "lawn", string>;
  quay: string;
  wall: string;
  wallCap: string;
  sill: string;
  frame: string;
  glass: string;
  glassOpacity: number;
  /** How much the glass catches the sky from above. */
  glassSheen: number;
  tableTop: string;
  tableTopQuiet: string;
  metal: string;
  chairWood: string;
  chairWoodQuiet: string;
  upholsteryQuiet: string;
  /** How much of the tier color tints bookable upholstery. */
  upholsteryTint: number;
  upholsteryBase: string;
  steel: string;
  steelDark: string;
  hedge: string;
  canopy: string;
  trunk: string;
  planter: string;
  soil: string;
  stone: string;
  bottle: string;
  ceiling: string;
  downlight: string;
  votive: string;
  /** Plates and stacked crockery. */
  plate: string;
  /** Emissive strength of the table votives (0 in daylight). */
  votiveGlow: number;
  water: { deep: string; shallow: string; sky: string };
  sky: { zenith: string; horizon: string; haze: string; far: string };
  light: {
    hemiSky: string;
    hemiGround: string;
    hemi: number;
    key: string;
    keyIntensity: number;
    /** Degrees above the horizon. */
    keyElevation: number;
    env: number;
    poolColor: string;
    poolIntensity: number;
    interior: string;
    interiorIntensity: number;
  };
  contactShadow: number;
  ao: { intensity: number; color: string };
  ringAlpha: number;
  /** How strongly the selected ring tints the floor inside it (a pale veil reads as haze on a dark floor). */
  ringFill: number;
  /** Exposure before tone mapping. */
  exposure: number;
  /** The look after tone mapping. */
  post: { contrast: number; saturation: number };
}

export const LIGHT: Palette = {
  theme: "light",
  background: "#f6f3ee",
  floor: {
    dining: "#e2d6c3",
    kitchen: "#d8d4cc",
    terrace: "#d2bc9c",
    service: "#ddd4c6",
    promenade: "#d9d1c3",
    garden: "#bfc8a0",
  },
  interiorGlow: "#000000",
  interiorGlowStrength: 0,
  ground: { stone: "#e6e0d5", lawn: "#cfd5b6" },
  quay: "#cdc5b7",
  wall: "#f5f1ea",
  wallCap: "#faf7f2",
  sill: "#e6ded1",
  frame: "#8b847b",
  glass: "#a9c6cf",
  glassOpacity: 0.24,
  glassSheen: 1,
  tableTop: "#d9bd94",
  tableTopQuiet: "#e8e2d7",
  metal: "#a99f92",
  chairWood: "#bf9a6c",
  chairWoodQuiet: "#ddd6ca",
  upholsteryQuiet: "#e3ddd2",
  upholsteryTint: 0.56,
  upholsteryBase: "#e0d2bd",
  steel: "#d3d3cf",
  steelDark: "#8e8c87",
  hedge: "#93a57c",
  canopy: "#a1b285",
  trunk: "#8b7a66",
  planter: "#d6cdbf",
  soil: "#8a7a66",
  stone: "#d9d1c4",
  bottle: "#a9b7ae",
  ceiling: "#f3eee6",
  downlight: "#fff4dd",
  votive: "#efe6d6",
  plate: "#f1e9dc",
  votiveGlow: 0,
  water: { deep: "#3f6f7f", shallow: "#86aab3", sky: "#e4e2d8" },
  sky: { zenith: "#7aa6c8", horizon: "#f0e7d8", haze: "#ece6da", far: "#a3abac" },
  light: {
    hemiSky: "#e9eef2",
    hemiGround: "#cdbca3",
    hemi: 0.95,
    key: "#fff1df",
    keyIntensity: 3.1,
    keyElevation: 52,
    env: 0.32,
    poolColor: "#fff3df",
    poolIntensity: 9,
    interior: "#ffe2bd",
    interiorIntensity: 0.7,
  },
  contactShadow: 0.85,
  ao: { intensity: 3, color: "#2a2018" },
  ringAlpha: 0.95,
  ringFill: 1,
  exposure: 1.5,
  post: { contrast: 0.14, saturation: 0.16 },
};

export const DUSK: Palette = {
  theme: "dark",
  background: "#12110f",
  floor: {
    dining: "#3d3934",
    kitchen: "#383633",
    terrace: "#3b342d",
    service: "#3a3632",
    promenade: "#292826",
    garden: "#252a22",
  },
  interiorGlow: "#ffcf9e",
  interiorGlowStrength: 0.022,
  ground: { stone: "#201f1d", lawn: "#1d211b" },
  quay: "#1a1918",
  wall: "#58534d",
  wallCap: "#635d57",
  sill: "#4a4540",
  frame: "#2a2826",
  glass: "#3a4f58",
  glassOpacity: 0.2,
  glassSheen: 0.22,
  tableTop: "#76664f",
  tableTopQuiet: "#4f4a45",
  metal: "#3a3531",
  chairWood: "#665441",
  chairWoodQuiet: "#4d4843",
  upholsteryQuiet: "#555049",
  upholsteryTint: 0.42,
  upholsteryBase: "#5a5149",
  steel: "#6f6c68",
  steelDark: "#373533",
  hedge: "#3a4631",
  canopy: "#414f35",
  trunk: "#3a3029",
  planter: "#46413c",
  soil: "#26211c",
  stone: "#4a4641",
  bottle: "#5c6b63",
  ceiling: "#4b4641",
  downlight: "#ffdcae",
  votive: "#f2c48c",
  plate: "#a39a8e",
  votiveGlow: 2.2,
  water: { deep: "#0c1318", shallow: "#18232a", sky: "#2a2f3a" },
  sky: { zenith: "#10172a", horizon: "#4b3f40", haze: "#2c2a2b", far: "#22232a" },
  light: {
    hemiSky: "#56617d",
    hemiGround: "#54463a",
    hemi: 0.95,
    key: "#ffe8d0",
    keyIntensity: 1.8,
    keyElevation: 64,
    env: 0.14,
    poolColor: "#ffd2a0",
    poolIntensity: 12,
    interior: "#ffc48a",
    interiorIntensity: 0.9,
  },
  contactShadow: 0.9,
  ao: { intensity: 2.2, color: "#0e0b08" },
  ringAlpha: 1,
  ringFill: 0.25,
  exposure: 1.35,
  post: { contrast: 0.1, saturation: 0.04 },
};

export function paletteFor(theme: Theme): Palette {
  return theme === "dark" ? DUSK : LIGHT;
}

/**
 * Seat renders: late-afternoon daylight. A warm, lower key light, a cream horizon
 * over a deeper sea, and a warm interior a touch darker than the view outside, the way
 * a photograph from the table would read.
 */
export const RENDER: Palette = {
  ...LIGHT,
  water: { deep: "#2d5c6d", shallow: "#5f8e9a", sky: "#e9dccb" },
  sky: { zenith: "#6f9ec4", horizon: "#f3e5cf", haze: "#efe2cf", far: "#9fa8aa" },
  frame: "#5f5a54",
  glassOpacity: 0.12,
  light: {
    ...LIGHT.light,
    hemiSky: "#e3e9ee",
    hemiGround: "#dcc8ab",
    hemi: 0.8,
    key: "#ffd9ab",
    keyIntensity: 3.3,
    keyElevation: 34,
    env: 0.3,
    interior: "#ffcf9c",
    interiorIntensity: 1.3,
  },
  exposure: 1.32,
};
