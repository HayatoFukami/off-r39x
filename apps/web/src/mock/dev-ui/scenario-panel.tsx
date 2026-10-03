"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveBrowserStorage, type StorageLike } from "../../config/browser-storage";
import { systemClock } from "../backend/clock";
import { createMockDb } from "../backend/db";
import {
  loadScenario,
  resetScenario,
  type Scenario,
  saveScenario,
  scenarioSchema,
} from "../backend/scenario";

// Development-only control surface for the mock backend (DEV-WEB-012 / 013). The control names are
// the scenario key paths themselves; the option values are the zod enum values.

type SelectControl = { path: string; kind: "select"; values: readonly string[] };
type NumberControl = { path: string; kind: "number" };
type Control = SelectControl | NumberControl;

const select = (path: string, ...values: string[]): SelectControl => ({
  path,
  kind: "select",
  values,
});

const CONTROLS: readonly Control[] = [
  select("publicFetch", "ok", "fail", "empty"),
  select("latency", "none", "long"),
  { path: "latencyLongMs", kind: "number" },
  select("sponsorLogos", "published", "none", "fail", "image_broken"),
  select("cart.state", "ok", "fail", "partial"),
  select("cart.purchaseStart", "ok", "reject_one", "limit", "unavailable"),
  select("checkout", "ok", "start_failed", "opportunity_expired"),
  select("karaokeHold", "ok", "conflict", "limit", "expire_before_checkout"),
  select("karaokeSales", "ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"),
  select(
    "paymentOutcome",
    "confirm_after_recheck",
    "confirm",
    "remain_awaiting",
    "payment_failed",
    "review_required",
    "expire",
    "cancel",
  ),
  select("notification", "sent", "failed_retryable"),
  select("auth.session", "ok", "unavailable"),
  select("auth.login", "ok", "credential_failure", "unavailable"),
  select("auth.signup", "confirmation_required", "signed_in", "rejected", "unavailable"),
  select("auth.verify", "ok", "invalid_or_expired", "unavailable"),
  select("auth.reset", "ok", "unavailable"),
  select("auth.resetContext", "valid", "invalid"),
  select("auth.logout", "ok", "provider_failure"),
  select("eventFields", "complete", "missing_optional"),
];

// Fixed seed references of other users (S2 seed) for ownership checks.
const OTHER_USER_LINKS: readonly { label: string; href: string }[] = [
  { label: "Order", href: "/mypage/orders/0d000000-0000-4000-8000-000000000101" },
  { label: "Entry Ticket", href: "/mypage/entry-tickets/7c000000-0000-4000-8000-000000000101" },
  { label: "Karaoke Reservation", href: "/mypage/karaoke/4e000000-0000-4000-8000-000000000101" },
  { label: "Goods", href: "/mypage/goods/91000000-0000-4000-8000-000000000101" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAt(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (isRecord(acc) ? acc[key] : undefined), root);
}

function setAt(root: unknown, keys: readonly string[], value: unknown): unknown {
  const [head, ...rest] = keys;
  if (head === undefined || !isRecord(root)) return value;
  return { ...root, [head]: rest.length === 0 ? value : setAt(root[head], rest, value) };
}

type PanelState =
  | { status: "loading" }
  | { status: "ready"; scenario: Scenario }
  | { status: "corrupted" };

export function ScenarioPanel() {
  const [storage, setStorage] = useState<StorageLike | null>(null);
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [latencyDraft, setLatencyDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [dbMessage, setDbMessage] = useState("");

  useEffect(() => {
    const resolved = resolveBrowserStorage();
    setStorage(resolved);
    const loaded = loadScenario(resolved);
    setState(
      loaded.kind === "ok"
        ? { status: "ready", scenario: loaded.scenario }
        : { status: "corrupted" },
    );
  }, []);

  const change = (path: string, value: unknown): boolean => {
    if (storage === null || state.status !== "ready") return false;
    const parsed = scenarioSchema.safeParse(setAt(state.scenario, path.split("."), value));
    if (!parsed.success) {
      setErrors((current) => ({ ...current, [path]: "指定できない値です" }));
      return false;
    }
    saveScenario(storage, parsed.data);
    setState({ status: "ready", scenario: parsed.data });
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== path)),
    );
    return true;
  };

  const resetAll = (): void => {
    if (storage === null) return;
    setState({ status: "ready", scenario: resetScenario(storage) });
    setLatencyDraft(null);
    setErrors({});
  };

  const resetDb = (): void => {
    if (storage === null) return;
    createMockDb({ storage, clock: systemClock }).reset();
    setDbMessage("モックDBをリセットしました");
  };

  const disabled = state.status !== "ready";

  return (
    <div className="flex flex-col gap-6">
      {state.status === "corrupted" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p
            role="alert"
            className="rounded-base bg-tone-failure-bg px-3 py-2 text-tone-failure-fg"
          >
            保存されているシナリオを読み込めません
          </p>
          <button
            type="button"
            onClick={resetAll}
            className="min-h-9 rounded-base border border-border px-3 text-sm hover:bg-muted"
          >
            シナリオを初期化
          </button>
        </div>
      ) : null}

      <section aria-labelledby="scenario-switches" className="flex flex-col gap-3">
        <h2 id="scenario-switches" className="text-lg font-semibold">
          シナリオ切替
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTROLS.map((control) => {
            const id = `scenario-${control.path.replaceAll(".", "-")}`;
            const errorId = `${id}-error`;
            const current = state.status === "ready" ? getAt(state.scenario, control.path) : "";
            return (
              <div key={control.path} className="flex flex-col gap-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {control.path}
                </label>
                {control.kind === "select" ? (
                  <select
                    id={id}
                    disabled={disabled}
                    value={typeof current === "string" ? current : ""}
                    onChange={(event) => {
                      change(control.path, event.target.value);
                    }}
                    className="min-h-9 rounded-base border border-border bg-background px-2 text-sm"
                  >
                    {control.values.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="number"
                    disabled={disabled}
                    value={latencyDraft ?? (typeof current === "number" ? String(current) : "")}
                    aria-invalid={errors[control.path] !== undefined}
                    aria-describedby={errors[control.path] !== undefined ? errorId : undefined}
                    onChange={(event) => {
                      const text = event.target.value;
                      setLatencyDraft(text);
                      if (change(control.path, text.trim() === "" ? Number.NaN : Number(text))) {
                        setLatencyDraft(null);
                      }
                    }}
                    className="min-h-9 rounded-base border border-border bg-background px-2 text-sm"
                  />
                )}
                {errors[control.path] !== undefined ? (
                  <p id={errorId} className="text-xs text-tone-failure-fg">
                    {errors[control.path]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="scenario-db" className="flex flex-col gap-2">
        <h2 id="scenario-db" className="text-lg font-semibold">
          モックDB
        </h2>
        <div>
          <button
            type="button"
            onClick={resetDb}
            className="min-h-9 rounded-base border border-border px-3 text-sm hover:bg-muted"
          >
            モックDBをリセット
          </button>
        </div>
        <p role="status" className="text-sm">
          {dbMessage}
        </p>
      </section>

      <section aria-label="他者データの参照" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">他者データの参照</h2>
        <p className="text-sm">
          other@example.com の参照。開くと閲覧不可の表示になることを確認します。
        </p>
        <ul className="flex flex-col gap-1">
          {OTHER_USER_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-sm underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
