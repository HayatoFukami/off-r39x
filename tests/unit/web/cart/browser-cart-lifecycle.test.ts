import { afterEach, describe, expect, it, vi } from "vitest";
import { CART, metadata } from "../../../harness/cart-lifecycle.ts";

afterEach(() => vi.unstubAllGlobals());

describe("TC-FR-CRT-012-012 initial Browser storage denial stays isolated until explicit recovery", () => {
  async function setup() {
    vi.resetModules();
    const data = new Map([
      ["r39x.cart.v1", CART],
      ["r39x.cart-lifecycle.v1", metadata("authenticated")],
    ]);
    const faults = { denied: true, clear: false, metadata: false };
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem(key: string, value: string) {
        if (faults.metadata) throw new DOMException("test-only metadata failure", "SecurityError");
        data.set(key, value);
      },
      removeItem(key: string) {
        if (faults.clear) throw new DOMException("test-only clear failure", "SecurityError");
        data.delete(key);
      },
    };
    const browser = {
      get localStorage() {
        if (faults.denied) throw new DOMException("test-only denial", "SecurityError");
        return storage;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", browser);
    vi.stubGlobal("navigator", {});
    const module = await import("../../../../apps/web/src/features/cart/cart-lifecycle.ts");
    return { ...module, data, faults, browser };
  }

  it("does not automatically create a lifecycle after storage alone recovers", async () => {
    const s = await setup();
    expect(s.getBrowserCartLifecycle()).toBeNull();
    s.faults.denied = false;
    expect(s.getBrowserCartLifecycle()).toBeNull();
    expect(s.data.get(s.CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.data.get("r39x.cart.v1")).toBe(CART);
  });

  it("SSR absence does not count as Browser storage denial", async () => {
    const s = await setup();
    vi.stubGlobal("window", undefined);
    expect(s.getBrowserCartLifecycle()).toBeNull();
    vi.stubGlobal("window", s.browser);
    s.faults.denied = false;
    expect(s.getBrowserCartLifecycle()).not.toBeNull();
  });

  it("only explicit recovery clears the old Cart and updates provenance; exposure waits for reload", async () => {
    const s = await setup();
    expect(s.getBrowserCartLifecycle()).toBeNull();
    s.faults.denied = false;
    await expect(s.recoverBrowserCartLifecycle("authenticated")).resolves.toBe("recovered");
    expect(s.data.has("r39x.cart.v1")).toBe(false);
    expect(s.data.get(s.CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("authenticated"));
    expect(s.getBrowserCartLifecycle()).toBeNull();
  });

  it.each(["denied", "clear", "metadata"] as const)(
    "keeps Cart inaccessible after a %s recovery failure and allows explicit retry",
    async (fault) => {
      const s = await setup();
      expect(s.getBrowserCartLifecycle()).toBeNull();
      s.faults.denied = false;
      s.faults[fault] = true;
      await expect(s.recoverBrowserCartLifecycle("guest")).resolves.toBe("failed");
      expect(s.getBrowserCartLifecycle()).toBeNull();
      s.faults[fault] = false;
      expect(s.getBrowserCartLifecycle()).toBeNull();
      await expect(s.recoverBrowserCartLifecycle("guest")).resolves.toBe("recovered");
      expect(s.data.has("r39x.cart.v1")).toBe(false);
      expect(s.data.get(s.CART_LIFECYCLE_STORAGE_KEY)).toBe(metadata("guest"));
    },
  );
});
