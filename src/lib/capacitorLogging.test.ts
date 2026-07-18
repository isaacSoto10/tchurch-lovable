import { describe, expect, it } from "vitest";

import capacitorConfig from "../../capacitor.config";

describe("Capacitor logging", () => {
  it("keeps native bridge logging disabled for every launch path", () => {
    expect(capacitorConfig.loggingBehavior).toBe("none");
  });
});
