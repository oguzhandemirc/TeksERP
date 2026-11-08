// =============================================================================
// TeksERP - Subcontractor (Fason) Service / shared
// =============================================================================
// Ortak yardımcılar: belge numarası, mesaj hijyeni (ham UUID yerine barkod)
// ve taşınan metotların `this` tipi.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { nextSeriesNo } from "../number-series.service";
import type { SubcontractorService } from "../subcontractor.service";
import type { receiveInner } from "./receive";
import type { findClosedRemainderItems } from "./receipt-cancel";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Export: workorder.service per-roll split'te taşınan toplar için yeni FS dispatch
// numarası üretirken yeniden kullanır (aynı sequence kaynağı).
/**
 * ⚠️ SIRA ile BİÇİM BİRLİKTE döner: kodu kuran çağıran, ön eki kuran okumanın
 * AYNISINI kullanmak zorunda. Yalnız sayı dönseydi çağıran biçimi İKİNCİ kez
 * okurdu ve arada bir önbellek tazelemesi olursa ön ek bir sürümden, hane/adım
 * başka bir sürümden gelirdi ("iki okuma" sınıfı).
 */
export async function nextSubcontractorDocNoTx(
  tx: Prisma.TransactionClient,
  table: "subcontractorDispatch" | "subcontractorReceipt",
  date: Date
): Promise<string> {
  // Ön ek artık literal değil: tablo adı AYNI ZAMANDA numara serisinin anahtarıdır
  // (`number-series-catalog`), yani sevk/kabul ön ekleri fabrikaya göre değişebilir.
  return nextSeriesNo(
    table,
    async (fullPrefix) => {
      // O-21: collation-güvenli — gte (index seek) + startsWith (tam-prefix, collation-
      // bağımsız) ile günün TÜM kayıtlarını çek, sayısal max'ı JS'te reduce et. Eski
      // startsWith-tek + orderBy desc glibc collation sırasına + lex taşmaya güveniyordu
      // (glibc seq-no bug — bkz. order.service.ts kanıtlı desen).
      if (table === "subcontractorDispatch") {
        const rows = await tx.subcontractorDispatch.findMany({
          where: { dispatchNo: { gte: fullPrefix, startsWith: fullPrefix } },
          select: { dispatchNo: true, createdAt: true },
        });
        return rows.map((r) => ({ code: r.dispatchNo, createdAt: r.createdAt }));
      }
      const rows = await tx.subcontractorReceipt.findMany({
        where: { receiptNo: { gte: fullPrefix, startsWith: fullPrefix } },
        select: { receiptNo: true, createdAt: true },
      });
      return rows.map((r) => ({ code: r.receiptNo, createdAt: r.createdAt }));
    },
    date,
  );
}

// -----------------------------------------------------------------------------
// Mesaj hijyeni — hata metinlerinde ham UUID yerine barkod
// -----------------------------------------------------------------------------

/** Barkodsuz açık kumaş topun hata metnindeki karşılığı. */
export const UNBARCODED_ROLL_LABEL = "(barkodsuz açık kumaş)";

/**
 * Verilen top id'leri için "insan okunur etiket" haritası: barkod varsa barkod,
 * yoksa `(barkodsuz açık kumaş)`. Operatöre `9f3c1a7e-…` gibi bir UUID göstermek
 * teşhis değil gürültüdür — tabletteki kimse o id ile topu bulamaz.
 *
 * Yalnız HATA yolunda çağrılır (mutlu yolda ek sorgu yok).
 */
export async function resolveRollLabels(
  client: Prisma.TransactionClient | typeof prisma,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await client.roll.findMany({
    where: { id: { in: unique } },
    select: { id: true, barcode: true },
  });
  return new Map(rows.map((r) => [r.id, r.barcode ?? UNBARCODED_ROLL_LABEL] as const));
}

/** Etiket haritasında olmayan id (silinmiş/uydurma) için son çare kısaltma. */
export function rollLabel(labels: Map<string, string>, id: string): string {
  return labels.get(id) ?? `${id.slice(0, 8)}…`;
}

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar.
 */
export type SubcontractorServiceThis = Pick<SubcontractorService, "dispatch" | "receive" | "bulkDispatchStep" | "cancel"> & {
  receiveInner: typeof receiveInner;
  findClosedRemainderItems: typeof findClosedRemainderItems;
};
