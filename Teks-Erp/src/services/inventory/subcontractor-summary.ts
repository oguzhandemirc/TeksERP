// =============================================================================
// Inventory Service / subcontractor-summary
// =============================================================================
// Fason top özeti (getRollSubcontractorSummary).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
} from "@prisma/client";
import { loadProducedBuckets } from "../helpers/roll-finalize.helper";

/** Fasonda özet şeridi — GET /api/rolls/subcontractor-summary cevabı. */
export interface RollSubcontractorSummary {
  /** Firma kartları. subcontractorId=null → açık sevk kalemi bulunamayan
   *  AT_SUBCONTRACTOR top (veri anomalisi) — "Bilinmiyor" kartı. */
  bySubcontractor: Array<{
    subcontractorId: string | null;
    name: string;
    code: string | null;
    rollCount: number;
    /** Σ currentQty (mt) — 1 ondalık (F85 yuvarlama kuralı). */
    totalQty: number;
    oldestDispatchedAt: Date | null;
    /** En eski açık sevkin yaşı (gün, floor) — "en eski N gün". */
    oldestDays: number | null;
  }>;
  /** İşlem-tipi chip'leri. categoryId=null → "Bilinmiyor" (kategorisiz adım + anomali).
   *  Her top tam BİR gruba düşer → "Tümü" chip'i = Σ byCategory. */
  byCategory: Array<{
    categoryId: string | null;
    name: string;
    rollCount: number;
    totalQty: number;
  }>;
  /** Evren toplamı — frontend "Tümü" chip'i + boş-durum gate'i bunu okur. */
  total: {
    rollCount: number;
    totalQty: number;
  };
}

