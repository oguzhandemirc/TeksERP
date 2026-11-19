// Deverecide tutulan iplik — saf yardımcılar (D6b-2). Panel hesap YAPMAZ: yalnız biçim, satır içi sınır uyarısı
// ve gövde kurar; tutma/aşım kararını sunucu verir (önizleme + yazım aynı yüklem).
import { fmtKg, parseNum } from "./order-model";
import { yarnLabelParts } from "./YarnLabel";
import type { WarpingOrder, WarpingOrderStatus } from "./types";
import type { WarpingTransferLine, WarpingYarnHolding } from "./holding-types";

/** İade/aktarma kaynağı yalnız ipliği tutan durumda (sunucu `HOLDERS`ının aynası; kapı sunucuda). */
export const holdsYarn = (s: WarpingOrderStatus) => s === "IN_PROGRESS" || s === "COMPLETED";

/** Aktarma hücresi: gelen (+) / giden (−) — sevk ve tutma tablolarında aynı biçim. */
export function transferText(out: string, inn: string): string {
  const parts = [Number(inn) > 0 && `+${fmtKg(inn)}`, Number(out) > 0 && `−${fmtKg(out)}`].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

export type YarnNames =Map<string, { code: string; name: string }>;
export const yarnNamesOf = (o: Pick<WarpingOrder, "yarns">): YarnNames => new Map(o.yarns.map((y) => [y.yarnItemId, { code: y.code, name: y.name }]));
export const yarnCode = (names: YarnNames, id: string) => names.get(id)?.code ?? "iplik";

/** Başlıkta iplik ADI birincil, kod ikincil (plan satırı yoksa yalnız kod/"iplik"). */
export const yarnTitle = (names: YarnNames, id: string) => {
  const y = names.get(id);
  return yarnLabelParts(y?.name, y?.code);
};

export type KgCheck = { ok: true; qty: number } | { ok: false; error: string | null };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Panel girişine geri yazılacak kg metni (virgüllü, sondaki sıfırsız). */
export const kgInput = (n: number) => String(round3(n)).replace(".", ",");

export type ReturnCheck =
  | { ok: true; qty: number; waste: number; keep: number }
  | { ok: false; error: string | null; field: "qty" | "waste" | "total" | null };

/**
 * İade + fire girişi: iade ∈ (0, tutma], fire boş = 0 ve ≥ 0, iade + fire ≤ tutma. Yalnız satır içi uyarı;
 * aşım kararı sunucuda (önizleme + yazım aynı yüklem). Boş iade hata metni üretmez (düğme kapalı kalır).
 */
export function checkReturn(qtyText: string, wasteText: string, holdingKg: string | number): ReturnCheck {
  const held = Number(holdingKg);
  const q = checkKg(qtyText, held);
  if (!q.ok) return { ok: false, error: q.error, field: q.error ? "qty" : null };
  const w = wasteText.trim() === "" ? 0 : parseNum(wasteText);
  if (w === null) return { ok: false, error: "Fire için geçerli bir sayı girin.", field: "waste" };
  if (w < 0) return { ok: false, error: "Fire negatif olamaz.", field: "waste" };
  const waste = round3(w);
  if (q.qty + waste > held + 1e-9) {
    return { ok: false, error: `İade + fire (${fmtKg(q.qty + waste)} kg) deverecide tutulanı (${fmtKg(held)} kg) aşıyor.`, field: "total" };
  }
  return { ok: true, qty: q.qty, waste, keep: round3(held - q.qty - waste) };
}

/** "Kalanın hepsini fire yaz": fire = tutma − iade; iade geçersizse null (düğme kapalı). */
export function remainingAsWaste(qtyText: string, holdingKg: string | number): string | null {
  const q = checkKg(qtyText, holdingKg);
  return q.ok ? kgInput(Number(holdingKg) - q.qty) : null;
}

/** Girilen kg ∈ (0, sınır]; boş girdi hata metni üretmez (düğme kapalı kalır). */
export function checkKg(text: string, limitKg: string | number): KgCheck {
  const n = parseNum(text);
  if (n === null) return { ok: false, error: text.trim() === "" ? null : "Geçerli bir sayı girin." };
  if (n <= 0) return { ok: false, error: "Miktar sıfırdan büyük olmalı." };
  if (n > Number(limitKg) + 1e-9) return { ok: false, error: "Deverecide tutulan miktarı aşıyor." };
  return { ok: true, qty: Math.round(n * 1000) / 1000 };
}

export interface TransferDraftRow {
  holding: WarpingYarnHolding;
  qtyKg: string;
}

export const initialTransferDrafts = (rows: WarpingYarnHolding[]): TransferDraftRow[] =>
  rows.filter((h) => Number(h.holdingKg) > 0).map((holding) => ({ holding, qtyKg: "" }));

export type TransferBuild = { ok: true; lines: WarpingTransferLine[]; totalKg: number } | { ok: false; error: string };

/** Dolu satırlar kalem kimliğiyle gider (FIFO seçimi o kaleme sabitlenir); boş satır atlanır. */
export function buildTransferLines(drafts: TransferDraftRow[]): TransferBuild {
  const lines: WarpingTransferLine[] = [];
  for (const d of drafts) {
    if (d.qtyKg.trim() === "") continue;
    const c = checkKg(d.qtyKg, d.holding.holdingKg);
    if (!c.ok) return { ok: false, error: `${d.holding.dispatchNo} · ${d.holding.lotNo ?? "lotsuz"}: ${c.error ?? "miktar girin"}` };
    lines.push({ yarnItemId: d.holding.yarnItemId, qtyKg: c.qty, lotId: d.holding.lotId, dispatchItemId: d.holding.dispatchItemId });
  }
  if (lines.length === 0) return { ok: false, error: "Aktarılacak en az bir satıra kg girin." };
  return { ok: true, lines, totalKg: lines.reduce((s, l) => s + l.qtyKg, 0) };
}
