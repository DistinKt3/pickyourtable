import "server-only";
import { esc } from "@/lib/email/index";
import { MAGIC_LINK_TTL_MINUTES } from "@/lib/auth/session";

/**
 * The operator sign-in email: the venue's name, one button, how long the link
 * lasts, and a plain-text part. Every value is escaped; no images or tracking.
 */

export interface SignInEmail {
  subject: string;
  html: string;
  text: string;
}

export function signInEmail(args: {
  venueName: string;
  operatorName: string;
  url: string;
  /** Venue accent for the button, from venue.json (validated hex). */
  accent?: string;
  onAccent?: string;
}): SignInEmail {
  const venue = esc(args.venueName);
  const accent = /^#[0-9a-fA-F]{6}$/.test(args.accent ?? "") ? args.accent! : "#1f5a63";
  const onAccent = /^#[0-9a-fA-F]{6}$/.test(args.onAccent ?? "") ? args.onAccent! : "#ffffff";
  const first = esc(args.operatorName.split(/\s+/)[0] ?? args.operatorName);
  const url = esc(args.url);
  const minutes = MAGIC_LINK_TTL_MINUTES;
  const subject = `Sign in to ${args.venueName}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f3ee;color:#1d1b18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fffdf9;border:1px solid #e3dcd1;border-radius:18px;">
<tr><td style="padding:36px 32px 8px;">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6459;">Venue portal</p>
<h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:30px;line-height:1.15;color:#1d1b18;">${venue}</h1>
</td></tr>
<tr><td style="padding:16px 32px 8px;font-size:16px;line-height:1.55;color:#4a453e;">
<p style="margin:0 0 16px;">Hi ${first}, use the button below to sign in to the ${venue} portal.</p>
</td></tr>
<tr><td style="padding:8px 32px 8px;">
<a href="${url}" style="display:inline-block;background:${accent};color:${onAccent};text-decoration:none;font-size:16px;font-weight:600;line-height:1;padding:16px 24px;border-radius:12px;">Sign in to ${venue}</a>
</td></tr>
<tr><td style="padding:20px 32px 32px;font-size:14px;line-height:1.55;color:#6b6459;">
<p style="margin:0 0 10px;">This link is valid for ${minutes} minutes and works once. If you did not ask to sign in, you can ignore this email; nobody can sign in without the link.</p>
<p style="margin:0;word-break:break-all;">If the button does not work, open this address: <a href="${url}" style="color:${accent};">${url}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Sign in to ${args.venueName}`,
    "",
    `Hi ${args.operatorName.split(/\s+/)[0] ?? args.operatorName}, open this link to sign in to the ${args.venueName} portal:`,
    "",
    args.url,
    "",
    `This link is valid for ${minutes} minutes and works once. If you did not ask to sign in, you can ignore this email; nobody can sign in without the link.`,
  ].join("\n");

  return { subject, html, text };
}
