import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaDetail from "./MediaDetail";

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

function endpointUnavailable() {
  return Object.assign(new Error("No se pudo completar la solicitud (404)."), { status: 404 });
}

describe("MediaDetail", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("shows the normal missing-service state when Media routes are not deployed yet", async () => {
    fetchApiMock.mockRejectedValue(endpointUnavailable());

    render(
      <MemoryRouter initialEntries={["/app/media/missing-service"]}>
        <Routes>
          <Route path="/app/media/:id" element={<MediaDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No se encontró este servicio")).toBeInTheDocument();
    });

    expect(toastMock).not.toHaveBeenCalled();
  });
});
