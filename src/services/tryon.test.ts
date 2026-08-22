import { describe, it, expect } from "vitest";
import { startOfUtcDay } from "./tryon";

describe("startOfUtcDay", () => {
  it("floors to midnight UTC on the same calendar day", () => {
    const now = new Date("2026-08-22T15:42:07.123Z");
    expect(startOfUtcDay(now).toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("does not roll over near UTC midnight", () => {
    const justAfterMidnight = new Date("2026-08-22T00:00:01.000Z");
    expect(startOfUtcDay(justAfterMidnight).toISOString()).toBe("2026-08-22T00:00:00.000Z");
  });

  it("two timestamps on the same UTC day produce the same floor (idempotent for the daily-limit check)", () => {
    const morning = startOfUtcDay(new Date("2026-08-22T01:00:00.000Z"));
    const night = startOfUtcDay(new Date("2026-08-22T23:59:59.000Z"));
    expect(morning.getTime()).toBe(night.getTime());
  });

  it("adjacent days produce different floors", () => {
    const day1 = startOfUtcDay(new Date("2026-08-22T23:59:59.000Z"));
    const day2 = startOfUtcDay(new Date("2026-08-23T00:00:00.000Z"));
    expect(day1.getTime()).not.toBe(day2.getTime());
  });
});
