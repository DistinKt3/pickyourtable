"use client";

/**
 * Cloudflare Turnstile before a hold (PRD S-4). The widget runs invisibly and only
 * shows a challenge in `containerId` when Cloudflare asks for one. In `offline-test`
 * mode (machines that cannot reach Cloudflare) it returns Cloudflare's documented
 * dummy test token, which only the test secret accepts.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      execute: (el: HTMLElement | string) => void;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener(
      "error",
      () => {
        loading = null;
        reject(new Error("Turnstile failed to load"));
      },
      { once: true },
    );
    document.head.appendChild(s);
  });
  return loading;
}

export async function turnstileToken(siteKey: string, mode: "live" | "offline-test", containerId: string): Promise<string> {
  if (mode === "offline-test") return DUMMY_TOKEN;
  await loadScript();
  const el = document.getElementById(containerId);
  if (!el || !window.turnstile) throw new Error("Turnstile is unavailable");
  el.replaceChildren();
  return new Promise<string>((resolve, reject) => {
    const id = window.turnstile!.render(el, {
      sitekey: siteKey,
      execution: "execute",
      appearance: "interaction-only",
      callback: (token: string) => {
        resolve(token);
        setTimeout(() => window.turnstile?.remove(id), 0);
      },
      "error-callback": () => reject(new Error("Turnstile check failed")),
      "timeout-callback": () => reject(new Error("Turnstile timed out")),
    });
    window.turnstile!.execute(el);
  });
}
