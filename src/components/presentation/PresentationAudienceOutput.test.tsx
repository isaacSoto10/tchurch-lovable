import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresentationAudienceOutput } from "./PresentationAudienceOutput";
import { DEFAULT_PRESENTATION_THEME, type PresentationAudienceSlide } from "@/lib/presentationOutput";

const lyrics: PresentationAudienceSlide = {
  id: "lyrics-1",
  itemId: "song-1",
  itemIndex: 0,
  kind: "lyrics",
  title: "Santo",
  durationSeconds: 240,
  sectionLabel: "Coro",
  lines: ["Santo por siempre", "Digno es el Señor"],
  part: 1,
  totalParts: 1,
  copyright: { text: "Autor", ccliNumber: "123" },
};

const video: PresentationAudienceSlide = {
  id: "video-1",
  itemId: "video-item",
  itemIndex: 1,
  kind: "video",
  title: "Bienvenida",
  durationSeconds: 20,
  src: "https://cdn.example.com/welcome.mp4",
  posterSrc: "https://cdn.example.com/poster.jpg",
  muted: true,
  autoplay: false,
  loop: false,
  durationMs: 20_000,
};

describe("PresentationAudienceOutput", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });

  it("renders clean themed lyrics without chords, notes, roles or controls", () => {
    const view = render(<PresentationAudienceOutput slide={lyrics} theme={DEFAULT_PRESENTATION_THEME} blackout={false} />);
    expect(screen.getByText("Santo por siempre")).toBeTruthy();
    expect(screen.getByText(/CCLI 123/)).toBeTruthy();
    expect(view.container.querySelector("button")).toBeNull();
    expect(view.container.textContent).not.toContain("acordes");
    expect(view.container.textContent).not.toContain("notas");
    expect(view.container.textContent).not.toContain("worship_leader");
  });

  it("wraps full required attribution without truncating it", () => {
    const longCopyright = "Autores y editoriales responsables de esta obra, con todos los derechos reservados para la proyección congregacional";
    const view = render(<PresentationAudienceOutput slide={{ ...lyrics, copyright: { text: longCopyright, ccliNumber: "12345678" } }} theme={DEFAULT_PRESENTATION_THEME} blackout={false} />);
    const attribution = screen.getByTestId("audience-copyright");
    expect(attribution.textContent).toContain(longCopyright);
    expect(attribution.textContent).toContain("CCLI 12345678");
    expect(attribution.parentElement?.className).toContain("break-words");
    expect(view.container.querySelector(".truncate")).toBeNull();
  });

  it("places lyrics in a lower third when the theme requests it", () => {
    render(<PresentationAudienceOutput slide={lyrics} theme={{ ...DEFAULT_PRESENTATION_THEME, placement: "lower_third" }} blackout={false} />);
    expect(screen.getByText("Santo por siempre").closest("div.absolute")?.className).toContain("bottom-0");
  });

  it("renders sermon and announcement imagery full bleed behind a dark readable overlay", () => {
    const announcement: PresentationAudienceSlide = { id: "announcement-1", itemId: "announcement-item", itemIndex: 2, kind: "announcement", title: "Noche de oración", durationSeconds: 10, body: ["Viernes · 7 PM"], mediaSrc: "https://cdn.example.com/prayer.webp", mediaType: "image", loop: true };
    const view = render(<div className="h-[390px] w-[844px]"><PresentationAudienceOutput slide={announcement} blackout={false} embedded /></div>);
    const output = view.container.querySelector("main");
    expect(output?.style.backgroundImage).toContain("prayer.webp");
    expect(screen.getByTestId("audience-media-overlay").style.backgroundColor).toContain("rgba");
    expect(view.container.querySelector('img[src="https://cdn.example.com/prayer.webp"]')).toBeNull();
    expect(screen.getByText("Viernes · 7 PM")).toBeTruthy();
  });

  it("covers media with pure black without unmounting or changing the playback element", () => {
    const view = render(<PresentationAudienceOutput slide={video} blackout={false} />);
    const media = view.container.querySelector("video");
    expect(media).toBeTruthy();
    expect(screen.getByTestId("audience-blackout").className).toContain("invisible");
    view.rerender(<PresentationAudienceOutput slide={video} blackout />);
    expect(view.container.querySelector("video")).toBe(media);
    expect(screen.getByTestId("audience-blackout").className).toContain("visible");
    expect(screen.getByTestId("audience-blackout").className).toContain("bg-black");
  });

  it("offers a local audio retry when autoplay is rejected", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    play.mockClear();
    play.mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError")).mockResolvedValueOnce(undefined);
    const audio: PresentationAudienceSlide = {
      id: "audio-1",
      itemId: "audio-item",
      itemIndex: 2,
      kind: "audio",
      title: "Preludio",
      durationSeconds: 180,
      src: "https://cdn.example.com/prelude.mp3",
      artist: "Equipo de adoración",
      autoplay: true,
      loop: false,
      durationMs: 180_000,
    };
    render(<PresentationAudienceOutput slide={audio} blackout={false} showPlaybackRecovery />);
    const retry = await screen.findByRole("button", { name: "Activar audio de la presentación" });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Activar audio de la presentación" })).toBeNull());
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("stays paused at natural media end and only wraps when loop is authoritative", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    play.mockClear();
    pause.mockClear();
    play.mockResolvedValue(undefined);
    const anchor = {
      itemId: video.itemId,
      slideId: video.id,
      kind: "video" as const,
      status: "playing" as const,
      positionMs: 0,
      startedAt: "2026-07-12T11:59:30.000Z",
      rate: 1 as const,
      loop: false,
    };
    const receivedAtMs = Date.now();
    const view = render(<PresentationAudienceOutput slide={video} blackout={false} playback={anchor} serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={receivedAtMs} />);
    const media = view.container.querySelector("video")!;
    play.mockClear();
    pause.mockClear();
    Object.defineProperty(media, "duration", { configurable: true, value: 20 });
    fireEvent.loadedMetadata(media);
    expect(media.currentTime).toBe(20);
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    view.rerender(<PresentationAudienceOutput slide={video} blackout={false} playback={{ ...anchor, loop: true }} serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={receivedAtMs} />);
    await waitFor(() => expect(media.currentTime).toBeCloseTo(10, 0));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("keeps media stopped when an authoritative media_stop clears playback", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    play.mockClear();
    pause.mockClear();
    play.mockResolvedValue(undefined);
    const autoplayVideo: PresentationAudienceSlide = { ...video, autoplay: true };
    const playback = {
      itemId: autoplayVideo.itemId,
      slideId: autoplayVideo.id,
      kind: "video" as const,
      status: "playing" as const,
      positionMs: 4_000,
      startedAt: "2026-07-12T12:00:00.000Z",
      rate: 1 as const,
      loop: false,
    };
    const receivedAtMs = Date.parse("2026-07-12T18:00:00.000Z");
    const view = render(<PresentationAudienceOutput slide={autoplayVideo} blackout={false} playback={playback} authoritativePlayback serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={receivedAtMs} nowMs={receivedAtMs} />);
    const media = view.container.querySelector("video")!;
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(media.autoplay).toBe(false);
    media.currentTime = 9;
    play.mockClear();
    pause.mockClear();

    view.rerender(<PresentationAudienceOutput slide={autoplayVideo} blackout={false} playback={null} authoritativePlayback serverNow="2026-07-12T12:00:05.000Z" receivedAtMs={receivedAtMs + 5_000} nowMs={receivedAtMs + 5_000} />);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(media.currentTime).toBe(0);
    expect(play).not.toHaveBeenCalled();
    expect(media.loop).toBe(false);
  });

  it("renders server-resolved scripture and quiet lifecycle states", () => {
    const scripture: PresentationAudienceSlide = {
      id: "scripture-1",
      itemId: "scripture-item",
      itemIndex: 2,
      kind: "scripture",
      title: "Juan 3:16",
      durationSeconds: 60,
      part: 1,
      totalParts: 1,
      passage: {
        source: "manual",
        reference: "Juan 3:16",
        passageUsfm: "JHN.3.16",
        version: { id: "manual", name: "Manual", abbreviation: "RVR", language: "es" },
        verses: [{ number: "16", text: "Porque de tal manera amó Dios al mundo" }],
        copyright: "",
        promotionalContent: null,
      },
    };
    const view = render(<PresentationAudienceOutput slide={scripture} blackout={false} />);
    expect(screen.getByText("Juan 3:16")).toBeTruthy();
    expect(screen.getByText(/Porque de tal manera/)).toBeTruthy();
    view.rerender(<PresentationAudienceOutput slide={null} blackout={false} status="reconnecting" />);
    expect(screen.getByText("Reconectando")).toBeTruthy();
    view.rerender(<PresentationAudienceOutput slide={null} blackout={false} status="ended" />);
    expect(screen.getByText("Servicio finalizado")).toBeTruthy();
  });

  it("keeps provider promotion visible even when Scripture copyright is empty", () => {
    const scripture: PresentationAudienceSlide = {
      id: "scripture-promo",
      itemId: "scripture-item",
      itemIndex: 2,
      kind: "scripture",
      title: "Juan 3:16",
      durationSeconds: null,
      part: 1,
      totalParts: 1,
      passage: { source: "youversion", reference: "Juan 3:16", passageUsfm: "JHN.3.16", version: { id: "149", name: "RVR", abbreviation: "RVR", language: "es" }, verses: [{ number: "16", text: "Porque de tal manera" }], copyright: "", promotionalContent: "Conoce más en YouVersion" },
    };
    render(<PresentationAudienceOutput slide={scripture} blackout={false} />);
    expect(screen.getByTestId("audience-promotion").textContent).toBe("Conoce más en YouVersion");
    expect(screen.queryByTestId("audience-copyright")).toBeNull();
  });

  it("keeps an authoritative countdown running across late join, blackout and reconnect", () => {
    const countdownSlide: PresentationAudienceSlide = { id: "countdown-1", itemId: "countdown-item", itemIndex: 3, kind: "countdown", title: "Inicio", durationSeconds: 65, label: "Comenzamos en" };
    const countdown = { durationSeconds: 65, targetAt: "2026-07-12T12:01:05.000Z" };
    const receivedAtMs = Date.parse("2026-07-12T18:00:00.000Z");
    const view = render(<PresentationAudienceOutput slide={countdownSlide} blackout={false} countdown={countdown} serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={receivedAtMs} nowMs={receivedAtMs} />);
    expect(screen.getByText("01:05")).toBeTruthy();
    view.rerender(<PresentationAudienceOutput slide={countdownSlide} blackout countdown={countdown} serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={receivedAtMs} nowMs={receivedAtMs + 5_000} />);
    expect(screen.getByText("01:00")).toBeTruthy();
    view.rerender(<PresentationAudienceOutput slide={countdownSlide} blackout={false} countdown={countdown} serverNow="2026-07-12T12:00:45.000Z" receivedAtMs={receivedAtMs + 45_000} nowMs={receivedAtMs + 50_000} status="reconnecting" />);
    expect(screen.getByText("Reconectando")).toBeTruthy();
    view.rerender(<PresentationAudienceOutput slide={countdownSlide} blackout={false} countdown={countdown} serverNow="2026-07-12T12:00:45.000Z" receivedAtMs={receivedAtMs + 45_000} nowMs={receivedAtMs + 50_000} />);
    expect(screen.getByText("00:15")).toBeTruthy();
  });

  it("ticks a countdown without requiring parent rerenders", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T18:00:00.000Z"));
    const countdownSlide: PresentationAudienceSlide = { id: "countdown-tick", itemId: "countdown-item", itemIndex: 3, kind: "countdown", title: "Inicio", durationSeconds: 10, label: "Comenzamos en" };
    render(<PresentationAudienceOutput slide={countdownSlide} blackout={false} countdown={{ durationSeconds: 10, targetAt: "2026-07-12T12:00:10.000Z" }} serverNow="2026-07-12T12:00:00.000Z" receivedAtMs={Date.parse("2026-07-12T18:00:00.000Z")} />);
    expect(screen.getByText("00:10")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByText("00:07")).toBeTruthy();
    vi.useRealTimers();
  });
});
