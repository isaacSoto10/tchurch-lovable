import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), church: { id: "church-a", role: "ADMIN" } as { id: string; role: string } | null }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), apiFetch: mocks.fetch }));
vi.mock("@/providers/ChurchProvider", () => ({ useChurch: () => ({ selectedChurch: mocks.church }) }));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ChordProPreview", () => ({ ChordProPreview: ({ selectedKey, onSelectedKeyChange }: { selectedKey: string; onSelectedKeyChange: (key: string) => void }) => <div><span>Selected key {selectedKey}</span><button onClick={() => onSelectedKeyChange("G")}>Change key</button></div> }));
vi.mock("@/components/ServiceSongPicker", () => ({ ServiceSongPicker: ({ selectedSongs, onToggleSong }: { selectedSongs: unknown[]; onToggleSong: (song: { id: string; title: string }) => void }) => <div><span>Selected songs {selectedSongs.length}</span><button type="button" onClick={() => onToggleSong({ id: "song-new", title: "New song" })}>Select fixture song</button></div> }));
import ServiceDetail from "./ServiceDetail";

const service = (title: string) => ({ id: "service-a", title, date: "2026-10-04T16:00:00Z", type: "Sunday", status: "DRAFT", items: [], assignments: [] });
function ServiceRouteSwitch() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/app/services/service-b")}>Other service</button>;
}

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

  it("ignores a previous service mutation completing after navigation to another service", async () => {
    let finishWrite!: (value: unknown) => void;
    mocks.fetch.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "PUT") return new Promise((resolve) => { finishWrite = resolve; });
      if (path.startsWith("/services/service-a")) return Promise.resolve({ ...service("Previous service"), items: [{ id: "item-a", title: "Test song", type: "song", position: 0, duration: 5, details: {}, song: { id: "song-a", title: "Test song", key: "C", lyrics: "[C]Test", arrangements: [] } }] });
      if (path.startsWith("/services/service-b")) return Promise.resolve({ ...service("Next service"), id: "service-b" });
      return Promise.resolve(path === "/users/me" ? { id: "actor-a" } : []);
    });
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><ServiceRouteSwitch /><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await screen.findByText("Test song");
    fireEvent.click(screen.getByRole("button", { name: "Expandir detalles de canción" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver acordes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    await waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Other service" }));
    await screen.findByText("Next service");
    await act(async () => { finishWrite({ id: "item-a" }); });
    expect(screen.getByText("Next service")).toBeInTheDocument();
    expect(mocks.fetch.mock.calls.filter(([path]) => path.startsWith("/services/service-a"))).toHaveLength(1);
  });

  it("keeps a new service form open when an old song POST completes", async () => {
    let finishWrite!: (value: unknown) => void;
    mocks.fetch.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "POST") return new Promise((resolve) => { finishWrite = resolve; });
      if (path.startsWith("/services/")) return Promise.resolve(service(path.includes("service-b") ? "Next service" : "Previous service"));
      return Promise.resolve(path === "/users/me" ? { id: "actor-a" } : []);
    });
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><ServiceRouteSwitch /><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await screen.findByText("Previous service");
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select fixture song" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Other service" }));
    await screen.findByText("Next service");
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select fixture song" }));
    await act(async () => { finishWrite({ id: "created-in-previous-service" }); });
    expect(screen.getByText("Selected songs 1")).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "1 canción agregada" }));
    expect(mocks.fetch.mock.calls.filter(([path]) => path.startsWith("/services/service-a"))).toHaveLength(1);
  });

  it("does not show the previous service when a new service read fails", async () => {
    mocks.fetch.mockImplementation((path: string) => path.startsWith("/services/service-b")
      ? Promise.reject(new Error("Service not found"))
      : Promise.resolve(path.startsWith("/services/") ? service("Previous service") : []));
    render(<MemoryRouter initialEntries={["/app/services/service-a"]}><ServiceRouteSwitch /><Routes><Route path="/app/services/:id" element={<ServiceDetail />} /></Routes></MemoryRouter>);
    await screen.findByText("Previous service");
    fireEvent.click(screen.getByRole("button", { name: "Other service" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No se pudo actualizar el servicio" })));
    expect(screen.queryByText("Previous service")).not.toBeInTheDocument();
    expect(screen.getByText("Servicio no encontrado")).toBeInTheDocument();
  });
});
