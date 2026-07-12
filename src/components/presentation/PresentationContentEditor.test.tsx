import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePresentationScripture } = vi.hoisted(() => ({ resolvePresentationScripture: vi.fn() }));
vi.mock("@/lib/presentationOutputApi", () => ({ resolvePresentationScripture }));

import { PresentationContentEditor } from "./PresentationContentEditor";

const passage = {
  source: "manual" as const,
  reference: "Juan 3:16",
  passageUsfm: "JHN.3.16",
  version: { id: null, name: "Manual", abbreviation: "MANUAL", language: "es" },
  verses: [{ number: "16", text: "Porque de tal manera" }],
  copyright: "",
  promotionalContent: null,
};

function initialScripture() {
  return { kind: "scripture", reference: "Juan 3:16", passageUsfm: "JHN.3.16", bibleId: null, language: "es", manualText: "16 Porque de tal manera", versionName: "Manual", versionAbbreviation: "MANUAL", copyright: null, promotionalContent: null, resolvedPassage: passage };
}

describe("PresentationContentEditor scripture resolution", () => {
  beforeEach(() => resolvePresentationScripture.mockReset());

  it("clears stale resolved verses as soon as the reference changes", () => {
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={initialScripture()} onChange={onChange} />);
    expect(screen.getByText(/MANUAL · 1 slide/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Juan 3:16–18"), { target: { value: "Romanos 8:1" } });
    expect(screen.queryByText(/MANUAL · 1 slide/)).toBeNull();
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ reference: "Romanos 8:1", resolvedPassage: null });
  });

  it("shows provider errors without retaining an old passage", async () => {
    resolvePresentationScripture.mockRejectedValueOnce(new Error("YouVersion no está disponible"));
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={{ ...initialScripture(), resolvedPassage: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /resolver texto/i }));
    expect(await screen.findByText("YouVersion no está disponible")).toBeTruthy();
    expect(onChange.mock.calls.some(([value]) => value?.resolvedPassage)).toBe(false);
  });

  it("persists the server-resolved manual fallback as one atomic draft", async () => {
    resolvePresentationScripture.mockResolvedValueOnce(passage);
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={{ ...initialScripture(), resolvedPassage: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /resolver texto/i }));
    await waitFor(() => expect(screen.getByText(/MANUAL · 1 slide/)).toBeTruthy());
    expect(resolvePresentationScripture).toHaveBeenCalledWith(expect.objectContaining({ reference: "Juan 3:16", manualText: "16 Porque de tal manera" }));
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ reference: "Juan 3:16", resolvedPassage: passage });
  });

  it.each([
    ["https://cdn.example.com/slide.png", "image/png"],
    ["https://cdn.example.com/slide.webp?version=2", "image/webp"],
  ])("infers real static-image MIME for %s", (url, expectedMime) => {
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={{ kind: "announcement", body: ["Aviso"], mediaSrc: null, mediaMimeType: null, durationSeconds: 10, loop: true }} onChange={onChange} />);
    const input = screen.getByText("Imagen HTTPS opcional").parentElement?.querySelector("input");
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: url } });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ mediaSrc: url, mediaMimeType: expectedMime });
  });

  it("leaves an extensionless CDN image untyped until the user selects its real format", () => {
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={{ kind: "sermon", subtitle: null, speaker: null, body: ["Mensaje"], mediaSrc: null, mediaMimeType: null }} onChange={onChange} />);
    const input = screen.getByText("Imagen HTTPS opcional").parentElement?.querySelector("input");
    fireEvent.change(input!, { target: { value: "https://cdn.example.com/assets/sermon?id=42" } });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ mediaSrc: "https://cdn.example.com/assets/sermon?id=42", mediaMimeType: null });
  });

  it("infers WebM and preserves an explicit synchronized duration", () => {
    const onChange = vi.fn();
    render(<PresentationContentEditor initialValue={{ kind: "video", src: "", posterSrc: null, mimeType: null, muted: true, autoplay: true, loop: false, durationMs: null }} onChange={onChange} />);
    const source = screen.getByText("URL HTTPS de video").parentElement?.querySelector("input");
    fireEvent.change(source!, { target: { value: "https://cdn.example.com/intro.webm" } });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ mimeType: "video/webm" });
    fireEvent.change(screen.getByPlaceholderText("180000"), { target: { value: "42000" } });
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ durationMs: 42_000 });
  });
});
