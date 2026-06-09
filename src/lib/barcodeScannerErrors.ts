export type ScannerErrorNotice = {
  title: string;
  description: string;
  variant?: "destructive";
};

function errorText(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return `${error.name} ${error.message}`.trim();
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isScannerCancelError(error: unknown) {
  return /cancel|cancelled|canceled|dismiss/i.test(errorText(error));
}

export function isCameraPermissionError(error: unknown) {
  const text = errorText(error);
  return (
    /camera.*(access|permission|denied|provided|authorized|permission_denied)/i.test(text) ||
    /(access|permission|denied|provided|authorized|permission_denied).*camera/i.test(text)
  );
}

export function scannerErrorNotice(error: unknown): ScannerErrorNotice | null {
  if (isScannerCancelError(error)) return null;

  if (isCameraPermissionError(error)) {
    return {
      title: "Permiso de cámara requerido",
      description: "Activa la cámara para Tchurch en la configuración del dispositivo y vuelve a escanear.",
      variant: "destructive",
    };
  }

  return {
    title: "No se pudo abrir el scanner",
    description: "Puedes pegar el código manualmente.",
    variant: "destructive",
  };
}

