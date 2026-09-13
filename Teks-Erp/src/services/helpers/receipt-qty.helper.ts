// =============================================================================
// KABUL-ANI METRAJI — TEK KAYNAK (hüküm §10.6 → §11, 2026-09-13/14)
// =============================================================================
// Alış faturası taslağı ve alış siparişi karşılaması "MAL KABUL ANINI" belgeler:
// top sonradan kesilir/sevk edilirse tedarikçiye borcumuz ve ısmarladığımız
// miktar değişmez. İki okuyucu bunu `Roll.initialQty` okuyarak yapıyordu; oysa o
// bir DURUM kolonudur — tambur geri alması aşımda yukarı çeker (`restoreBumpTx`),
// elle düzeltme yeniden yazar — ve para okuyucusu durumdan türetilmez (durum ≠
// defter). Ölçüldü (9b sondası 2026-09-13): 100 m fiş topu → 40·40·40 → geri
// alma ⇒ taslak ve karşılama 120.
//
// "initialQty − Σ canlı TAMBUR OVERAGE" de kaynak DEĞİLDİR: keşif (TAMBUR_OVERCUT)
// KESİM anında yazılır, bump GERİ ALMA anında doğar; ikisi yalnız "bütün çocuklar
// geri alınmış" durumunda eşitlenir (altı durumun dördünde yanlış).
//
// KAYNAK = DEPO DEFTERİ: fiş topu doğarken `createInitialEntry` ENTRY satırı yazar
// (`reasonCode ENTRY_RECEIPT`). Toplanan sebep kodları TEK LİSTEDEDİR
// (`RECEIPT_QTY_REASONS`, işaretli: to +, from −): giriş ölçümü düzeltmesinin
// satırı (`applyManualProperties`, bütün topta initialQty = currentQty = m) 6e'nin
// yazıcısıyla — sabit + yazıcı + ters-yol beyanı (§13a) + 7. fikstür durumu tek
// commit — bu listeye girer; yazıcısız sebep kodu ölü katalog kodudur (MANUAL_ADJUST
// dersi). Aşım bump'ının satırı YOKTUR (kasıtlı) — o yüzden toplamda görünmez.
// `adjustRollQty` (MANUAL_ADJUST) `initialQty` yazmaz ⇒ listede değil.
//
// ÜÇ SONUÇ, İKİ DEĞİL (fail-closed):
//   ① satır var                     → defter (LEDGER)
//   ② satır yok ∧ top ufuk ÖNCESİ   → `initialQty`, source INITIAL_QTY_FALLBACK,
//                                     okuyucu `ApiResponse.warnings`e bir cümle
//   ③ satır yok ∧ top ufuk SONRASI  → 409 RECEIPT_LEDGER_ROW_MISSING — K=0 kapısı
//                                     delinmiş demektir; para okuyucusu sessiz geçmez.
// Ufuk tek kaynak: `constants/ledger-horizon.ts`.
//
// Bekçiler: `scripts/test_receipt_qty_single_source.ts` (iki okuyucuda çıplak
// `initialQty` yasak) · `scripts/test_receipt_qty_readers.ts` (altı durum × iki okuyucu).
// =============================================================================
import { Prisma } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { LEDGER_HORIZON_DAY, ledgerHorizonStart } from "../../constants/ledger-horizon";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Kabul-anı metrajına GİREN sebep kodları — tek liste. Yeni üye yalnız yazıcısı
 * ve ters-yol beyanıyla birlikte gelir (giriş ölçümü düzeltmesi: 6e dilimi).
 */
export const RECEIPT_QTY_REASONS: readonly string[] = [STOCK_MOVE_REASON.ENTRY_RECEIPT, STOCK_MOVE_REASON.ENTRY_CORRECTION];

export type ReceiptQtySource = "LEDGER" | "INITIAL_QTY_FALLBACK";
export interface ReceiptQty {
  qty: Prisma.Decimal;
  source: ReceiptQtySource;
}

/** `details.code` — ufuk sonrası fiş topunun defter girişi yok. */
export const RECEIPT_LEDGER_ROW_MISSING = "RECEIPT_LEDGER_ROW_MISSING";

