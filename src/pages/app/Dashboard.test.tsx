import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

const { fetchApiMock, navigateMock, churchState } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  navigateMock: vi.fn(),
  churchState: {
    id: "church-1",
    name: "Tchurch",
    role: "ADMIN",
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({ fetchApi: fetchApiMock }),
}));

vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({
    loading: false,
    selectedChurch: churchState,
  }),
}));

function futureDate(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

function todayDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    churchState.role = "ADMIN";
  });

  it("limits the dashboard preview to the next two upcoming services", async () => {
    fetchApiMock.mockImplementation(async (path: string) => {
      switch (path) {
        case "/dashboard/stats":
          return {
            ministries: 0,
            events: 1,
            songs: 0,
            services: 3,
            teams: 0,
            members: 0,
            announcements: 0,
          };
        case "/services?summary=1&from=today&order=asc&limit=60":
          return [
            { id: "service-3", title: "Tercer servicio", date: futureDate(21), status: "confirmed", type: "Sunday Service" },
            { id: "service-1", title: "Primer servicio", date: futureDate(7), status: "confirmed", type: "Sunday Service" },
            { id: "service-2", title: "Segundo servicio", date: futureDate(14), status: "confirmed", type: "Sunday Service" },
          ];
        case "/events?startDate=today&limit=25":
          return [
            { id: "event-1", title: "Retiro familiar", date: futureDate(28), type: "fellowship", location: "Santuario" },
          ];
        case "/announcements":
        case "/my-ministries":
        case "/service-assignments/mine":
          return [];
        case "/service-media?limit=6":
          return { live: [], scheduled: [], previous: [] };
        default:
          throw new Error(`Unexpected request: ${path}`);
      }
    });

    render(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText("Primer servicio")).toBeInTheDocument();
      expect(screen.getByText("Segundo servicio")).toBeInTheDocument();
      expect(screen.getByText("Retiro familiar")).toBeInTheDocument();
    });

    expect(screen.queryByText("Tercer servicio")).not.toBeInTheDocument();
    expect(fetchApiMock).toHaveBeenCalledWith("/services?summary=1&from=today&order=asc&limit=60");
  });

  it("keeps date-only services scheduled for today on the dashboard", async () => {
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/services?summary=1&from=today&order=asc&limit=60") {
        return [{ id: "today-service", title: "Servicio de hoy", date: todayDate(), status: "confirmed", type: "Sunday Service" }];
      }
      if (path === "/dashboard/stats") return null;
      if (path === "/service-media?limit=6") return { live: [], scheduled: [], previous: [] };
      return [];
    });

    render(<Dashboard />);

    expect(await screen.findByText("Servicio de hoy")).toBeInTheDocument();
  });

  it("shows upcoming services to members without assignments instead of an empty dashboard", async () => {
    churchState.role = "MEMBER";
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/services?summary=1&from=today&order=asc&limit=60") {
        return [
          { id: "service-1", title: "Servicio abierto uno", date: futureDate(7), status: "confirmed", type: "Sunday Service" },
          { id: "service-2", title: "Servicio abierto dos", date: futureDate(14), status: "confirmed", type: "Sunday Service" },
        ];
      }
      if (path === "/dashboard/stats") return null;
      if (path === "/service-media?limit=6") return { live: [], scheduled: [], previous: [] };
      return [];
    });

    render(<Dashboard />);

    expect(await screen.findByText("Servicio abierto uno")).toBeInTheDocument();
    expect(screen.getByText("Servicio abierto dos")).toBeInTheDocument();
  });

  it("prioritizes assigned services and fills the preview with the next visible service", async () => {
    churchState.role = "MEMBER";
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/services?summary=1&from=today&order=asc&limit=60") {
        return [
          { id: "open-1", title: "Próximo visible", date: futureDate(7), status: "confirmed", type: "Sunday Service" },
          { id: "open-2", title: "Segundo visible", date: futureDate(14), status: "confirmed", type: "Sunday Service" },
          { id: "assigned", title: "Mi servicio asignado", date: futureDate(21), status: "confirmed", type: "Sunday Service" },
        ];
      }
      if (path === "/service-assignments/mine") {
        return [{ id: "assignment-1", serviceId: "assigned", position: "Voz", confirmed: true, responseStatus: "accepted" }];
      }
      if (path === "/dashboard/stats") return null;
      if (path === "/service-media?limit=6") return { live: [], scheduled: [], previous: [] };
      return [];
    });

    render(<Dashboard />);

    expect(await screen.findByText("Mi servicio asignado")).toBeInTheDocument();
    expect(screen.getByText("Próximo visible")).toBeInTheDocument();
    expect(screen.queryByText("Segundo visible")).not.toBeInTheDocument();
  });
});
