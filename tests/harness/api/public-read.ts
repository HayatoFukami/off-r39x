// Test double and rig for API-PUB-001..005 and API-PUB-012 (PR-L2-3). Test only: a recording stand-in for
// the PublicContentStore port (AppDependencies.publicContent), its DI fault injection and a createApp rig
// built the same way as tests/harness/api/self-profile.ts. Synthetic data only; nothing here is reachable
// from production code.
//
// The row types below are this harness's reading of the C3 repository contract (plan, Implementation steps
// C3): camel-case names taken from the Drizzle columns, timestamps as `YYYY-MM-DDTHH:mm:ss.sssZ` strings,
// `unitAmount` as a decimal string and `hasRemainingCapacity` as a boolean. The service port must accept a
// store of exactly these shapes (checked at compile time where `publicContent` is passed to createApp).
import { createApp } from "../../../apps/api/src/api/app.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../rate-limit/api.ts";

export const WEB = "https://web.example.test";
export const API = "https://api.example.test";
export const BASE = "/api/v1/public";
export const GOOD = "e30.e30.c2ln";
export const BAD = "e30.e30.YmFk";
/** A non-public row carries this prefix in every string; it must never appear in any response. */
export const NONPUBLIC_MARKER = "nonpublic-marker";

export const EVENT_REF = "00000000-0000-4000-8000-0000000000e1";
export const FAQ_REFS = [
  "00000000-0000-4000-8000-0000000000f1",
  "00000000-0000-4000-8000-0000000000f2",
] as const;
export const ANNOUNCEMENT_REFS = [
  "00000000-0000-4000-8000-0000000000a1",
  "00000000-0000-4000-8000-0000000000a2",
] as const;
export const UNKNOWN_ANNOUNCEMENT_REF = "00000000-0000-4000-8000-0000000000a9";
export const OFFERING_REFS = [
  "00000000-0000-4000-8000-0000000000c1",
  "00000000-0000-4000-8000-0000000000c2",
  "00000000-0000-4000-8000-0000000000c3",
  "00000000-0000-4000-8000-0000000000c4",
  "00000000-0000-4000-8000-0000000000c5",
] as const;
export const LOGO_REFS = [
  "00000000-0000-4000-8000-0000000000d1",
  "00000000-0000-4000-8000-0000000000d2",
] as const;

/** The six Operations: key, Operation ID, path. */
export const PUBLIC_OPERATIONS = [
  { key: "event", operationId: "API-PUB-001", path: `${BASE}/event` },
  { key: "faqs", operationId: "API-PUB-002", path: `${BASE}/faqs` },
  { key: "announcements", operationId: "API-PUB-003", path: `${BASE}/announcements` },
  {
    key: "announcement",
    operationId: "API-PUB-004",
    path: `${BASE}/announcements/${ANNOUNCEMENT_REFS[0]}`,
  },
  { key: "entryOfferings", operationId: "API-PUB-005", path: `${BASE}/entry-offerings` },
  { key: "sponsorLogos", operationId: "API-PUB-012", path: `${BASE}/sponsor-logos` },
] as const;
export type PublicOperationKey = (typeof PUBLIC_OPERATIONS)[number]["key"];

export type PublicEventRowFixture = {
  publicRef: string;
  name: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  businessTimezone: string;
  venueName: string | null;
  venueDetails: string | null;
  accessInformation: string | null;
  participantNotices: string | null;
};
export type PublicFaqRowFixture = {
  publicRef: string;
  question: string;
  answer: string;
  sortOrder: number;
};
export type PublicAnnouncementRowFixture = {
  publicRef: string;
  title: string;
  body: string;
  publishedAt: string | null;
};
export type EntryOfferingRowFixture = {
  publicRef: string;
  name: string;
  description: string | null;
  unitAmount: string;
  currency: string;
  salesStartsAt: string;
  salesEndsAt: string;
  saleControlState: "ENABLED" | "SUSPENDED";
  purchaseLimit: number;
  hasRemainingCapacity: boolean;
};
export type PublicLogoRowFixture = {
  publicRef: string;
  displayName: string;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
};

export type EventResult =
  | { status: "found"; event: PublicEventRowFixture }
  | { status: "none" }
  | { status: "multiple" }
  | { status: "unavailable" };
export type ListResult<Row> =
  | { status: "ok"; items: Row[] }
  | { status: "multiple_events" }
  | { status: "unavailable" };