const ZERO = new Prisma.Decimal(0);

/**
 * Saf karar — üç sonuç. `ledgerQty` null (hiç satır yok) ise ufuk sorulur; ufuk
 * sonrası satırsız top `null` döner (çağıran toplar ve TEK 409 fırlatır: her topu
 * ayrı ayrı reddetmek okuyucuyu N kez yeniden denemeye zorlardı).
 */
export function receiptQtyOf(args: {
  ledgerQty: Prisma.Decimal | null;
  initialQty: Prisma.Decimal;
  createdAt: Date;
  horizonStart: Date;
}): ReceiptQty | null {
  if (args.ledgerQty !== null) return { qty: args.ledgerQty, source: "LEDGER" };
  if (args.createdAt < args.horizonStart) return { qty: args.initialQty, source: "INITIAL_QTY_FALLBACK" };
  return null;
}

/**
 * Verilen topların kabul-anı metrajı (top id → {qty, source}). Aynı tx'te iki
 * SIRALI sorgu (tx client'ta `Promise.all` yasak); boş liste boş harita döner.
 * ⚠️ Ufuk sonrası satırsız top varsa TEK 409, barkodlar `details.barcodes`ta.
 */
export async function receiptQtyByRollTx(db: Db, rollIds: readonly string[]): Promise<Map<string, ReceiptQty>> {
  const out = new Map<string, ReceiptQty>();
  if (rollIds.length === 0) return out;
  const ids = [...rollIds];
  const rolls = await db.roll.findMany({
    where: { id: { in: ids } },
    select: { id: true, barcode: true, initialQty: true, createdAt: true },
  });
  // Satırlar İŞARETLİ toplanır (to +, from −). Terslenmiş olup olmadığı sorulmaz:
  // iptal (ROLL_CANCEL) ve geri alma (CANCEL_RESTORE) listede olmayan kodlarla
  // yazılır, iptal edilmiş topu okuyucular statüden zaten süzer — tersleme
  // "gelmedi" der, "kaç metre gelmişti" sorusunu değiştirmez.
  const rows = await db.warehouseMovement.findMany({
    where: { rollId: { in: ids }, reasonCode: { in: [...RECEIPT_QTY_REASONS] } },
    select: { rollId: true, qty: true, toWarehouseId: true, fromWarehouseId: true },
  });
  const ledgerByRoll = new Map<string, Prisma.Decimal>();
  for (const r of rows) {
    const signed = r.toWarehouseId ? r.qty : r.fromWarehouseId ? r.qty.negated() : ZERO;
    ledgerByRoll.set(r.rollId, (ledgerByRoll.get(r.rollId) ?? ZERO).plus(signed));
  }
  const horizonStart = ledgerHorizonStart();
  const missing: string[] = [];
  for (const r of rolls) {
    const v = receiptQtyOf({
      ledgerQty: ledgerByRoll.get(r.id) ?? null,
      initialQty: r.initialQty,
      createdAt: r.createdAt,
      horizonStart,
    });
    if (v) out.set(r.id, v);
    else missing.push(r.barcode ?? r.id);
  }
  if (missing.length > 0) {
    throw AppError.conflict(
      `${missing.length} fiş topunun depo defterinde giriş satırı yok (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}) — ` +
        "kabul metrajı defterden okunamadı; stok defteri bağını kontrol edin.",
      { code: RECEIPT_LEDGER_ROW_MISSING, barcodes: missing },
    );
  }
  return out;
}

/** ② dalı için okuyucunun `ApiResponse.warnings`e koyacağı cümle; yoksa null. */
export function receiptQtyWarning(map: ReadonlyMap<string, ReceiptQty>): string | null {
  let n = 0;
  for (const v of map.values()) if (v.source === "INITIAL_QTY_FALLBACK") n++;
  if (n === 0) return null;
  return `${n} fiş topu depo defteri ufkundan (${LEDGER_HORIZON_DAY}) önce doğmuş — kabul metrajı defterden değil topun giriş kolonundan okundu.`;
}
