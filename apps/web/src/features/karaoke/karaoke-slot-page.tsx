"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiPort } from "../../api-client/port";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { KaraokeSlotDetail, Ref } from "../../api-client/types";
import { type SessionState, useSession } from "../../auth/use-session";
import type { Loadable } from "../../presentation/components/list-state";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { PageState } from "../../presentation/components/page-state";
import { SectionHeading } from "../../presentation/components/section-heading";
import { StatusBadge } from "../../presentation/components/status-badge";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { Link } from "../../routing/link";
import { CartRecovery } from "../cart/cart-recovery";
import {
  type EligibilityInput,
  type EligibilityMode,
  eligibilityForSession,
  eligibilityMode,
  toEligibilityInput,
} from "../purchase/eligibility-model";
import { buildKaraokeSlotModel, karaokeEligibilityTarget } from "./karaoke-slot-model";
import { type KaraokePurchasePhase, useKaraokePurchase } from "./use-karaoke-purchase";

const detail = copy.karaoke.slotDetail;
const linkClass = "text-brand underline underline-offset-4";
const alertClass =
  "flex flex-col gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg";
const REASON_ID = "karaoke-slot-disabled-reason";
const FAILURE_ID = "karaoke-slot-failure";

function failureText(phase: KaraokePurchasePhase): string | null {
  switch (phase.kind) {
    case "conflict":
      return detail.failure.conflict;
    case "limit":
      return detail.failure.limit;
    case "not_on_sale":
      return detail.failure.notOnSale;
    case "expired":
      return detail.failure.expired;
    case "unavailable":
      return detail.failure.unavailable;
    case "cart_busy":
    case "cart_recovery":
    case "idle":
    case "holding":
    case "preparing":
      return null;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

function progressText(phase: KaraokePurchasePhase): string | null {
  if (phase.kind === "holding") return detail.holding;
  if (phase.kind === "preparing") return copy.purchase.checkoutPreparing;
  if (phase.kind === "cart_busy") return copy.cart.lifecycleBusy.description;
  return null;
}

type SlotState = {
  /** The session state the eligibility was read under (null before the first read). */
  session: SessionState | null;
  slot: Loadable<KaraokeSlotDetail>;
  /** The owner-scoped eligibility read together with the slot. Kept in memory only (SEC-API-029). */
  eligibility: EligibilityInput;
};

const INITIAL_STATE: SlotState = {
  session: null,
  slot: { kind: "loading" },
  eligibility: { kind: "loading" },
};

/** Reads the eligibility of a slot that is purchasable publicly (quantity 1); verified owners only. */
async function readEligibility(
  api: ApiPort,
  mode: Exclude<EligibilityMode, "wait">,
  slot: Loadable<KaraokeSlotDetail>,
): Promise<EligibilityInput> {
  if (mode === "not_applicable") return { kind: "not_applicable" };
  if (mode === "unavailable") return { kind: "unavailable" };
  const target = karaokeEligibilityTarget(slot);
  if (target === null) return { kind: "ok", data: [] };
  try {
    return toEligibilityInput(await api.purchase.getPurchaseEligibility([target]));
  } catch {
    return { kind: "unavailable" };
  }
}

// PG-KRK-003 container: reads the slot after mount through the port. Karaoke purchase contents never enter the Cart.
export function KaraokeSlotPage({ slotRef }: { slotRef: Ref<"slot"> }) {
  const api = useApi();
  const { state: sessionState } = useSession();
  const [state, setState] = useState<SlotState>(INITIAL_STATE);
  const token = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    const mode = eligibilityMode(sessionState);
    if (mode === "wait") return;
    token.current += 1;
    const current = token.current;
    // The public slot and the owner-scoped eligibility are applied together, once.
    void (async () => {
      const slot = await settleRead(api.public.getKaraokeSlot(slotRef));
      const eligibility = await readEligibility(api, mode, slot);
      if (token.current === current) setState({ session: sessionState, slot, eligibility });
    })();
  }, [api, slotRef, sessionState]);

  // The public slot stays shown while both are read again; the owner-scoped answer is used only for
  // the session it was read for (B4b-F-1, SPEC-050 12.1 / 13.3). A response for an older session is
  // dropped by the token.
  useEffect(() => {
    const ref = token;
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setState(INITIAL_STATE);
    load();
  };

  const purchase = useKaraokePurchase({ slotRef, onRefresh: load });
  const phaseKind = purchase.phase.kind;

  useEffect(() => {
    if (
      phaseKind === "conflict" ||
      phaseKind === "limit" ||
      phaseKind === "not_on_sale" ||
      phaseKind === "expired" ||
      phaseKind === "unavailable"
    ) {
      alertRef.current?.focus();
    }
  }, [phaseKind]);

  const eligibility = eligibilityForSession(state.eligibility, state.session, sessionState);
  const model = buildKaraokeSlotModel(state.slot, eligibility);
  if (model.kind === "not_found") return <NotFoundView />;

  const heading = <h1 className="text-2xl font-bold">{copy.karaoke.slotDetail.heading}</h1>;
  if (model.kind === "loading") {
    return (
      <div className="flex flex-col gap-5">
        {heading}
        <PageState state="loading" />
      </div>
    );
  }
  if (model.kind === "unavailable") {
    return (
      <div className="flex flex-col gap-5">
        {heading}
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(detail.subject)}
          onRetry={reload}
        />
      </div>
    );
  }

  const guest = sessionState.status === "ready" && sessionState.session.kind === "guest";
  const failure = failureText(purchase.phase);
  const progress = progressText(purchase.phase);
  const blockedByPhase =
    phaseKind === "limit" || phaseKind === "expired" || phaseKind === "cart_recovery";
  const describedBy = !model.purchasable ? REASON_ID : blockedByPhase ? FAILURE_ID : undefined;
  const withWayBack = phaseKind === "conflict" || phaseKind === "expired";

  return (
    <div className="flex flex-col gap-5">
      {heading}
      <section aria-labelledby="karaoke-slot-info" className="flex flex-col gap-3">
        <SectionHeading id="karaoke-slot-info">{detail.infoHeading}</SectionHeading>
        <dl className="flex flex-col gap-2">
          <div>
            <dt className="text-sm font-semibold">{detail.dateLabel}</dt>
            <dd>{model.dateText}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">{detail.timeLabel}</dt>
            <dd>{model.timeText}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">{copy.karaoke.guide.priceLabel}</dt>
            <dd>{model.priceText}</dd>
          </div>
          <div className="flex flex-col items-start gap-1">
            <dt className="text-sm font-semibold">{detail.stateLabel}</dt>
            <dd className="flex flex-col items-start gap-1">
              <StatusBadge tone={model.tone} label={model.stateLabel} />
              <span>{model.description}</span>
            </dd>
          </div>
        </dl>
        <p>{copy.karaoke.guide.purchaseLimit}</p>
      </section>
      <section aria-labelledby="karaoke-slot-action" className="flex flex-col gap-3">
        <SectionHeading id="karaoke-slot-action">{detail.actionHeading}</SectionHeading>
        {eligibility.kind === "unavailable" && failure === null ? (
          <PageState
            state="unavailable"
            message={copy.pageState.unavailable(copy.entry.eligibilitySubject)}
            onRetry={reload}
          />
        ) : null}
        <div>
          <Button
            type="button"
            size="lg"
            disabled={!model.purchasable || purchase.busy || blockedByPhase}
            aria-describedby={describedBy}
            aria-busy={purchase.busy ? true : undefined}
            onClick={purchase.start}
          >
            {guest ? detail.proceedGuest : detail.proceed}
          </Button>
        </div>
        {model.disabledReason === null ? null : <p id={REASON_ID}>{model.disabledReason}</p>}
        {progress === null ? null : (
          <div role="status" className="text-sm">
            {progress}
          </div>
        )}
        {failure === null ? null : (
          <div ref={alertRef} role="alert" tabIndex={-1} className={alertClass}>
            <p id={FAILURE_ID}>{failure}</p>
            {withWayBack ? (
              <p>
                <Link href={model.dayHref} prefetch={false} className={linkClass}>
                  {detail.chooseAgain}
                </Link>
              </p>
            ) : null}
          </div>
        )}
        {phaseKind === "cart_recovery" ? (
          <CartRecovery onRecovered={purchase.dismissCartRecovery} />
        ) : null}
        <p className="text-sm">{detail.separateNote}</p>
        <p>
          <Link href={model.dayHref} prefetch={false} className={linkClass}>
            {detail.backToDay}
          </Link>
        </p>
      </section>
    </div>
  );
}