export type OfferingsResult =
  | { status: "ok"; now: string; items: EntryOfferingRowFixture[] }
  | { status: "multiple_events" }
  | { status: "unavailable" };
export type AnnouncementResult =
  | { status: "found"; announcement: PublicAnnouncementRowFixture }
  | { status: "not_found" }
  | { status: "multiple_events" }
  | { status: "unavailable" };

/** The port the harness stands in for (plan C3 / C4-2). */
export interface PublicContentStoreFixture {
  readPublicEvent(): Promise<EventResult>;
  listPublishedFaqs(): Promise<ListResult<PublicFaqRowFixture>>;
  listPublishedAnnouncements(): Promise<ListResult<PublicAnnouncementRowFixture>>;
  readPublishedAnnouncement(announcementRef: string): Promise<AnnouncementResult>;
  listEntryOfferings(): Promise<OfferingsResult>;
  listPublishedSponsorLogos(): Promise<ListResult<PublicLogoRowFixture>>;
}

/**
 * Injection points of the recording store (DI only; the production adapter is never patched).
 * `FP.DB.INSIDE_STATEMENT` is a SPEC-170 Fault Point; `PUBLIC.*` are this harness's own injection points,
 * not SPEC-170 Fault Points.
 */
export type PublicFaultPoint =
  | "FP.DB.INSIDE_STATEMENT"
  | "PUBLIC.STORE_THROWS"
  | "PUBLIC.MULTIPLE_EVENTS";
export type StoreMethod = keyof PublicContentStoreFixture;

export interface RecordingPublicContentStore extends PublicContentStoreFixture {
  /** Method names in call order (an argument, when there is one, is in `refs`). */
  readonly calls: StoreMethod[];
  /** The announcement_ref values `readPublishedAnnouncement` received. */
  readonly refs: string[];
  count(method: StoreMethod): number;
  /** Replace what a method answers (until replaced again). */
  set(data: Partial<StoreData>): void;
  /** Make every method (or only `only`) fail in this way; `undefined` removes the fault. */
  inject(point: PublicFaultPoint | undefined, only?: StoreMethod): void;
}

export interface StoreData {
  event: EventResult;
  faqs: ListResult<PublicFaqRowFixture>;
  announcements: ListResult<PublicAnnouncementRowFixture>;
  announcement: AnnouncementResult;
  offerings: OfferingsResult;
  logos: ListResult<PublicLogoRowFixture>;
}

export const FIXED_NOW = "2030-06-15T00:00:00.000Z";

export const eventRow = (): PublicEventRowFixture => ({
  publicRef: EVENT_REF,
  name: "Synthetic Event 2030",
  summary: "Synthetic summary",
  startsAt: "2030-06-15T03:00:00.000Z",
  endsAt: "2030-06-15T09:30:00.000Z",
  businessTimezone: "Asia/Tokyo",
  venueName: "Synthetic Hall",
  venueDetails: "Synthetic floor 3",
  accessInformation: "Synthetic access guide",
  participantNotices: "Synthetic notice one\nSynthetic notice two",
});
export const eventDto = () => ({
  event_ref: EVENT_REF,
  name: "Synthetic Event 2030",
  summary: "Synthetic summary",
  starts_at: "2030-06-15T03:00:00.000Z",
  ends_at: "2030-06-15T09:30:00.000Z",
  business_timezone: "Asia/Tokyo" as const,
  venue_name: "Synthetic Hall",
  venue_details: "Synthetic floor 3",
  access_information: "Synthetic access guide",
  participant_notices: "Synthetic notice one\nSynthetic notice two",
});
/** An Event whose every nullable column is NULL (BR-EVT-001: nothing is guessed). */
export const unsetEventRow = (): PublicEventRowFixture => ({
  ...eventRow(),
  summary: null,
  startsAt: null,
  endsAt: null,
  venueName: null,
  venueDetails: null,
  accessInformation: null,
  participantNotices: null,
});

export const faqRows = (): PublicFaqRowFixture[] => [
  {
    publicRef: FAQ_REFS[1],
    question: "Synthetic question B",
    answer: "Synthetic answer B",
    sortOrder: -1,
  },
  {
    publicRef: FAQ_REFS[0],
    question: "Synthetic question A",
    answer: "Synthetic answer A",
    sortOrder: 5,
  },
];
export const faqDtos = () => [
  {
    faq_ref: FAQ_REFS[1],
    question: "Synthetic question B",
    answer: "Synthetic answer B",
    sort_order: -1,
  },
  {
    faq_ref: FAQ_REFS[0],
    question: "Synthetic question A",
    answer: "Synthetic answer A",
    sort_order: 5,
  },
];

