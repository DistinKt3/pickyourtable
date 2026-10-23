import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/portal/sign-in/auth-card";
import { SignInForm } from "@/components/portal/sign-in/sign-in-form";
import { currentOperator } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (await currentOperator()) redirect("/portal/tonight");
  const notice = params.link === "expired" ? "link" : params.expired ? "expired" : null;
  const e = env();
  return (
    <AuthCard eyebrow="Venue portal" title="Sign in">
      <SignInForm notice={notice} devInbox={e.EMAIL_MODE === "dev" && e.NODE_ENV !== "production"} />
    </AuthCard>
  );
}
