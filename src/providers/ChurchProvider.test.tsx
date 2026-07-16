import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: true,
    userId: "user-1" as string | null,
    getToken: vi.fn(),
  },
  fetchSelection: vi.fn(),
  setChurchId: vi.fn(),
  getChurchId: vi.fn(),
  principal: vi.fn(),
  authorize: vi.fn(),
  authorizationUnknown: vi.fn(),
  signedOut: vi.fn(),
  accessRevoked: vi.fn(),
}));

vi.mock("@/hooks/useAppAuth", () => ({ useAppAuth: () => mocks.auth }));
vi.mock("@/lib/api", () => ({
  fetchUserChurchSelection: mocks.fetchSelection,
  getChurchId: mocks.getChurchId,
  setChurchId: mocks.setChurchId,
}));
vi.mock("@/lib/userActionLogger", () => ({ logUserAction: vi.fn() }));
vi.mock("@/lib/studioLANPrivacyCoordinator", () => ({
  studioLANPrivacyCoordinator: {
    principal: mocks.principal,
    authorize: mocks.authorize,
    authorizationUnknown: mocks.authorizationUnknown,
    signedOut: mocks.signedOut,
    accessRevoked: mocks.accessRevoked,
  },
}));

import { ChurchProvider, useChurch } from "./ChurchProvider";

function church(id: string) {
  return {
    id,
    name: id,
    slug: id,
    role: "MEMBER",
    brandColor: null,
    logoUrl: null,
    plan: "FREE",
    memberLimit: 10,
    trialEndsAt: null,
    subscriptionStatus: null,
  };
}

function Probe() {
  const { churches, selectedChurch, switchChurch, error } = useChurch();
  return (
    <div>
      <span data-testid="selected">{selectedChurch?.id || "none"}</span>
      <span data-testid="error">{error || "none"}</span>
      {churches.map((item) => (
        <button key={item.id} onClick={() => void switchChurch(item)}>{item.id}</button>
      ))}
    </div>
  );
}