export const ANNOUNCEMENT_BODY_0 = "Synthetic announcement body\n\n  with   spaces\tand a tab";
export const announcementRows = (): PublicAnnouncementRowFixture[] => [
  {
    publicRef: ANNOUNCEMENT_REFS[0],
    title: "Synthetic title one",
    body: ANNOUNCEMENT_BODY_0,
    publishedAt: "2030-05-02T01:02:03.456Z",
  },
  {
    publicRef: ANNOUNCEMENT_REFS[1],
    title: "Synthetic title two",
    body: "Synthetic short body",
    publishedAt: "2030-05-01T00:00:00.000Z",
  },
];
export const announcementListDtos = () => [
  {
    announcement_ref: ANNOUNCEMENT_REFS[0],
    title: "Synthetic title one",
    published_at: "2030-05-02T01:02:03.456Z",
    excerpt: "Synthetic announcement body with spaces and a tab",
    excerpt_truncated: false,
  },
  {
    announcement_ref: ANNOUNCEMENT_REFS[1],
    title: "Synthetic title two",
    published_at: "2030-05-01T00:00:00.000Z",
    excerpt: "Synthetic short body",
    excerpt_truncated: false,
  },
];
export const announcementDetailDto = () => ({
  announcement_ref: ANNOUNCEMENT_REFS[0],
  title: "Synthetic title one",
  body: ANNOUNCEMENT_BODY_0,
  published_at: "2030-05-02T01:02:03.456Z",
});

/**
 * Five Offerings against FIXED_NOW (2030-06-15T00:00:00.000Z), in the repository's order. Counters are
 * not part of the row: only the boolean `hasRemainingCapacity`.
 */
export const offeringRows = (): EntryOfferingRowFixture[] => [
  {
    publicRef: OFFERING_REFS[0],
    name: "Synthetic ticket not yet on sale",
    description: null,
    unitAmount: "1000",
    currency: "JPY",
    salesStartsAt: "2030-06-16T00:00:00.000Z",
    salesEndsAt: "2030-06-20T00:00:00.000Z",
    saleControlState: "ENABLED",
    purchaseLimit: 4,
    hasRemainingCapacity: true,
  },
  {
    publicRef: OFFERING_REFS[1],
    name: "Synthetic ticket closed",
    description: "Synthetic description",
    unitAmount: "9007199254740993",
    currency: "JPY",
    salesStartsAt: "2030-06-01T00:00:00.000Z",
    salesEndsAt: "2030-06-15T00:00:00.000Z",
    saleControlState: "ENABLED",
    purchaseLimit: 2,
    hasRemainingCapacity: true,
  },
  {
    publicRef: OFFERING_REFS[2],
    name: "Synthetic ticket in period",
    description: null,
    unitAmount: "0",
    currency: "JPY",
    salesStartsAt: "2030-06-15T00:00:00.000Z",
    salesEndsAt: "2030-06-15T00:00:00.001Z",
    saleControlState: "ENABLED",
    purchaseLimit: 1,
    hasRemainingCapacity: true,
  },
  {
    publicRef: OFFERING_REFS[3],
    name: "Synthetic ticket suspended",
    description: null,
    unitAmount: "1500",
    currency: "JPY",
    salesStartsAt: "2030-06-01T00:00:00.000Z",
    salesEndsAt: "2030-06-30T00:00:00.000Z",
    saleControlState: "SUSPENDED",
    purchaseLimit: 3,
    hasRemainingCapacity: true,
  },
  {
    publicRef: OFFERING_REFS[4],
    name: "Synthetic ticket without remaining capacity",
    description: null,
    unitAmount: "2000",
    currency: "JPY",
    salesStartsAt: "2030-06-01T00:00:00.000Z",
    salesEndsAt: "2030-06-30T00:00:00.000Z",
    saleControlState: "ENABLED",
    purchaseLimit: 3,
    hasRemainingCapacity: false,
  },
];
/**
 * What API-PUB-005 answers for offeringRows() on the current dev: no Entry purchase Operation
 * (API-PUR-ENTRY-001 / API-PUR-CART-001) is in ROUTES, so an Offering inside its sales period is
 * SALES_STOPPED (SPEC-110 §26.1 API-PUB-005, UCR-110-004). Periods are checked first, so the first two keep
 * their own reasons. When an Entry purchase route is registered these expectations change by the
 * specification (the third, fourth and fifth become AVAILABLE, SALES_STOPPED and SOLD_OUT).
 */
