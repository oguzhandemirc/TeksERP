// =============================================================================
// ÖDEME/TAHSİLAT GİRİŞİNDE AÇIK FATURA EŞLEMESİ — saf katman (2026-09-18, 9b çıkarımı C7/J3)
// =============================================================================
// Ödeme kaydedilirken açık faturalar aynı pencerede seçilir; seçim yapılmazsa ödeme bugünkü gibi BAĞSIZ
// kaydedilir (+0 zorunlu adım). Kuruş aritmetiği `Allocations/allocationMath` ile ortak; kayıt yolu mevcut
// `allocateBulk` (yeni tablo yok). Sunucu FIFO önerisini (`suggested`) verir; "Tümünü kapat" onu ya da açık
// tutarların tamamını taslağa yazar.
// =============================================================================
import type { OpenInvoiceRow } from "./Allocations/service";
import { fromKurus, kurusToInput, toKurus } from "./Allocations/allocationMath";

export type Drafts = Record<string, string>;

export interface DraftItem {
  invoiceId: string;
  kurus: number;
}

/** Taslak → pozitif kalemler (sıra: tablo sırası). */
export function draftItems(drafts: Drafts, rows: OpenInvoiceRow[]): DraftItem[] {
  return rows
    .map((r) => ({ invoiceId: r.id, kurus: toKurus(drafts[r.id] ?? "") }))
    .filter((x) => x.kurus > 0);
}

export const distributedKurus = (items: DraftItem[]): number => items.reduce((a, b) => a + b.kurus, 0);

/** Açık tutarından fazla yazılan satır sayısı (sunucu 400 verir; formda erken söylenir). */
export function overCount(items: DraftItem[], rows: OpenInvoiceRow[]): number {
  const open = new Map(rows.map((r) => [r.id, toKurus(r.openTotal)]));
  return items.filter((it) => it.kurus > (open.get(it.invoiceId) ?? 0)).length;
}

/** "Tümü" — satıra sığan en büyük tutar: açık; tutar yazılmışsa öteki satırlardan artan kadar. */
export function fillMaxDraft(drafts: Drafts, rows: OpenInvoiceRow[], invoiceId: string, amountKurus: number): Drafts {
  const open = toKurus(rows.find((r) => r.id === invoiceId)?.openTotal ?? "");
  const others = distributedKurus(draftItems(drafts, rows)) - toKurus(drafts[invoiceId] ?? "");
  const value = amountKurus > 0 ? Math.min(open, Math.max(0, amountKurus - others)) : open;
  return { ...drafts, [invoiceId]: value > 0 ? kurusToInput(value) : "" };
}

/** Sunucunun FIFO önerisi (`suggested`) → taslak; öneri yoksa (tutar verilmedi) boş. */
export function draftsFromSuggestion(rows: OpenInvoiceRow[]): Drafts {
  const out: Drafts = {};
  for (const r of rows) {
    const k = toKurus(r.suggested);
    if (k > 0) out[r.id] = kurusToInput(k);
  }
  return out;
}

/** "Tümünü kapat" — her açık faturanın tamamı taslağa; dönen toplam tutar alanına yazılır. */
export function draftsCloseAll(rows: OpenInvoiceRow[]): { drafts: Drafts; totalKurus: number } {
  const drafts: Drafts = {};
  let total = 0;
  for (const r of rows) {
    const k = toKurus(r.openTotal);
    if (k > 0) {
      drafts[r.id] = kurusToInput(k);
      total += k;
    }
  }
  return { drafts, totalKurus: total };
}

/** Kalemler → `allocateBulk` gövdesi (tutar metin, 2 hane). */
export function allocationItems(items: DraftItem[]): Array<{ invoiceId: string; amount: string }> {
  return items.map((it) => ({ invoiceId: it.invoiceId, amount: fromKurus(it.kurus).toFixed(2) }));
}

/** Kayıt kapısı: eşlenen toplam tutarı aşamaz, satır açığını aşamaz. Boş taslak serbest (bağsız ödeme). */
export function allocationBlockReason(items: DraftItem[], rows: OpenInvoiceRow[], amountKurus: number): string | null {
  if (items.length === 0) return null;
  const dist = distributedKurus(items);
  if (dist > amountKurus) return `Eşlenen toplam (${fromKurus(dist).toFixed(2)}) tutarı (${fromKurus(amountKurus).toFixed(2)}) aşıyor — tutarı büyütün ya da satırları azaltın.`;
  const over = overCount(items, rows);
  if (over > 0) return `${over} satırda yazılan tutar faturanın açık tutarını aşıyor.`;
  return null;
}
