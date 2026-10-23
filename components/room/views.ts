import type { TableAvailability } from "@/lib/api/contracts";
import { formatMoney } from "@/lib/format";
import { type RoomTable, tierOf, visualState } from "@/lib/room/types";
import type { Venue } from "@/lib/venue/schema";
import type { PlanTableView } from "./plan2d/plan2d";

/** How each table reads on the guest plan and list, from its live state. */

export function priceText(t: RoomTable, a: TableAvailability | undefined, hasSlot: boolean): string | null {
  if (!t.bookable) return null;
  if (hasSlot && a?.feeCents != null) return formatMoney(a.feeCents);
  if (!hasSlot && t.fromCents != null) return `from ${formatMoney(t.fromCents)}`;
  return null;
}

export function stateText(t: RoomTable, a: TableAvailability | undefined): string {
  const s = visualState(t, a);
  if (s === "taken") return "Taken";
  if (s === "wrong_size") return `Seats ${t.minParty === t.maxParty ? t.maxParty : `${t.minParty} to ${t.maxParty}`}`;
  if (s === "not_bookable") return "Seated by the host";
  return "Available";
}

export function tableAriaLabel(venue: Venue, t: RoomTable, a: TableAvailability | undefined, hasSlot: boolean): string {
  const tier = tierOf(venue, t.tier);
  const parts = [t.label, tier.name, `${t.seats} seats`];
  const s = visualState(t, a);
  if (s === "not_bookable") parts.push("not bookable online, seated by the host");
  else if (s === "taken") parts.push("taken at this time");
  else if (s === "wrong_size") parts.push(a?.reason ?? "not the right size for your party");
  else {
    parts.push(hasSlot ? "available" : "bookable");
    const price = priceText(t, a, hasSlot);
    if (price) parts.push(price);
  }
  return parts.join(", ");
}

export function guestPlanViews(
  venue: Venue,
  tables: RoomTable[],
  availability: Record<string, TableAvailability> | null,
): Record<string, PlanTableView> {
  const hasSlot = availability !== null;
  const out: Record<string, PlanTableView> = {};
  for (const t of tables) {
    const a = availability?.[t.id];
    const s = visualState(t, a);
    const price = priceText(t, a, hasSlot);
    const base = { label: t.label, short: t.id, ariaLabel: tableAriaLabel(venue, t, a, hasSlot) };
    switch (s) {
      case "available":
        out[t.id] = {
          ...base,
          ring: "solid",
          faded: false,
          muted: false,
          detail: price,
          shortDetail: hasSlot ? price : t.id,
          priority: 3,
        };
        break;
      case "taken":
        out[t.id] = { ...base, ring: "none", faded: true, muted: true, detail: "Taken", shortDetail: t.id, priority: 1 };
        break;
      case "wrong_size":
        out[t.id] = {
          ...base,
          ring: "hatched",
          faded: false,
          muted: true,
          detail: stateText(t, a),
          shortDetail: t.id,
          priority: 1,
        };
        break;
      case "not_bookable":
        out[t.id] = { ...base, ring: "none", faded: false, muted: true, detail: null, shortDetail: t.id, priority: 0 };
        break;
    }
  }
  return out;
}