export const offeringDtos = () => [
  {
    offering_ref: OFFERING_REFS[0],
    name: "Synthetic ticket not yet on sale",
    description: null,
    unit_price: { amount: "1000", currency: "JPY" },
    sales_starts_at: "2030-06-16T00:00:00.000Z",
    sales_ends_at: "2030-06-20T00:00:00.000Z",
    purchase_limit: 4,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "SALES_NOT_STARTED" as const,
  },
  {
    offering_ref: OFFERING_REFS[1],
    name: "Synthetic ticket closed",
    description: "Synthetic description",
    unit_price: { amount: "9007199254740993", currency: "JPY" },
    sales_starts_at: "2030-06-01T00:00:00.000Z",
    sales_ends_at: "2030-06-15T00:00:00.000Z",
    purchase_limit: 2,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "SALES_CLOSED" as const,
  },
  {
    offering_ref: OFFERING_REFS[2],
    name: "Synthetic ticket in period",
    description: null,
    unit_price: { amount: "0", currency: "JPY" },
    sales_starts_at: "2030-06-15T00:00:00.000Z",
    sales_ends_at: "2030-06-15T00:00:00.001Z",
    purchase_limit: 1,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "SALES_STOPPED" as const,
  },
  {
    offering_ref: OFFERING_REFS[3],
    name: "Synthetic ticket suspended",
    description: null,
    unit_price: { amount: "1500", currency: "JPY" },
    sales_starts_at: "2030-06-01T00:00:00.000Z",
    sales_ends_at: "2030-06-30T00:00:00.000Z",
    purchase_limit: 3,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "SALES_STOPPED" as const,
  },
  {
    offering_ref: OFFERING_REFS[4],
    name: "Synthetic ticket without remaining capacity",
    description: null,
    unit_price: { amount: "2000", currency: "JPY" },
    sales_starts_at: "2030-06-01T00:00:00.000Z",
    sales_ends_at: "2030-06-30T00:00:00.000Z",
    purchase_limit: 3,
    availability: "UNAVAILABLE" as const,
    unavailable_reason: "SALES_STOPPED" as const,
  },
];

export const logoRows = (): PublicLogoRowFixture[] => [
  {
    publicRef: LOGO_REFS[0],
    displayName: "Synthetic sponsor one",
    imageUrl: "https://logos.example.test/one.png",
    linkUrl: "https://sponsor.example.test/one",
    sortOrder: 0,
  },
  {
    publicRef: LOGO_REFS[1],
    displayName: "Synthetic sponsor two",
    imageUrl: "https://logos.example.test/two.png",
    linkUrl: null,
    sortOrder: 0,
  },
];
export const logoDtos = () => [
  {
    logo_ref: LOGO_REFS[0],
    display_name: "Synthetic sponsor one",
    image_url: "https://logos.example.test/one.png",
    link_url: "https://sponsor.example.test/one",
    sort_order: 0,
  },
  {
    logo_ref: LOGO_REFS[1],
    display_name: "Synthetic sponsor two",
    image_url: "https://logos.example.test/two.png",
    link_url: null,
    sort_order: 0,
  },
];

export const defaultStoreData = (): StoreData => ({
  event: { status: "found", event: eventRow() },
  faqs: { status: "ok", items: faqRows() },
  announcements: { status: "ok", items: announcementRows() },
  announcement: {
    status: "found",
    announcement: announcementRows()[0] as PublicAnnouncementRowFixture,
  },
  offerings: { status: "ok", now: FIXED_NOW, items: offeringRows() },
  logos: { status: "ok", items: logoRows() },
});

const KEY_OF: Record<StoreMethod, keyof StoreData> = {
  readPublicEvent: "event",
  listPublishedFaqs: "faqs",
  listPublishedAnnouncements: "announcements",
  readPublishedAnnouncement: "announcement",
  listEntryOfferings: "offerings",
  listPublishedSponsorLogos: "logos",
};
const MULTIPLE: Record<keyof StoreData, unknown> = {
  event: { status: "multiple" },
  faqs: { status: "multiple_events" },
  announcements: { status: "multiple_events" },
  announcement: { status: "multiple_events" },
  offerings: { status: "multiple_events" },
  logos: { status: "multiple_events" },
};

