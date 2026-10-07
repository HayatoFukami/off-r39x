import { describe, expect, it } from "vitest";
import { decidePurpose } from "../../../../apps/web/src/mock/backend/purpose.ts";

describe("TC-BR-ORD-013-101 decidePurpose (BR-ORD-013, FR-CRT-002)", () => {
  it("Entry only -> ENTRY_TICKET_PURCHASE", () => {
    expect(decidePurpose(["ENTRY_TICKET"])).toBe("ENTRY_TICKET_PURCHASE");
    expect(decidePurpose(["ENTRY_TICKET", "ENTRY_TICKET"])).toBe("ENTRY_TICKET_PURCHASE");
  });

  it("Goods only -> GOODS_PURCHASE", () => {
    expect(decidePurpose(["GOODS"])).toBe("GOODS_PURCHASE");
    expect(decidePurpose(["GOODS", "GOODS", "GOODS"])).toBe("GOODS_PURCHASE");
  });

  it("Entry and Goods together -> ENTRY_GOODS_PURCHASE regardless of order or duplicates", () => {
    expect(decidePurpose(["ENTRY_TICKET", "GOODS"])).toBe("ENTRY_GOODS_PURCHASE");
    expect(decidePurpose(["GOODS", "ENTRY_TICKET"])).toBe("ENTRY_GOODS_PURCHASE");
    expect(decidePurpose(["GOODS", "ENTRY_TICKET", "GOODS", "ENTRY_TICKET"])).toBe(
      "ENTRY_GOODS_PURCHASE",
    );
  });

  it("Karaoke only -> KARAOKE_PURCHASE", () => {
    expect(decidePurpose(["KARAOKE"])).toBe("KARAOKE_PURCHASE");
  });

  it("never mixes Karaoke with anything else (a 4th composite purpose is forbidden)", () => {
    expect(() => decidePurpose(["KARAOKE", "ENTRY_TICKET"])).toThrow(Error);
    expect(() => decidePurpose(["GOODS", "KARAOKE"])).toThrow(Error);
    expect(() => decidePurpose(["ENTRY_TICKET", "GOODS", "KARAOKE"])).toThrow(Error);
  });

  it("rejects an empty list", () => {
    expect(() => decidePurpose([])).toThrow(Error);
  });
});
