import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), church: { id: "church-a", role: "ADMIN" } as { id: string; role: string } | null }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: mocks.fetch }));
vi.mock("@/providers/ChurchProvider", () => ({ useChurch: () => ({ selectedChurch: mocks.church }) }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ChordProPreview", () => ({ ChordProPreview: ({ selectedKey, onSelectedKeyChange }: { selectedKey: string; onSelectedKeyChange: (key: string) => void }) => <div><span>Selected key {selectedKey}</span><button onClick={() => onSelectedKeyChange("G")}>Change key</button></div> }));
import ServiceDetail from "./ServiceDetail";

const service = (title: string) => ({ id: "service-a", title, date: "2026-10-04T16:00:00Z", type: "Sunday", status: "DRAFT", items: [], assignments: [] });

describe("service detail authoritative refresh", () => {
  beforeEach(() => { mocks.fetch.mockReset(); mocks.toast.mockReset(); mocks.church = { id: "church-a", role: "ADMIN" }; });
  it("does not replace a newer foreground read with an older delayed service response", async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.fetch.mockImplementation((path: string) => path.startsWith("/services/")
      ? new Promise((resolve) => pending.push(resolve))
      : Promise.resolve(path === "/users/me" ? { id: "actor-a" } : []));
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { window.dispatchEvent(new Event("pageshow")); });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1](service("Current server plan")); });
    await act(async () => { pending[0](service("Obsolete server plan")); });
    expect(await screen.findByText("Current server plan")).toBeInTheDocument();
    expect(screen.queryByText("Obsolete server plan")).not.toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("/services/service-a"), expect.objectContaining({ churchId: "church-a", cache: "no-store" }));
  });

  it("does not issue an unscoped service read on direct entry without a selected church", async () => {
    mocks.church = null;
    mocks.fetch.mockResolvedValue({ id: "actor-a" });
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Servicio no encontrado")).toBeInTheDocument();
    expect(mocks.fetch.mock.calls.some(([path]) => path.startsWith("/services/"))).toBe(false);
  });

  it("does not leave a rejected tone edit looking saved and retains the canonical details contract", async () => {
    const state = { ...service("Current server plan"), items: [{ id: "item-a", title: "Test song", type: "song", position: 0, duration: 5, details: { notes: { vocals: "Singer" } }, song: { id: "song-a", title: "Test song", key: "C", lyrics: "[C]Test", arrangements: [] } }] };
    mocks.fetch.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "PUT") return Promise.reject(new Error("Write rejected"));
      return Promise.resolve(path.startsWith("/services/") ? state : path === "/users/me" ? { id: "actor-a" } : []);
    });
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await screen.findByText("Test song");
    fireEvent.click(screen.getByRole("button", { name: "Expandir detalles de canción" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver acordes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No se pudo guardar el tono" })));
    expect(screen.getByText("Selected key C")).toBeInTheDocument();
    const write = mocks.fetch.mock.calls.find(([, options]) => options?.method === "PUT");
    expect(write?.[0]).toBe("/service-items/item-a");
    expect(JSON.parse(write?.[1].body)).toEqual({ details: { notes: { vocals: "Singer" }, serviceKey: "G" } });
  });

  it("shows the tone returned by the service after a successful key write", async () => {
    let committed = false;
    let reads = 0;
    mocks.fetch.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "PUT") { committed = true; return Promise.resolve({ id: "item-a" }); }
      if (path.startsWith("/services/")) {
        reads += 1;
        return Promise.resolve({ ...service("Current server plan"), items: [{ id: "item-a", title: "Test song", type: "song", position: 0, duration: 5, details: committed ? { serviceKey: "G" } : {}, song: { id: "song-a", title: "Test song", key: "C", lyrics: "[C]Test", arrangements: [] } }] });
      }
      return Promise.resolve(path === "/users/me" ? { id: "actor-a" } : []);
    });
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await screen.findByText("Test song");
    fireEvent.click(screen.getByRole("button", { name: "Expandir detalles de canción" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver acordes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    expect(await screen.findByText("Selected key G")).toBeInTheDocument();
    expect(reads).toBe(2);
  });
});
