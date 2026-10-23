import type { PortalReservation } from "@/lib/api/contracts";
import { formatDateLong, formatMoney, formatTime, occasionLabel } from "@/lib/format";

/**
 * The printable run sheet: a clean black-on-white table of the date's bookings.
 * Hidden on screen; printing hides everything else (see the print rules in the
 * Tonight screen and the portal shell).
 */

const STATUS: Record<string, string> = {
  confirmed: "",
  seated: "Seated",
  no_show: "No-show",
  cancelled: "Cancelled",
  held: "Held",
  expired: "Expired",
};

export function RunSheet({
  venueName,
  date,
  rows,
  printedAt,
  labels,
}: {
  venueName: string;
  date: string;
  rows: PortalReservation[];
  printedAt: string;
  /** Table code to label, for guests seated somewhere else. */
  labels: Record<string, string>;
}) {
  const live = rows.filter((r) => r.status !== "cancelled" && r.status !== "expired" && r.status !== "held");
  const covers = live.reduce((n, r) => n + r.partySize, 0);
  return (
    <section aria-hidden className="run-sheet hidden text-black print:block">
      <style>{"@page { margin: 14mm 12mm; }"}</style>
      <header className="mb-4 flex items-end justify-between border-b-2 border-black pb-2">
        <div>
          <p className="font-display text-[22pt] leading-none">{venueName}</p>
          <p className="mt-1 text-[11pt]">Run sheet · {formatDateLong(date)}</p>
        </div>
        <p className="text-right text-[9pt] tabular">
          {live.length} paid tables · {covers} guests
          <br />
          Printed {printedAt}
        </p>
      </header>
      <table className="w-full border-collapse text-left text-[10pt] tabular">
        <thead>
          <tr className="border-b border-black">
            {["Time", "Table", "Guest", "Party", "Occasion", "Note", "Fee", "Status", "Done"].map((h) => (
              <th key={h} className="py-1.5 pr-3 align-bottom font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="break-inside-avoid border-b border-[#bbb] align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">{formatTime(r.slot.time)}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {r.tableLabel}
                {r.seatedTable && r.seatedTable !== r.table ? `, seated at ${labels[r.seatedTable] ?? r.seatedTable}` : ""}
              </td>
              <td className="py-1.5 pr-3">{r.guestName}</td>
              <td className="py-1.5 pr-3">{r.partySize}</td>
              <td className="py-1.5 pr-3">{occasionLabel(r.occasion) ?? ""}</td>
              <td className="py-1.5 pr-3">{r.note ?? ""}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {r.status === "cancelled" ? `Refunded ${formatMoney(r.refundCents)}` : `Paid ${formatMoney(r.priceCents)}`}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{STATUS[r.status] ?? r.status}</td>
              <td className="py-1.5">
                <span aria-hidden className="inline-block size-3.5 border border-black">
                  {"\u00a0"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="mt-6 text-[11pt]">No paid bookings for this date.</p> : null}
    </section>
  );
}