export async function getRollSubcontractorSummary(
    includeFire = false,
  ): Promise<ApiResponse<RollSubcontractorSummary>> {
    // FIRE dışlama koşulu (liste buildRollWhere ile aynı semantik): includeFire
    // açıksa boş fragment → FIRE toplar da sayılır.
    //
    // Kova KATALOGDAN (`targetStatus = SCRAP`) — gömülü `'FIRE'` kaldırıldı
    // (karar ①); bu fragment `buildRollWhere`in BOĞAZ İKİZİdir ve onunla
    // BİRLİKTE değişir (ikisi aynı soruyu cevaplar, ayrışırsa şerit ile tablo
    // aynı fabrikada iki farklı toplam basar).
    // ⚠️ BOŞ KÜMEDE FRAGMENT BOŞ KALIR: `NOT IN ()` PG'de SÖZDİZİMİ HATASIDIR
    // (Prisma.join boş dizide de patlar) — ve SCRAP kademesi olmayan katalogda
    // eski `<> 'FIRE'` zaten hiçbir şeyi dışlamıyordu → davranış birebir aynı.
    const { fireCodes } = await loadProducedBuckets(prisma);
    const fireClause =
      includeFire || fireCodes.length === 0
        ? Prisma.empty
        : Prisma.sql`AND (r."qualityGrade" IS NULL OR r."qualityGrade" NOT IN (${Prisma.join(fireCodes)}))`;
    // Paylaşılan CTE — rolls tarafı @@index([status, createdAt]), kalemler
    // @@index([rollId]), anti-join @@index([sourceDispatchItemId]) kullanır.
    const baseCte = Prisma.sql`
      open_items AS (
        SELECT DISTINCT ON (sdi."rollId")
          sdi."rollId"            AS "rollId",
          sd."subcontractorId"    AS "subcontractorId",
          sd."dispatchedAt"       AS "dispatchedAt",
          -- "İşlem" kategorisi: adımın requiredCategory'si; boşsa firmanın kendi
          -- kategorisine düşülür (yalnız firma TEK kategoriliyse — çok kategorili
          -- firmada işlem belirsiz → null "Bilinmiyor"). Frontend activeCategoryOf
          -- + buildRollWhere filtresi AYNI COALESCE tanımını paylaşır.
          COALESCE(
            ws."requiredCategoryId",
            (SELECT MAX(scl."categoryId"::text)::uuid
             FROM subcontractor_category_links scl
             WHERE scl."subcontractorId" = sd."subcontractorId"
             HAVING COUNT(*) = 1)
          )                       AS "categoryId"
        FROM rolls r
        JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = r.id
        JOIN subcontractor_dispatches sd      ON sd.id = sdi."dispatchId"
        JOIN work_order_steps ws              ON ws.id = sd."stepId"
        WHERE r.status = 'AT_SUBCONTRACTOR'
          AND sd."cancelledAt" IS NULL
          AND sd."directShippedAt" IS NULL
          AND sdi."remainderClosedAt" IS NULL
          -- OUTSTANDING_ITEM ikizi: topu doğrudan sevk edilmiş kalem açık değildir.
          AND r."directShipmentId" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM subcontractor_receipt_items sri
            JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
            WHERE sri."sourceDispatchItemId" = sdi.id
              AND sr."cancelledAt" IS NULL
              -- Kısmi makbuz kalemi kapatmaz (kalan hâlâ fasonda) — kalem yalnız
              -- TAM satırla dolu sayılır; yoksa yarım kalan top firma atfını yitirirdi.
              AND NOT sri."isPartial"
          )
        ORDER BY sdi."rollId", sd."dispatchedAt" DESC, sdi."createdAt" DESC
      ),
      base AS (
        SELECT r.id, r."currentQty", oi."subcontractorId", oi."dispatchedAt", oi."categoryId"
        FROM rolls r
        LEFT JOIN open_items oi ON oi."rollId" = r.id
        WHERE r.status = 'AT_SUBCONTRACTOR'
          ${fireClause}
      )
    `;

    const [firmRows, catRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          subcontractorId: string | null;
          name: string | null;
          code: string | null;
          rollCount: bigint;
          totalQty: number | null;
          oldestDispatchedAt: Date | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."subcontractorId"        AS "subcontractorId",
          s.name                     AS "name",
          s.code                     AS "code",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty",
          MIN(b."dispatchedAt")      AS "oldestDispatchedAt"
        FROM base b
        LEFT JOIN subcontractors s ON s.id = b."subcontractorId"
        GROUP BY b."subcontractorId", s.name, s.code
        ORDER BY "rollCount" DESC, s.name ASC NULLS LAST
      `),
      prisma.$queryRaw<
        Array<{
          categoryId: string | null;
          name: string | null;
          rollCount: bigint;
          totalQty: number | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."categoryId"             AS "categoryId",
          c.name                     AS "name",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty"
        FROM base b
        LEFT JOIN subcontractor_categories c ON c.id = b."categoryId"
        GROUP BY b."categoryId", c.name
        ORDER BY "rollCount" DESC, c.name ASC NULLS LAST
      `),
    ]);

    const now = Date.now();
    const round1 = (v: number | null) => Math.round(Number(v ?? 0) * 10) / 10;
    const byCategory = catRows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name ?? "Bilinmiyor",
      rollCount: Number(r.rollCount),
      totalQty: round1(r.totalQty),
    }));
    // "Tümü" chip'i / boş-durum gate'i: her top tam bir kategori grubuna düştüğü
    // için total = Σ byCategory (aynı zamanda Σ bySubcontractor).
    const total = byCategory.reduce(
      (acc, c) => ({
        rollCount: acc.rollCount + c.rollCount,
        totalQty: Math.round((acc.totalQty + c.totalQty) * 10) / 10,
      }),
      { rollCount: 0, totalQty: 0 },
    );

    return {
      success: true,
      data: {
        bySubcontractor: firmRows.map((r) => ({
          subcontractorId: r.subcontractorId,
          name: r.name ?? "Bilinmiyor",
          code: r.code,
          rollCount: Number(r.rollCount),
          totalQty: round1(r.totalQty),
          oldestDispatchedAt: r.oldestDispatchedAt,
          oldestDays: r.oldestDispatchedAt
            ? Math.max(0, Math.floor((now - new Date(r.oldestDispatchedAt).getTime()) / 86_400_000))
            : null,
        })),
        byCategory,
        total,
      },
    };
  }
