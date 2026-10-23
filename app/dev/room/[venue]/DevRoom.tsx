"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { REVIEW_SLOT, reviewAvailability } from "@/components/room/scene3d/roomData";
import { useRoom } from "@/lib/room/store";
import type { RoomData } from "@/lib/room/types";

const RoomScene3D = dynamic(() => import("@/components/room/scene3d"), { ssr: false });

export interface DevRoomFlags {
  taken: string[];
  wrong: string[];
  selected: string | null;
  sit: string | null;
  reduced: boolean;
  slot: boolean;
}

function applyFlags(data: RoomData, f: DevRoomFlags) {
  const s = useRoom.getState();
  s.setReducedMotion(f.reduced);
  if (f.slot || f.taken.length || f.wrong.length) {
    s.setSlot({ ...REVIEW_SLOT });
    s.setAvailability(reviewAvailability(data, { taken: f.taken, wrong: f.wrong }));
  } else {
    s.setSlot(null);
  }
  if (f.sit) s.sit(f.sit);
  else if (f.selected) s.select(f.selected);
  else s.select(null);
}

/** Mounts the scene the way the lead does: client-only, full screen, store-driven. */
export function DevRoom({ data, flags }: { data: RoomData; flags: DevRoomFlags }) {
  const [ready, setReady] = useState(false);
  useState(() => {
    applyFlags(data, flags);
    return true;
  });
  return (
    <main className="fixed inset-0 bg-surface-0" data-ready={ready ? "true" : "false"}>
      <h1 className="sr-only">{data.venue.name}: 3D room review</h1>
      <RoomScene3D data={data} onReady={() => setReady(true)} />
    </main>
  );
}
