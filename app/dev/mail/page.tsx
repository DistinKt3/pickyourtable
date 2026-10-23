import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/primitives";
import { db } from "@/db/client";
import { emailMessage, reservation } from "@/db/schema";
import { currentOperator } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { cx } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dev inbox" };

/**
 * Every email the app has stored (EMAIL_MODE=dev), newest first. Open in development;
 * on a deployed demo with the dev mail store, only to a signed-in operator, who sees
 * their own venue's mail. Message HTML renders in a sandboxed frame with no scripts.
 */

interface Attachment {
  name: string;
  contentType: string;
  content: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function access(): Promise<{ venueId: string | null; email: string | null }> {
  const e = env();
  if (e.NODE_ENV === "development") return { venueId: null, email: null };
  if (e.EMAIL_MODE !== "dev") notFound();
  const op = await currentOperator();
  if (!op) notFound();
  return { venueId: op.venueId, email: op.email };
}

function sentAt(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sizeLabel(base64: string): string {
  const bytes = Math.floor((base64.length * 3) / 4);
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default async function DevMail({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const scope = await access();
  const { id } = await searchParams;

  const visible = scope.venueId
    ? or(
        eq(emailMessage.to, scope.email!),
        inArray(
          emailMessage.reservationId,
          db().select({ id: reservation.id }).from(reservation).where(eq(reservation.venueId, scope.venueId)),
        ),
      )
    : sql`true`;
  const messages = await db()
    .select({
      id: emailMessage.id,
      to: emailMessage.to,
      subject: emailMessage.subject,
      tag: emailMessage.tag,
      createdAt: emailMessage.createdAt,
    })
    .from(emailMessage)
    .where(visible)
    .orderBy(desc(emailMessage.createdAt))
    .limit(100);

  const selectedId = id && UUID.test(id) && messages.some((m) => m.id === id) ? id : messages[0]?.id;
  const [selected] = selectedId ? await db().select().from(emailMessage).where(eq(emailMessage.id, selectedId)) : [];
  const attachments = (selected?.attachments ?? []) as Attachment[];

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium tracking-[0.08em] text-ink-3 uppercase">Development</p>
          <h1 className="font-display text-display-l">Dev inbox</h1>
        </div>
        <p className="text-[0.9375rem] text-ink-3 tabular">
          {messages.length === 1 ? "1 message" : `${messages.length} messages`}, newest first
        </p>
      </header>

      {messages.length === 0 ? (
        <section className="rounded-card bg-surface-1 px-6 py-12 text-center hairline">
          <h2 className="font-display text-display-m">No emails yet</h2>
          <p className="mt-2 text-ink-2">Book a table and its confirmation appears here.</p>
        </section>
      ) : (
        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
          <nav aria-label="Messages" className="flex max-h-[80dvh] flex-col gap-2 overflow-y-auto pr-1">
            {messages.map((m) => {
              const active = m.id === selectedId;
              return (
                <Link
                  key={m.id}
                  href={`/dev/mail?id=${m.id}`}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "flex flex-col gap-1.5 rounded-card px-4 py-3 transition-colors duration-150",
                    active
                      ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent-base)]"
                      : "bg-surface-1 hairline hover:bg-surface-2",
                  )}
                >
                  <span className="line-clamp-2 text-[0.9375rem] font-medium text-ink">{m.subject}</span>
                  <span className="flex items-center justify-between gap-2 text-sm text-ink-3">
                    <span className="truncate">{m.to}</span>
                    <span className="shrink-0 tabular">{sentAt(m.createdAt)}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          {selected ? (
            <article className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-card bg-surface-1 px-5 py-4 hairline">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-semibold text-ink">{selected.subject}</h2>
                  <Badge>{selected.tag}</Badge>
                </div>
                <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-[0.9375rem]">
                  <dt className="text-ink-3">To</dt>
                  <dd className="min-w-0 truncate text-ink">{selected.to}</dd>
                  <dt className="text-ink-3">Sent</dt>
                  <dd className="text-ink tabular">{sentAt(selected.createdAt)}</dd>
                  <dt className="text-ink-3">Attachments</dt>
                  <dd className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
                    {attachments.length === 0 ? (
                      <span className="text-ink-3">None</span>
                    ) : (
                      attachments.map((a) => (
                        <a
                          key={a.name}
                          download={a.name}
                          href={`data:${a.contentType.split(";")[0]};base64,${a.content}`}
                          className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-current"
                        >
                          {a.name} <span className="whitespace-nowrap text-ink-3 tabular">({sizeLabel(a.content)})</span>
                        </a>
                      ))
                    )}
                  </dd>
                </dl>
              </div>
              {selected.html ? (
                <iframe
                  title={`Email: ${selected.subject}`}
                  sandbox=""
                  srcDoc={selected.html}
                  className="h-[70dvh] w-full rounded-card bg-white hairline"
                />
              ) : (
                <p className="rounded-card bg-surface-1 px-5 py-4 text-ink-2 hairline">
                  This message was sent through the email provider, so only its envelope is stored.
                </p>
              )}
              {selected.text ? (
                <details className="rounded-card bg-surface-1 px-5 py-3 hairline">
                  <summary className="cursor-pointer text-[0.9375rem] font-medium text-ink">Plain-text version</summary>
                  <pre className="mt-3 overflow-x-auto font-sans text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-ink-2">
                    {selected.text}
                  </pre>
                </details>
              ) : null}
            </article>
          ) : null}
        </div>
      )}
    </main>
  );
}
