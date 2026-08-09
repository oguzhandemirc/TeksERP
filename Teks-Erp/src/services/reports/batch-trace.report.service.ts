// =============================================================================
// PARTİ İZLEME — "bu partiden kime ne gitti"
// =============================================================================
// Mevcut "Top İzleme" ileri yönü veriyordu (bir top → istasyon adımları). Eksik
// olan GERİ yöndü: müşteri şikâyet ettiğinde ya da bir boya partisinde sorun
// çıktığında "bu partiden başka kime ne gitti" sorusunun cevabı hiçbir ekranda
// yoktu — etki kümesini bulmanın tek yolu topları tek tek açmaktı.
//
// ── PARTİ NUMARASI BENZERSİZ DEĞİLDİR ──────────────────────────────────────
// ⚠️ 2026-08-05'ten beri parti no `P01…P99` arasında DÖNER ve `@unique` KALKTI
// (kök CLAUDE.md). Bu yüzden arama TEK sonuç varsaymaz: numarayla arama bir
// ADAY LİSTESİ döndürür, izleme ise `batchId` ile yapılır. Numaradan doğrudan
// izlemeye atlamak, aynı numarayı taşıyan başka bir partinin müşterilerini
// göstermek demekti — şikâyet araştırmasında yapılabilecek en kötü hata.
//
// ── PARTİ KESİM ÇOCUKLARINA MİRAS KALIR ────────────────────────────────────
// `Roll.batchId` Tambur kesiminde çocuğa kalıtılır (şema notu), yani tek bir
// `batchId` sorgusu ebeveyni de çocukları da getirir. Ayrı bir soyağacı
// gezintisi GEREKMEZ — ve yazılsaydı çocukları İKİ kez sayardı.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { round1 } from "./_breakdown";

export interface BatchCandidate {
  batchId: string;
  batchNumber: string;
  workOrderNumber: string | null;
  createdAt: string;
  rollCount: number;
  qty: number;
  /** Tarihçe partisi (başka partiye birleştirilmiş) — izlemede ayırt edilsin. */
  merged: boolean;
}

export interface BatchTrace {
  batch: {
    batchId: string;
    batchNumber: string;
    workOrderNumber: string | null;
    createdAt: string;
    merged: boolean;
  };
  totals: { rollCount: number; qty: number };
  /** Statü kırılımı — malın şu an nerede olduğu. */
  byStatus: Array<{ status: string; count: number; qty: number }>;
  /** GERİ İZLEME: bu partiden hangi müşteriye ne gitti. */
  customers: Array<{
    customerId: string;
    customerName: string;
    shipmentCount: number;
    rollCount: number;
    qty: number;
    lastDispatchedAt: string | null;
  }>;
  /** Bu partiden alınan iadeler. */
  returns: Array<{
    returnId: string;
    customerName: string;
    qty: number;
    reason: string;
    createdAt: string;
  }>;
  /** Bu partinin fason sevkleri. */
  subcontractorDispatches: Array<{
    dispatchId: string;
    dispatchNo: string;
    subcontractorName: string;
    dispatchedAt: string;
    qty: number;
    cancelled: boolean;
  }>;
}

/**
 * Parti numarası ya da top barkoduyla ADAY partileri bulur.
 * Numara benzersiz olmadığı için (dosya başlığı) daima liste döner.
 */
