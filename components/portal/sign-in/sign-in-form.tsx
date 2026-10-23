"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Banner } from "@/components/ui/primitives";
import { PortalError, portalFetch } from "@/lib/portal/client";

/**
 * Asks for a sign-in link. The answer never says whether the address has an
 * account, so the confirmation is worded for both cases.
 */
export function SignInForm({ notice, devInbox }: { notice: "expired" | "link" | null; devInbox: boolean }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Enter the email address you use for the venue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await portalFetch("/api/portal/auth/request", { method: "POST", body: { email: value } });
      setSentTo(value);
    } catch (err) {
      setError(err instanceof PortalError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div aria-live="polite">
        <div className="flex items-start gap-3 rounded-card bg-surface-2 px-4 py-4">
          <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
          <div className="text-base text-ink-2">
            <p className="font-semibold text-ink">Check your email</p>
            <p className="mt-1">
              If <span className="font-medium break-all text-ink">{sentTo}</span> has a venue account, a sign-in link is on its
              way. It works once and is valid for 15 minutes.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="-ml-3" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
          {devInbox ? (
            <Link
              href="/dev/mail"
              className="text-[0.9375rem] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink"
            >
              Open the dev inbox
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {notice === "expired" ? <Banner tone="neutral">Your session ended. Sign in again to carry on.</Banner> : null}
      {notice === "link" ? (
        <Banner tone="warning">That sign-in link has expired or was already used. Ask for a new one below.</Banner>
      ) : null}
      <p className="text-base text-ink-2">We&rsquo;ll email you a link to sign in. There is no password to remember.</p>
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={error}
        required
      />
      <Button type="submit" size="lg" block loading={busy}>
        Email me a sign-in link
      </Button>
    </form>
  );
}
