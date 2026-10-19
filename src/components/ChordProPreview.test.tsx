import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChordProPreview } from "./ChordProPreview";

afterEach(cleanup);
describe("ChordProPreview", () => {
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
