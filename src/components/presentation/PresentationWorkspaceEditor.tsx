import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CopyPlus, Loader2, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createPresentationAnnotationId,
  createPresentationSequenceId,
  isValidPresentationAnnotationBody,
  MAX_PRESENTATION_ANNOTATION_BODY_LENGTH,
  type PresentationAnnotationCategory,
  type PresentationAnnotationVisibility,
  type PresentationTargetRole,
  type PresentationWorkspace,
  type PresentationWorkspaceItem,
} from "@/lib/presentationWorkspace";
import type { PresentationService } from "@/lib/servicePresentation";

const CATEGORY_LABELS: Record<PresentationAnnotationCategory, string> = {
  note: "Nota",
  direction: "Dirección",
  musical: "Musical",
  technical: "Técnica",
  transition: "Transición",
  safety: "Seguridad",
};

const ROLE_LABELS: Record<PresentationTargetRole, string> = {
  worship_leader: "Líder",
  band: "Banda",
  vocals: "Voces",
  av: "A/V",
  speaker: "Predicador",
  operator: "Operador",
  stage: "Escenario",
  all: "Todos",
};

const EDITABLE_ROLES = Object.keys(ROLE_LABELS) as PresentationTargetRole[];
const EDITABLE_CATEGORIES = Object.keys(CATEGORY_LABELS) as PresentationAnnotationCategory[];

function cloneItem(item: PresentationWorkspaceItem) {
  return {
    ...item,
    source: { ...item.source, sections: item.source.sections.map((section) => ({ ...section })) },
    sequence: item.sequence.map((entry) => ({ ...entry })),
    annotations: item.annotations.map((annotation) => ({ ...annotation, roles: [...annotation.roles] })),
    legacyNotes: [...item.legacyNotes],
    reconciliation: {
      ...item.reconciliation,
      unresolvedAnnotationIds: [...item.reconciliation.unresolvedAnnotationIds],
      unresolvedStepIds: [...item.reconciliation.unresolvedStepIds],
    },
    availableArrangements: item.availableArrangements.map((arrangement) => ({ ...arrangement })),
  };
}

type AnnotationDraft = {
  id: string | null;
  sectionAnchorId: string;
  category: PresentationAnnotationCategory;
  visibility: PresentationAnnotationVisibility;
  roles: PresentationTargetRole[];
  body: string;
};

function emptyAnnotation(sectionAnchorId = "__item__"): AnnotationDraft {
  return {
    id: null,
    sectionAnchorId,
    category: "direction",
    visibility: "stage",
    roles: ["worship_leader"],
    body: "",
  };
}

type PresentationWorkspaceEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: PresentationService;
  workspace: PresentationWorkspace;
  saving: boolean;
  onSave: (item: PresentationWorkspaceItem) => Promise<void>;
};

