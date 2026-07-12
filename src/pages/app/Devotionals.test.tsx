import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Devotionals from "./Devotionals";

const { fetchApiMock, toastMock } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({ fetchApi: fetchApiMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function devotional(index: number) {
  return {
    id: `devotional-${index}`,
    title: `Devocional ${index}`,
    body: `Reflexión ${index}`,
    publishDate: "2026-07-12",
    status: "published",
  };
}

describe("Devotionals", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the URL page, renders at most 12 cards, and treats later pages as history", async () => {
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/my-ministries") return { ministries: [] };
      if (path === "/devotionals?includeDrafts=1&paginated=1&page=2&pageSize=12") {
        return {
          devotionals: Array.from({ length: 13 }, (_, index) => devotional(index + 1)),
          permissions: { canManage: false },
          pagination: {
            page: 2,
            pageSize: 12,
            total: 25,
            totalPages: 3,
            hasPrevious: true,
            hasNext: true,
          },
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <MemoryRouter initialEntries={["/app/devotionals?page=2"]}>
        <Devotionals />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Devocional 1")).toBeInTheDocument());

    expect(fetchApiMock).toHaveBeenCalledWith("/devotionals?includeDrafts=1&paginated=1&page=2&pageSize=12");
    expect(screen.getByText("Historial")).toBeInTheDocument();
    expect(screen.queryByText("Anteriores")).not.toBeInTheDocument();
    expect(screen.queryByText("Devocional 13")).not.toBeInTheDocument();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior / Previous page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Página siguiente / Next page" })).toBeEnabled();
  });
});
