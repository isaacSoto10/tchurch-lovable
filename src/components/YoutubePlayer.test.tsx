import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserOpenMock, getPlatformMock, isNativePlatformMock } = vi.hoisted(() => ({
  browserOpenMock: vi.fn(),
  getPlatformMock: vi.fn(),
  isNativePlatformMock: vi.fn(),
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: browserOpenMock },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: getPlatformMock,
    isNativePlatform: isNativePlatformMock,
  },
}));

import { YoutubePlayer } from "@/components/YoutubePlayer";

const playerProps = {
  sourceUrl: "https://youtu.be/abc123xyz",
  embedUrl: "https://www.youtube.com/embed/abc123xyz",
  title: "Devocional de prueba",
};

describe("YoutubePlayer", () => {
  beforeEach(() => {
    browserOpenMock.mockReset().mockResolvedValue(undefined);
    getPlatformMock.mockReset().mockReturnValue("ios");
    isNativePlatformMock.mockReset().mockReturnValue(true);
  });

  it("replaces the YouTube iframe with a native-safe launch card on iOS", async () => {
    const { container } = render(<YoutubePlayer {...playerProps} />);

    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver Devocional de prueba en YouTube" }));

    await waitFor(() => {
      expect(browserOpenMock).toHaveBeenCalledWith({
        url: "https://www.youtube.com/watch?v=abc123xyz",
      });
    });
  });

  it.each([
    ["the web", false, "web"],
    ["native Android", true, "android"],
  ])("keeps inline playback on %s", (_label, isNative, platform) => {
    isNativePlatformMock.mockReturnValue(isNative);
    getPlatformMock.mockReturnValue(platform);

    render(<YoutubePlayer {...playerProps} />);

    expect(screen.getByTitle("Devocional de prueba")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/abc123xyz",
    );
  });
});
