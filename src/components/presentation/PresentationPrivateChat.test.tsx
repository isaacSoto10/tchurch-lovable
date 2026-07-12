import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationPrivateChat } from "./PresentationPrivateChat";
import type { PresentationChatEnvelope, PresentationChatMessage } from "@/lib/presentationProduction";

const mocks = vi.hoisted(() => ({
  fetchChat: vi.fn(),
  sendChat: vi.fn(),
}));

vi.mock("@/lib/presentationProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationProduction")>();
  return {
    ...actual,
    fetchPresentationChat: mocks.fetchChat,
    sendPresentationChatMessage: mocks.sendChat,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function message(id: string, channel: "all" | "worship" | "production", body: string): PresentationChatMessage {
  return { id, clientMessageId: `client-${id}`, channel, body, sender: { id: "user-00000001", displayName: "Equipo" }, sentAt: "2026-07-12T13:00:00.000Z" };
}

function envelope(serviceId: string, mode: "live" | "rehearsal", messages: PresentationChatMessage[] = []): PresentationChatEnvelope {
  return { schemaVersion: 4, serviceId, mode, serverNow: "2026-07-12T13:00:00.000Z", messages, nextCursor: null };
}

describe("PresentationPrivateChat privacy lifecycle", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });

  beforeEach(() => {
    mocks.fetchChat.mockReset();
    mocks.sendChat.mockReset();
  });

  it("drops a delayed poll from the previous account/church scope", async () => {
    const oldPoll = deferred<PresentationChatEnvelope>();
    const currentPoll = deferred<PresentationChatEnvelope>();
    mocks.fetchChat.mockReturnValueOnce(oldPoll.promise).mockReturnValueOnce(currentPoll.promise);
    const view = render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="account-a::church-a" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledTimes(1));
    view.rerender(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="account-b::church-b" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledTimes(2));
    await act(async () => currentPoll.resolve(envelope("service-1", "live", [message("message-current", "all", "Scope actual")])));
    expect(await screen.findByText("Scope actual")).toBeInTheDocument();
    await act(async () => oldPoll.resolve(envelope("service-1", "live", [message("message-old", "all", "Scope anterior")])));
    expect(screen.queryByText("Scope anterior")).not.toBeInTheDocument();
  });

  it("does not restart polling for equivalent inline channel arrays", async () => {
    mocks.fetchChat.mockResolvedValue(envelope("service-1", "live"));
    const view = render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all", "production"]} privacyScope="stable" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledTimes(1));
    view.rerender(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["production", "all"]} privacyScope="stable" />);
    expect(mocks.fetchChat).toHaveBeenCalledTimes(1);
  });

  it("fails closed with no permitted channels and filters an unexpected server channel", async () => {
    const empty = render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={[]} privacyScope="member" />);
    expect(await screen.findByText(/no incluye canales privados/i)).toBeInTheDocument();
    expect(mocks.fetchChat).not.toHaveBeenCalled();
    empty.unmount();

    mocks.fetchChat.mockResolvedValue(envelope("service-1", "live", [message("production-only", "production", "Dato de producción") ]));
    render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="worship" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledOnce());
    expect(screen.queryByText("Dato de producción")).not.toBeInTheDocument();
  });

  it("does not commit a send response after the privacy scope changes", async () => {
    const oldSend = deferred<PresentationChatEnvelope>();
    mocks.fetchChat.mockResolvedValue(envelope("service-1", "live"));
    mocks.sendChat.mockReturnValue(oldSend.promise);
    const view = render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="account-a" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByPlaceholderText("Mensaje al equipo…"), { target: { value: "Mensaje viejo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledOnce());
    view.rerender(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="account-b" />);
    await act(async () => oldSend.resolve(envelope("service-1", "live", [message("old-send", "all", "Respuesta vieja")])));
    expect(screen.queryByText("Respuesta vieja")).not.toBeInTheDocument();
  });

  it("does not commit a send response after channel permission is revoked", async () => {
    const oldSend = deferred<PresentationChatEnvelope>();
    mocks.fetchChat.mockResolvedValue(envelope("service-1", "live"));
    mocks.sendChat.mockReturnValue(oldSend.promise);
    const view = render(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["all"]} privacyScope="same-account" />);
    await waitFor(() => expect(mocks.fetchChat).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByPlaceholderText("Mensaje al equipo…"), { target: { value: "Mensaje restringido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(mocks.sendChat).toHaveBeenCalledOnce());
    view.rerender(<PresentationPrivateChat serviceId="service-1" mode="live" channels={["production"]} privacyScope="same-account" />);
    await act(async () => oldSend.resolve(envelope("service-1", "live", [message("revoked-send", "all", "Canal revocado")])));
    expect(screen.queryByText("Canal revocado")).not.toBeInTheDocument();
  });
});
