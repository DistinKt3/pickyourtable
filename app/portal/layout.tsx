import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { template: "%s · Venue portal", default: "Venue portal" },
  robots: { index: false, follow: false },
};

export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return children;
}
