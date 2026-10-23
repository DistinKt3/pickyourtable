/**
 * Seat view image URLs. A real photo (photoId) always wins over the build-time render
 * (PRD D-3), with no code change: set `photoId` in venue.json and run `pnpm venue:assets`.
 */

export const SEAT_VIEW_WIDTHS = [640, 1280] as const;
export const SEAT_VIEW_SIZE = { width: 1280, height: 853 } as const;

export interface SeatViewImage {
  kind: "photo" | "render";
  avif: string;
  webp: string;
  /** Default `src` for browsers without srcset support. */
  fallback: string;
  /** JPEG used in emails, which rarely support AVIF or WebP. */
  email: string;
  width: number;
  height: number;
}

export function seatViewImage(venueId: string, table: { id: string; photoId: string | null }): SeatViewImage {
  const kind = table.photoId ? "photo" : "render";
  const base = table.photoId ? `/venues/${venueId}/photos/${table.photoId}` : `/venues/${venueId}/renders/${table.id}`;
  const set = (ext: string) => SEAT_VIEW_WIDTHS.map((w) => `${base}-${w}.${ext} ${w}w`).join(", ");
  return {
    kind,
    avif: set("avif"),
    webp: set("webp"),
    fallback: `${base}-1280.webp`,
    email: `${base}-email.jpg`,
    width: SEAT_VIEW_SIZE.width,
    height: SEAT_VIEW_SIZE.height,
  };
}
