import { describe, expect, it } from "vitest";
import { getBest, recordKey, recordScore, type KV, type RecordOptions } from "../src/game/records";

const memory = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const base: RecordOptions = { placeSet: "all", level: "easy", size: false, orientation: false, streetNames: false };

describe("recordKey", () => {
  it("differs for every option that changes difficulty", () => {
    const keys = new Set([
      recordKey("caba", base),
      recordKey("caba", { ...base, placeSet: "stadiums" }),
      recordKey("caba", { ...base, level: "hard" }),
      recordKey("caba", { ...base, size: true }),
      recordKey("caba", { ...base, orientation: true }),
      recordKey("caba", { ...base, streetNames: true }),
      recordKey("otra", base),
      recordKey("caba", { ...base, length: "full" }),
    ]);
    expect(keys.size).toBe(8);
  });
  it("quick games keep the original keys (existing records survive)", () => {
    expect(recordKey("caba", { ...base, length: "quick" })).toBe(recordKey("caba", base));
  });
  it("ignores street names outside the easy level", () => {
    expect(recordKey("caba", { ...base, level: "hard", streetNames: true })).toBe(recordKey("caba", { ...base, level: "hard" }));
  });
});

describe("recordScore", () => {
  it("keeps only improvements", () => {
    const kv = memory();
    const key = recordKey("caba", base);
    expect(recordScore(key, 3000, 7000, kv)).toEqual({ previous: null, isRecord: true });
    expect(recordScore(key, 2500, 7000, kv).isRecord).toBe(false);
    expect(getBest(key, kv)!.score).toBe(3000);
    const r = recordScore(key, 4100, 7000, kv);
    expect(r.isRecord).toBe(true);
    expect(r.previous!.score).toBe(3000);
    expect(getBest(key, kv)!.score).toBe(4100);
  });
  it("a zero score is never a record", () => {
    expect(recordScore("k", 0, 7000, memory()).isRecord).toBe(false);
  });
  it("survives missing, corrupt or failing storage", () => {
    expect(getBest("k", null)).toBeNull();
    const corrupt: KV = { getItem: () => "{not json", setItem: () => {} };
    expect(getBest("k", corrupt)).toBeNull();
    const failing: KV = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(recordScore("k", 10, 100, failing).isRecord).toBe(true);
  });
});
