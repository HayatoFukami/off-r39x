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
  QrPresentation,
  Read,
  Ref,
  ReservationDetail,
  ReservationSummary,
  SponsorLogo,
} from "./types";

// Methods without an Operation ID (Operation ID なし) cite UCR-110-001. No Operation ID is invented here.

export interface PublicApi {
  /** API-PUB-001 */
  getEvent(): Promise<Read<EventInfo>>;
  /** API-PUB-002 */
  listFaqs(): Promise<Read<readonly FaqItem[]>>;
  /** API-PUB-003 */
  listAnnouncements(q?: { limit?: number }): Promise<Read<readonly AnnouncementSummary[]>>;
  /** API-PUB-004 */
  getAnnouncement(ref: Ref<"announcement">): Promise<Read<Announcement>>;
  /** Operation ID なし (UCR-110-001) */
  listSponsorLogos(): Promise<Read<readonly SponsorLogo[]>>;
  /** API-PUB-005 plus the viewer-specific Purchase Limit result: Operation ID なし (UCR-110-001) */
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
  /** Composition of API-PUB-005, API-PUB-010 and API-PUB-011 plus UCR-110-001: Operation ID なし */
  resolveCartLines(lines: readonly CartLine[]): Promise<Read<readonly CartLineResolution[]>>;
}

export interface PurchaseApi {
  /** Operation ID なし (UCR-110-001) */
  startCartPurchase(
    lines: readonly CartLine[],
    o: { idempotencyKey: string },
  ): Promise<CartPurchaseStart>;
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
  /** API-AUTH-002 */
  getProfile(): Promise<Read<Profile>>;
  /** API-AUTH-004 (maximum length is not defined until UCR-100-001 is reflected) */
  updateProfile(i: { displayName: string }): Promise<ProfileUpdate>;
  /** API-ORD-001 */
  listOrders(): Promise<Read<readonly OrderSummary[]>>;
  /** API-ORD-003 (ENTRY_GOODS_PURCHASE purpose and notice: Operation ID なし, UCR-110-001) */
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
