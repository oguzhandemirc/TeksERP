// =============================================================================
// Sevki Geri Al — etkilenen kayıt listesi (saf): çuval → toplar (barkod · metre · sahibi · döneceği raf)
// =============================================================================
// Çekirdek kural: yıkıcı işlemde etkilenen HER kayıt listelenir, soyut sayı yetmez. Backend
// `sacks[].rolls` ve `looseRolls` taşır; eski sunucu (alan yok) için çuval satırı yine basılır,
// top satırları boş kalır — liste "1 çuval · N top" sayısına DÜŞMEZ, çuval numarası her durumda görünür.
// =============================================================================
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { UndoAffectedRoll, UndoDispatchPreview } from "./service";

export interface UndoAffectedRow {
  key: string;
  kind: "sack" | "roll";
  /** Çuval no ya da top barkodu. */
  label: string;
  /** Top satırı: "12,5 m · Sahibi: X · → Depo"; çuval satırı: "N top". */
  detail: string;
}

const meters = (m: number): string => `${m.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} m`;
const shelf = (s: string): string => rollStatusLabels[s as RollStatus] ?? s;

export function undoRollDetail(r: UndoAffectedRoll): string {
  const parts = [meters(r.meters)];
  if (r.ownerName) parts.push(`Emanet: ${r.ownerName}`);
  parts.push(`→ ${shelf(r.returnTo)}`);
  return parts.join(" · ");
}

export function undoAffectedRows(p: Pick<UndoDispatchPreview, "sacks" | "looseRolls">): UndoAffectedRow[] {
  const rows: UndoAffectedRow[] = [];
  for (const s of p.sacks) {
    const rolls = s.rolls ?? [];
    rows.push({ key: `sack:${s.id}`, kind: "sack", label: s.sackNo, detail: `${rolls.length || s.rollCount} top` });
    for (const r of rolls) rows.push({ key: `roll:${r.id}`, kind: "roll", label: r.barcode ?? "(barkodsuz)", detail: undoRollDetail(r) });
  }
  for (const r of p.looseRolls ?? []) rows.push({ key: `roll:${r.id}`, kind: "roll", label: r.barcode ?? "(barkodsuz)", detail: `Çuvalsız · ${undoRollDetail(r)}` });
  return rows;
}
