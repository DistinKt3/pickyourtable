"use client";

import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { cx } from "@/lib/format";

/**
 * Spring-physics bottom sheet (vaul). Non-modal by default so the room stays live
 * behind it: tapping another table switches the card instead of closing it.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  modal = false,
  full = false,
  dismissible = true,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  modal?: boolean;
  full?: boolean;
  dismissible?: boolean;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} modal={modal} dismissible={dismissible} repositionInputs={false}>
      <Drawer.Portal>
        {modal ? <Drawer.Overlay className="fixed inset-0 z-40 bg-[var(--scrim)]" /> : null}
        <Drawer.Content
          onInteractOutside={(e) => {
            if (!modal) e.preventDefault();
          }}
          className={cx(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-xl flex-col rounded-t-sheet bg-surface-1 pb-[env(safe-area-inset-bottom)] shadow-sheet outline-none",
            full && "h-[94dvh]",
            className,
          )}
        >
          <div aria-hidden className="mx-auto mt-2.5 mb-1.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" />
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{description ?? title}</Drawer.Description>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
