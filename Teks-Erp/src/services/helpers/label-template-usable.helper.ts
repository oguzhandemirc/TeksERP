// =============================================================================
// TOP ETİKETİNE SEÇİLEBİLİR ŞABLON — tek yüklem (2026-11-11, `roll-label-edit.service`ten taşındı)
// =============================================================================
// "Etiketi düzenle" havuz seçicisi ve çoklu etiket seti (`label-template-options.helper.ts`) AYNI süzgeçten geçer:
// aktif, silinmemiş, serbest değil, türü uyumlu, başka bağlamın (çuval/tezgah/levent/kartela) alanını bağlamıyor.
// =============================================================================
import { LabelKind, type LabelTemplate } from "@prisma/client";
import { readCanvasLayout } from "../../config/label-elements";
import { getKindExclusiveKeys } from "./label-context-fit";

/** Yüklemin okuduğu şablon kolonları — çağıranlar `select`e bunu yayar. */
export const USABLE_TEMPLATE_SELECT = {
  isActive: true, deletedAt: true, standalone: true, kind: true, fields: true, variants: { select: { elements: true } },
} as const;

/** Kanvas varyantlarının + akış alan listesinin bağladığı anahtarlar (koşullu eleman dahil). */
export function boundKeysOf(t: { fields: unknown; variants: { elements: unknown }[] }): Set<string> {
  const keys = new Set<string>();
  for (const v of t.variants) {
    for (const el of readCanvasLayout(v.elements)?.elements ?? []) {
      if (el.type === "field" && typeof el.bind === "string") keys.add(el.bind);
    }
  }
  if (Array.isArray(t.fields)) {
    for (const f of t.fields as Array<{ key?: unknown; isVisible?: unknown }>) {
      if (typeof f.key === "string" && f.isVisible !== false) keys.add(f.key);
    }
  }
  return keys;
}

const FOREIGN_KINDS = [LabelKind.SACK, LabelKind.MACHINE, LabelKind.WARP_BEAM, LabelKind.SWATCH];
/** Top etiketine yabancı bağlamların kimlik alanları. */
export const foreignKeys = (): Set<string> => new Set(FOREIGN_KINDS.flatMap((k) => [...getKindExclusiveKeys(k)]));

/** Top etiketine seçilebilir şablon: aktif, silinmemiş, serbest değil, türü uyumlu, başka bağlamın alanını bağlamıyor. */
export function usableForRoll(
  t: Pick<LabelTemplate, "isActive" | "deletedAt" | "standalone" | "kind">,
  bound: Set<string>,
  kind: LabelKind,
  foreign: Set<string>,
): boolean {
  if (!t.isActive || t.deletedAt != null || t.standalone) return false;
  if (t.kind != null && t.kind !== kind) return false;
  for (const k of bound) if (foreign.has(k)) return false;
  return true;
}
