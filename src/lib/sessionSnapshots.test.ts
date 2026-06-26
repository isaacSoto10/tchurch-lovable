import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSessionSnapshot, sessionSnapshotKey, writeSessionSnapshot } from "./sessionSnapshots";

type TestSnapshot = {
  items: string[];
};

function isTestSnapshot(data: unknown): data is TestSnapshot {
  return Boolean(data && typeof data === "object" && Array.isArray((data as Partial<TestSnapshot>).items));
}

describe("session snapshots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it("stores short-lived scoped page data", () => {
    const key = sessionSnapshotKey("test", "church 1");

    writeSessionSnapshot(key, { items: ["events"] }, { nativeOnly: false });

    expect(readSessionSnapshot<TestSnapshot>(key, { nativeOnly: false, validate: isTestSnapshot })?.data).toEqual({
      items: ["events"],
    });
  });

  it("ignores expired or invalid payloads", () => {
    const key = sessionSnapshotKey("test", "church 1");

    writeSessionSnapshot(key, { items: ["old"] }, { nativeOnly: false });
    vi.setSystemTime(new Date("2026-06-26T12:03:00.000Z"));

    expect(readSessionSnapshot<TestSnapshot>(key, { nativeOnly: false, validate: isTestSnapshot, ttlMs: 60_000 })).toBeNull();

    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: { items: "not-array" } }));

    expect(readSessionSnapshot<TestSnapshot>(key, { nativeOnly: false, validate: isTestSnapshot })).toBeNull();
  });
});
