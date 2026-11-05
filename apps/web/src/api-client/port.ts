import type {
  Announcement,
  AnnouncementSummary,
  BusinessDateJst,
  CartLine,
  CartLineResolution,
  CartPurchaseStart,
  CheckoutStart,
  EntryOffering,
  EntryTicketDetail,
  EntryTicketSummary,
  EventInfo,
  FaqItem,
  GoodsDetail,
  GoodsItemDetail,
  GoodsItemSummary,
  GoodsSummary,
  KaraokeDay,
  KaraokePurchaseStart,
  KaraokeSales,
  KaraokeSlotDetail,
  OrderDetail,
  OrderSummary,
  Profile,
  ProfileUpdate,
  PurchaseEligibilityRead,
  QrPresentation,
  Read,
  Ref,
  ReservationDetail,
  ReservationSummary,
  SponsorLogo,
} from "./types";

export interface PublicApi {
  /** API-PUB-001 */
  getEvent(): Promise<Read<EventInfo>>;
  /** API-PUB-002 */
  listFaqs(): Promise<Read<readonly FaqItem[]>>;
  /** API-PUB-003 */
  listAnnouncements(q?: { limit?: number }): Promise<Read<readonly AnnouncementSummary[]>>;
  /** API-PUB-004 */
  getAnnouncement(ref: Ref<"announcement">): Promise<Read<Announcement>>;
  /** API-PUB-012 (PUBLISHED only, sort_order ASC then public_ref ASC) */
  listSponsorLogos(): Promise<Read<readonly SponsorLogo[]>>;
  /** API-PUB-005 (public sale data only; owner conditions come from getPurchaseEligibility) */
  listEntryOfferings(): Promise<Read<readonly EntryOffering[]>>;
  /** API-PUB-006 */
  getKaraokeSales(): Promise<Read<KaraokeSales>>;
  /** API-PUB-007 and API-PUB-008 */
  getKaraokeDay(date: BusinessDateJst): Promise<Read<KaraokeDay>>;
  /** API-PUB-009 */
  getKaraokeSlot(ref: Ref<"slot">): Promise<Read<KaraokeSlotDetail>>;
  /** API-PUB-010 */
  listGoods(): Promise<Read<readonly GoodsSummary[]>>;
  /** API-PUB-011 */
  getGoods(ref: Ref<"goods">): Promise<Read<GoodsDetail>>;
  /** Composition of API-PUB-005, API-PUB-010 and API-PUB-011 (public conditions only; owner conditions come from getPurchaseEligibility) */
  resolveCartLines(lines: readonly CartLine[]): Promise<Read<readonly CartLineResolution[]>>;
}

export interface PurchaseApi {
  /** API-PUR-CART-001 (all-or-nothing: one Order for every line or none; item failures carry API-PUR-ELG-001 reasons; the Checkout is started or resumed through startCheckout / API-CHK-001) */
  startCartPurchase(
    lines: readonly CartLine[],
    o: { idempotencyKey: string },
  ): Promise<CartPurchaseStart>;
  /** API-PUR-ELG-001 (owner-scoped read-only snapshot; private, no-store; not a reservation: re-verified at purchase start) */
  getPurchaseEligibility(lines: readonly CartLine[]): Promise<PurchaseEligibilityRead>;
  /** API-PUR-KRK-001 */
  startKaraokePurchase(
    slot: Ref<"slot">,
    o: { idempotencyKey: string },
  ): Promise<KaraokePurchaseStart>;
  /** API-CHK-001 */
  startCheckout(order: Ref<"order">, o: { idempotencyKey: string }): Promise<CheckoutStart>;
}

/** Another user's ref and a nonexistent ref are answered identically with not_found (SPEC-110 section 22). */
export interface SelfApi {
  /** API-AUTH-002 (display_name is null when unset; the Account email is the authenticated Identity's, SPEC-050 18.2) */
  getProfile(): Promise<Read<Profile>>;
  /** API-AUTH-004 (SPEC-030 9.2: trimmed, blank clears to null, 1..80 code points, no Cc) */
  updateProfile(i: { displayName: string }): Promise<ProfileUpdate>;
  /** API-ORD-001 */
  listOrders(): Promise<Read<readonly OrderSummary[]>>;
  /** API-ORD-003 (notification_summary is the owner projection of SPEC-120 7.2; null when only the summary is unavailable) */
  getOrder(r: Ref<"order">): Promise<Read<OrderDetail>>;
  /** API-TKT-001 */
  listEntryTickets(): Promise<Read<readonly EntryTicketSummary[]>>;
  /** API-TKT-002 */
  getEntryTicket(r: Ref<"ticket">): Promise<Read<EntryTicketDetail>>;
  /** API-TKT-003 */
  getEntryQr(r: Ref<"ticket">): Promise<Read<QrPresentation>>;
  /** API-KRK-SELF-001 */
  listReservations(): Promise<Read<readonly ReservationSummary[]>>;
  /** API-KRK-SELF-002 */
  getReservation(r: Ref<"reservation">): Promise<Read<ReservationDetail>>;
  /** API-KRK-SELF-003 */
  getKaraokeQr(r: Ref<"reservation">): Promise<Read<QrPresentation>>;
  /** API-GDS-SELF-001 */
  listGoodsItems(): Promise<Read<readonly GoodsItemSummary[]>>;
  /** API-GDS-SELF-002 */
  getGoodsItem(r: Ref<"goodsItem">): Promise<Read<GoodsItemDetail>>;
}

export interface ApiPort {
  readonly public: PublicApi;
  readonly purchase: PurchaseApi;
  readonly self: SelfApi;
}
