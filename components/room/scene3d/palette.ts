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
    dining: "#e9e0d2",
    kitchen: "#dfdcd5",
    terrace: "#d6c4a9",
    service: "#e4ddd2",
    promenade: "#dcd5c9",
    garden: "#c3cba6",
  },
  interiorGlow: "#000000",
  interiorGlowStrength: 0,
  ground: { stone: "#e1dbd0", lawn: "#c9cfaf" },
  quay: "#cdc5b7",
  wall: "#f5f1ea",
  wallCap: "#faf7f2",
  sill: "#e6ded1",
  frame: "#77716a",
  glass: "#bcd3da",
  glassOpacity: 0.16,
  tableTop: "#d9bd94",
  tableTopQuiet: "#e8e2d7",
  metal: "#948a7e",
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
  contactShadow: 0.55,
  ao: { intensity: 3, color: "#2a2018" },
  ringAlpha: 0.95,
  exposure: 1.3,
};

export const DUSK: Palette = {
  theme: "dark",
  background: "#12110f",
  floor: {
    dining: "#4a4036",
    kitchen: "#413c36",
    terrace: "#3f3428",
    service: "#433a31",
    promenade: "#2f2c28",
    garden: "#2b3125",
  },
  interiorGlow: "#ffb46b",
  interiorGlowStrength: 0.05,
  ground: { stone: "#2a2724", lawn: "#262b21" },
  quay: "#24221f",
  wall: "#5a5047",
  wallCap: "#665b50",
  sill: "#4c433a",
  frame: "#2f2b27",
  glass: "#33505c",
  glassOpacity: 0.22,
  tableTop: "#77634b",
  tableTopQuiet: "#5c5248",
  metal: "#2c2722",
  chairWood: "#6b5640",
  chairWoodQuiet: "#554b41",
  upholsteryQuiet: "#5a5047",
  upholsteryTint: 0.5,
  upholsteryBase: "#5f5246",
  steel: "#77736d",
  steelDark: "#3c3935",
  hedge: "#3c4a31",
  canopy: "#435236",
  trunk: "#3c3229",
  planter: "#4a4239",
  soil: "#2a231d",
  stone: "#4a443d",
  bottle: "#5f6f66",
  ceiling: "#4e463e",
  downlight: "#ffd9a6",
  votive: "#f3d9b0",
  votiveGlow: 2.4,
  water: { deep: "#0e1a22", shallow: "#203540", sky: "#3a3f4c" },
  sky: { zenith: "#121a2b", horizon: "#5a4844", haze: "#3a3434", far: "#2a2a33" },
  light: {
    hemiSky: "#5d6c94",
    hemiGround: "#3a2a1d",
    hemi: 0.75,
    key: "#ffcf9e",
    keyIntensity: 1.55,
    keyElevation: 64,
    env: 0.16,
    poolColor: "#ffc98e",
    poolIntensity: 12,
    interior: "#ffb874",
    interiorIntensity: 0.9,
  },
  contactShadow: 0.6,
  ao: { intensity: 2.6, color: "#000000" },
  ringAlpha: 1,
  exposure: 1,
};

export function paletteFor(theme: Theme): Palette {
  return theme === "dark" ? DUSK : LIGHT;
}
