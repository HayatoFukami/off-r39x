import { describe, expect, it } from "vitest";
import {
  createInMemoryStorage,
  resolveBrowserStorage,
  type StorageLike,
} from "../../../../apps/web/src/config/browser-storage.ts";
import { createMemoryStorage } from "../../../harness/mock-backend.ts";

// Contract: tests/contracts/s3-layout.md section 2.4 (unavailable storage must not crash the shell).

const throwing = (): StorageLike => ({
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("denied");
  },
});

describe("TC-DEV-WEB-013-111 createInMemoryStorage", () => {
  it("stores, reads and removes values, independently per instance", () => {
    const a = createInMemoryStorage();
    const b = createInMemoryStorage();
    a.setItem("k", "v");
    expect(a.getItem("k")).toBe("v");
    expect(b.getItem("k")).toBeNull();
    a.removeItem("k");
    expect(a.getItem("k")).toBeNull();
  });
});

describe("TC-DEV-WEB-013-112 resolveBrowserStorage", () => {
  it("returns the given storage itself and leaves no probe residue", () => {
    const real = createMemoryStorage();
    const resolved = resolveBrowserStorage(() => real);
    expect(resolved).toBe(real);
    expect(real.dump()).toEqual({});
  });

  it("falls back to a working in-memory storage when access throws", () => {
    const resolved = resolveBrowserStorage(() => {
      throw new Error("SecurityError");
    });
    resolved.setItem("r39x.test.fallback.throw", "1");
    expect(resolved.getItem("r39x.test.fallback.throw")).toBe("1");
  });

  it("falls back when the storage is null", () => {
    const resolved = resolveBrowserStorage(() => null);
    resolved.setItem("r39x.test.fallback.null", "1");
    expect(resolved.getItem("r39x.test.fallback.null")).toBe("1");
  });

  it("falls back when writing fails (quota / private mode)", () => {
    const resolved = resolveBrowserStorage(() => throwing());
    expect(() => resolved.setItem("r39x.test.fallback.quota", "1")).not.toThrow();
    expect(resolved.getItem("r39x.test.fallback.quota")).toBe("1");
  });

  it("shares one in-memory fallback so the api and auth ports see the same state", () => {
    const first = resolveBrowserStorage(() => null);
    const second = resolveBrowserStorage(() => throwing());
    expect(second).toBe(first);
  });

  it("does not throw during SSR (no window) with the default getter", () => {
    expect(() => resolveBrowserStorage()).not.toThrow();
    const resolved = resolveBrowserStorage();
    resolved.setItem("r39x.test.ssr", "1");
    expect(resolved.getItem("r39x.test.ssr")).toBe("1");
  });
});
