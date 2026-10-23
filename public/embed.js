/*!
 * "Choose your table" button for a venue's own website (PRD G-12).
 *
 *   <script src="https://YOUR-APP/embed.js" data-venue="halcyon" async></script>
 *
 * Optional: data-label (button text), data-accent (#RRGGBB), data-target (a CSS
 * selector for where to place the button). The widget opens full screen in an
 * iframe on our origin with allow="payment" for Apple Pay and Google Pay. The
 * venue's origin must be listed in EMBED_ALLOWED_ORIGINS.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var venue = script.getAttribute("data-venue") || "";
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(venue)) return;
  var origin = new URL(script.src, window.location.href).origin;
  var label = script.getAttribute("data-label") || "Choose your table";
  var accentAttr = script.getAttribute("data-accent") || "";
  var accent = /^#[0-9a-fA-F]{6}$/.test(accentAttr) ? accentAttr : "#1F5A63";
  var targetSelector = script.getAttribute("data-target");

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("data-pyt-embed", venue);
  button.setAttribute("aria-haspopup", "dialog");
  var b = button.style;
  b.font = "500 16px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  b.color = "#fff";
  b.background = accent;
  b.border = "0";
  b.borderRadius = "999px";
  b.padding = "14px 24px";
  b.minHeight = "48px";
  b.cursor = "pointer";
  b.boxShadow = "0 1px 2px rgba(0,0,0,.12), 0 6px 20px rgba(0,0,0,.12)";
  // With async or defer the script may run before the target exists, or from <head>:
  // place the button once the document is parsed, and never inside <head>.
  function place() {
    var target = targetSelector ? document.querySelector(targetSelector) : null;
    if (target) target.appendChild(button);
    else if (script.parentNode && script.parentNode !== document.head) script.insertAdjacentElement("afterend", button);
    else if (document.body) document.body.appendChild(button);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
  else place();

  var overlay = null;
  var lastFocus = null;
  var previousOverflow = "";

  function onMessage(e) {
    if (e.origin === origin && e.data && e.data.type === "pyt:close") close();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.documentElement.style.overflow = previousOverflow;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function open() {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", label);
    var o = overlay.style;
    o.position = "fixed";
    o.inset = "0";
    o.zIndex = "2147483000";
    o.background = "#f6f3ee";
    var frame = document.createElement("iframe");
    frame.src = origin + "/v/" + venue + "?embed=1&parent=" + encodeURIComponent(window.location.origin);
    frame.title = label;
    frame.setAttribute("allow", "payment");
    var f = frame.style;
    f.width = "100%";
    f.height = "100%";
    f.border = "0";
    f.display = "block";
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey);
    frame.focus();
  }
  button.addEventListener("click", open);
})();
