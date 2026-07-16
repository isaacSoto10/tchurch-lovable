import {
  synchronizeStudioLANPrivacyContext,
  type StudioLANPrivacyContext,
} from "@/lib/studioLANClient";

type PrivacySynchronizer = (context: StudioLANPrivacyContext) => Promise<void>;

/**
 * Single serialization point for every account/church privacy transition.
 * Unknown auth/network state deliberately preserves the current LAN scope;
 * only an authoritative scope or revocation can rotate it.
 */
export class StudioLANPrivacyCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly synchronize: PrivacySynchronizer = synchronizeStudioLANPrivacyContext) {}

  private enqueue(context: StudioLANPrivacyContext) {
    const operation = this.tail.then(() => this.synchronize(context));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  authorizationUnknown() {
    return this.enqueue({ access: "unknown" });
  }

  principal(principalId: string) {
    return this.enqueue({ access: "principal", principalId });
  }

  authorize(principalId: string, churchId: string) {
    return this.enqueue({ access: "authorized", principalId, churchId });
  }

  signedOut() {
    return this.enqueue({ access: "signedOut" });
  }

  accessRevoked() {
    return this.enqueue({ access: "revoked" });
  }
}

export const studioLANPrivacyCoordinator = new StudioLANPrivacyCoordinator();
