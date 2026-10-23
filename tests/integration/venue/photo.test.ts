import { afterAll, describe, expect, it } from "vitest";
import { seedVenue } from "@/db/seed";
import { loadBookingVenue } from "@/lib/booking/context";
import { loadRoomData } from "@/lib/room/load";
import { loadVenue } from "@/lib/venue/load";
import { seatViewImage } from "@/lib/venue/media";

/**
 * PRD D-3: adding a photo id to a table in venue.json swaps its seat view everywhere
 * (the room, the confirmation email, the venue review) with no code change.
 */
describe("a real photo replaces a render (D-3)", () => {
  afterAll(async () => {
    await seedVenue(await loadVenue("halcyon"), { reset: false });
  });

  it("uses the render until a photo id is set, then the photo, in the room and in email", async () => {
    const venue = await loadVenue("halcyon");
    const before = (await loadRoomData("halcyon")).data.tables.find((t) => t.id === "W1")!;
    expect(before.image).toMatchObject({ kind: "render", fallback: "/venues/halcyon/renders/W1-1280.webp" });

    // The only change: photoId in the venue's data, then the usual seed.
    const withPhoto = structuredClone(venue);
    withPhoto.tables.find((t) => t.id === "W1")!.photoId = "w1-dusk";
    await seedVenue(withPhoto, { reset: false });

    const after = (await loadRoomData("halcyon")).data.tables.find((t) => t.id === "W1")!;
    expect(after.image).toMatchObject({
      kind: "photo",
      fallback: "/venues/halcyon/photos/w1-dusk-1280.webp",
      email: "/venues/halcyon/photos/w1-dusk-email.jpg",
    });
    expect(after.image!.avif).toBe(
      "/venues/halcyon/photos/w1-dusk-640.avif 640w, /venues/halcyon/photos/w1-dusk-1280.avif 1280w",
    );
    const bv = await loadBookingVenue("halcyon");
    const table = bv!.byCode.get("W1")!;
    expect(seatViewImage("halcyon", { id: table.code, photoId: table.photoId }).email).toBe(
      "/venues/halcyon/photos/w1-dusk-email.jpg",
    );
    // Other tables keep their renders.
    expect((await loadRoomData("halcyon")).data.tables.find((t) => t.id === "W2")!.image!.kind).toBe("render");
  });
});
