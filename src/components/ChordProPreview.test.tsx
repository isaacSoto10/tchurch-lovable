import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChordProPreview } from "./ChordProPreview";

afterEach(cleanup);
describe("ChordProPreview", () => {
  it("keeps slash chords and words atomic in compact and full-height charts", () => {
    const song = "Cas[C]tillo [G/C]fuerte es [Am/C]nuestro [Em/C]Dios, es[F/C]pada y [C]arma[Dm7/C]du ------ [C]ra";
    for (const props of [{ compact: true }, { fullHeight: true }]) {
      const view = render(<ChordProPreview value={song} {...props} />);
      expect(screen.getByText((value) => value.split(/\s+/).includes("Em/C"))).toBeInTheDocument();
      expect(screen.getByText((value) => value.includes("Dios,"))).toBeInTheDocument();
      view.unmount();
    }
  });
  it("renders the whole saved song", () => {
    const song = Array.from({ length: 150 }, (_, i) => `[C/G]Final ${i + 1}`).join("\n");
    render(<ChordProPreview value={song} originalKey="C" />);
    expect(screen.getByText("Final 150")).toBeInTheDocument();
    expect(screen.queryByText("Vista previa")).not.toBeInTheDocument();
  });
  it("raises a semitone from C sharp and transposes root and bass together", () => {
    render(<ChordProPreview value="[C#/G#]Gloria" originalKey="C#" />);
    fireEvent.click(screen.getByRole("button", { name: "Subir tonalidad" }));
    expect(screen.getByLabelText("Tonalidad")).toHaveValue("D");
    expect(screen.getByText("D/A")).toBeInTheDocument();
  });
});
