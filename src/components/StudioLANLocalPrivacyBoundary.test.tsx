import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principalId: "user-1" as string | null,
  authChange: null as (() => void) | null,
  principal: vi.fn(),
  signedOut: vi.fn(),
  suspendLogging: vi.fn(),
}));

vi.mock("@/lib/mobileAuth", () => ({
  getMobileAuthPrincipalId: () => mocks.principalId,
  onMobileAuthChange: (listener: () => void) => {
    mocks.authChange = listener;
    return () => { mocks.authChange = null; };
  },
}));

vi.mock("@/lib/studioLANPrivacyCoordinator", () => ({
  studioLANPrivacyCoordinator: {
    principal: mocks.principal,
    signedOut: mocks.signedOut,
  },
}));
vi.mock("@/lib/userActionLogger", () => ({ setUserActionLoggingSuspended: mocks.suspendLogging }));

import { StudioLANLocalPrivacyBoundary } from "./StudioLANLocalPrivacyBoundary";

describe("StudioLANLocalPrivacyBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.principalId = "user-1";
    mocks.authChange = null;
    mocks.principal.mockResolvedValue(undefined);
    mocks.signedOut.mockResolvedValue(undefined);
  });

  it("verifies the locally remembered principal before exposing Studio", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let release: (() => void) | undefined;
    mocks.principal.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

    const view = render(<StudioLANLocalPrivacyBoundary><div>Salida de músicos</div></StudioLANLocalPrivacyBoundary>);

    expect(screen.getByRole("status")).toHaveTextContent(/verificando el acceso local/i);
    expect(screen.queryByText("Salida de músicos")).not.toBeInTheDocument();
    expect(mocks.principal).toHaveBeenCalledWith("user-1");
    expect(mocks.signedOut).not.toHaveBeenCalled();

    await act(async () => { release?.(); });
    expect(await screen.findByText("Salida de músicos")).toBeInTheDocument();
    expect(mocks.suspendLogging).toHaveBeenCalledWith(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    view.unmount();
    fetchSpy.mockRestore();
    expect(mocks.suspendLogging).toHaveBeenLastCalledWith(false);
  });

  it("purges an unowned cold scope without consulting Cloud", async () => {
    mocks.principalId = null;
    render(<StudioLANLocalPrivacyBoundary><div>Salida de músicos</div></StudioLANLocalPrivacyBoundary>);

    await waitFor(() => expect(mocks.signedOut).toHaveBeenCalledOnce());
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(await screen.findByText("Salida de músicos")).toBeInTheDocument();
  });

  it("closes visible output while a changed local account is being isolated", async () => {
    render(<StudioLANLocalPrivacyBoundary><div>Salida de músicos</div></StudioLANLocalPrivacyBoundary>);
    expect(await screen.findByText("Salida de músicos")).toBeInTheDocument();

    let release: (() => void) | undefined;
    mocks.principalId = "user-2";
    mocks.principal.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    act(() => mocks.authChange?.());

    expect(screen.queryByText("Salida de músicos")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/verificando el acceso local/i);
    expect(mocks.principal).toHaveBeenLastCalledWith("user-2");

    await act(async () => { release?.(); });
    expect(await screen.findByText("Salida de músicos")).toBeInTheDocument();
  });
});
