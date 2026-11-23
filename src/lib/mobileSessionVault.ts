import { registerPlugin } from "@capacitor/core";

interface MobileSessionVault {
  load(): Promise<{ session?: string | null }>;
  save(options: { session: string }): Promise<void>;
  clear(): Promise<void>;
}

export const mobileSessionVault = registerPlugin<MobileSessionVault>("MobileSessionVault");
