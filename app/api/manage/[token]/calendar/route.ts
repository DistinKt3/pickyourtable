import { tokenParams } from "@/lib/api/contracts";
import { limitManage } from "@/lib/booking/http";
import { calendarForToken } from "@/lib/booking/manage";
import { api } from "@/lib/http/api";

/** GET /api/manage/{token}/calendar: the booking as an .ics file. */
export const GET = api({ guest: true, params: tokenParams }, async ({ req, params }) => {
  await limitManage(req);
  const { body, filename } = await calendarForToken(params.token);
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
