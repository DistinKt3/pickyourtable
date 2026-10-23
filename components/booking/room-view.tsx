"use client";

import { useMemo } from "react";
import { Plan2D } from "@/components/room/plan2d/plan2d";
import { guestPlanViews } from "@/components/room/views";
import type { RoomData } from "@/lib/room/types";
import { useRoom } from "@/lib/room/store";

/**
 * The room: the 2D plan paints first (server-rendered, interactive as soon as it
 * hydrates), and stays as the whole experience without WebGL.
 */
export function RoomView({ data, bottomInset }: { data: RoomData; bottomInset: number }) {
  const availability = useRoom((s) => s.availability);
  const selected = useRoom((s) => s.selected);
  const hovered = useRoom((s) => s.hovered);
  const select = useRoom((s) => s.select);
  const hover = useRoom((s) => s.hover);
  const reducedMotion = useRoom((s) => s.reducedMotion);
  const views = useMemo(() => guestPlanViews(data.venue, data.tables, availability), [data, availability]);

  return (
    <div className="relative size-full">
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
  );
}
