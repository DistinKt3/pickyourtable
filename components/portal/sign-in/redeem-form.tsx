"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/primitives";
import { PortalError, portalFetch } from "@/lib/portal/client";

/**
 * The one button that uses a sign-in link. It is a real form POST, so it works
 * without scripts; with scripts it stays on the page to explain a failure.
 */
export function RedeemForm({ token, venueName }: { token: string; venueName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await portalFetch<{ ok: true; next: string }>("/api/portal/auth/redeem", { method: "POST", body: { token } });
      window.location.replace(res.next);
    } catch (err) {
      setBusy(false);
      setError(err instanceof PortalError ? err.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <form method="post" action="/api/portal/auth/redeem" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {error ? (
        <Banner tone="warning" title="This link can't sign you in">
          {error}{" "}
          <Link href="/portal/sign-in" className="font-medium underline underline-offset-4">
            Get a new link
          </Link>
        </Banner>
      ) : null}
      <Button type="submit" size="lg" block loading={busy} disabled={Boolean(error)}>
        Sign in to {venueName}
      </Button>
    </form>
  );
}
