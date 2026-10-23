"use client";

import { create } from "zustand";
import type { TableAvailability } from "@/lib/api/contracts";

/**
 * Shared guest state (PRD architecture: one zustand store keeps the 3D plan, 2D plan
 * and list view in sync). Renderers read from it and call its actions; none of them
 * holds its own copy of selection or slot.
 */

export interface Slot {
  date: string;
  time: string;
  party: number;
}

/** Each intent carries a fresh id so asking twice for the same thing still moves the camera. */
export type CameraIntent =
  | { kind: "overview"; id: number }
  | { kind: "frame"; code: string; id: number }
  | { kind: "sit"; code: string; id: number };

export type RendererKind = "pending" | "3d" | "2d";

export interface RoomStore {
  view: "room" | "list";
  renderer: RendererKind;
  /** Party size in the header, kept even before a slot is chosen. */
  party: number;
  slot: Slot | null;
  /** Live availability for `slot`, keyed by table code. Null in browse mode. */
  availability: Record<string, TableAvailability> | null;
  hovered: string | null;
  selected: string | null;
  /** Table whose seat the camera is in ("Sit here"), if any. */
  sitting: string | null;
  camera: CameraIntent;
  reducedMotion: boolean;

  setView: (view: RoomStore["view"]) => void;
  setRenderer: (r: RendererKind) => void;
  setParty: (party: number) => void;
  setSlot: (slot: Slot | null) => void;
  setAvailability: (tables: TableAvailability[] | null) => void;
  hover: (code: string | null) => void;
  /** Selects a table and frames it; null returns to the whole room. */
  select: (code: string | null) => void;
  sit: (code: string) => void;
  standUp: () => void;
  overview: () => void;
  setReducedMotion: (v: boolean) => void;
}

let intentId = 0;
const next = () => ++intentId;

export const useRoom = create<RoomStore>()((set, get) => ({
  view: "room",
  renderer: "pending",
  party: 2,
  slot: null,
  availability: null,
  hovered: null,
  selected: null,
  sitting: null,
  camera: { kind: "overview", id: 0 },
  reducedMotion: false,

  setView: (view) => set({ view }),
  setRenderer: (renderer) => set({ renderer }),
  setParty: (party) => set({ party }),
  setSlot: (slot) => set(slot ? { slot, party: slot.party } : { slot: null, availability: null }),
  setAvailability: (tables) => set({ availability: tables ? Object.fromEntries(tables.map((t) => [t.code, t])) : null }),
  hover: (hovered) => {
    if (get().hovered !== hovered) set({ hovered });
  },
  select: (code) =>
    set(
      code
        ? { selected: code, sitting: null, camera: { kind: "frame", code, id: next() } }
        : { selected: null, sitting: null, camera: { kind: "overview", id: next() } },
    ),
  sit: (code) => set({ selected: code, sitting: code, camera: { kind: "sit", code, id: next() } }),
  standUp: () => {
    const code = get().sitting ?? get().selected;
    set({ sitting: null, camera: code ? { kind: "frame", code, id: next() } : { kind: "overview", id: next() } });
  },
  overview: () => set({ camera: { kind: "overview", id: next() } }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
