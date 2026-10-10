import type { OrderState } from "@off-r39x/domain";
import type { OrderDetail, OrderItem, Ref } from "../../api-client/types";
import {
  entitlementsListHref,
  entryTicketHref,
  goodsItemHref,
  mypageOrderHref,
  reservationHref,
} from "../../config/purchase-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { safeExternalHref } from "../../presentation/components/safe-url";
import { copy } from "../../presentation/copy/ja";
import {
  formatJstDate,
  formatJstDateTime,
  formatJstTimeRange,
} from "../../presentation/format/datetime";
import { formatMoney } from "../../presentation/format/money";
import { presentNotification } from "../../presentation/state-mapping/notification";
import {
  orderActionLabel,
  presentOrderState,
  type Tone,
} from "../../presentation/state-mapping/order";
import { presentPurpose, purchaseAgainTarget } from "../../presentation/state-mapping/purpose";

// View model of PG-XFN-001 (SPEC-050 16, 20.1, BR-ORD-015, INV-010-07). Pure: the server snapshot is
// the only source; this module re-checks that no right is shown before the Order is CONFIRMED.

export type PurchaseItemRow = {
  key: string;
  kind: "ENTRY_TICKET" | "GOODS" | "KARAOKE";
  kindLabel: string;
  name: string;
  quantityText: string | null;
  usageText: string | null;
  unitPriceText: string;
  subtotalText: string;
};

export type PurchaseAction =
  | { kind: "retry_checkout"; label: string }
  | { kind: "recheck_status"; label: string }
  | { kind: "purchase_again"; label: string; target: "cart" | "karaoke" }
  | { kind: "link"; action: "view_purchase" | "view_entitlements"; label: string; href: string };

export type EntitlementsModel = {
  entryTickets: readonly { ref: string; label: string; href: string }[];
  reservation: { ref: string; label: string; href: string } | null;
  goodsItems: readonly {
    ref: string;
    label: string;
    href: string;
    itemLabel: string;
    handoffLabel: string;
  }[];
};

export type PurchaseStatusModel =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      orderRef: Ref<"order">;
      stateKey: OrderState;
      stateLabel: string;
      description: string;
      tone: Tone;
      purposeLabel: string;
      createdAtText: string;
      totalText: string;
      items: readonly PurchaseItemRow[];
      actions: readonly PurchaseAction[];
      entitlements: EntitlementsModel | null;
      notice: { label: string; message: string } | null;
      receiptHref: string | null;
    };

function itemRow(item: OrderItem, index: number): PurchaseItemRow {
  const base = {
    kind: item.kind,
    kindLabel: copy.purchase.itemKind[item.kind],
    name: item.name,
    unitPriceText: formatMoney(item.unitPrice),
    subtotalText: formatMoney(item.subtotal),
  };
  switch (item.kind) {
    case "ENTRY_TICKET":
      return {
        ...base,
        key: `${item.kind}:${item.offeringRef}:${index}`,
        quantityText: copy.purchase.quantity(item.quantity),
        usageText: null,
      };
    case "GOODS":
      return {
        ...base,
        key: `${item.kind}:${item.goodsRef}:${index}`,
        quantityText: copy.purchase.quantity(item.quantity),
        usageText: null,
      };
    case "KARAOKE":
      return {
        ...base,
        key: `${item.kind}:${item.slotRef}:${index}`,
        quantityText: null,
        usageText: copy.purchase.usage(
          formatJstDate(item.usageStart),
          formatJstTimeRange(item.usageStart, item.usageEnd),
        ),
      };
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

/** All the rights the Purpose requires, or nothing: a composite Order never shows half of its rights. */
function buildEntitlements(detail: OrderDetail): EntitlementsModel | null {
  if (!presentOrderState(detail.state).showsEntitlements) return null;
  const includes = presentPurpose(detail.purpose).includes;
  const source = detail.entitlements;
  const wantsEntry = includes.includes("ENTRY_TICKET");
  const wantsGoods = includes.includes("GOODS");
  const wantsKaraoke = includes.includes("KARAOKE");
  if (wantsEntry && source.entryTicketRefs.length < 1) return null;
  if (wantsGoods && source.goodsItems.length < 1) return null;
  if (wantsKaraoke && source.reservationRef === null) return null;
  return {
    entryTickets: wantsEntry
      ? source.entryTicketRefs.map((ref, i) => ({
          ref,
          label: copy.purchase.entitlements.entryLink(i + 1),
          href: entryTicketHref(ref),
        }))
      : [],
    reservation:
      wantsKaraoke && source.reservationRef !== null
        ? {
            ref: source.reservationRef,
            label: copy.purchase.entitlements.reservationLink,
            href: reservationHref(source.reservationRef),
          }
        : null,
    goodsItems: wantsGoods
      ? source.goodsItems.map((goods, i) => ({
          ref: goods.ref,
          label: copy.purchase.entitlements.goodsLink(i + 1),
          href: goodsItemHref(goods.ref),
          itemLabel: copy.goods.item[goods.itemState],
          handoffLabel: copy.goods.handoff[goods.handoffState],
        }))
      : [],
  };
}

function buildActions(detail: OrderDetail, hasEntitlements: boolean): PurchaseAction[] {
  const actions: PurchaseAction[] = [];
  for (const action of presentOrderState(detail.state).actions) {
    const label = orderActionLabel(action);
    switch (action) {
      case "retry_checkout":
        actions.push({ kind: "retry_checkout", label });
        break;
      case "recheck_status":
        actions.push({ kind: "recheck_status", label });
        break;
      case "purchase_again":
        actions.push({
          kind: "purchase_again",
          label,
          target: purchaseAgainTarget(detail.purpose),
        });
        break;
      case "view_purchase":
        actions.push({
          kind: "link",
          action: "view_purchase",
          label,
          href: mypageOrderHref(detail.orderRef),
        });
        break;
      case "view_entitlements":
        if (hasEntitlements) {
          actions.push({
            kind: "link",
            action: "view_entitlements",
            label,
            href: entitlementsListHref(detail.purpose),
          });
        }
        break;
      default: {
        const unreachable: never = action;
        return unreachable;
      }
    }
  }
  return actions;
}

export function buildPurchaseStatusModel(input: Loadable<OrderDetail>): PurchaseStatusModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      // Another user's Order and a missing Order are the same answer (SPEC-110 section 22).
      return { kind: "denied" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    case "ok": {
      const detail = input.data;
      const presented = presentOrderState(detail.state);
      const entitlements = buildEntitlements(detail);
      const confirmed = detail.state === "CONFIRMED";
      const notification = presentNotification("FAILED_RETRYABLE");
      return {
        kind: "ready",
        orderRef: detail.orderRef,
        stateKey: detail.state,
        stateLabel: presented.label,
        description: presented.description,
        tone: presented.tone,
        purposeLabel: presentPurpose(detail.purpose).label,
        createdAtText: formatJstDateTime(detail.createdAt),
        totalText: formatMoney(detail.total),
        items: detail.items.map((item, index) => itemRow(item, index)),
        actions: buildActions(detail, entitlements !== null),
        entitlements,
        notice:
          confirmed && detail.notice?.kind === "email_delayed" && notification !== null
            ? { label: notification.label, message: notification.message }
            : null,
        receiptHref: confirmed ? safeExternalHref(detail.receiptUrl) : null,
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

export function recheckAnnouncement(previous: OrderState, next: OrderState): string {
  return previous === next
    ? copy.purchase.recheck.unchanged
    : copy.purchase.recheck.changed(presentOrderState(next).label);
}
