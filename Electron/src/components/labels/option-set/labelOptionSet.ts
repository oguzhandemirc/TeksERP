import type {
  CustomerLabelOptionSetBody,
  LabelOptionItem,
  LabelOptionSetBody,
  LabelOptionSetResponse,
  OptionSetKind,
} from "@/services/labelTemplateOptionService";

// Etiket seti editörünün SAF mantığı (React'siz, vitest ile sınanır). Taslak sunucu
// yanıtından kurulur, PUT gövdesine birebir döner; yıldız = varsayılan şablon.

export const MAX_SET_SIZE = 20;

export interface SetEntry {
  templateId: string;
  name: string;
  active: boolean;
}

export interface OptionSetDraft {
  entries: SetEntry[];
  defaultTemplateId: string | null;
}

export type OptionSetDrafts = Record<OptionSetKind, OptionSetDraft>;

export const EMPTY_DRAFT: OptionSetDraft = { entries: [], defaultTemplateId: null };

/** Sunucu varsayılanı sette satırı olmasa da başta döndürür; tekrar gelirse ilk geçen kalır. */
export function draftFromResponse(res: Pick<LabelOptionSetResponse, "defaultTemplateId" | "items">): OptionSetDraft {
  const seen = new Set<string>();
  const entries: SetEntry[] = [];
  for (const it of res.items) {
    if (seen.has(it.templateId)) continue;
    seen.add(it.templateId);
    entries.push({ templateId: it.templateId, name: it.name, active: it.active });
  }
  const def = res.defaultTemplateId && seen.has(res.defaultTemplateId) ? res.defaultTemplateId : null;
  return { entries, defaultTemplateId: def };
}

export function canAdd(draft: OptionSetDraft, templateId: string): boolean {
  return draft.entries.length < MAX_SET_SIZE && !draft.entries.some((e) => e.templateId === templateId);
}

export function addEntry(draft: OptionSetDraft, entry: SetEntry): OptionSetDraft {
  if (!canAdd(draft, entry.templateId)) return draft;
  return { ...draft, entries: [...draft.entries, entry] };
}

/**
 * "İkisine birlikte ekle" (K1): kutu işaretliyse şablon ham ve bitmiş setlerin İKİSİNE
 * eklenir; zaten olan/dolu sette değişiklik yoktur ve o set PUT'a girmez.
 */
export function addTargets(
  drafts: OptionSetDrafts,
  kind: OptionSetKind,
  both: boolean,
  entry: SetEntry,
): Array<{ kind: OptionSetKind; draft: OptionSetDraft }> {
  const kinds = both ? (Object.keys(drafts) as OptionSetKind[]) : [kind];
  // Tıklanan bağlam önce yazılır (sunucu reddederse diğeri hiç denenmez).
  const ordered = [kind, ...kinds.filter((k) => k !== kind)];
  return ordered
    .map((k) => ({ kind: k, draft: addEntry(drafts[k], entry) }))
    .filter((c) => c.draft !== drafts[c.kind]);
}

export function moveEntry(draft: OptionSetDraft, templateId: string, dir: -1 | 1): OptionSetDraft {
  const i = draft.entries.findIndex((e) => e.templateId === templateId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= draft.entries.length) return draft;
  const entries = [...draft.entries];
  const [moved] = entries.splice(i, 1);
  if (moved) entries.splice(j, 0, moved);
  return { ...draft, entries };
}

/** Varsayılanın kaldırılması onay ister (müşterisiz etiketin şablonu değişir). */
export function removalNeedsConfirm(draft: OptionSetDraft, templateId: string): boolean {
  return draft.defaultTemplateId === templateId;
}

/** Varsayılan kaldırılırsa yıldız BOŞALIR; yerine kimse kendiliğinden geçmez. */
export function removeEntry(draft: OptionSetDraft, templateId: string): OptionSetDraft {
  return {
    entries: draft.entries.filter((e) => e.templateId !== templateId),
    defaultTemplateId: draft.defaultTemplateId === templateId ? null : draft.defaultTemplateId,
  };
}

/** Yıldıza dokunmak varsayılanı o şablona taşır; yıldızlıya yeniden dokunmak yıldızı kaldırır. */
export function toggleStar(draft: OptionSetDraft, templateId: string): OptionSetDraft {
  if (!draft.entries.some((e) => e.templateId === templateId)) return draft;
  return {
    ...draft,
    defaultTemplateId: draft.defaultTemplateId === templateId ? null : templateId,
  };
}

/** `showGlobalTemplates` yalnız müşteri setinde ve verildiyse gövdeye girer. */
export function toPutBody(
  kind: OptionSetKind,
  draft: OptionSetDraft,
  showGlobalTemplates?: boolean,
): CustomerLabelOptionSetBody {
  const body: LabelOptionSetBody = {
    kind,
    templateIds: draft.entries.map((e) => e.templateId),
    defaultTemplateId: draft.defaultTemplateId,
  };
  return showGlobalTemplates === undefined ? body : { ...body, showGlobalTemplates };
}

/** Salt-okunur global önizleme: varsayılan önce, sonra sıradakiler. */
export function previewNames(items: LabelOptionItem[]): Array<{ name: string; isDefault: boolean }> {
  return items.filter((i) => i.active).map((i) => ({ name: i.name, isDefault: i.isDefault }));
}

export type OptionSetStatus = "loading" | "missing" | "error" | "ready";

/** Eski backend (uç yok → 404) "missing": editör sessizce gizlenir, eski tek seçim kalır. */
export function optionSetStatus(
  results: Array<{ isLoading: boolean; error: unknown }>,
  isMissing: (err: unknown) => boolean,
): OptionSetStatus {
  if (results.some((r) => r.error && isMissing(r.error))) return "missing";
  if (results.some((r) => r.error)) return "error";
  if (results.some((r) => r.isLoading)) return "loading";
  return "ready";
}
