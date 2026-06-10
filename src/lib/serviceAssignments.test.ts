import { describe, expect, it } from "vitest";
import {
  assignmentNeedsResponse,
  getAssignmentPositionOptions,
  getAssignmentResponseStatus,
  getCustomAssignmentPositions,
  servicePositionsMatch,
} from "./serviceAssignments";

describe("service assignment helpers", () => {
  it("treats legacy confirmed assignments as accepted", () => {
    expect(getAssignmentResponseStatus({ confirmed: true, responseStatus: null })).toBe("accepted");
    expect(assignmentNeedsResponse({ confirmed: true, responseStatus: undefined })).toBe(false);
  });

  it("shows actions only for pending assignments", () => {
    expect(assignmentNeedsResponse({ confirmed: false, responseStatus: "pending" })).toBe(true);
    expect(assignmentNeedsResponse({ confirmed: true, responseStatus: "accepted" })).toBe(false);
    expect(assignmentNeedsResponse({ confirmed: false, responseStatus: "declined" })).toBe(false);
  });

  it("mixes default and custom service positions without duplicates", () => {
    const options = getAssignmentPositionOptions([
      { id: "a1", position: "Vocals", confirmed: false },
      { id: "a2", position: "Stage Manager", confirmed: false },
      { id: "a3", position: "stage manager", confirmed: false },
    ]);

    expect(options).toContain("Vocals");
    expect(options).toContain("Stage Manager");
    expect(options.filter((position) => position.toLowerCase() === "stage manager")).toHaveLength(1);
  });

  it("separates positions outside the default matrix", () => {
    expect(getCustomAssignmentPositions([
      { id: "a1", position: "Sound Tech", confirmed: false },
      { id: "a2", position: "Hospitality Lead", confirmed: false },
    ])).toEqual(["Hospitality Lead"]);
    expect(servicePositionsMatch("Lead Sound Tech", "Sound Tech")).toBe(true);
  });
});
