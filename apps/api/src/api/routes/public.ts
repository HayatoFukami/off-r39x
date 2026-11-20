// SPEC-110 §6 / §14 / §26 / §26.1: the public namespace (no authentication) with the six public read
// Operations API-PUB-001..005 and API-PUB-012. The route declarations and the response schemas live in the
// @off-r39x/api-contract builder (DEV-API-002/003); this file only injects the fail-closed guard, the Query
// and Path validation and the service result -> HTTP mapping (DEV-API-001). Every route is registered in
// ../routes.ts ROUTES as `public_read` (DEV-RLM-005).
//
// No token, Principal or Capability is read here: `public.read` is allowed for everyone including a Guest
// (SPEC-060 §24), the `Authorization` header and Cookie are not read (API-PUB-READ-001), and the Rate
// Limit Stage 1 middleware has already run by the time a handler is reached.
import {
  announcementRefParamSchema,
  createPublicReadRpc,
  emptyPublicQuerySchema,
  type PublicAnnouncement,
  type PublicAnnouncementList,
  type PublicEntryOfferingList,
  type PublicEvent,
  type PublicFaqList,
  type PublicSponsorLogoList,
  publicAnnouncementListSchema,
  publicAnnouncementSchema,
  publicEntryOfferingListSchema,
  publicEventSchema,
  publicFaqListSchema,
  publicSponsorLogoListSchema,
} from "@off-r39x/api-contract";
import type { RouteRegistration } from "@off-r39x/security";
import type { MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";
import { validateQuery } from "../middleware/query.ts";
import { ROUTES } from "../routes.ts";
import {
  listEntryOfferings,
  listPublishedAnnouncements,
  listPublishedFaqs,
  listPublishedSponsorLogos,
  type PublicContentStore,
  type PublicReadResult,
  readPublicEvent,
  readPublishedAnnouncement,
} from "../services/index.ts";

export interface PublicRouteDependencies {
  readonly app: {
    readonly publicContent?: PublicContentStore | undefined;
  };
}

/**
 * API-PUB-005 / UCR-110-004: whether an Entry purchase Operation (API-PUR-ENTRY-001 or API-PUR-CART-001)
 * is in the route registry. Derived from the registry itself, so registering the purchase route is the
 * only step that changes the answer; nothing here can be switched on its own.
 */
export function isEntryPurchaseMounted(
  routes: readonly Pick<RouteRegistration, "operationId">[],
): boolean {
  return routes.some(
    (route) =>
      route.operationId === "API-PUR-ENTRY-001" || route.operationId === "API-PUR-CART-001",
  );
}

// A service result -> data, or the failure the route answers (API-PUB-READ-002, API-PUB-READ-006).
function unwrap<T>(result: PublicReadResult<T>): T {
  if (result.kind === "ok") return result.data;
  if (result.kind === "not_found") throw new ApiFailure("RESOURCE_NOT_FOUND");
  if (result.kind === "inconsistent") throw new ApiFailure("INTERNAL_ERROR");
  throw new ApiFailure("DATABASE_TEMPORARY_FAILURE");
}

// API-PUB-READ-006: a row the response schema refuses (for example a PUBLISHED Announcement without
// published_at) fails the whole Operation with a retryable 503; it is not guessed, skipped or sent. The
// builder checks the envelope again (DEV-API-003), so a refusal there is a producer defect (500).
function checked<S extends z.ZodType>(schema: S, dto: unknown): z.output<S> {
  const result = schema.safeParse(dto);
  if (!result.success) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
  return result.data;
}

export function createPublicRoutes(dependencies: PublicRouteDependencies) {
  const { publicContent } = dependencies.app;
  const purchaseRouteMounted = isEntryPurchaseMounted(ROUTES);
  // Fail closed when the store is missing; runs before the Query is validated.
  const guard: MiddlewareHandler<ApiEnvironment> = async (_c, next) => {
    if (!publicContent) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    await next();
  };
  const store = (): PublicContentStore => {
    if (!publicContent) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    return publicContent;
  };
  return createPublicReadRpc<ApiEnvironment>({
    requestId: (c) => c.get("requestId"),
    guard,
    query: validateQuery(emptyPublicQuerySchema),
    event: {
      load: async (): Promise<PublicEvent> => {
        const event = unwrap(await readPublicEvent(store()));
        return checked(publicEventSchema, {
          event_ref: event.publicRef,
          name: event.name,
          summary: event.summary,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          business_timezone: event.businessTimezone,
          venue_name: event.venueName,
          venue_details: event.venueDetails,
          access_information: event.accessInformation,
          participant_notices: event.participantNotices,
        });
      },
    },
    faqs: {
      load: async (): Promise<PublicFaqList> => {
        const faqs = unwrap(await listPublishedFaqs(store()));
        return checked(publicFaqListSchema, {
          items: faqs.map((faq) => ({
            faq_ref: faq.publicRef,
            question: faq.question,
            answer: faq.answer,
            sort_order: faq.sortOrder,
          })),
        });
      },
    },
    announcements: {
      load: async (): Promise<PublicAnnouncementList> => {
        const announcements = unwrap(await listPublishedAnnouncements(store()));
        return checked(publicAnnouncementListSchema, {
          items: announcements.map((announcement) => ({
            announcement_ref: announcement.publicRef,
            title: announcement.title,
            published_at: announcement.publishedAt,
            excerpt: announcement.excerpt,
            excerpt_truncated: announcement.excerptTruncated,
          })),
        });
      },
    },
    announcement: {
      load: async (c): Promise<PublicAnnouncement> => {
        // API-PUB-004 Path: a UUID of any case; the lower-case value is the only one the store sees.
        const ref = announcementRefParamSchema.safeParse(c.req.param("announcement_ref"));
        if (!ref.success) throw new ApiFailure("VALIDATION_FAILED");
        const announcement = unwrap(await readPublishedAnnouncement(store(), ref.data));
        return checked(publicAnnouncementSchema, {
          announcement_ref: announcement.publicRef,
          title: announcement.title,
          body: announcement.body,
          published_at: announcement.publishedAt,
        });
      },
    },
    entryOfferings: {
      load: async (): Promise<PublicEntryOfferingList> => {
        const offerings = unwrap(await listEntryOfferings(store(), { purchaseRouteMounted }));
        return checked(publicEntryOfferingListSchema, {
          items: offerings.map((offering) => ({
            offering_ref: offering.publicRef,
            name: offering.name,
            description: offering.description,
            unit_price: { amount: offering.unitAmount, currency: offering.currency },
            sales_starts_at: offering.salesStartsAt,
            sales_ends_at: offering.salesEndsAt,
            purchase_limit: offering.purchaseLimit,
            availability: offering.availability,
            unavailable_reason: offering.reason,
          })),
        });
      },
    },
    sponsorLogos: {
      load: async (): Promise<PublicSponsorLogoList> => {
        const logos = unwrap(await listPublishedSponsorLogos(store()));
        return checked(publicSponsorLogoListSchema, {
          items: logos.map((logo) => ({
            logo_ref: logo.publicRef,
            display_name: logo.displayName,
            image_url: logo.imageUrl,
            link_url: logo.linkUrl,
            sort_order: logo.sortOrder,
          })),
        });
      },
    },
  });
}
