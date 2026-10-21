import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JoinChurch from "./JoinChurch";

const mocks = vi.hoisted(() => ({ open: vi.fn(), apiFetch: vi.fn(), requestCode: vi.fn(), selection: vi.fn(), getToken: vi.fn(), signedIn: false, userId: "user-1", reload: vi.fn() }));
vi.mock("@/hooks/useAppAuth", () => ({ useAppAuth: () => ({ isLoaded: true, isSignedIn: mocks.signedIn, userId: mocks.userId, getToken: mocks.getToken }) }));
vi.mock("@/lib/churchInvitationHandoff", async (original) => ({ ...await original<typeof import("@/lib/churchInvitationHandoff")>(), openChurchInvitationInBrowser: mocks.open }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch, fetchUserChurchSelection: mocks.selection, setChurchId: vi.fn() }));
vi.mock("@/lib/mobileAuth", async (original) => ({ ...await original<typeof import("@/lib/mobileAuth")>(), isNativeMobileAuth: true, requestMobileJoinAuthCode: mocks.requestCode }));
const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location")!;

function joinTree(query: string) {
  return (<MemoryRouter initialEntries={[`/join-church${query}`]}><Link to="/join-church?invite=second-token">Cambiar invitación de prueba</Link><Routes>
    <Route path="/join-church" element={<JoinChurch />} />
    <Route path="/login" element={<p>Inicio de sesión</p>} />
    <Route path="/app" element={<p>Iglesia actualizada</p>} />
  </Routes></MemoryRouter>);
}
function showJoin(query: string) { return render(joinTree(query)); }

beforeEach(() => {
  mocks.signedIn = false;
  mocks.userId = "user-1";
  mocks.getToken.mockReset().mockResolvedValue("test-session-token");
  mocks.selection.mockReset().mockResolvedValue({ churches: [{ id: "church-1", role: "MEMBER" }], selectedChurchId: "church-1" });
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.apiFetch.mockReset().mockResolvedValue({ valid: true, church: { id: "church-1", name: "Iglesia de prueba" } });
  mocks.requestCode.mockReset().mockResolvedValue({ email: "member@example.test", church: { id: "church-1", name: "Iglesia de prueba" } });
  mocks.reload.mockReset();
});
afterEach(() => { cleanup(); Object.defineProperty(window, "location", locationDescriptor); });

describe("JoinChurch secure invitation links", () => {
  it.each(["invite", "token"])("hands off %s privately without calling code preview or native acceptance", async (key) => {
    const token = "Sensitive-Mixed_token/+?=";
    const { container } = showJoin(`?${new URLSearchParams({ [key]: token, code: "ABCD1234" })}`);
    expect(screen.getByText("Acepta tu invitación")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de iglesia")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith(token));
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.requestCode).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(token);
    expect(container.querySelector(`[href*="Sensitive"]`)).toBeNull();
    expect(screen.queryByText("Acceso confirmado")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Ya terminé en el navegador" }));
    expect(screen.getByText("Inicio de sesión")).toBeInTheDocument();
  });
  it("shows pending and safe retry states when the native browser cannot open", async () => {
    let rejectOpen!: (error: Error) => void;
    mocks.open.mockImplementation(() => new Promise((_resolve, reject) => { rejectOpen = reject; }));
    showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    expect(screen.getByRole("button", { name: "Abriendo invitación..." })).toBeDisabled();
    rejectOpen(new Error("Failure opening https://example.test/?invite=private-token"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos abrir la invitación. Intenta de nuevo.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-token");
    expect(screen.getByRole("button", { name: "Continuar con la invitación" })).toBeEnabled();
  });
  it("reloads authoritative church membership when a signed-in member returns", async () => {
    mocks.signedIn = true;
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: mocks.reload } });
    showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ya terminé en el navegador" }));
    await screen.findByText("Iglesia actualizada");
    expect(mocks.selection).toHaveBeenCalledWith("test-session-token");
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
  it("keeps a failed authority refresh visible and retries without inferring access", async () => {
    mocks.signedIn = true;
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: mocks.reload } });
    mocks.selection.mockRejectedValueOnce(new Error("Forbidden"));
    showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ya terminé en el navegador" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos actualizar tu acceso");
    expect(screen.queryByText("Iglesia actualizada")).not.toBeInTheDocument();
    expect(mocks.reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ya terminé en el navegador" }));
    await screen.findByText("Iglesia actualizada");
    expect(mocks.reload).toHaveBeenCalledOnce();
  });
  it.each(["account change", "unmount"])("ignores a late authority response after %s", async (change) => {
    mocks.signedIn = true;
    let resolveSelection!: (value: unknown) => void;
    mocks.selection.mockImplementation(() => new Promise((resolve) => { resolveSelection = resolve; }));
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: mocks.reload } });
    const rendered = showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ya terminé en el navegador" }));
    await waitFor(() => expect(mocks.selection).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Actualizando acceso..." })).toBeDisabled();
    if (change === "account change") {
      mocks.userId = "user-2";
      rendered.rerender(joinTree("?invite=private-token"));
    } else rendered.unmount();
    resolveSelection({ churches: [{ id: "church-private", role: "ADMIN" }], selectedChurchId: "church-private" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(screen.queryByText("Iglesia actualizada")).not.toBeInTheDocument();
  });
  it("ignores a browser completion after the invitation token changes", async () => {
    let resolveOpen!: () => void;
    mocks.open.mockImplementation(() => new Promise<void>((resolve) => { resolveOpen = resolve; }));
    showJoin("?invite=first-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    fireEvent.click(screen.getByRole("link", { name: "Cambiar invitación de prueba" }));
    resolveOpen();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Ya terminé en el navegador" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar con la invitación" })).toBeEnabled();
    expect(mocks.selection).not.toHaveBeenCalled();
  });
  it("does not request old-account authority after a pending token read resolves", async () => {
    mocks.signedIn = true;
    let resolveToken!: (value: string) => void;
    mocks.getToken.mockImplementation(() => new Promise<string>((resolve) => { resolveToken = resolve; }));
    const rendered = showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la invitación" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ya terminé en el navegador" }));
    mocks.userId = "user-2";
    rendered.rerender(joinTree("?invite=private-token"));
    resolveToken("old-account-session");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.selection).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
  });
  it("keeps ordinary code joining available after leaving the invitation", async () => {
    showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("link", { name: "Usar código de iglesia" }));
    fireEvent.change(screen.getByLabelText("Código de iglesia"), { target: { value: "abcd1234" } });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "Member@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear acceso y unirme" }));
    await waitFor(() => expect(mocks.requestCode).toHaveBeenCalledWith("member@example.test", "ABCD1234"));
    expect(await screen.findByLabelText("Código de verificación")).toBeInTheDocument();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("has a usable back path for a direct signed-out invitation entry", () => {
    showJoin("?invite=private-token");
    fireEvent.click(screen.getByRole("link", { name: "Volver" }));
    expect(screen.getByText("Inicio de sesión")).toBeInTheDocument();
  });
});
