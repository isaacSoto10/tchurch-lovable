import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";

export function getClerkErrorMessage(error: unknown, fallback: string) {
  if (!isClerkAPIResponseError(error)) {
    return fallback;
  }

  const clerkError = error.errors[0];
  const code = clerkError?.code;
  const message = clerkError?.longMessage || clerkError?.message;

  if (code === "form_identifier_not_found") {
    return "No encontramos una cuenta con ese correo. Crea una cuenta primero.";
  }

  if (code === "form_identifier_exists") {
    return "Ya existe una cuenta con ese correo. Inicia sesión.";
  }

  if (code === "form_code_incorrect") {
    return "Ese código no es correcto. Revisa tu correo e intenta de nuevo.";
  }

  if (code === "verification_expired") {
    return "Ese código expiró. Solicita uno nuevo e intenta de nuevo.";
  }

  return message || fallback;
}
