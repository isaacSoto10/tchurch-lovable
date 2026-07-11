import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import type { PresentationService } from "./servicePresentation";
import {
  buildPresentationItemSnapshot,
  buildPresentationSavePayload,
  canEnterPresentationWorkspace,
  derivePresentationWorkspaceItem,
  fetchPresentationWorkspaceForPreferredView,
  isValidPresentationAnnotationBody,
  isPresentationAnnotationVisible,
  normalizePresentationWorkspace,
} from "./presentationWorkspace";

const service: PresentationService = {
  id: "service-1",
  title: "Domingo",
  date: "2026-07-12T15:00:00.000Z",
  type: "service",
  notes: null,
  items: [
    {
      id: "item-1",
      title: "Digno",
      type: "song",
      position: 0,
      duration: 5,
      song: {
        id: "song-1",
        title: "Digno",
        key: "D",
        lyrics: "{verse}\n[D]Digno eres Tú\n{chorus}\n[G]Santo, santo\n{chorus}\n[A]Aleluya",
        arrangements: [{ id: "arr-1", name: "Domingo", lyrics: "{verse}\n[D]Digno eres Tú\n{chorus}\n[G]Santo, santo\n{chorus}\n[A]Aleluya" }],
      },
    },
  ],
};

describe("presentation workspace contract", () => {
  it("derives stable, distinct section anchors and a default service sequence", () => {
    const item = derivePresentationWorkspaceItem(service.items[0], "arr-1");

    expect(item.source.sections.map((section) => [section.semanticKey, section.ordinal])).toEqual([
      ["verse", 1],
      ["chorus", 1],
      ["chorus", 2],
    ]);
    expect(new Set(item.source.sections.map((section) => section.anchorId)).size).toBe(3);
    expect(item.sequence.map((entry) => entry.sectionAnchorId)).toEqual(item.source.sections.map((section) => section.anchorId));
  });

  it("normalizes the versioned backend response without trusting missing fields", () => {
    const fallback = derivePresentationWorkspaceItem(service.items[0], "arr-1");
    const chorus = fallback.source.sections[1];
    const workspace = normalizePresentationWorkspace({
      schemaVersion: 1,
      serviceId: "service-1",
      serviceVersion: 4,
      viewer: { view: "editor", churchRole: "PLANNER", roles: ["worship_leader"], canEdit: true },
      items: [{
        serviceItemId: "item-1",
        itemVersion: 7,
        arrangementId: "arr-1",
        availableArrangements: [{ id: "arr-1", name: "Domingo", key: "D" }],
        source: fallback.source,
        sequence: [
          { id: "run-1", sectionAnchorId: chorus.anchorId, sourceFingerprint: chorus.fingerprint, label: "Coro", position: 0 },
          { id: "run-2", sectionAnchorId: chorus.anchorId, sourceFingerprint: chorus.fingerprint, label: "Coro otra vez", position: 1 },
        ],
      annotations: [{
          id: "note-1",
          sectionAnchorId: chorus.anchorId,
          sourceFingerprint: chorus.fingerprint,
          category: "musical",
          visibility: "stage",
          roles: ["band"],
          body: "Bajar dinámica",
        }],
        reconciliation: { status: "current", unresolvedAnnotationIds: [], unresolvedStepIds: [] },
      }],
    }, service, "editor", "PLANNER");

    expect(workspace.source).toBe("api");
    expect(workspace.viewer.canEdit).toBe(true);
    expect(workspace.items[0]).toMatchObject({ itemVersion: 7, arrangementId: "arr-1" });
    expect(workspace.items[0].availableArrangements).toEqual([{ id: "arr-1", name: "Domingo", key: "D" }]);
    expect(workspace.items[0].sequence).toHaveLength(2);
    expect(workspace.items[0].annotations[0].body).toBe("Bajar dinámica");
  });

  it("preserves item-level cues instead of attaching them to the first section", () => {
    const fallback = derivePresentationWorkspaceItem(service.items[0], "arr-1");
    const workspace = normalizePresentationWorkspace({
      serviceId: service.id,
      serviceVersion: "svc-v4",
      viewer: { view: "operator", roles: ["operator"], canEdit: false },
      items: [{
        serviceItemId: "item-1",
        itemVersion: 2,
        arrangementId: "arr-1",
        source: fallback.source,
        sequence: fallback.sequence,
        annotations: [{
          id: "item-cue",
          sectionAnchorId: null,
          sourceFingerprint: null,
          category: "safety",
          visibility: "stage",
          roles: ["all"],
          body: "No usar humo",
        }],
      }],
    }, service, "operator");

    expect(workspace.serviceVersion).toBe("svc-v4");
    expect(workspace.items[0].annotations[0]).toMatchObject({ sectionAnchorId: null, sourceFingerprint: null });
  });

  it("keeps unresolved steps for editor recovery without treating them as source sections", () => {
    const fallback = derivePresentationWorkspaceItem(service.items[0], "arr-1");
    const workspace = normalizePresentationWorkspace({
      serviceId: service.id,
      viewer: { view: "editor", canEdit: true },
      items: [{
        serviceItemId: "item-1",
        itemVersion: 3,
        arrangementId: "arr-1",
        source: fallback.source,
        sequence: [
          ...fallback.sequence,
          { id: "orphan-step", sectionAnchorId: "missing-anchor", sourceFingerprint: "old-fingerprint", label: "Puente anterior", position: 99 },
        ],
        annotations: [],
        reconciliation: { status: "needs_review", unresolvedAnnotationIds: [], unresolvedStepIds: ["orphan-step"] },
      }],
    }, service, "editor");

    expect(workspace.items[0].sequence.at(-1)).toMatchObject({ id: "orphan-step", sectionAnchorId: "missing-anchor" });
    expect(workspace.items[0].reconciliation).toMatchObject({ status: "needs_review", unresolvedStepIds: ["orphan-step"] });
  });

  it("builds the exact optimistic-concurrency snapshot expected by PUT", () => {
    const item = derivePresentationWorkspaceItem(service.items[0], "arr-1");
    item.itemVersion = 9;
    item.annotations.push({
      id: "local_note_draft",
      sectionAnchorId: null,
      sourceFingerprint: null,
      category: "note",
      visibility: "stage",
      roles: ["all"],
      body: "Nota nueva",
    });

    const snapshot = buildPresentationItemSnapshot(item);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      itemId: "item-1",
      expectedVersion: 9,
      arrangementId: "arr-1",
    });
    expect(snapshot.sequence.every((entry) => !("id" in entry))).toBe(true);
    expect(snapshot.annotations[0]).not.toHaveProperty("id");
    expect(buildPresentationSavePayload(item)).toMatchObject({
      schemaVersion: 1,
      itemId: "item-1",
      expectedVersion: 9,
      arrangementId: "arr-1",
    });
  });

  it("defensively filters role-specific private stage notes", () => {
    const annotation = {
      id: "note-1",
      sectionAnchorId: "section-1" as string | null,
      sourceFingerprint: "fingerprint-1" as string | null,
      category: "direction" as const,
      visibility: "stage" as const,
      roles: ["worship_leader" as const],
      body: "Repite el coro",
    };

    expect(isPresentationAnnotationVisible(annotation, "stage", ["band"])).toBe(false);
    expect(isPresentationAnnotationVisible(annotation, "stage", ["worship_leader"])).toBe(true);
    expect(isPresentationAnnotationVisible(annotation, "stage", ["all"])).toBe(true);
    expect(isPresentationAnnotationVisible(annotation, "operator", [], true)).toBe(true);
  });

  it("keeps backend semantic UUIDs, explicit ordinals, empty sequences, and legacy note bodies", () => {
    const fallback = derivePresentationWorkspaceItem(service.items[0], "arr-1");
    const serverSections = fallback.source.sections.map((section) => ({
      ...section,
      anchorId: `server-${section.semanticKey}-${section.ordinal}`,
      semanticKey: `${section.semanticKey}:${section.ordinal}`,
      type: section.semanticKey,
    }));
    const workspace = normalizePresentationWorkspace({
      schemaVersion: 1,
      serviceId: service.id,
      serviceVersion: "server-v8",
      viewer: { view: "editor", churchRole: "PLANNER", roles: ["all"], canEdit: true },
      items: [{
        serviceItemId: "item-1",
        itemVersion: 8,
        arrangementId: "arr-1",
        source: { ...fallback.source, sections: serverSections },
        sequence: [],
        annotations: [],
        legacyNotes: [{ id: "legacy-vocals", key: "vocals", body: "Entrada suave", roles: ["vocals"], readOnly: true }],
        reconciliation: { status: "needs_review", unresolvedAnnotationIds: [], unresolvedStepIds: [] },
      }],
    }, service, "editor", "PLANNER");

    expect(workspace.items[0].source.sections.map((section) => [section.anchorId, section.semanticKey, section.ordinal])).toEqual([
      ["server-verse-1", "verse", 1],
      ["server-chorus-1", "chorus", 1],
      ["server-chorus-2", "chorus", 2],
    ]);
    expect(workspace.items[0].sequence).toEqual([]);
    expect(workspace.items[0].legacyNotes).toEqual(["Entrada suave"]);
  });

  it("uses the backend as the authority for view fallback and entry", async () => {
    const stageWorkspace = normalizePresentationWorkspace({
      schemaVersion: 1,
      serviceId: service.id,
      serviceVersion: "server-v2",
      viewer: { view: "stage", churchRole: "MEMBER", roles: ["band"], canEdit: false },
      items: [],
    }, service, "stage", "MEMBER");
    const calls: string[] = [];
    const loaded = await fetchPresentationWorkspaceForPreferredView(service, "editor", "PLANNER", async (_service, view) => {
      calls.push(view);
      if (view === "editor") throw new ApiError("Forbidden", 403, { error: "FORBIDDEN" });
      return stageWorkspace;
    });

    expect(calls).toEqual(["editor", "stage"]);
    expect(loaded.viewer).toMatchObject({ view: "stage", canEdit: false });
    expect(canEnterPresentationWorkspace(loaded, false)).toBe(true);

    await expect(fetchPresentationWorkspaceForPreferredView(service, "stage", "MEMBER", async () => {
      throw new ApiError("Forbidden", 403, { error: "FORBIDDEN" });
    })).rejects.toMatchObject({ status: 403 });
    await expect(fetchPresentationWorkspaceForPreferredView(service, "editor", "PLANNER", async () => {
      throw new ApiError("Unauthorized", 401, { error: "UNAUTHORIZED" });
    })).rejects.toMatchObject({ status: 401 });
  });

  it("enforces the backend annotation body limit", () => {
    expect(isValidPresentationAnnotationBody("Cue")).toBe(true);
    expect(isValidPresentationAnnotationBody(" ")).toBe(false);
    expect(isValidPresentationAnnotationBody("x".repeat(2_000))).toBe(true);
    expect(isValidPresentationAnnotationBody("x".repeat(2_001))).toBe(false);
  });
});
