import { describe, expect, it, vi } from "vitest";
import { StudioLANPrivacyCoordinator } from "./studioLANPrivacyCoordinator";
import type { StudioLANPrivacyContext } from "./studioLANClient";

describe("StudioLANPrivacyCoordinator", () => {
  it("serializes principal, church, unknown-auth, and revocation signals", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const contexts: StudioLANPrivacyContext[] = [];
    const synchronize = vi.fn(async (context: StudioLANPrivacyContext) => {
      contexts.push(context);
      if (contexts.length === 1) await first;
    });
    const coordinator = new StudioLANPrivacyCoordinator(synchronize);

    const principal = coordinator.principal("user-1");
    const account = coordinator.authorize("user-1", "church-1");
    const temporaryFailure = coordinator.authorizationUnknown();
    const revocation = coordinator.accessRevoked();

    await Promise.resolve();
    expect(contexts).toEqual([{ access: "principal", principalId: "user-1" }]);
    releaseFirst?.();
    await Promise.all([principal, account, temporaryFailure, revocation]);
    expect(contexts).toEqual([
      { access: "principal", principalId: "user-1" },
      { access: "authorized", principalId: "user-1", churchId: "church-1" },
      { access: "unknown" },
      { access: "revoked" },
    ]);
  });

  it("does not let one native failure poison the next authoritative transition", async () => {
    const synchronize = vi.fn()
      .mockRejectedValueOnce(new Error("injected-persistence-failure"))
      .mockResolvedValue(undefined);
    const coordinator = new StudioLANPrivacyCoordinator(synchronize);

    await expect(coordinator.signedOut()).rejects.toThrow("injected-persistence-failure");
    await expect(coordinator.authorize("user-2", "church-2")).resolves.toBeUndefined();
    expect(synchronize).toHaveBeenCalledTimes(2);
  });
});
