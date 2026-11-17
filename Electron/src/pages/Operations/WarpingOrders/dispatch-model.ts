// =============================================================================
// İPLİK SEVKİ taslak modeli (D6b) — saf: önizlemeden satırlar · satır içi lot/stok uyarıları · gövde
// =============================================================================
// Karar sunucuda (lot kuralı, eksi bakiye, sahip); panel aynı kuralı satırda ÖNCEDEN gösterir ki kullanıcı
// 409'u tıklamadan görsün. Engelleyen uyarı (depo yok, lot zorunlu, tek lot kuralı) düğmeyi kapatır; diğerleri yalnız bilgi.
// =============================================================================
import { fmtKg, parseNum } from "./order-model";
import type { WarpingDispatchBody, WarpingDispatchPreview, WarpingDispatchPreviewYarn } from "./yarn-types";

export interface PickedRef {
  id: string;
  label: string;
  /** Seçim anında görülen serbest bakiye (kg) — yalnız uyarı için. */
  balanceKg: number | null;
}

export interface DispatchLineDraft {
  key: string;
  yarnItemId: string;
  warehouse: PickedRef | null;
  lot: PickedRef | null;
  qtyKg: string;
}

export interface LineNote {
  text: string;
  blocking: boolean;
}

const lotKey = (id: string | null | undefined) => id ?? "";

/** Önerisi olan her iplik için bir satır (öneri dolu, virgüllü); önerisi sıfır olan iplik boş miktarla gelir.
 *  Deverecide bu iplikten TEK lot varsa satır o lotla başlar (lot kuralına uyan varsayılan; kullanıcı değiştirebilir). */
export function initialDispatchLines(p: WarpingDispatchPreview): DispatchLineDraft[] {
  return p.yarns.map((y) => {
    const s = Number(y.suggestedKg);
    const only = y.lots.length === 1 && y.lots[0]!.lotId ? y.lots[0]! : null;
    return {
      key: y.yarnItemId, yarnItemId: y.yarnItemId, warehouse: null,
      lot: only ? { id: only.lotId!, label: only.lotNo ?? "", balanceKg: null } : null,
      qtyKg: s > 0 ? String(Number(s.toFixed(3))).replace(".", ",") : "",
    };
  });
}

export function addLotLine(lines: DispatchLineDraft[], yarnItemId: string): DispatchLineDraft[] {
  const n = lines.filter((l) => l.yarnItemId === yarnItemId).length;
  const at = lines.map((l) => l.yarnItemId).lastIndexOf(yarnItemId);
  const next = [...lines];
  next.splice(at + 1, 0, { key: `${yarnItemId}#${n}`, yarnItemId, warehouse: null, lot: null, qtyKg: "" });
  return next;
}

const active = (l: DispatchLineDraft) => (parseNum(l.qtyKg) ?? 0) > 0;

/** Satır notları — sırası: engelleyenler önce. Lot karışımı = deverecideki açık lotlar ∪ taslaktaki diğer satırların lotu. */
export function lineNotes(line: DispatchLineDraft, lines: DispatchLineDraft[], yarn: WarpingDispatchPreviewYarn, p: WarpingDispatchPreview): LineNote[] {
  if (!active(line)) return [];
  const qty = parseNum(line.qtyKg) ?? 0;
  const notes: LineNote[] = [];
  if (!line.warehouse) notes.push({ text: "Depo seçin.", blocking: true });
  if (p.lotRequired && !line.lot) notes.push({ text: "Lot zorunlu (fabrika ayarı) — lot seçin.", blocking: true });
  const others = new Map<string, string>();
  for (const l of yarn.lots) others.set(lotKey(l.lotId), l.lotNo ?? "lotsuz");
  for (const l of lines) if (l !== line && l.yarnItemId === line.yarnItemId && active(l)) others.set(lotKey(l.lot?.id), l.lot?.label ?? "lotsuz");
  const mine = lotKey(line.lot?.id);
  const foreign = [...others].filter(([k]) => k !== mine).map(([, label]) => label);
  if (foreign.length > 0 && p.lotPolicy === "SINGLE_LOT") {
    notes.push({ text: `Tek lot kuralı: bu iplikte ${foreign.join(", ")} var — aynı lotu seçin.`, blocking: true });
  } else if (foreign.length > 0 && p.lotPolicy === "WARN") {
    notes.push({ text: `Karışık lot: bu iplikte ${foreign.join(", ")} de var.`, blocking: false });
  }
  const bal = line.lot?.balanceKg ?? line.warehouse?.balanceKg ?? null;
  if (bal !== null && qty > bal) notes.push({ text: `Seçilen yerde ${fmtKg(bal)} kg var — sunucu eksi bakiyeye izin vermezse sevk reddedilir.`, blocking: false });
  return notes;
}

/** İplik toplamı plandan fazla mı (meşru — yalnız bilgi). */
export function overPlanNote(yarn: WarpingDispatchPreviewYarn, lines: DispatchLineDraft[]): string | null {
  const sum = lines.filter((l) => l.yarnItemId === yarn.yarnItemId).reduce((s, l) => s + (parseNum(l.qtyKg) ?? 0), 0);
  const sug = Number(yarn.suggestedKg);
  return sum > sug + 0.0005 ? `Öneriden ${fmtKg(sum - sug)} kg fazla gidiyor (plandan fazla sevk serbest).` : null;
}

export type DispatchBodyResult = { ok: true; body: Omit<WarpingDispatchBody, "clientToken"> } | { ok: false; error: string };

export function buildDispatchBody(
  lines: DispatchLineDraft[],
  p: WarpingDispatchPreview,
  meta: { plateNumber: string; driverName: string; notes: string },
): DispatchBodyResult {
  const used = lines.filter(active);
  if (used.length === 0) return { ok: false, error: "En az bir iplik satırına miktar girin." };
  for (const l of lines) {
    if (l.qtyKg.trim() !== "" && parseNum(l.qtyKg) === null) return { ok: false, error: "Miktar sayı olmalı." };
  }
  const blocked = used.some((l) => lineNotes(l, lines, p.yarns.find((y) => y.yarnItemId === l.yarnItemId)!, p).some((n) => n.blocking));
  if (blocked) return { ok: false, error: "Kırmızı satır notlarını giderin." };
  const opt = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    ok: true,
    body: {
      lines: used.map((l) => ({ yarnItemId: l.yarnItemId, warehouseId: l.warehouse!.id, lotId: l.lot?.id ?? null, qtyKg: parseNum(l.qtyKg)! })),
      plateNumber: opt(meta.plateNumber),
      driverName: opt(meta.driverName),
      notes: opt(meta.notes),
    },
  };
}
