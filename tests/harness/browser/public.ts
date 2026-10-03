import type { Page } from "@playwright/test";
import type {
  AnnouncementSummary,
  BusinessDateJst,
  FaqItem,
  Ref,
  UtcInstant,
} from "../../../apps/web/src/api-client/types.ts";
import type { DbState } from "../../../apps/web/src/mock/backend/db.ts";
import { buildSeed } from "../../../apps/web/src/mock/backend/seed.ts";
import {
  bucketStartHourJst,
  toBusinessDateJst,
} from "../../../apps/web/src/presentation/format/datetime.ts";
import { NOW_ISO } from "../mock-seed.ts";
import { KEYS, scenarioJson } from "./shell.ts";

// Browser-side helpers for the S4 public page suite (tests/contracts/s4-public.md section 4).
// Test-only. All data is synthetic. Playwright cannot load the mock backend (it imports
// @off-r39x/domain), so the expected values come from the pure seed builder and are filtered
// here by the SPEC-050 rules (published only, newest first, JST buckets), not by app code.

/** Fixes the page clock so that the seed's relative dates are deterministic (DEV-REL-001). */
export async function fixClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(NOW_ISO));
}

export function seedState(): DbState {
  return buildSeed(NOW_ISO);
}

export function publicScenario(patch: Record<string, unknown> = {}): Record<string, string> {
  return { [KEYS.scenario]: scenarioJson(patch) };
}

/** A DB seed JSON for localStorage, with a caller-supplied edit applied to a deep copy. */
export function dbJson(edit: (state: DbState) => void): Record<string, string> {
  const state = structuredClone(seedState());
  edit(state);
  return { [KEYS.db]: JSON.stringify(state) };
}

// ---- expected public data (SPEC-050 11.1 / 11.2 / 13.2 / 14.1) -----------------------------

export type ExpectedAnnouncement = AnnouncementSummary & { body: string };

/** PUBLISHED announcements, newest first. */
export function expectedAnnouncements(): ExpectedAnnouncement[] {
  return seedState()
    .announcements.filter((a) => a.publication === "PUBLISHED")
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((a) => ({
      announcementRef: a.ref as Ref<"announcement">,
      title: a.title,
      excerpt: a.excerpt,
      publishedAt: a.publishedAt as UtcInstant,
      body: a.body,
    }));
}

export function expectedFaqs(): FaqItem[] {
  return seedState()
    .faqs.filter((f) => f.publication === "PUBLISHED")
    .map((f) => ({ id: f.id, question: f.question, answer: f.answer }));
}

export function expectedEvent() {
  return seedState().event;
}

export function expectedSales() {
  const { karaoke } = seedState();
  return {
    price: karaoke.price,
    startsAt: karaoke.startsAt as UtcInstant,
    endsAt: karaoke.endsAt as UtcInstant,
    salesDates: karaoke.salesDates as BusinessDateJst[],
  };
}

export type ExpectedSlot = {
  slotRef: Ref<"slot">;
  usageStart: UtcInstant;
  usageEnd: UtcInstant;
  state: DbState["slots"][number]["state"];
};
export type ExpectedBucket = {
  startHour: number;
  totalSlots: number;
  availableSlots: number;
  slots: ExpectedSlot[];
};

/** JST 1-hour buckets by usage_start for one business date (SPEC-050 13.2), sale running. */
export function expectedBuckets(date: BusinessDateJst): ExpectedBucket[] {
  const slots = seedState()
    .slots.filter((s) => toBusinessDateJst(s.usageStart as UtcInstant) === date)
    .sort((a, b) => Date.parse(a.usageStart) - Date.parse(b.usageStart))
    .map(
      (s): ExpectedSlot => ({
        slotRef: s.ref as Ref<"slot">,
        usageStart: s.usageStart as UtcInstant,
        usageEnd: s.usageEnd as UtcInstant,
        state: s.state,
      }),
    );
  const byHour = new Map<number, ExpectedSlot[]>();
  for (const slot of slots) {
    const hour = bucketStartHourJst(slot.usageStart);
    byHour.set(hour, [...(byHour.get(hour) ?? []), slot]);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startHour, list]) => ({
      startHour,
      totalSlots: list.length,
      availableSlots: list.filter((s) => s.state === "AVAILABLE").length,
      slots: list,
    }));
}

/** Public (published) goods in seed order. */
export function expectedGoods() {
  return seedState()
    .goods.filter((g) => g.published)
    .map((g) => ({
      goodsRef: g.ref as Ref<"goods">,
      name: g.name,
      shortDescription: g.shortDescription,
      unitPrice: g.unitPrice,
      startsAt: g.startsAt as UtcInstant,
    }));
}

/** Business outcomes that must never appear while a public read is still loading (SPEC-050 9.1). */
export const LOADING_FORBIDDEN =
  /売り切れ|販売済み|販売停止|販売終了|販売開始前|0件|[¥￥]\s*\d|\d+\s*円|この日に販売対象の枠はありません|現在公開中の情報はありません|取得できません|対象日はありません/;

/** Heading levels of every heading in the main landmark, in document order. */
export async function mainHeadingLevels(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6"),
    ).map((el) => Number(el.tagName.slice(1))),
  );
}

export function hasLevelSkip(levels: readonly number[]): boolean {
  let previous = 0;
  for (const level of levels) {
    if (level > previous + 1) return true;
    previous = level;
  }
  return false;
}

/** Horizontal overflow in px (<= 0 means none). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
