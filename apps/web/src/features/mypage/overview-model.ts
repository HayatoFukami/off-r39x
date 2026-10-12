import type {
  EntryTicketSummary,
  GoodsItemSummary,
  OrderSummary,
  Profile,
  ReservationSummary,
} from "../../api-client/types";
import { MYPAGE_PATHS } from "../../config/mypage-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { presentGoodsItem } from "../../presentation/state-mapping/goods";
import { buildOrderListModel, type OrderListRow } from "./order-list-model";
import { buildProfileModel } from "./profile-model";
import { type ReservationRow, sortByUsageStart, toReservationRow } from "./reservation-model";

// View model of PG-MYP-001 (SPEC-050 18.1, 9.2, 21, 20.1, INV-010-07). Pure. Every area is built from
// its own read: a failed area is unavailable and never changes another area. There is no clock here:
// "upcoming" comes from the server's Reservation and Ticket states only.

export type OverviewInput = {
  profile: Loadable<Profile>;
  orders: Loadable<readonly OrderSummary[]>;
  tickets: Loadable<readonly EntryTicketSummary[]>;
  reservations: Loadable<readonly ReservationSummary[]>;
  goodsItems: Loadable<readonly GoodsItemSummary[]>;
};

export type MypageOverviewModel = {
  profile:
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "ready"; displayName: string; email: string; href: string };
  pending: ListState<OrderListRow>;
  latest:
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "empty" }
    | { kind: "ready"; row: OrderListRow };
  tickets:
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "empty" }
    | { kind: "ready"; validCount: number; totalCount: number; summary: string; href: string };
  reservations: ListState<ReservationRow>;
  goods:
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "empty" }
    | { kind: "ready"; count: number; summary: string; href: string };
};

// Orders whose payment is not settled (Pending states and Recovery Pending): they show no right.
const UNCONFIRMED: ReadonlySet<OrderSummary["state"]> = new Set([
  "PREPARED",
  "AWAITING_PAYMENT",
  "REVIEW_REQUIRED",
]);

function buildProfile(input: Loadable<Profile>): MypageOverviewModel["profile"] {
  const model = buildProfileModel(input);
  if (model.kind !== "ready") return model;
  return {
    kind: "ready",
    displayName: model.displayName,
    email: model.email,
    href: MYPAGE_PATHS.profile,
  };
}

function buildPending(input: Loadable<readonly OrderSummary[]>): ListState<OrderListRow> {
  return buildOrderListModel(
    input.kind === "ok"
      ? { kind: "ok", data: input.data.filter((order) => UNCONFIRMED.has(order.state)) }
      : input,
  );
}

function buildLatest(input: Loadable<readonly OrderSummary[]>): MypageOverviewModel["latest"] {
  const list = buildOrderListModel(input);
  switch (list.kind) {
    case "loading":
    case "unavailable":
    case "empty":
      return list;
    case "items": {
      const [row] = list.items;
      return row === undefined ? { kind: "empty" } : { kind: "ready", row };
    }
    default: {
      const unreachable: never = list;
      return unreachable;
    }
  }
}

function buildTickets(
  input: Loadable<readonly EntryTicketSummary[]>,
): MypageOverviewModel["tickets"] {
  const list = toListState(input, (ticket) => ticket.state);
  switch (list.kind) {
    case "loading":
    case "unavailable":
    case "empty":
      return list;
    case "items": {
      const validCount = list.items.filter((state) => state === "VALID").length;
      const totalCount = list.items.length;
      return {
        kind: "ready",
        validCount,
        totalCount,
        summary: copy.mypage.overview.ticketsSummary(validCount, totalCount),
        href: MYPAGE_PATHS.entryTickets,
      };
    }
    default: {
      const unreachable: never = list;
      return unreachable;
    }
  }
}

function buildReservations(
  input: Loadable<readonly ReservationSummary[]>,
): ListState<ReservationRow> {
  return toListState(
    input.kind === "ok"
      ? {
          kind: "ok",
          data: sortByUsageStart(
            input.data.filter(
              (reservation) =>
                reservation.reservationState === "CONFIRMED" && reservation.ticketState === "VALID",
            ),
          ),
        }
      : input,
    toReservationRow,
  );
}

function buildGoods(input: Loadable<readonly GoodsItemSummary[]>): MypageOverviewModel["goods"] {
  const list = toListState(input, (item) => presentGoodsItem(item.itemState, item.handoffState));
  switch (list.kind) {
    case "loading":
    case "unavailable":
      return list;
    case "empty":
      return { kind: "empty" };
    case "items": {
      // Only a paid, not yet handed-over item waits for pickup (an unpaid item does not).
      const count = list.items.filter((presented) => presented.receivable).length;
      if (count === 0) return { kind: "empty" };
      return {
        kind: "ready",
        count,
        summary: copy.mypage.overview.goodsSummary(count),
        href: MYPAGE_PATHS.goodsItems,
      };
    }
    default: {
      const unreachable: never = list;
      return unreachable;
    }
  }
}

export function buildMypageOverviewModel(input: OverviewInput): MypageOverviewModel {
  return {
    profile: buildProfile(input.profile),
    pending: buildPending(input.orders),
    latest: buildLatest(input.orders),
    tickets: buildTickets(input.tickets),
    reservations: buildReservations(input.reservations),
    goods: buildGoods(input.goodsItems),
  };
}
