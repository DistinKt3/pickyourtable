"use client";

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

/**
 * A non-modal bottom sheet for the table card. The room behind it stays live and
 * reachable: tapping another table switches the card, and assistive tech can still
 * reach every table. (vaul's modal={false} does not reach Radix, which then hides the
 * page from screen readers, so vaul is kept for the modal sheets only.)
 *
 * Drag the handle down to dismiss; it settles with the same easing curve vaul uses.
 */
export function CardSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLElement>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { y: e.clientY, t: performance.now() };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setDy(Math.max(0, e.clientY - start.current.y));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const moved = Math.max(0, e.clientY - start.current.y);
    const velocity = moved / Math.max(1, performance.now() - start.current.t);
    const height = sheet.current?.offsetHeight ?? 400;
    start.current = null;
    setDragging(false);
    setDy(0);
    if (moved > height * 0.25 || velocity > 0.6) onClose();
  };

  return (
    <section
      ref={sheet}
      aria-label={label}
      aria-hidden={!open}
      inert={!open}
      className={cx(
        "fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-sheet bg-surface-1 pb-[env(safe-area-inset-bottom)] shadow-sheet",
        !open && "pointer-events-none",
      )}
      style={{
        transform: open ? `translate3d(0, ${dy}px, 0)` : "translate3d(0, calc(100% + 32px), 0)",
        transition: dragging ? "none" : "transform 460ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-hidden
      >
        <span className="h-1.5 w-10 rounded-full bg-line-strong" />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:right-3 focus:z-10 focus:rounded-full focus:bg-surface-1 focus:px-3 focus:py-1.5"
      >
        Close
      </button>
      {children}
    </section>
  );
}
