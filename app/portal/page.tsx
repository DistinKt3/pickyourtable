import { redirect } from "next/navigation";
import { currentOperator } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** /portal: Tonight when signed in, otherwise sign-in. */
export default async function PortalIndex() {
  redirect((await currentOperator()) ? "/portal/tonight" : "/portal/sign-in");
}
