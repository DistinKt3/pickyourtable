"use client";

import { useEffect, useState } from "react";
import { cx, formatCountdown } from "@/lib/format";
import type { SeatViewImage as SeatViewImageData } from "@/lib/venue/media";
import { serverNow } from "./api";
import { useNow } from "./hooks";

/**
 * The view from the seat: the emotional center of the product. AVIF first, WebP
 * next, 3:2 like the photo standard, labeled "Preview render" until a real photo
 * replaces it (PRD D-3).
 */
export function SeatViewImage({
  image,
  alt,
  sizes = "(min-width: 1024px) 420px, 100vw",
  priority = false,
  className,
  showTag = true,
  fit = false,
}: {
  image: SeatViewImageData;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  showTag?: boolean;
  /** Fit inside the viewport (full-screen view) instead of filling the width. */
  fit?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cx(
        "relative aspect-[3/2] overflow-hidden bg-surface-2",
        fit ? "w-[min(100vw,calc((100dvh-5.5rem)*1.5))]" : "w-full",
        className,
      )}
    >
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,var(--surface-2),var(--surface-3))]">
          {showTag ? (
            <p className="px-6 text-center text-[0.9375rem] text-ink-3">The view from this seat is on its way.</p>
          ) : null}
        </div>
      ) : (
        <picture>
          <source type="image/avif" srcSet={image.avif} sizes={sizes} />
          <source type="image/webp" srcSet={image.webp} sizes={sizes} />
          <img
            src={image.fallback}
            alt={alt}
            width={image.width}
            height={image.height}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
      )}
      {showTag && image.kind === "render" ? (
        <span className="absolute top-3 left-3 inline-flex h-6 items-center rounded-full bg-black/65 px-2.5 text-[0.75rem] font-medium tracking-[0.02em] text-white backdrop-blur-[6px]">
          Preview render
        </span>
      ) : null}
    </div>
  );
}

export function TierDot({ color, colorDark, className }: { color: string; colorDark: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-2.5 shrink-0 rounded-full bg-[var(--tl)] dark:bg-[var(--td)]", className)}
      style={{ "--tl": color, "--td": colorDark } as React.CSSProperties}
    />
  );
}

/** The one visible hold countdown (PRD: 8 minutes, one visible countdown). */
export function HoldTimer({ expiresAt, onExpire, className }: { expiresAt: string; onExpire?: () => void; className?: string }) {
  useNow(1000);
  const left = Date.parse(expiresAt) - serverNow();
  const urgent = left < 60_000;
  const expired = left <= 0;
  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);
  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={`Table held for ${formatCountdown(left)}`}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.9375rem] font-medium tabular",
        urgent ? "bg-warning-surface text-warning" : "bg-accent-soft text-accent",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-4">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Held for {formatCountdown(left)}
    </span>
  );
}
