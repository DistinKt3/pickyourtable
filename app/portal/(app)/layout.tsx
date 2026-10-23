import { PortalShell } from "@/components/portal/shell";
import { portalPage, ROLE_LABEL } from "@/lib/portal/page";
import { accentStyle } from "@/lib/portal/venue";

export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const { op, venue } = await portalPage();
  return (
    <PortalShell
      venueName={venue.name}
      demo={venue.demo}
      operatorName={op.name}
      roleLabel={ROLE_LABEL[op.role]}
      isOwner={op.role === "owner"}
      accent={accentStyle(venue.brand)}
    >
      {children}
    </PortalShell>
  );
}
