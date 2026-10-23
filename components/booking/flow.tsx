"use client";

import { ArrowLeft, CalendarPlus, Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextField } from "@/components/ui/field";
import { Banner } from "@/components/ui/primitives";
import { type GuestDetails, guestDetails, type HoldView } from "@/lib/api/contracts";
import { formatCountdown, formatDate, formatMoney, formatTime, occasionOptions, partyLabel } from "@/lib/format";
import type { RoomData } from "@/lib/room/types";
import { ApiFailure, api, serverNow } from "./api";
import { useBooking } from "./booking-store";
import { useNow, useOnline } from "./hooks";
import { HoldTimer, SeatViewImage } from "./parts";
import { SimPay } from "./sim-pay";

const StripePay = dynamic(() => import("./stripe-pay").then((m) => m.StripePay), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse rounded-card bg-surface-2" aria-busy />,
});

/** Hold, details and payment (PRD guest step 6), confirmation (step 7). */
export function Flow({ data, onClose, onRehold }: { data: RoomData; onClose: () => void; onRehold: () => void }) {
  const step = useBooking((s) => s.step);
  if (step === "details") return <DetailsStep data={data} onClose={onClose} />;
  if (step === "pay") return <PayStep data={data} />;
  if (step === "confirmed") return <ConfirmedStep data={data} onClose={onClose} />;
  if (step === "expired") return <ExpiredStep data={data} onClose={onClose} onRehold={onRehold} />;
  return null;
}

function useHoldTable(data: RoomData) {
  const hold = useBooking((s) => s.hold);
  return { hold, table: hold ? data.tables.find((t) => t.id === hold.table) : undefined };
}

function HoldSummary({ data, hold, timer = true }: { data: RoomData; hold: HoldView; timer?: boolean }) {
  const table = data.tables.find((t) => t.id === hold.table);
  const expire = useBooking((s) => s.expire);
  const online = useOnline();
  const onExpire = useCallback(() => expire(), [expire]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        {table?.image ? (
          <div className="w-24 shrink-0 overflow-hidden rounded-[12px]">
            <SeatViewImage image={table.image} alt="" sizes="96px" showTag={false} />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="font-display text-[1.5rem] leading-tight">{hold.tableLabel}</p>
          <p className="text-[0.9375rem] text-ink-2 tabular">
            {formatDate(hold.slot.date)} · {formatTime(hold.slot.time)} · {partyLabel(hold.partySize)}
          </p>
        </div>
      </div>
      {timer ? (
        <div className="flex items-center justify-between gap-3">
          <HoldTimer expiresAt={hold.expiresAt} onExpire={onExpire} />
          <p className="text-[0.9375rem] font-semibold tabular">{formatMoney(hold.priceCents)}</p>
        </div>
      ) : null}
      {!online ? <OfflineBanner hold={hold} /> : null}
    </div>
  );
}

function OfflineBanner({ hold }: { hold: HoldView }) {
  return (
    <Banner
      tone="warning"
      title="You're offline"
      action={
        <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
          Retry
        </Button>
      }
    >
      Your hold is safe for <HoldTimeLeft expiresAt={hold.expiresAt} />.
    </Banner>
  );
}

function HoldTimeLeft({ expiresAt }: { expiresAt: string }) {
  useNow(1000);
  return <span className="tabular">{formatCountdown(Date.parse(expiresAt) - serverNow())}</span>;
}

function StepHeader({ title, onBack, backLabel }: { title: string; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-1 pb-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel ?? "Back"}
          className="-ml-2 inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </button>
      ) : null}
      <h2 className="font-display text-display-m">{title}</h2>
    </div>
  );
}

const POLICY = (hours: number) =>
  `Full refund if you cancel ${hours} hours or more before your booking. No refund after that or for no-shows. The table fee is separate from your bill.`;

