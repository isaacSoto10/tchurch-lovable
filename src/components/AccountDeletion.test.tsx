import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { AccountDeletion } from "./AccountDeletion";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  clearDeletedAccountData: vi.fn(),
  clearMobileAuthSession: vi.fn(),
  getToken: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof import("@/lib/api")>(),
  apiFetch: mocks.apiFetch,
}));
vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ userId: "sample-member", getToken: mocks.getToken, signOut: mocks.signOut }),
}));
vi.mock("@/lib/mobileAuth", async (original) => ({
  ...await original<typeof import("@/lib/mobileAuth")>(),
  isNativeMobileAuth: true,
  getMobileAuthPrincipalId: () => "sample-member",
  clearMobileAuthSession: mocks.clearMobileAuthSession,
}));
vi.mock("@/lib/accountDeletion", () => ({ clearDeletedAccountData: mocks.clearDeletedAccountData }));

function Receipt() {
  const location = useLocation();
  return <p>{location.state.accountDeletion}</p>;
}

function openDeletion() {
  render(
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={["/app/settings"]}>
        <Routes>
          <Route path="/app/settings" element={<AccountDeletion />} />
          <Route path="/login" element={<Receipt />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Eliminar mi cuenta" }));
}

async function enterCode(value: string) {
  fireEvent.change(await screen.findByLabelText("Código de verificación"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Eliminar permanentemente" }));
}

describe("account deletion", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getToken.mockResolvedValue("mock-bearer");
    mocks.clearDeletedAccountData.mockResolvedValue(true);
  });

  it("explains the impact and cancels before contacting the server", async () => {
    openDeletion();
    expect(screen.getByText(/donaciones recurrentes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("sends and reconfirms with authenticated, church-independent requests", async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true });
    openDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(await screen.findByLabelText("Código de verificación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar permanentemente" })).toBeDisabled();
    await enterCode("12 3456");
    expect(await screen.findByText("completed")).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(1, "/account/deletion/start", expect.objectContaining({
      method: "POST", churchId: null, body: "{}",
    }), "mock-bearer");
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, "/account/deletion/confirm", expect.objectContaining({
      method: "POST", churchId: null, body: '{"code":"123456"}', sensitiveBody: true,
    }), "mock-bearer");
    expect(mocks.clearDeletedAccountData).toHaveBeenCalledWith("sample-member", true);
    expect(mocks.clearMobileAuthSession).toHaveBeenCalledOnce();
  });

  it("recovers from an expired code and displays a distinct receipt for queued deletion", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new ApiError("", 400, { code: "INVALID_CODE" }))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: "pending" });
    openDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await enterCode("123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("incorrecto o caducó");
    fireEvent.click(screen.getByRole("button", { name: "Solicitar otro código" }));
    await waitFor(() => expect(screen.getByLabelText("Código de verificación")).toHaveValue(""));
    await enterCode("654321");
    expect(await screen.findByText("pending")).toBeInTheDocument();
    expect(mocks.clearMobileAuthSession).toHaveBeenCalledOnce();
  });

  it("offers reauthentication when the server no longer accepts the session", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError("", 401, { code: "UNAUTHENTICATED" }));
    mocks.signOut.mockResolvedValue(undefined);
    openDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tu sesión venció");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith("/login"));
    expect(mocks.clearDeletedAccountData).not.toHaveBeenCalled();
  });
});
