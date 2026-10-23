"use client";

import dynamic from "next/dynamic";
import type { RoomData } from "@/lib/room/types";

const SeatRender = dynamic(() => import("@/components/room/scene3d/render"), { ssr: false });

export function SeatRenderClient({ data, code }: { data: RoomData; code: string }) {
  return (
    <main className="fixed inset-0">
      <h1 className="sr-only">{`${data.venue.name}, view from ${data.tables.find((t) => t.id === code)?.label ?? code}`}</h1>
      <SeatRender data={data} code={code} />
    </main>
  );
}
