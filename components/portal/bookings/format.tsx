import type { PortalReservation } from "@/lib/api/contracts";
import { cx } from "@/lib/format";

/** Shared wording for bookings: status names and how a card reads. */

export const STATUS_LABEL: Record<PortalReservation["status"], string> = {
  held: "Held",
  confirmed: "Confirmed",
  seated: "Seated",
  no_show: "No-show",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const STATUS_TONE: Record<PortalReservation["status"], "accent" | "success" | "warning" | "neutral" | "danger"> = {
  held: "neutral",
  confirmed: "accent",
  seated: "success",
  no_show: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

export function cardText(brand: string | null, last4: string | null): string {
  if (!brand && !last4) return "No card on file";
  const name = brand ? (BRANDS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)) : "Card";
  return last4 ? `${name} ${last4}` : name;
}

const DOT: Record<PortalReservation["status"], string> = {
  held: "bg-ink-3",
  confirmed: "bg-accent",
  seated: "bg-success",
  no_show: "bg-warning",
  cancelled: "bg-line-strong",
  expired: "bg-line-strong",
};

/** A quiet status for long lists: a colored dot and the word, so the PAID-style badges stay rare. */
export function StatusDot({ status }: { status: PortalReservation["status"] }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 text-[0.9375rem] whitespace-nowrap",
        status === "cancelled" ? "text-ink-3" : "text-ink-2",
      )}
    >
      <span aria-hidden className={cx("size-2 rounded-full", DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
