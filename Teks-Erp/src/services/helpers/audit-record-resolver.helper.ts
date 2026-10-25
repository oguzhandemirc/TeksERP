// =============================================================================
// AUDIT KAYIT NO ÇÖZÜCÜ — "91cd4281-…" değil "SP-2026-0148" (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// İki yön: (1) `(tableName, recordId)[]` → insana okunur numara (tablo başına TEK sorgu,
// FAIL-OPEN — çözülemeyen kayıt kısa kimlikle kalır; `audit-value-resolver.ts` deseni);
// (2) arama metni `q` → numaralı modellerin UNIQUE kolonlarında TAM eşleşme → `(tableName, id)`.
// Tablo/kolon adları aşağıdaki SABİT haritadan gelir (kullanıcı girdisi değil); değerler bind.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";

export interface NumaraKaynagi {
  /** Fiziksel tablo (`@@map`). */
  tablo: string;
  /** Gösterilen kolon. */
  kolon: string;
  /** `q` aramasının bakacağı UNIQUE kolonlar (schema `@unique`); boşsa aranmaz. */
  ara: readonly string[];
}

/** audit `tableName` → numara kaynağı. Beyan: yalnız numarası/adı olan kayıtlar. */
export const AUDIT_NUMBER_SOURCES: Readonly<Record<string, NumaraKaynagi>> = {
  ORDER: { tablo: "orders", kolon: "orderNumber", ara: ["orderNumber"] },
  ROLL: { tablo: "rolls", kolon: "barcode", ara: ["barcode"] },
  WORK_ORDER: { tablo: "work_orders", kolon: "workOrderNumber", ara: ["workOrderNumber"] },
  WEAVING_ORDER: { tablo: "weaving_orders", kolon: "weavingOrderNumber", ara: ["weavingOrderNumber"] },
  SHIPMENT: { tablo: "shipments", kolon: "shipmentNo", ara: ["shipmentNo"] },
  SACK: { tablo: "sacks", kolon: "sackNo", ara: ["sackNo"] },
  MANIFEST: { tablo: "manifests", kolon: "manifestNo", ara: ["manifestNo"] },
  BATCH: { tablo: "batches", kolon: "batchNumber", ara: [] },
  SUBCONTRACTOR_DISPATCH: { tablo: "subcontractor_dispatches", kolon: "dispatchNo", ara: ["dispatchNo"] },
  SUBCONTRACTOR_RECEIPT: { tablo: "subcontractor_receipts", kolon: "receiptNo", ara: ["receiptNo"] },
  DIRECT_SHIPMENT: { tablo: "direct_shipments", kolon: "shipmentNo", ara: ["shipmentNo"] },
  SWATCH: { tablo: "swatches", kolon: "cardNumber", ara: ["cardNumber", "barcode"] },
  TRAVELER_CARD: { tablo: "traveler_cards", kolon: "cardNumber", ara: ["cardNumber", "barcode"] },
  WARP_BEAM: { tablo: "warp_beams", kolon: "beamNo", ara: ["beamNo"] },
  INVOICE: { tablo: "invoices", kolon: "docNo", ara: ["docNo"] },
  PAYMENT: { tablo: "payments", kolon: "docNo", ara: ["docNo"] },
  CHEQUE: { tablo: "cheques", kolon: "docNo", ara: ["docNo"] },
  PURCHASE_ORDER: { tablo: "purchase_orders", kolon: "orderNo", ara: ["orderNo"] },
  STOCK_COUNT: { tablo: "stock_counts", kolon: "countNo", ara: ["countNo"] },
  CUSTOMER: { tablo: "customers", kolon: "name", ara: ["code"] },
  SUBCONTRACTOR: { tablo: "subcontractors", kolon: "name", ara: ["code"] },
  users: { tablo: "users", kolon: "fullName", ara: [] },
  devices: { tablo: "devices", kolon: "name", ara: [] },
  DEFECT_TYPE: { tablo: "defect_types", kolon: "name", ara: [] },
  CUSTOMER_BRANCH: { tablo: "customer_branches", kolon: "name", ara: [] },
  NumberSeries: { tablo: "number_series", kolon: "label", ara: [] },
  DOCUMENT_TEMPLATE: { tablo: "document_templates", kolon: "name", ara: [] },
  packing_groups: { tablo: "packing_groups", kolon: "code", ara: [] },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordRef {
  tableName: string;
  recordId: string;
}

/** `"<tableName>:<recordId>"` anahtarlı numara haritası. */
export function recordKey(tableName: string, recordId: string): string {
  return `${tableName}:${recordId}`;
}

/** Kayıt numaralarını toplu çözer — tablo başına tek sorgu; hata yutulur (fail-open). */
export async function resolveRecordNumbers(refs: readonly RecordRef[]): Promise<Map<string, string>> {
  const byTable = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!r.recordId || !UUID_RE.test(r.recordId) || !AUDIT_NUMBER_SOURCES[r.tableName]) continue;
    const set = byTable.get(r.tableName) ?? new Set<string>();
    set.add(r.recordId);
    byTable.set(r.tableName, set);
  }
  const out = new Map<string, string>();
  for (const [tableName, ids] of byTable) {
    const k = AUDIT_NUMBER_SOURCES[tableName]!;
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string; label: string | null }>>(
        Prisma.sql`SELECT "id"::text AS id, ${Prisma.raw(`"${k.kolon}"`)}::text AS label
                   FROM ${Prisma.raw(`"${k.tablo}"`)}
                   WHERE "id" = ANY(${Array.from(ids)}::uuid[])`,
      );
      for (const row of rows) if (row.label) out.set(recordKey(tableName, row.id), row.label);
    } catch {
      // Fail-open: bu tablo çözülemedi, kısa kimlik kalır.
    }
  }
  return out;
}

/** Arama metni → eşleşen kayıtlar (UNIQUE kolonlarda tam eşleşme; büyük harf toleranslı). */
export async function findRecords(q: string): Promise<Array<RecordRef & { numara: string }>> {
  const v = q.trim();
  if (v.length < 2 || v.length > 100) return [];
  const adaylar = Array.from(new Set([v, v.toUpperCase()]));
  const out: Array<RecordRef & { numara: string }> = [];
  for (const [tableName, k] of Object.entries(AUDIT_NUMBER_SOURCES)) {
    for (const kolon of k.ara) {
      try {
        const rows = await prisma.$queryRaw<Array<{ id: string; label: string | null }>>(
          Prisma.sql`SELECT "id"::text AS id, ${Prisma.raw(`"${k.kolon}"`)}::text AS label
                     FROM ${Prisma.raw(`"${k.tablo}"`)}
                     WHERE ${Prisma.raw(`"${kolon}"`)} = ANY(${adaylar}::text[]) LIMIT 5`,
        );
        for (const r of rows) out.push({ tableName, recordId: r.id, numara: r.label ?? v });
      } catch {
        // Fail-open: tek tablonun hatası aramayı düşürmez.
      }
    }
  }
  return out;
}
