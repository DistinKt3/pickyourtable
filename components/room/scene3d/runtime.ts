"use client";

import { createContext, use, useEffect, useState } from "react";
import type * as THREE from "three";
import type { Theme } from "./palette";

/**
 * Mutable per-mount state shared between the 3D scene and the HTML label layer.
 * Per-frame values live here, not in React state, so nothing re-renders per frame.
 */

export interface LabelSlot {
  button: HTMLButtonElement;
  pill: HTMLElement;
  width: number;
  height: number;
  shown: boolean;
}

export interface Runtime {
  /** 0 in the diorama, 1 seated ("Sit here"), animated in between. */
  sit: number;
  /** Current lift of each table group, meters. */
  lift: Map<string, number>;
  groups: Map<string, THREE.Object3D>;
  labels: Map<string, LabelSlot>;
  /** The label that has keyboard focus: always visible. */
  focused: string | null;
  invalidate: () => void;
  stats: { drawCalls: number; triangles: number };
  camera: { target: { x: number; y: number; z: number } };
  ready: boolean;
  /** Bumped when label sizes change, so the next frame re-measures. */
  labelsDirty: boolean;
  /** Distance of the default view, for the far-out label rule. */
  overviewDistance: number;
}

export function createRuntime(): Runtime {
  return {
    sit: 0,
    lift: new Map(),
    groups: new Map(),
    labels: new Map(),
    focused: null,
    invalidate: () => {},
    stats: { drawCalls: 0, triangles: 0 },
    camera: { target: { x: 0, y: 0, z: 0 } },
    ready: false,
    labelsDirty: true,
    overviewDistance: 40,
  };
}

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = use(RuntimeContext);
  if (!rt) throw new Error("useRuntime outside RoomScene3D");
  return rt;
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light or dusk, following `prefers-color-scheme` and the `data-theme` override, live. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(readTheme());
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return theme;
}

/** `prefers-reduced-motion`, live. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** The page background token, so the diorama fades into exactly the page color. */
export function readSurfaceColor(fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--surface-0").trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}
