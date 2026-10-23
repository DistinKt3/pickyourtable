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
  /** Exposure before tone mapping. */
  exposure: number;
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
  votiveGlow: 0,
  water: { deep: "#4f7f8f", shallow: "#9cc0c8", sky: "#dbe7ea" },
  sky: { zenith: "#9fc0d4", horizon: "#e8eeee", haze: "#e9ece8", far: "#a9b9bf" },
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
    interiorIntensity: 0,
  },
  contactShadow: 0.85,
  ao: { intensity: 3, color: "#2a2018" },
  ringAlpha: 0.95,
  exposure: 1.5,
};

export const DUSK: Palette = {
  theme: "dark",
  background: "#12110f",
  floor: {
    dining: "#433b33",
    kitchen: "#3b3834",
    terrace: "#3e3429",
    service: "#3d3730",
    promenade: "#2b2926",
    garden: "#283023",
  },
  interiorGlow: "#ffc48a",
  interiorGlowStrength: 0.035,
  ground: { stone: "#262422", lawn: "#22271f" },
  quay: "#1f1e1c",
  wall: "#57504a",
  wallCap: "#635b54",
  sill: "#4a443e",
  frame: "#2c2926",
  glass: "#3c5560",
  glassOpacity: 0.2,
  glassSheen: 0.25,
  tableTop: "#7a6650",
  tableTopQuiet: "#57504a",
  metal: "#3a342f",
  chairWood: "#6e5944",
  chairWoodQuiet: "#4f4943",
  upholsteryQuiet: "#57514b",
  upholsteryTint: 0.42,
  upholsteryBase: "#5d5249",
  steel: "#6f6c68",
  steelDark: "#3a3835",
  hedge: "#3a4631",
  canopy: "#414f35",
  trunk: "#3a3029",
  planter: "#47403a",
  soil: "#28221d",
  stone: "#4a453f",
  bottle: "#5c6b63",
  ceiling: "#4b4540",
  downlight: "#ffdcae",
  votive: "#f1dcbc",
  votiveGlow: 2.2,
  water: { deep: "#0d161d", shallow: "#1a2a33", sky: "#2c3240" },
  sky: { zenith: "#10172a", horizon: "#4b3f40", haze: "#332f31", far: "#24242c" },
  light: {
    hemiSky: "#5a6688",
    hemiGround: "#33291f",
    hemi: 0.8,
    key: "#ffe0bf",
    keyIntensity: 1.9,
    keyElevation: 64,
    env: 0.14,
    poolColor: "#ffd2a0",
    poolIntensity: 12,
    interior: "#ffc48a",
    interiorIntensity: 0.9,
  },
  contactShadow: 0.9,
  ao: { intensity: 2.6, color: "#000000" },
  ringAlpha: 1,
  exposure: 1.35,
};

export function paletteFor(theme: Theme): Palette {
  return theme === "dark" ? DUSK : LIGHT;
}
