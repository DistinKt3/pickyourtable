"use client";

import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";
import { Component, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Plan2D } from "@/components/room/plan2d/plan2d";
import { guestPlanViews } from "@/components/room/views";
import { cx } from "@/lib/format";
import type { RoomData } from "@/lib/room/types";
import { useRoom } from "@/lib/room/store";

// The 3D room is its own chunk, fetched only after the 2D plan is interactive.
const RoomScene3D = dynamic(() => import("@/components/room/scene3d"), { ssr: false, loading: () => null });

function webglAvailable(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/** If the 3D room fails for any reason, the 2D plan simply stays. */
class Fallback extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The room. The 2D plan paints first (server-rendered, interactive as soon as it
 * hydrates) and is the whole experience without WebGL. Where WebGL works, the 3D
 * diorama loads after it and cross-fades in once its first frames are ready; from
 * then on the 3D labels are the tables' buttons and the plan is inert, so each table
 * is reachable exactly once.
 */
export function RoomView({ data, bottomInset }: { data: RoomData; bottomInset: number }) {
  const availability = useRoom((s) => s.availability);
  const selected = useRoom((s) => s.selected);
  const hovered = useRoom((s) => s.hovered);
  const select = useRoom((s) => s.select);
  const hover = useRoom((s) => s.hover);
  const reducedMotion = useRoom((s) => s.reducedMotion);
  const sitting = useRoom((s) => s.sitting);
  const standUp = useRoom((s) => s.standUp);
  const renderer = useRoom((s) => s.renderer);
  const views = useMemo(() => guestPlanViews(data.venue, data.tables, availability), [data, availability]);

  const [want3d, setWant3d] = useState(false);
  const [ready3d, setReady3d] = useState(false);

  // Start the 3D room once the plan is interactive and the main thread is idle.
  useEffect(() => {
    if (renderer === "pending" || want3d || !webglAvailable()) return;
    const start = () => setWant3d(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(start, 200);
    return () => clearTimeout(id);
  }, [renderer, want3d]);

  // Leaving the room (to the list) unmounts the scene: the plan is the renderer again.
  useEffect(
    () => () => {
      if (useRoom.getState().renderer === "3d") useRoom.getState().setRenderer("2d");
    },
    [],
  );

  const onReady = useCallback(() => {
    performance.mark("pyt:3d-ready");
    setReady3d(true);
    useRoom.getState().setRenderer("3d");
  }, []);
  const onError = useCallback(() => {
    setReady3d(false);
    setWant3d(false);
    useRoom.getState().setRenderer("2d");
  }, []);

  const fade = reducedMotion ? "" : "transition-opacity duration-500 ease-out";
  return (
    <div className="relative size-full overflow-hidden">
      <div
        data-plan-layer
        className={cx("absolute inset-0", fade, ready3d && "pointer-events-none opacity-0")}
        inert={ready3d}
        aria-hidden={ready3d || undefined}
      >
        <Plan2D
          venue={data.venue}
          tables={data.tables}
          views={views}
          selected={selected}
          hovered={hovered}
          onSelect={select}
          onHover={hover}
          focus={selected && bottomInset > 0 ? { code: selected, bottomInset } : null}
          reducedMotion={reducedMotion}
          ariaLabel={`Floor plan of ${data.venue.name}. Each table is a button.`}
          className="p-3 lg:p-8"
        />
      </div>
      {want3d ? (
        <Fallback onError={onError}>
          <section
            className={cx("absolute inset-0", fade, !ready3d && "pointer-events-none opacity-0")}
            inert={!ready3d}
            aria-hidden={!ready3d || undefined}
            aria-label={`3D view of ${data.venue.name}. Each table label is a button.`}
            data-room3d
          >
            <RoomScene3D data={data} onReady={onReady} />
          </section>
        </Fallback>
      ) : null}
      {ready3d && sitting ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={standUp}
            className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-black/65 px-5 font-medium text-white shadow-pop backdrop-blur hover:bg-black/75"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to the room
          </button>
        </div>
      ) : null}
    </div>
  );
}