function DetailsStep({ data, onClose }: { data: RoomData; onClose: () => void }) {
  const { hold } = useHoldTable(data);
  const token = useBooking((s) => s.holdToken);
  const saved = useBooking((s) => s.guest);
  const setGuest = useBooking((s) => s.setGuest);
  const setPayment = useBooking((s) => s.setPayment);
  const expire = useBooking((s) => s.expire);
  const [values, setValues] = useState({
    name: saved?.name ?? "",
    email: saved?.email ?? "",
    mobile: saved?.mobile ?? "",
    occasion: saved?.occasion ?? "",
    note: saved?.note ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  if (!hold || !token) return null;

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = guestDetails.safeParse({
      ...values,
      occasion: values.occasion || null,
      note: values.note.trim() || null,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    setFailure(null);
    try {
      const guest: GuestDetails = parsed.data;
      const res = await api.checkout(hold.id, token, guest);
      setGuest(guest);
      setPayment(res.payment);
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === "hold_expired" || err.code === "hold_not_active")) expire();
      else setFailure(err instanceof ApiFailure ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setReleasing(true);
    try {
      await api.releaseHold(hold.id, token);
    } catch {
      /* the hold lapses on its own in a few minutes */
    }
    useBooking.getState().reset();
    onClose();
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <StepHeader title="Your details" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <HoldSummary data={data} hold={hold} />
        <p className="mt-3 text-base text-ink-2">We&rsquo;re holding this table for you while you book.</p>
        {failure ? (
          <Banner tone="danger" className="mt-4">
            {failure}
          </Banner>
        ) : null}
        <div className="mt-5 flex flex-col gap-4">
          <TextField label="Name" autoComplete="name" value={values.name} onChange={set("name")} error={errors.name} required />
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            error={errors.email}
            hint="Your confirmation and manage link go here."
            required
          />
          <TextField
            label="Mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.mobile}
            onChange={set("mobile")}
            error={errors.mobile}
            hint="For the venue, if they need to reach you on the day."
            required
          />
          <SelectField
            label="Occasion"
            optional
            options={occasionOptions}
            placeholder="None"
            value={values.occasion}
            onChange={set("occasion")}
          />
          <TextArea
            label="Note for the venue"
            optional
            maxLength={280}
            value={values.note}
            onChange={set("note")}
            error={errors.note}
            hint="Allergies, a surprise, anything they should know."
          />
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-5 pt-3 pb-4">
        <Button type="submit" size="lg" block loading={busy}>
          Continue to payment &ndash; {formatMoney(hold.priceCents)}
        </Button>
        <Button variant="ghost" block className="mt-1.5" loading={releasing} onClick={() => void release()}>
          Release this table
        </Button>
      </div>
    </form>
  );
}

/** After the provider reports success, wait for the webhook to confirm the booking (PRD G-7). */
async function waitForConfirmation(holdId: string, token: string): Promise<"confirmed" | "failed" | "timeout"> {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const s = await api.holdStatus(holdId, token);
      if (s.hold.status === "confirmed" && s.booking) {
        useBooking.getState().confirm(s);
        return "confirmed";
      }
      if (s.payment.status === "failed") {
        useBooking.getState().setPaymentError(s.payment.message ?? "Your payment did not go through.");
        return "failed";
      }
      if (s.hold.status === "expired") {
        useBooking.getState().expire();
        return "failed";
      }
    } catch {
      /* keep trying until the deadline */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return "timeout";
}

function PayStep({ data }: { data: RoomData }) {
  const { hold } = useHoldTable(data);
  const token = useBooking((s) => s.holdToken);
  const payment = useBooking((s) => s.payment);
  const paymentError = useBooking((s) => s.paymentError);
  const setPaymentError = useBooking((s) => s.setPaymentError);
  const setStep = useBooking((s) => s.setStep);
  const [confirming, setConfirming] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  if (!hold || !token || !payment) return null;

  const onPaid = async () => {
    setConfirming(true);
    setPaymentError(null);
    const r = await waitForConfirmation(hold.id, token);
    if (r !== "confirmed") setConfirming(false);
    if (r === "timeout") setTimedOut(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StepHeader title="Pay to reserve" onBack={() => setStep("details")} backLabel="Back to your details" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <HoldSummary data={data} hold={hold} />
        {paymentError ? (
          <Banner tone="danger" title="Payment didn't go through" className="mt-4">
            {paymentError} Your table is still held. Try another card or payment method.
          </Banner>
        ) : null}
        {timedOut ? (
          <Banner tone="warning" title="Still confirming" className="mt-4">
            Your payment went through and we&rsquo;re still waiting for the confirmation. You&rsquo;ll get an email shortly.
          </Banner>
        ) : null}
        <div className="mt-5">
          {payment.mode === "stripe" ? (
            <StripePay
              payment={payment}
              venueName={data.venue.name}
              confirming={confirming}
              onPaid={onPaid}
              onError={(m) => setPaymentError(m)}
              returnPath={`/v/${data.venue.id}`}
            />
          ) : (
            <SimPay payment={payment} confirming={confirming} onPaid={onPaid} onError={(m) => setPaymentError(m)} />
          )}
        </div>
        <p className="mt-5 text-base leading-relaxed text-ink-3">{POLICY(data.venue.booking.fullRefundHours)}</p>
      </div>
    </div>
  );
}

function ConfirmedStep({ data, onClose }: { data: RoomData; onClose: () => void }) {
  const { hold, table } = useHoldTable(data);
  const booking = useBooking((s) => s.booking);
  const reset = useBooking((s) => s.reset);
  if (!hold || !booking) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-5">
        {table?.image ? <SeatViewImage image={table.image} alt={`The view from ${table.label}`} priority /> : null}
        <div className="px-5 pt-5">
          <p className="inline-flex items-center gap-1.5 text-base font-medium text-success">
            <Check aria-hidden className="size-4" strokeWidth={2.25} />
            Booked and paid
          </p>
          <h2 className="mt-1.5 font-display text-display-l">You&rsquo;re at {hold.tableLabel}</h2>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[0.9375rem] tabular">
            <dt className="text-ink-3">Date</dt>
            <dd>{formatDate(hold.slot.date, { weekday: "long" })}</dd>
            <dt className="text-ink-3">Time</dt>
            <dd>{formatTime(hold.slot.time)}</dd>
            <dt className="text-ink-3">Party</dt>
            <dd>{partyLabel(hold.partySize)}</dd>
            <dt className="text-ink-3">Table fee</dt>
            <dd>{formatMoney(hold.priceCents)} paid</dd>
          </dl>
          <p className="mt-4 text-base text-ink-2">
            We&rsquo;ve emailed the details and your manage link to {booking.emailedTo}.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <a
              href={booking.calendarUrl}
              download
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-surface-1 px-4 font-medium hairline hover:bg-surface-2"
            >
              <CalendarPlus aria-hidden className="size-4" strokeWidth={1.75} />
              Add to calendar
            </a>
            <a
              href={booking.manageUrl}
              className="inline-flex min-h-11 items-center justify-center rounded-control bg-surface-1 px-4 font-medium hairline hover:bg-surface-2"
            >
              Manage booking
            </a>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-5 pt-3 pb-4">
        <Button
          size="lg"
          block
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function ExpiredStep({ data, onClose, onRehold }: { data: RoomData; onClose: () => void; onRehold: () => void }) {
  const { hold } = useHoldTable(data);
  const notice = useBooking((s) => s.notice);
  const reset = useBooking((s) => s.reset);
  const [busy, setBusy] = useState(false);
  if (!hold) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StepHeader title="Your hold ended" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <HoldSummary data={data} hold={hold} timer={false} />
        <p className="mt-4 text-base text-ink-2">
          We released {hold.tableLabel} after {data.venue.booking.holdMinutes} minutes so others could book it. If it&rsquo;s
          still free, you can hold it again.
        </p>
        {notice ? (
          <Banner tone={notice.tone === "neutral" ? "neutral" : notice.tone} title={notice.title} className="mt-4">
            {notice.body}
          </Banner>
        ) : null}
      </div>
      <div className="shrink-0 border-t border-line px-5 pt-3 pb-4">
        <Button
          size="lg"
          block
          loading={busy}
          onClick={() => {
            setBusy(true);
            onRehold();
          }}
        >
          Hold {hold.tableLabel} again
        </Button>
        <Button
          variant="ghost"
          block
          className="mt-1.5"
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Choose another table
        </Button>
      </div>
    </div>
  );
}
