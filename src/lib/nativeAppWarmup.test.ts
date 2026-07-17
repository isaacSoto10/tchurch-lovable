import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getMobileAuthSession: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: mocks.apiFetch,
  eventCollectionPath: () => "/events",
}));
vi.mock("@/lib/devotionalsPagination", () => ({ devotionalsCollectionPath: () => "/devotionals" }));
vi.mock("@/lib/mobileAuth", () => ({
  isNativeMobileAuth: true,
  getMobileAuthSession: mocks.getMobileAuthSession,
}));

import { scheduleNativeAppDataWarmup } from "./nativeAppWarmup";

describe("native app Cloud warmup isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.location.hash = "#/app/services";
    localStorage.setItem("tchurch_church_id", "church-1");
    mocks.getMobileAuthSession.mockReturnValue({ token: "token", user: { id: "user-1" } });
    mocks.apiFetch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("never starts a Cloud warmup on the isolated Studio route", async () => {
    window.location.hash = "#/app/studio-stage";
    const cancel = scheduleNativeAppDataWarmup();
    await vi.advanceTimersByTimeAsync(1_200);

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    cancel?.();
  });

  it("aborts every active request when the Cloud shell unmounts", async () => {
    const signals: AbortSignal[] = [];
    mocks.apiFetch.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signals.push(options.signal);
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const cancel = scheduleNativeAppDataWarmup();
    await vi.advanceTimersByTimeAsync(1_200);
    await vi.waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(4));

    cancel?.();
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("checks the route between batches and does not start another batch in LAN", async () => {
    const releases: Array<() => void> = [];
    mocks.apiFetch.mockImplementation(() => new Promise<void>((resolve) => { releases.push(resolve); }));

    const cancel = scheduleNativeAppDataWarmup();
    await vi.advanceTimersByTimeAsync(1_200);
    await vi.waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(4));

    window.location.hash = "#/app/studio-stage";
    releases.forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.apiFetch).toHaveBeenCalledTimes(4);
    cancel?.();
  });
});
