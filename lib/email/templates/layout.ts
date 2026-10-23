import { esc } from "@/lib/email/index";

/**
 * Shared shell for every email: table-based HTML with inline styles (what mail clients
 * render reliably), plus a plain-text part. The guest sees the venue's name and accent
 * color only. Every interpolated value is escaped here or by the caller with `esc`.
 */

export interface EmailVenue {
  id: string;
  name: string;
  accent: string;
  onAccent: string;
  demo: boolean;
  address: string;
  phone: string;
  email: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";
const INK = "#1d1b18";
const INK_2 = "#4a453e";
const INK_3 = "#6b6459";
const LINE = "#e3dcd1";

/** A heading in the body. */
export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-family:${SERIF};font-size:28px;line-height:1.15;font-weight:400;color:${INK};">${esc(text)}</h1>`;
}

/** A paragraph; `html` must already be escaped. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.5;color:${INK_2};">${html}</p>`;
}

/** Label and value rows, such as Table, Date and Time. Values are escaped here. */
export function details(rows: [string, string][]): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:15px;color:${INK_3};width:38%;vertical-align:top;">${esc(label)}</td>` +
        `<td style="padding:10px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:16px;color:${INK};font-variant-numeric:tabular-nums;vertical-align:top;">${esc(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-top:1px solid ${LINE};">${body}</table>`;
}

/** A button-styled link in the venue's accent color. */
export function button(v: EmailVenue, href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr>` +
    `<td style="border-radius:12px;background:${esc(v.accent)};">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 22px;font-family:${SANS};font-size:16px;font-weight:600;color:${esc(v.onAccent)};text-decoration:none;border-radius:12px;">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

export function layout(
  v: EmailVenue,
  opts: { subject: string; preheader: string; body: string; image?: { src: string; alt: string } | null },
): string {
  const image = opts.image
    ? `<tr><td style="padding:0;line-height:0;"><img src="${esc(opts.image.src)}" width="600" height="400" alt="${esc(opts.image.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
    : "";
  const demo = v.demo
    ? `<p style="margin:12px 0 0;font-family:${SANS};font-size:13px;color:${INK_3};">Demo venue. No real table or payment is involved.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f3ee;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fffdf9;border:1px solid ${LINE};border-radius:18px;overflow:hidden;">
<tr><td style="background:${esc(v.accent)};padding:22px 28px;font-family:${SERIF};font-size:26px;line-height:1.1;color:${esc(v.onAccent)};">${esc(v.name)}</td></tr>
${image}
<tr><td style="padding:28px 28px 12px;">${opts.body}</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid ${LINE};">
<p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.5;color:${INK_3};">${esc(v.name)} &middot; ${esc(v.address)} &middot; ${esc(v.phone)}</p>
${demo}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text part: paragraphs separated by blank lines, then the footer. */
export function textPart(v: EmailVenue, blocks: string[]): string {
  const footer = [
    `${v.name}, ${v.address}, ${v.phone}`,
    ...(v.demo ? ["Demo venue. No real table or payment is involved."] : []),
  ];
  return [...blocks, "--", ...footer].join("\n\n") + "\n";
}

/** "Table: Window 1" lines for the plain-text part. */
export function textDetails(rows: [string, string][]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}