export function PresentationWorkspaceEditor({
  open,
  onOpenChange,
  service,
  workspace,
  saving,
  onSave,
}: PresentationWorkspaceEditorProps) {
  const editableItems = workspace.items;
  const [selectedItemId, setSelectedItemId] = useState(editableItems[0]?.serviceItemId || "");
  const selectedWorkspaceItem = editableItems.find((item) => item.serviceItemId === selectedItemId) || editableItems[0] || null;
  const [draft, setDraft] = useState<PresentationWorkspaceItem | null>(() => selectedWorkspaceItem ? cloneItem(selectedWorkspaceItem) : null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>(() => emptyAnnotation(selectedWorkspaceItem?.source.sections[0]?.anchorId));

  useEffect(() => {
    if (!open) return;
    const nextItem = editableItems.find((item) => item.serviceItemId === selectedItemId) || editableItems[0] || null;
    if (nextItem && nextItem.serviceItemId !== selectedItemId) setSelectedItemId(nextItem.serviceItemId);
    setDraft(nextItem ? cloneItem(nextItem) : null);
    setAnnotationDraft(emptyAnnotation(nextItem?.source.sections[0]?.anchorId));
  }, [open, selectedItemId, editableItems]);

  const sourceById = useMemo(
    () => new Map(draft?.source.sections.map((section) => [section.anchorId, section]) || []),
    [draft?.source.sections],
  );
  const serviceItemNames = useMemo(
    () => new Map(service.items.map((item) => [item.id, item.song?.title || item.title])),
    [service.items],
  );

  function selectItem(itemId: string) {
    setSelectedItemId(itemId);
    const item = editableItems.find((candidate) => candidate.serviceItemId === itemId) || null;
    setDraft(item ? cloneItem(item) : null);
    setAnnotationDraft(emptyAnnotation(item?.source.sections[0]?.anchorId));
  }

  function updateSequence(nextSequence: PresentationWorkspaceItem["sequence"]) {
    setDraft((current) => current ? {
      ...current,
      sequence: nextSequence.map((entry, position) => ({ ...entry, position })),
    } : current);
  }

  function moveSequence(index: number, delta: number) {
    if (!draft) return;
    const destination = index + delta;
    if (destination < 0 || destination >= draft.sequence.length) return;
    const next = [...draft.sequence];
    [next[index], next[destination]] = [next[destination], next[index]];
    updateSequence(next);
  }

  function duplicateSequence(index: number) {
    if (!draft) return;
    const source = draft.sequence[index];
    if (!source) return;
    const next = [...draft.sequence];
    next.splice(index + 1, 0, {
      ...source,
      id: createPresentationSequenceId(draft.serviceItemId, source.sectionAnchorId),
      label: `${source.label} · repetir`,
    });
    updateSequence(next);
  }

  function addSection(anchorId: string) {
    if (!draft) return;
    const section = sourceById.get(anchorId);
    if (!section) return;
    updateSequence([
      ...draft.sequence,
      {
        id: createPresentationSequenceId(draft.serviceItemId, section.anchorId),
        sectionAnchorId: section.anchorId,
        sourceFingerprint: section.fingerprint,
        label: section.label,
        position: draft.sequence.length,
      },
    ]);
  }

  function resetSequence() {
    if (!draft) return;
    updateSequence(draft.source.sections.map((section, position) => ({
      id: createPresentationSequenceId(draft.serviceItemId, section.anchorId),
      sectionAnchorId: section.anchorId,
      sourceFingerprint: section.fingerprint,
      label: section.label,
      position,
    })));
  }

  function toggleRole(role: PresentationTargetRole) {
    setAnnotationDraft((current) => {
      if (role === "all") return { ...current, roles: current.roles.includes("all") ? current.roles : ["all"] };
      const withoutAll = current.roles.filter((candidate) => candidate !== "all");
      if (withoutAll.length === 1 && withoutAll[0] === role) return current;
      return {
        ...current,
        roles: withoutAll.includes(role) ? withoutAll.filter((candidate) => candidate !== role) : [...withoutAll, role],
      };
    });
  }

  function commitAnnotation() {
    if (!draft || !isValidPresentationAnnotationBody(annotationDraft.body) || annotationDraft.roles.length === 0) return;
    const sectionAnchorId = annotationDraft.sectionAnchorId === "__item__" ? null : annotationDraft.sectionAnchorId;
    const source = sectionAnchorId ? sourceById.get(sectionAnchorId) : null;
    const annotation = {
      id: annotationDraft.id || createPresentationAnnotationId(),
      sectionAnchorId,
      sourceFingerprint: source?.fingerprint || null,
      category: annotationDraft.category,
      visibility: annotationDraft.visibility,
      roles: annotationDraft.roles,
      body: annotationDraft.body.trim(),
    };
    setDraft((current) => current ? {
      ...current,
      annotations: annotationDraft.id
        ? current.annotations.map((candidate) => candidate.id === annotationDraft.id ? { ...candidate, ...annotation } : candidate)
        : [...current.annotations, annotation],
    } : current);
    setAnnotationDraft(emptyAnnotation(draft.source.sections[0]?.anchorId));
  }

  function editAnnotation(annotationId: string) {
    const annotation = draft?.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) return;
    setAnnotationDraft({
      id: annotation.id,
      sectionAnchorId: annotation.sectionAnchorId || "__item__",
      category: annotation.category,
      visibility: annotation.visibility,
      roles: [...annotation.roles],
      body: annotation.body,
    });
  }

  function deleteAnnotation(annotationId: string) {
    setDraft((current) => current ? {
      ...current,
      annotations: current.annotations.filter((annotation) => annotation.id !== annotationId),
    } : current);
    if (annotationDraft.id === annotationId) setAnnotationDraft(emptyAnnotation(draft?.source.sections[0]?.anchorId));
  }

  const canCommitAnnotation = isValidPresentationAnnotationBody(annotationDraft.body) && annotationDraft.roles.length > 0;
  const canSaveDraft = Boolean(
    draft &&
    draft.sequence.length > 0 &&
    draft.annotations.every((annotation) => isValidPresentationAnnotationBody(annotation.body) && annotation.roles.length > 0),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100svh-1rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-3xl p-0 sm:h-[min(92svh,920px)]">
        <DialogHeader className="border-b border-zinc-200 px-5 py-4 pr-12">
          <DialogTitle className="text-xl font-black tracking-tight">Preparar Tchurch Live</DialogTitle>
          <DialogDescription>Ordena la canción y coloca indicaciones privadas justo donde el equipo las necesita.</DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1">
            <aside className="flex gap-2 overflow-x-auto border-b border-zinc-200 bg-zinc-50 p-3 lg:block lg:space-y-2 lg:overflow-y-auto lg:border-b-0 lg:border-r">
              {editableItems.map((item) => (
                <button
                  key={item.serviceItemId}
                  type="button"
                  className={`min-h-11 min-w-40 rounded-xl px-3 py-2 text-left text-sm font-bold transition-colors lg:w-full ${item.serviceItemId === draft.serviceItemId ? "bg-zinc-950 text-white" : "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100"}`}
                  onClick={() => selectItem(item.serviceItemId)}
                >
                  <span className="line-clamp-2">{serviceItemNames.get(item.serviceItemId) || "Canción"}</span>
                  <span className={`mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] ${item.serviceItemId === draft.serviceItemId ? "text-zinc-400" : "text-zinc-400"}`}>
                    {item.sequence.length} secciones · {item.annotations.length} notas
                  </span>
                </button>
              ))}
            </aside>

            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
              {draft.reconciliation.status === "needs_review" && (
                <div className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div><strong>Revisa el arreglo.</strong> La letra cambió; {draft.reconciliation.unresolvedStepIds.length} sección(es) y {draft.reconciliation.unresolvedAnnotationIds.length} nota(s) no se mostrarán en escenario hasta que las vuelvas a ubicar.</div>
                </div>
              )}

              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <section className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Mapa del arreglo</p>
                      <h2 className="mt-1 text-lg font-black text-zinc-950">Orden del servicio</h2>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 rounded-xl" onClick={resetSequence}>
                      <RotateCcw className="h-4 w-4" /> Original
                    </Button>
                  </div>

                  {draft.availableArrangements.length > 0 && (
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                      <Label htmlFor="presentation-arrangement" className="text-xs font-bold text-zinc-600">Arreglo de esta canción</Label>
                      <Select value={draft.arrangementId || draft.availableArrangements[0].id} onValueChange={(arrangementId) => setDraft((current) => current ? { ...current, arrangementId } : current)}>
                        <SelectTrigger id="presentation-arrangement" className="mt-2 h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {draft.availableArrangements.map((arrangement) => (
                            <SelectItem key={arrangement.id} value={arrangement.id}>{arrangement.name}{arrangement.key ? ` · ${arrangement.key}` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {draft.arrangementId !== selectedWorkspaceItem?.arrangementId && <p className="mt-2 text-xs leading-5 text-amber-700">Al guardar, Tchurch remapeará las secciones y conservará las notas que pueda identificar. Las demás quedarán marcadas para revisión.</p>}
                    </div>
                  )}

                  <div className="space-y-2">
                    {draft.sequence.map((entry, index) => (
                      <div key={entry.id} className="flex min-h-14 items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xs font-black text-zinc-500">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-zinc-950">{entry.label}</p>
                          <p className="truncate text-[11px] text-zinc-500">{sourceById.get(entry.sectionAnchorId)?.preview || "Sección musical"}</p>
                          {draft.reconciliation.unresolvedStepIds.includes(entry.id) && <span className="mt-1 inline-flex rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-amber-800">Reubicar</span>}
                        </div>
                        <div className="flex shrink-0">
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl" aria-label={`Mover ${entry.label} arriba`} disabled={index === 0} onClick={() => moveSequence(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl" aria-label={`Mover ${entry.label} abajo`} disabled={index === draft.sequence.length - 1} onClick={() => moveSequence(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl" aria-label={`Repetir ${entry.label}`} onClick={() => duplicateSequence(index)}><CopyPlus className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-red-500" aria-label={`Quitar ${entry.label}`} onClick={() => updateSequence(draft.sequence.filter((candidate) => candidate.id !== entry.id))}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-3">
                    <p className="mb-2 text-xs font-bold text-zinc-600">Agregar una sección</p>
                    <div className="flex flex-wrap gap-2">
                      {draft.source.sections.map((section) => (
                        <Button key={section.anchorId} type="button" variant="outline" size="sm" className="min-h-10 rounded-xl bg-white" onClick={() => addSection(section.anchorId)}>
                          <Plus className="h-3.5 w-3.5" /> {section.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">Notas privadas</p>
                    <h2 className="mt-1 text-lg font-black text-zinc-950">Indicación de escenario</h2>
                  </div>

                  <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="presentation-note-section" className="text-xs font-bold text-zinc-600">Momento</Label>
                        <Select value={annotationDraft.sectionAnchorId} onValueChange={(value) => setAnnotationDraft((current) => ({ ...current, sectionAnchorId: value }))}>
                          <SelectTrigger id="presentation-note-section" className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__item__">Toda la canción</SelectItem>
                            {draft.source.sections.map((section) => <SelectItem key={section.anchorId} value={section.anchorId}>{section.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="presentation-note-category" className="text-xs font-bold text-zinc-600">Tipo</Label>
                        <Select value={annotationDraft.category} onValueChange={(value) => setAnnotationDraft((current) => ({ ...current, category: value as PresentationAnnotationCategory }))}>
                          <SelectTrigger id="presentation-note-category" className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>{EDITABLE_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{CATEGORY_LABELS[category]}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="presentation-note-body" className="text-xs font-bold text-zinc-600">Nota</Label>
                      <Textarea id="presentation-note-body" rows={3} maxLength={MAX_PRESENTATION_ANNOTATION_BODY_LENGTH} className="rounded-xl bg-white" placeholder="Ej. Repite el coro; guitarra acústica solamente…" value={annotationDraft.body} onChange={(event) => setAnnotationDraft((current) => ({ ...current, body: event.target.value }))} />
                      <p className="text-right text-[11px] font-semibold tabular-nums text-zinc-400">{annotationDraft.body.length}/{MAX_PRESENTATION_ANNOTATION_BODY_LENGTH}</p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="presentation-note-visibility" className="text-xs font-bold text-zinc-600">Visibilidad</Label>
                      <Select value={annotationDraft.visibility} onValueChange={(value) => setAnnotationDraft((current) => ({ ...current, visibility: value as PresentationAnnotationVisibility }))}>
                        <SelectTrigger id="presentation-note-visibility" className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stage">Solo escenario</SelectItem>
                          <SelectItem value="all">Todas las vistas</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-zinc-600">Quién la verá</Label>
                      <div className="flex flex-wrap gap-2">
                        {EDITABLE_ROLES.map((role) => (
                          <button key={role} type="button" aria-pressed={annotationDraft.roles.includes(role)} className={`min-h-10 rounded-xl px-3 text-xs font-bold ring-1 transition-colors ${annotationDraft.roles.includes(role) ? "bg-zinc-950 text-white ring-zinc-950" : "bg-white text-zinc-600 ring-zinc-200"}`} onClick={() => toggleRole(role)}>{ROLE_LABELS[role]}</button>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      {annotationDraft.id && <Button type="button" variant="ghost" className="min-h-11 rounded-xl" onClick={() => setAnnotationDraft(emptyAnnotation(draft.source.sections[0]?.anchorId))}>Cancelar edición</Button>}
                      <Button type="button" className="min-h-11 rounded-xl" disabled={!canCommitAnnotation} onClick={commitAnnotation}>
                        {annotationDraft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        {annotationDraft.id ? "Actualizar" : "Agregar nota"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {draft.annotations.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">Aún no hay notas privadas para esta canción.</div>
                    ) : draft.annotations.map((annotation) => (
                      <div key={annotation.id} className="flex gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex flex-wrap gap-1.5">
                            <Badge variant="secondary" className="rounded-lg">{CATEGORY_LABELS[annotation.category]}</Badge>
                            <Badge variant="outline" className="rounded-lg">{annotation.sectionAnchorId ? sourceById.get(annotation.sectionAnchorId)?.label || "Sección" : "Toda la canción"}</Badge>
                            {annotation.roles.slice(0, 3).map((role) => <Badge key={role} variant="outline" className="rounded-lg">{ROLE_LABELS[role]}</Badge>)}
                          </div>
                          <p className="text-sm font-semibold leading-5 text-zinc-800">{annotation.body}</p>
                        </div>
                        <div className="flex shrink-0">
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl" aria-label="Editar nota" onClick={() => editAnnotation(annotation.id)}><Pencil className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-red-500" aria-label="Eliminar nota" onClick={() => deleteAnnotation(annotation.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-zinc-500">Agrega una canción con secciones para preparar Tchurch Live.</div>
        )}

        <DialogFooter className="border-t border-zinc-200 bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button type="button" variant="outline" className="min-h-11 rounded-xl" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button type="button" className="min-h-11 rounded-xl" disabled={!canSaveDraft || saving} onClick={() => draft && onSave(draft)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar canción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
