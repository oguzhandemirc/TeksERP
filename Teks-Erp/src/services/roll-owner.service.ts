// =============================================================================
// TeksERP — EMANET SAHİBİ okumaları (ister 3.2: "içerideki işleri ayrı ekranda takip")
// =============================================================================
// Salt okuma; yazıcı değil. Ayrı dosya: `inventory.service` tavanın çok üstünde (roll-tablet emsali).
//   · `listRollOwnerCustomers` — top listesi "Sahibi" süzgecinin seçenekleri (entry-users emsali:
//     katalog değil, gerçekten top sahibi olmuş müşteriler; `customer:read` İSTEMEZ).
//   · `getConsignedWorkSummary` — İçerideki İşler: müşteri başına içerideki emanet top/metre,
//     durum kırılımıyla; TEK toplama sorgusu.
// =============================================================================
import { Prisma, RollEntrySource, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";
import { NO_LIVE_MATERIAL_STATUSES } from "./batch.service";
import { readEmanetEnabled } from "./system-setting.service";
import { holdViewsByCustomer, NO_HOLD_VIEW } from "./helpers/cari-hold-badge.helper";

/**
 * "İÇERİDE DEĞİL" kümesi — canlı malzemesi kalmamış top (K18 + SHIPPED + SCRAP; batch.service tek kaynağı) +
 * fason dönüşünde kapanmış eski barkod (RETURNED_FROM_SUBCONTRACTOR). Geri kalan her statü içeridedir.
 */
export const NOT_INSIDE_STATUSES: readonly RollStatus[] = [
  ...NO_LIVE_MATERIAL_STATUSES,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** Sevke hazır kovası — Envanter "Bitmiş Depo" sekmesinin kapsamı; `rollScope=FINISHED_STOCK` da BUNU kullanır (tek kaynak). */
export const READY_STATUSES: readonly RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK];

export interface ConsignedBucket {
  count: number;
  /** `currentQty` toplamı — Envanter özet şeridinin `totalQty`siyle AYNI kolon (içerideki net metre). */
  qty: number;
}

export interface ConsignedOwnerRow {
  ownerCustomerId: string;
  ownerName: string;
  /** Rotaya girmemiş ham emanet (`currentStepId` yok, STOCK, entrySource ≠ SEMI_FINISHED) — Ham Stok (`RAW_STOCK_PURE`). */
  waiting: ConsignedBucket;
  /** Rotaya girmemiş YARI MAMUL emanet (gelen belge onayının doğurduğu top) — Yarı Mamul sekmesi (`SEMI_FINISHED`). */
  waitingSemi: ConsignedBucket;
  /** Bir iş emri adımında (`currentStepId` dolu) — Üretimde sekmesi. */
  inProcess: ConsignedBucket;
  /** Depoda, sevke hazır (WAREHOUSE · A1_STOCK) — Bitmiş Depo sekmesi. */
  ready: ConsignedBucket;
  /** İçeride ama üç kovanın dışında (adımsız fason/kartela vb.) — toplam eksiksiz kalsın diye. */
  other: ConsignedBucket;
  total: ConsignedBucket;
  /** D4-I3: sahibin cari kilidi (rozet; sunucu metni) — eski istemci yok sayar. */
  hold: typeof NO_HOLD_VIEW;
}

export interface ConsignedWorkSummary {
  rows: ConsignedOwnerRow[];
  totals: Omit<ConsignedOwnerRow, "ownerCustomerId" | "ownerName" | "hold">;
}

const BUCKET_KEYS = ["waiting", "waitingSemi", "inProcess", "ready", "other"] as const;
type BucketKey = (typeof BUCKET_KEYS)[number];

const emptyBucket = (): ConsignedBucket => ({ count: 0, qty: 0 });

export async function listRollOwnerCustomers(): Promise<ApiResponse<{ id: string; name: string; code: string | null }[]>> {
  // Emanet kapalıyken cari adları bu uçtan sızmasın (roll-tablet emsali); panel çipi zaten çizilmez.
  if (!(await readEmanetEnabled())) return { success: true, data: [] };
  const groups = await prisma.roll.groupBy({ by: ["ownerCustomerId"], where: { ownerCustomerId: { not: null } } });
  const ids = groups.map((g) => g.ownerCustomerId).filter((v): v is string => !!v);
  if (ids.length === 0) return { success: true, data: [] };
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  return { success: true, data: customers.map((c) => ({ id: c.id, name: c.name, code: c.code })) };
}

export async function getConsignedWorkSummary(): Promise<ApiResponse<ConsignedWorkSummary>> {
  // Kova ayrımı Envanter sekme kapsamlarının aynası: ready = FINISHED_STOCK, inProcess = PRODUCTION_ACTIVE
  // (adımda; SHIPPED/KARTELA_CONSUMED adımlı top sekmede görünür ama içeride sayılmaz — bilinçli fark),
  // waiting = RAW_STOCK_PURE, waitingSemi = SEMI_FINISHED. Hücre o sekmeyi sahip süzgeciyle açar.
  const rows = await prisma.$queryRaw<
    Array<{ ownerCustomerId: string; ownerName: string; bucket: BucketKey; cnt: bigint; qty: Prisma.Decimal | null }>
  >(Prisma.sql`
    SELECT
      r."ownerCustomerId" AS "ownerCustomerId",
      c.name              AS "ownerName",
      CASE
        WHEN r.status::text IN (${Prisma.join(READY_STATUSES)}) THEN 'ready'
        WHEN r."currentStepId" IS NOT NULL                       THEN 'inProcess'
        WHEN r.status::text = ${RollStatus.STOCK}
         AND r."entrySource"::text = ${RollEntrySource.SEMI_FINISHED} THEN 'waitingSemi'
        WHEN r.status::text = ${RollStatus.STOCK}                THEN 'waiting'
        ELSE 'other'
      END                 AS "bucket",
      COUNT(*)            AS "cnt",
      SUM(r."currentQty") AS "qty"
    FROM rolls r
    JOIN customers c ON c.id = r."ownerCustomerId"
    WHERE r."ownerCustomerId" IS NOT NULL
      AND r.status::text NOT IN (${Prisma.join(NOT_INSIDE_STATUSES)})
    GROUP BY 1, 2, 3
  `);

  const byOwner = new Map<string, ConsignedOwnerRow>();
  const totals = { waiting: emptyBucket(), waitingSemi: emptyBucket(), inProcess: emptyBucket(), ready: emptyBucket(), other: emptyBucket(), total: emptyBucket() };
  // Decimal biriktirme: metre toplamı float sürüklenmesin (Decimal kuralı).
  const qtyAcc = new Map<string, Prisma.Decimal>();
  const addQty = (key: string, v: Prisma.Decimal | null): number => {
    const next = (qtyAcc.get(key) ?? new Prisma.Decimal(0)).plus(v ?? 0);
    qtyAcc.set(key, next);
    return Number(next);
  };
  for (const r of rows) {
    let row = byOwner.get(r.ownerCustomerId);
    if (!row) {
      row = {
        ownerCustomerId: r.ownerCustomerId,
        ownerName: r.ownerName,
        waiting: emptyBucket(),
        waitingSemi: emptyBucket(),
        inProcess: emptyBucket(),
        ready: emptyBucket(),
        other: emptyBucket(),
        total: emptyBucket(),
        hold: NO_HOLD_VIEW,
      };
      byOwner.set(r.ownerCustomerId, row);
    }
    const n = Number(r.cnt);
    row[r.bucket].count += n;
    row[r.bucket].qty = addQty(`${r.ownerCustomerId}:${r.bucket}`, r.qty);
    row.total.count += n;
    row.total.qty = addQty(`${r.ownerCustomerId}:total`, r.qty);
    totals[r.bucket].count += n;
    totals[r.bucket].qty = addQty(`*:${r.bucket}`, r.qty);
    totals.total.count += n;
    totals.total.qty = addQty("*:total", r.qty);
  }
  const holds = await holdViewsByCustomer([...byOwner.keys()]);
  for (const [id, row] of byOwner) row.hold = holds.get(id) ?? NO_HOLD_VIEW;
  const list = [...byOwner.values()].sort((a, b) => b.total.qty - a.total.qty || a.ownerName.localeCompare(b.ownerName, "tr"));
  return { success: true, data: { rows: list, totals } };
}