export async function searchBatches(q: string, limit = 20): Promise<BatchCandidate[]> {
  const term = q.trim();
  if (!term) return [];
  const rows = await prisma.$queryRaw<
    Array<{
      batchId: string; batchNumber: string; workOrderNumber: string | null;
      createdAt: Date; rollCount: bigint; qty: number | null; merged: boolean;
    }>
  >(Prisma.sql`
    SELECT
      b.id                  AS "batchId",
      b."batchNumber"       AS "batchNumber",
      wo."workOrderNumber"  AS "workOrderNumber",
      b."createdAt"         AS "createdAt",
      COUNT(r.id)           AS "rollCount",
      SUM(r."currentQty")::float AS "qty",
      (b."mergedIntoId" IS NOT NULL) AS "merged"
    FROM batches b
    LEFT JOIN work_orders wo ON wo.id = b."workOrderId"
    LEFT JOIN rolls r        ON r."batchId" = b.id
    WHERE b."batchNumber" ILIKE ${"%" + term + "%"}
       -- Barkodla da bulunur: operatörün elinde parti no değil TOP olur.
       OR EXISTS (SELECT 1 FROM rolls r2 WHERE r2."batchId" = b.id AND r2.barcode = ${term})
    GROUP BY b.id, b."batchNumber", wo."workOrderNumber", b."createdAt", b."mergedIntoId"
    -- ⚠️ batchNumber ile SIRALAMA YAPILMAZ (kök CLAUDE.md): numara sardığı için
    -- sözlüksel/sayısal sıra "yenilik" sırası DEĞİLDİR.
    ORDER BY b."createdAt" DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    batchId: r.batchId,
    batchNumber: r.batchNumber,
    workOrderNumber: r.workOrderNumber,
    createdAt: r.createdAt.toISOString(),
    rollCount: Number(r.rollCount),
    qty: round1(Number(r.qty ?? 0)),
    merged: Boolean(r.merged),
  }));
}

export async function getBatchTrace(batchId: string): Promise<BatchTrace | null> {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true, batchNumber: true, createdAt: true, mergedIntoId: true,
      workOrder: { select: { workOrderNumber: true } },
    },
  });
  if (!batch) return null;

  const [statusRows, customerRows, returnRows, dispatchRows] = await Promise.all([
    prisma.$queryRaw<Array<{ status: string; cnt: bigint; qty: number | null }>>(Prisma.sql`
      SELECT r.status::text AS status, COUNT(*) AS cnt, SUM(r."currentQty")::float AS qty
      FROM rolls r WHERE r."batchId" = ${batchId}::uuid
      GROUP BY r.status ORDER BY 3 DESC NULLS LAST
    `),
    // GERİ İZLEME. ⚠️ İade edilmiş toplar `shipmentId`'sini KAYBEDER
    // (`return.service`) → yalnız canlı bağa bakmak, iade edilen malın gittiği
    // müşteriyi listeden SİLERDİ. Tam da şikâyet araştırmasında en çok aranan
    // müşteri odur. Bu yüzden `RollReturn.fromShipmentId` ile geri eklenir —
    // sevk yüzeylerindeki brüt kuralının izleme karşılığı.
    prisma.$queryRaw<
      Array<{
        customerId: string; customerName: string; shipmentCount: bigint;
        rollCount: bigint; qty: number | null; lastDispatchedAt: Date | null;
      }>
    >(Prisma.sql`
      WITH links AS (
        SELECT s.id AS shipment_id, s."customerId", s."dispatchedAt", r.id AS roll_id, r."currentQty" AS qty
        FROM rolls r JOIN shipments s ON s.id = r."shipmentId"
        WHERE r."batchId" = ${batchId}::uuid
        UNION
        SELECT s.id, s."customerId", s."dispatchedAt", rr."rollId", rr.qty
        FROM roll_returns rr
        JOIN shipments s ON s.id = rr."fromShipmentId"
        JOIN rolls r     ON r.id = rr."rollId"
        WHERE r."batchId" = ${batchId}::uuid AND rr."cancelledAt" IS NULL
      )
      SELECT
        l."customerId" AS "customerId", cu.name AS "customerName",
        COUNT(DISTINCT l.shipment_id) AS "shipmentCount",
        COUNT(DISTINCT l.roll_id)     AS "rollCount",
        SUM(l.qty)::float             AS "qty",
        MAX(l."dispatchedAt")         AS "lastDispatchedAt"
      FROM links l JOIN customers cu ON cu.id = l."customerId"
      GROUP BY l."customerId", cu.name
      ORDER BY 5 DESC NULLS LAST
    `),
    prisma.$queryRaw<
      Array<{ returnId: string; customerName: string; qty: number; reason: string | null; createdAt: Date }>
    >(Prisma.sql`
      SELECT rr.id AS "returnId", cu.name AS "customerName", rr.qty::float AS qty,
             COALESCE(rn.name, rr."reasonText") AS reason, rr."createdAt" AS "createdAt"
      FROM roll_returns rr
      JOIN rolls r ON r.id = rr."rollId"
      JOIN customers cu ON cu.id = rr."customerId"
      LEFT JOIN return_reasons rn ON rn.id = rr."reasonId"
      WHERE r."batchId" = ${batchId}::uuid AND rr."cancelledAt" IS NULL
      ORDER BY rr."createdAt" DESC
    `),
    prisma.$queryRaw<
      Array<{
        dispatchId: string; dispatchNo: string; subcontractorName: string;
        dispatchedAt: Date; qty: number | null; cancelled: boolean;
      }>
    >(Prisma.sql`
      SELECT sd.id AS "dispatchId", sd."dispatchNo" AS "dispatchNo", sub.name AS "subcontractorName",
             sd."dispatchedAt" AS "dispatchedAt", SUM(sdi."dispatchedQty")::float AS qty,
             (sd."cancelledAt" IS NOT NULL) AS cancelled
      FROM subcontractor_dispatches sd
      JOIN subcontractors sub ON sub.id = sd."subcontractorId"
      LEFT JOIN subcontractor_dispatch_items sdi ON sdi."dispatchId" = sd.id
      WHERE sd."batchId" = ${batchId}::uuid
      GROUP BY sd.id, sd."dispatchNo", sub.name, sd."dispatchedAt", sd."cancelledAt"
      ORDER BY sd."dispatchedAt" DESC
    `),
  ]);

  const byStatus = statusRows.map((r) => ({
    status: r.status,
    count: Number(r.cnt),
    qty: round1(Number(r.qty ?? 0)),
  }));

  return {
    batch: {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      workOrderNumber: batch.workOrder?.workOrderNumber ?? null,
      createdAt: batch.createdAt.toISOString(),
      merged: batch.mergedIntoId !== null,
    },
    totals: {
      rollCount: byStatus.reduce((a, r) => a + r.count, 0),
      qty: round1(byStatus.reduce((a, r) => a + r.qty, 0)),
    },
    byStatus,
    customers: customerRows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      shipmentCount: Number(r.shipmentCount),
      rollCount: Number(r.rollCount),
      qty: round1(Number(r.qty ?? 0)),
      lastDispatchedAt: r.lastDispatchedAt ? r.lastDispatchedAt.toISOString() : null,
    })),
    returns: returnRows.map((r) => ({
      returnId: r.returnId,
      customerName: r.customerName,
      qty: round1(Number(r.qty)),
      reason: r.reason ?? "Sebep girilmemiş",
      createdAt: r.createdAt.toISOString(),
    })),
    subcontractorDispatches: dispatchRows.map((r) => ({
      dispatchId: r.dispatchId,
      dispatchNo: r.dispatchNo,
      subcontractorName: r.subcontractorName,
      dispatchedAt: r.dispatchedAt.toISOString(),
      qty: round1(Number(r.qty ?? 0)),
      cancelled: Boolean(r.cancelled),
    })),
  };
}
