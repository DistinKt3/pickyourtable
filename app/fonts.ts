import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";

/** Display serif for venue and table names (PRD typography). Self-hosted, OFL-1.1. */
export const instrumentSerif = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
      style: "normal",
      weight: "400",
    },
    {
      path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
      style: "italic",
      weight: "400",
    },
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["Iowan Old Style", "Georgia", "serif"],
});

/** Interface sans (PRD typography). Self-hosted, OFL-1.1. */
export const geistSans = GeistSans;