/** A stub that behaves like the repository contract: it answers what `set` last put in, nothing is written. */
export function createRecordingPublicContentStore(
  initial: Partial<StoreData> = {},
): RecordingPublicContentStore {
  const data: StoreData = { ...defaultStoreData(), ...initial };
  const calls: StoreMethod[] = [];
  const refs: string[] = [];
  let fault: { point: PublicFaultPoint; only: StoreMethod | undefined } | undefined;
  const answer = <T>(method: StoreMethod): T => {
    calls.push(method);
    if (fault && (fault.only === undefined || fault.only === method)) {
      if (fault.point === "PUBLIC.STORE_THROWS") throw new Error("synthetic public store failure");
      if (fault.point === "FP.DB.INSIDE_STATEMENT") return { status: "unavailable" } as T;
      return MULTIPLE[KEY_OF[method]] as T;
    }
    return data[KEY_OF[method]] as T;
  };
  return {
    calls,
    refs,
    count: (method) => calls.filter((c) => c === method).length,
    set: (next) => {
      Object.assign(data, next);
    },
    inject: (point, only) => {
      fault = point === undefined ? undefined : { point, only };
    },
    readPublicEvent: async () => answer<EventResult>("readPublicEvent"),
    listPublishedFaqs: async () => answer("listPublishedFaqs"),
    listPublishedAnnouncements: async () => answer("listPublishedAnnouncements"),
    readPublishedAnnouncement: async (ref) => {
      refs.push(ref);
      return answer<AnnouncementResult>("readPublishedAnnouncement");
    },
    listEntryOfferings: async () => answer("listEntryOfferings"),
    listPublishedSponsorLogos: async () => answer("listPublishedSponsorLogos"),
  };
}

export interface PublicReadRigOptions {
  /** Pass no `publicContent` dependency to createApp (fail-closed case). */
  readonly omitPublicContent?: boolean;
  readonly store?: RecordingPublicContentStore;
  /** Mount this store instead of the recording one (for example the real repository on a fake pool). */
  readonly publicContent?: PublicContentStoreFixture;
  readonly overrides?: Record<string, unknown>;
}
export interface PublicReadRig {
  readonly app: ReturnType<typeof createApp>;
  readonly store: RecordingPublicContentStore;
  readonly trs: TestRateLimit;
  /** Rate limit store calls, token verification, directory reads and log events in time order. */
  readonly order: string[];
  readonly records: Record<string, unknown>[];
  readonly lines: string[];
  /** Number of token verifications / Principal directory reads (both must stay 0 on a public route). */
  verifications(): number;
  principalReads(): number;
  send(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
}

export function publicReadRig(options: PublicReadRigOptions = {}): PublicReadRig {
  const order: string[] = [];
  const records: Record<string, unknown>[] = [];
  const lines: string[] = [];
  let verifications = 0;
  let principalReads = 0;
  const store = options.store ?? createRecordingPublicContentStore();
  const trs = createTestRateLimit({ overrides: options.overrides ?? {} });
  const evaluate = trs.store.evaluate.bind(trs.store);
  trs.store.evaluate = async (mode, rules, id) => {
    order.push(`store:${mode}`);
    return evaluate(mode, rules, id);
  };
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
      const record = JSON.parse(line) as Record<string, unknown>;
      records.push(record);
      order.push(`log:${String(record.event_name)}`);
    },
  );
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger,
    auth: {
      verifier: {
        verify: async () => {
          verifications += 1;
          order.push("verify");
          return { subject: "00000000-0000-4000-8000-0000000000b1" };
        },
      },
      store: {
        findByAuthSubject: async () => {
          principalReads += 1;
          order.push("db");
          return {
            directory: { authSubject: "00000000-0000-4000-8000-0000000000b1", emailVerified: true },
            profile: null,
            roles: [],
          };
        },
      },
    },
    rateLimit: trs.rateLimit,
    // Spread, so that the file compiles before AppDependencies has `publicContent` (C4-6).
    ...(options.omitPublicContent ? {} : { publicContent: options.publicContent ?? store }),
  });
  const send = async (path: string, init?: RequestInit): Promise<Response> =>
    app.request(path.startsWith("http") ? path : `${API}${path}`, init, peer());
  return {
    app,
    store,
    trs,
    order,
    records,
    lines,
    verifications: () => verifications,
    principalReads: () => principalReads,
    send,
    get: (path, headers = {}) => send(path, { headers }),
  };
}

export const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; retryable: boolean; details: unknown } }).error;
