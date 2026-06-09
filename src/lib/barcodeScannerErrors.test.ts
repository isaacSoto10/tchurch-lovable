import { describe, expect, it } from "vitest";
import { isCameraPermissionError, isScannerCancelError, scannerErrorNotice } from "./barcodeScannerErrors";

describe("barcode scanner error helpers", () => {
  it("silences user cancellations", () => {
    expect(isScannerCancelError(new Error("Scan cancelled by user"))).toBe(true);
    expect(scannerErrorNotice("user canceled scanner")).toBeNull();
  });

  it("recognizes native camera permission failures", () => {
    const error = new Error("Couldn't scan because camera access wasn't provided. Check your camera permissions and try again.");

    expect(isCameraPermissionError(error)).toBe(true);
    expect(scannerErrorNotice(error)).toMatchObject({
      title: "Permiso de cámara requerido",
      variant: "destructive",
    });
  });

  it("returns a manual fallback for unknown scan failures", () => {
    expect(scannerErrorNotice(new Error("Scanner failed"))).toEqual({
      title: "No se pudo abrir el scanner",
      description: "Puedes pegar el código manualmente.",
      variant: "destructive",
    });
  });
});

