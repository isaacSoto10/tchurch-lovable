import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

const { fetchApiMock, navigateMock } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  navigateMock: vi.fn(),
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
    selectedChurch: {
      id: "church-1",
      name: "Tchurch",
      role: "ADMIN",
    },
  }),
}));

function futureDate(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
}

describe("Dashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
        case "/services":
          return [
            { id: "service-3", title: "Tercer servicio", date: futureDate(21), status: "confirmed", type: "Sunday Service" },
            { id: "service-1", title: "Primer servicio", date: futureDate(7), status: "confirmed", type: "Sunday Service" },
            { id: "service-2", title: "Segundo servicio", date: futureDate(14), status: "confirmed", type: "Sunday Service" },
          ];
        case "/events":
          return [
            { id: "event-1", title: "Retiro familiar", date: futureDate(28), type: "fellowship", location: "Santuario" },
          ];
        case "/announcements":
        case "/my-ministries":
        case "/service-assignments/mine":
          return [];
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
    expect(fetchApiMock).toHaveBeenCalledWith("/services");
  });
});
