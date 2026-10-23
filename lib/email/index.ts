import "server-only";
import { ServerClient } from "postmark";
import { db } from "@/db/client";
import { emailMessage } from "@/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Email adapter (PRD: email only, through Postmark; a dev inbox in development).
 * `dev` stores the full message for the /dev/mail page. `postmark` sends it and keeps
 * only the envelope, so guest data is not copied twice.
 */

export interface EmailAttachment {
  name: string;
  contentType: string;
  /** Base64 content. */
  content: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short category, such as "booking-confirmed". */
  tag: string;
  reservationId?: string | null;
  attachments?: EmailAttachment[];
}

let client: ServerClient | null = null;

export async function sendEmail(msg: OutgoingEmail): Promise<{ id: string; provider: "dev" | "postmark" }> {
  const e = env();
  if (e.EMAIL_MODE === "postmark") {
    client ??= new ServerClient(e.POSTMARK_SERVER_TOKEN!);
    const res = await client.sendEmail({
      From: e.EMAIL_FROM,
      To: msg.to,
      Subject: msg.subject,
      HtmlBody: msg.html,
      TextBody: msg.text,
      Tag: msg.tag,
      MessageStream: "outbound",
      Attachments: (msg.attachments ?? []).map((a) => ({
        Name: a.name,
        Content: a.content,
        ContentType: a.contentType,
        ContentID: null,
      })),
    });
    const [row] = await db()
      .insert(emailMessage)
      .values({
        to: msg.to,
        subject: msg.subject,
        html: "",
        text: "",
        tag: msg.tag,
        reservationId: msg.reservationId ?? null,
        provider: "postmark",
        providerMessageId: res.MessageID,
      })
      .returning({ id: emailMessage.id });
    log.info("email.sent", {
      provider: "postmark",
      tag: msg.tag,
      to: msg.to,
      reservationId: msg.reservationId,
      messageId: res.MessageID,
    });
    return { id: row!.id, provider: "postmark" };
  }

  const [row] = await db()
    .insert(emailMessage)
    .values({
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments ?? [],
      tag: msg.tag,
      reservationId: msg.reservationId ?? null,
      provider: "dev",
    })
    .returning({ id: emailMessage.id });
  log.info("email.sent", { provider: "dev", tag: msg.tag, to: msg.to, reservationId: msg.reservationId, messageId: row!.id });
  return { id: row!.id, provider: "dev" };
}

/** HTML-escape for email templates. */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
