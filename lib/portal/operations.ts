import "server-only";
import { OperationError } from "@/lib/booking/operations";
import { ApiError } from "@/lib/http/api";

/**
 * Reservation operations live in the booking service. Portal routes authenticate,
 * authorize and call them; an OperationError becomes the same status, code and
 * message on the wire.
 */
export async function callOperation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof OperationError) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
}