describe("ChurchProvider Studio LAN privacy coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    [
      mocks.auth.getToken,
      mocks.fetchSelection,
      mocks.getChurchId,
      mocks.principal,
      mocks.authorize,
      mocks.authorizationUnknown,
      mocks.signedOut,
      mocks.accessRevoked,
    ].forEach((mock) => mock.mockReset());
    mocks.auth.isLoaded = true;
    mocks.auth.isSignedIn = true;
    mocks.auth.userId = "user-1";
    mocks.auth.getToken.mockResolvedValue("token");
    mocks.getChurchId.mockReturnValue(null);
    mocks.principal.mockResolvedValue(undefined);
    mocks.authorize.mockResolvedValue(undefined);
    mocks.authorizationUnknown.mockResolvedValue(undefined);
    mocks.signedOut.mockResolvedValue(undefined);
    mocks.accessRevoked.mockResolvedValue(undefined);
  });

  it("does not purge on a temporary token or Internet failure", async () => {
    mocks.auth.getToken.mockResolvedValueOnce(null);
    render(<ChurchProvider><Probe /></ChurchProvider>);

    await waitFor(() => expect(mocks.authorizationUnknown).toHaveBeenCalledOnce());
    expect(mocks.principal).toHaveBeenCalledWith("user-1");
    expect(mocks.accessRevoked).not.toHaveBeenCalled();
    expect(mocks.signedOut).not.toHaveBeenCalled();
  });

  it("authorizes account/church scope before publishing it and serializes a manual church switch", async () => {
    mocks.fetchSelection.mockResolvedValue({ churches: [church("church-1"), church("church-2")], selectedChurchId: "church-1" });
    const view = render(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("church-1"));
    expect(mocks.principal).toHaveBeenCalledWith("user-1");
    expect(mocks.authorize).toHaveBeenNthCalledWith(1, "user-1", "church-1");

    let releaseSwitch: (() => void) | undefined;
    mocks.authorize.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSwitch = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "church-2" }));
    await waitFor(() => expect(mocks.authorize).toHaveBeenLastCalledWith("user-1", "church-2"));
    expect(screen.getByTestId("selected")).toHaveTextContent("church-1");
    await act(async () => { releaseSwitch?.(); });
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("church-2"));

    mocks.auth.userId = "user-2";
    view.rerender(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(mocks.principal).toHaveBeenCalledWith("user-2"));
    await waitFor(() => expect(mocks.authorize).toHaveBeenCalledWith("user-2", "church-1"));
  });

  it("treats only a successful empty membership response as authoritative revocation", async () => {
    mocks.fetchSelection.mockResolvedValue({ churches: [], selectedChurchId: null });
    render(<ChurchProvider><Probe /></ChurchProvider>);

    await waitFor(() => expect(mocks.accessRevoked).toHaveBeenCalledOnce());
    expect(mocks.authorizationUnknown).not.toHaveBeenCalled();
    expect(mocks.setChurchId).toHaveBeenCalledWith(null);
  });

  it("does not let a cancelled account request overwrite the newer principal scope", async () => {
    let releaseOld: ((value: unknown) => void) | undefined;
    mocks.fetchSelection
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockResolvedValueOnce({ churches: [church("church-2")], selectedChurchId: "church-2" });
    const view = render(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(mocks.fetchSelection).toHaveBeenCalledTimes(1));

    mocks.auth.userId = "user-2";
    view.rerender(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(mocks.authorize).toHaveBeenCalledWith("user-2", "church-2"));
    await act(async () => {
      releaseOld?.({ churches: [church("church-1")], selectedChurchId: "church-1" });
    });

    expect(mocks.authorize).not.toHaveBeenCalledWith("user-1", "church-1");
    expect(screen.getByTestId("selected")).toHaveTextContent("church-2");
  });

  it("does not let a pending manual switch publish after the account changes", async () => {
    mocks.fetchSelection
      .mockResolvedValueOnce({ churches: [church("church-1"), church("church-2")], selectedChurchId: "church-1" })
      .mockResolvedValueOnce({ churches: [church("church-3")], selectedChurchId: "church-3" });
    const view = render(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("church-1"));

    let releaseOldSwitch: (() => void) | undefined;
    mocks.authorize.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseOldSwitch = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "church-2" }));
    await waitFor(() => expect(mocks.authorize).toHaveBeenCalledWith("user-1", "church-2"));

    mocks.auth.userId = "user-2";
    view.rerender(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("church-3"));
    await act(async () => { releaseOldSwitch?.(); });

    expect(screen.getByTestId("selected")).toHaveTextContent("church-3");
    expect(mocks.setChurchId).not.toHaveBeenLastCalledWith("church-2");
  });

  it("hides the previous account church even when the new privacy boundary cannot begin", async () => {
    mocks.fetchSelection.mockResolvedValue({ churches: [church("church-1")], selectedChurchId: "church-1" });
    const view = render(<ChurchProvider><Probe /></ChurchProvider>);
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("church-1"));

    mocks.principal.mockRejectedValueOnce(new Error("tombstone-write-failed"));
    mocks.auth.userId = "user-2";
    view.rerender(<ChurchProvider><Probe /></ChurchProvider>);

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("none"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("tombstone-write-failed"));
    expect(mocks.fetchSelection).toHaveBeenCalledTimes(1);
    expect(mocks.setChurchId).toHaveBeenLastCalledWith(null);
  });

  it("keeps the existing scope when the membership request itself fails", async () => {
    mocks.fetchSelection.mockRejectedValue(new Error("offline"));
    render(<ChurchProvider><Probe /></ChurchProvider>);

    await waitFor(() => expect(mocks.authorizationUnknown).toHaveBeenCalledOnce());
    expect(mocks.accessRevoked).not.toHaveBeenCalled();
    expect(screen.getByTestId("error")).toHaveTextContent("offline");
  });
});
