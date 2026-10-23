import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/portal/sign-in/auth-card";
import { RedeemForm } from "@/components/portal/sign-in/redeem-form";
import { inspectSignInLink } from "@/lib/portal/auth";
import { accentStyle } from "@/lib/portal/venue";
import { loadVenue } from "@/lib/venue/load";

export const dynamic = "force-dynamic";

/** The link from the sign-in email. Opening it never signs in; only the button does (a POST). */
export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" };

const PROBLEMS = {
  expired: {
    title: "This link has expired",
    body: "Sign-in links work for 15 minutes. Ask for a new one and use it right away.",
  },
  used: {
    title: "This link was already used",
    body: "Each sign-in link works once. Ask for a new one to sign in on this device.",
  },
  invalid: {
    title: "This link doesn't work",
    body: "It may be cut short. Open the whole link from the email, or ask for a new one.",
  },
} as const;

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : undefined;
  const link = await inspectSignInLink(token);
  const brand = link.venueId ? (await loadVenue(link.venueId).catch(() => null))?.brand : null;
  const accent = brand ? accentStyle(brand) : undefined;

  if (link.state === "valid") {
    return (
      <AuthCard eyebrow="Venue portal" title={link.venueName} accent={accent}>
        <p className="mb-6 text-base text-ink-2">
          Signing in as <span className="font-medium break-all text-ink">{link.email}</span>.
        </p>
        <RedeemForm token={token!} venueName={link.venueName} />
      </AuthCard>
    );
  }

  const problem = PROBLEMS[link.state];
  return (
    <AuthCard eyebrow={link.venueName ?? "Venue portal"} title={problem.title} accent={accent}>
      <p className="text-base text-ink-2">{problem.body}</p>
      <Link
        href="/portal/sign-in"
        className="mt-6 inline-flex min-h-[3.25rem] w-full items-center justify-center rounded-control bg-accent px-5 text-[1.0625rem] font-medium text-on-accent transition-[filter] hover:brightness-[1.06]"
      >
        Get a new link
      </Link>
    </AuthCard>
  );
}
