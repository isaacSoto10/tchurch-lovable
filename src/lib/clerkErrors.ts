import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";

export function getClerkErrorMessage(error: unknown, fallback: string) {
  if (!isClerkAPIResponseError(error)) {
    return fallback;
  }

  const clerkError = error.errors[0];
  const code = clerkError?.code;
  const message = clerkError?.longMessage || clerkError?.message;

  if (code === "form_identifier_not_found") {
    return "We couldn't find an account with that email. Please sign up first.";
  }

  if (code === "form_identifier_exists") {
    return "An account already exists with that email. Please sign in instead.";
  }

  if (code === "form_code_incorrect") {
    return "That code is not correct. Please check the email and try again.";
  }

  if (code === "verification_expired") {
    return "That code expired. Please request a new code and try again.";
  }

  return message || fallback;
}
