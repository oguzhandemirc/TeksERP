// =============================================================================
// NEREDE TAKILDI (WIP) — "mal şu an nerede ve ne kadardır orada"
// =============================================================================
// İstasyon Verimliliği raporunun yerini alır. Eskisinin iki sorunu vardı:
//   1. `qtyIn` ve `qtyOut` kolonlarını yan yana basıyordu ve tam da olmayan bir
//      "kayıp" okumasını davet ediyordu — oysa `qtyOut = qtyIn` TASARIM GEREĞİ
//      yazılır (kök CLAUDE.md; ölçüldü: kapanan hareketlerin %79'unda eşit).
//      Bu karne o farkı HİÇ basmaz; metraj yalnız "istasyonda bekleyen" olarak
//      ve `qtyIn`'den okunur.
//   2. Asıl operasyonel soruyu ("hangi iş kaç gündür duruyor") sormuyordu.
//
// ── İKİ BÖLÜM, İKİ ZAMAN ANLAYIŞI — ekranda da ayrı ────────────────────────
//   • BEKLEYEN  → ANLIK SNAPSHOT, tarih filtresinden BAĞIMSIZ. "Şu an nerede
//     takılı" sorusunun tarih aralığıyla işi yoktur; filtrelemek, önündeki
//     yığını görmek isteyen planlamacıyı yanıltırdı.
//   • GEÇEN     → DÖNEM. Seçilen aralıkta o istasyondan kaç top geçti ve
//     ortalama ne kadar kaldı.
//
// ⚠️ YAŞ MUTLAK PENCEREDİR (iki an arası fark), takvim günü DEĞİL → saat
// diliminden bağımsızdır ve çıplak now() doğrudur.
//
// ⚠️ SÜRE VERİSİNDE BİLİNEN TARİHSEL ÇARPIKLIK: 2026-08-01 öncesinde 10 ham SQL
// yazma noktası `roll_movements.exitedAt`'e çıplak NOW() yazıyordu (Prisma aynı
// kolona UTC yazarken) → o satırların süresi +3 saat şişkin ve geçmiş veri
// bilinçli olarak DÜZELTİLMEDİ (kök CLAUDE.md O-11). Bu geliştirme kopyasında
// ölçüldü ve çarpık satır ÇIKMADI (34 kapanışın 30'u 3 saatin altında, medyan
// 7 dk); sahada eski dönem sorgulanırsa ortalama süre olduğundan uzun görünebilir.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { round1 } from "./_breakdown";

export interface WipStationRow {
  key: string;
  label: string;
  kind: string;
  /** ANLIK: istasyonda bekleyen top ve metraj. */
  waitingCount: number;
  waitingQty: number;
  oldestDays: number | null;
  avgWaitDays: number | null;
  /** DÖNEM: aralıkta bu istasyondan çıkan top ve ortalama kalış süresi. */
  passedCount: number;
  avgDurationHours: number | null;
}

export interface WipScorecard {
  summary: {
    waitingCount: number;
    waitingQty: number;
    oldestDays: number | null;
    avgWaitDays: number | null;
    /** Canlı ama hiç top hareketi görmemiş iş emri sayısı. */
    neverStartedWorkOrders: number;
    neverStartedOldestDays: number | null;
    /** DÖNEM: aralıkta kapanan hareket sayısı. */
    passedCount: number;
  };
  byStation: WipStationRow[];
  /** En uzun bekleyen toplar — doğrudan müdahale listesi. */
  oldestWaiting: Array<{
    rollId: string;
    barcode: string | null;
    itemName: string;
    colorName: string | null;
    stationName: string;
    workOrderNumber: string | null;
    qty: number;
    daysWaiting: number;
  }>;
  /** Açılmış ama hiç malzeme girmemiş canlı iş emirleri. */
  neverStarted: Array<{
    workOrderId: string;
    workOrderNumber: string;
    status: string;
    daysOpen: number;
  }>;
}

export async function getWipScorecard(range: DateRange): Promise<WipScorecard> {
  const [waitingRows, passedRows, oldestRows, neverStartedRows, neverStartedAgg] = await Promise.all([
    // ── ANLIK: açık hareketler (istasyonda duran mal) ───────────────────────
    prisma.$queryRaw<
      Array<{
        stationId: string; stationName: string; stationKind: string;
        cnt: bigint; qty: number | null; oldestDays: number | null; avgDays: number | null;
      }>
    >(Prisma.sql`
      SELECT
        s.id         AS "stationId",
        s.name       AS "stationName",
        s.kind::text AS "stationKind",
        COUNT(*)                       AS "cnt",
        SUM(rm."qtyIn")::float         AS "qty",
        -- tz-ok: bekleme YAŞI iki an arası mutlak farktır, takvim günü değil.
        MAX(EXTRACT(EPOCH FROM (now() - rm."enteredAt")) / 86400.0) AS "oldestDays",
        -- tz-ok: ortalama bekleme de mutlak farktır (yukarıdaki MAX ile aynı).
        AVG(EXTRACT(EPOCH FROM (now() - rm."enteredAt")) / 86400.0) AS "avgDays"
      FROM roll_movements rm
      JOIN work_order_steps wos ON wos.id = rm."workOrderStepId"
      JOIN stations s           ON s.id = wos."stationId"
      WHERE rm."exitedAt" IS NULL
        AND rm."revokedAt" IS NULL
      GROUP BY s.id, s.name, s.kind
    `),
    // ── DÖNEM: kapanan hareketler (istasyondan geçen mal) ───────────────────
    prisma.$queryRaw<
      Array<{ stationId: string; cnt: bigint; avgSec: number | null }>
    >(Prisma.sql`
      SELECT
        wos."stationId" AS "stationId",
        COUNT(*)        AS "cnt",
        AVG(EXTRACT(EPOCH FROM (rm."exitedAt" - rm."enteredAt"))) AS "avgSec"
      FROM roll_movements rm
      JOIN work_order_steps wos ON wos.id = rm."workOrderStepId"
      WHERE rm."exitedAt" IS NOT NULL
        AND rm."revokedAt" IS NULL
        AND rm."exitedAt" >= ${range.from} AND rm."exitedAt" <= ${range.to}
      GROUP BY wos."stationId"
    `),
    // ── En uzun bekleyen toplar ─────────────────────────────────────────────
    prisma.$queryRaw<
      Array<{
        rollId: string; barcode: string | null; itemName: string; colorName: string | null;
        stationName: string; workOrderNumber: string | null; qty: number; daysWaiting: number;
      }>
    >(Prisma.sql`
      SELECT
        r.id AS "rollId", r.barcode, i.name AS "itemName", c.name AS "colorName",
        s.name AS "stationName", wo."workOrderNumber" AS "workOrderNumber",
        rm."qtyIn"::float AS "qty",
        -- tz-ok: mutlak bekleme süresi.
        EXTRACT(EPOCH FROM (now() - rm."enteredAt")) / 86400.0 AS "daysWaiting"
      FROM roll_movements rm
      JOIN work_order_steps wos ON wos.id = rm."workOrderStepId"
      JOIN work_orders wo       ON wo.id = wos."workOrderId"
      JOIN stations s           ON s.id = wos."stationId"
      JOIN rolls r              ON r.id = rm."rollId"
      JOIN items i              ON i.id = r."itemId"
      LEFT JOIN colors c        ON c.id = r."colorId"
      WHERE rm."exitedAt" IS NULL
        AND rm."revokedAt" IS NULL
      ORDER BY rm."enteredAt" ASC
      LIMIT 25
    `),
    // ── Hiç başlamamış canlı iş emirleri ────────────────────────────────────
    // "Açılmış ama malzeme hiç girmemiş" — planlama backlog'u da olabilir,
    // unutulmuş iş de. Rapor bunu YORUMLAMAZ, sayar ve yaşlandırır; kararı
    // planlamacı verir.
    prisma.$queryRaw<
      Array<{ workOrderId: string; workOrderNumber: string; status: string; daysOpen: number }>
    >(Prisma.sql`
      SELECT
        wo.id AS "workOrderId", wo."workOrderNumber" AS "workOrderNumber",
        wo.status::text AS "status",
        -- tz-ok: iş emrinin açık kaldığı mutlak süre.
        EXTRACT(EPOCH FROM (now() - wo."createdAt")) / 86400.0 AS "daysOpen"
      FROM work_orders wo
      WHERE wo.status IN ('PLANNED','IN_PROGRESS')
        AND NOT EXISTS (
          SELECT 1 FROM roll_movements m
          JOIN work_order_steps s ON s.id = m."workOrderStepId"
          WHERE s."workOrderId" = wo.id
            AND m."revokedAt" IS NULL
        )
      ORDER BY wo."createdAt" ASC
      LIMIT 25
    `),
    prisma.$queryRaw<Array<{ cnt: bigint; oldestDays: number | null }>>(Prisma.sql`
      SELECT COUNT(*) AS "cnt",
             -- tz-ok: en eski açık iş emrinin mutlak yaşı.
             MAX(EXTRACT(EPOCH FROM (now() - wo."createdAt")) / 86400.0) AS "oldestDays"
      FROM work_orders wo
      WHERE wo.status IN ('PLANNED','IN_PROGRESS')
        AND NOT EXISTS (
          SELECT 1 FROM roll_movements m
          JOIN work_order_steps s ON s.id = m."workOrderStepId"
          WHERE s."workOrderId" = wo.id
            AND m."revokedAt" IS NULL
        )
    `),
  ]);

  const passedByStation = new Map(passedRows.map((r) => [r.stationId, r]));
  // İstasyon listesi ANLIK bekleyenden değil, İKİ kümenin BİRLEŞİMİNDEN doğar:
  // dönemde iş geçirmiş ama şu an boş olan istasyon da satır almalı — "boş mu,
  // yoksa hiç mi çalışmadı" sorusu operatörü durdurur (Kurşun Planlama sekme
  // dersinin aynısı).
  const stationIds = new Set<string>([
    ...waitingRows.map((r) => r.stationId),
    ...passedRows.map((r) => r.stationId),
  ]);
  const stationMeta = new Map(waitingRows.map((r) => [r.stationId, r]));
  const missing = [...stationIds].filter((id) => !stationMeta.has(id));
  const extra = missing.length
    ? await prisma.station.findMany({
        where: { id: { in: missing } },
        select: { id: true, name: true, kind: true },
      })
    : [];
  const extraMeta = new Map(extra.map((s) => [s.id, s]));

  const byStation: WipStationRow[] = [...stationIds].map((id) => {
    const w = stationMeta.get(id);
    const p = passedByStation.get(id);
    const meta = extraMeta.get(id);
    return {
      key: id,
      label: w?.stationName ?? meta?.name ?? "(bilinmiyor)",
      kind: w?.stationKind ?? meta?.kind ?? "",
      waitingCount: w ? Number(w.cnt) : 0,
      waitingQty: round1(Number(w?.qty ?? 0)),
      oldestDays: w?.oldestDays != null ? round1(Number(w.oldestDays)) : null,
      avgWaitDays: w?.avgDays != null ? round1(Number(w.avgDays)) : null,
      passedCount: p ? Number(p.cnt) : 0,
      avgDurationHours: p?.avgSec != null ? Math.round((Number(p.avgSec) / 3600) * 10) / 10 : null,
    };
  });
  // Bekleyen metraj büyükten küçüğe — planlamacının ilk baktığı yer en dolu
  // istasyon olsun. Boş istasyonlar sona düşer ama LİSTEDEN DÜŞMEZ.
  byStation.sort((a, b) => b.waitingQty - a.waitingQty || a.label.localeCompare(b.label, "tr"));

  const totalWaitingCount = waitingRows.reduce((a, r) => a + Number(r.cnt), 0);
  const totalWaitingQty = waitingRows.reduce((a, r) => a + Number(r.qty ?? 0), 0);
  const oldest = waitingRows.reduce<number | null>((a, r) => {
    const v = r.oldestDays != null ? Number(r.oldestDays) : null;
    return v === null ? a : a === null ? v : Math.max(a, v);
  }, null);
  // Ortalama bekleme TOP AĞIRLIKLI: istasyon ortalamalarının ortalaması,
  // 1 toplu istasyon ile 50 toplu istasyonu eşit sayardı.
  const weightedWaitSum = waitingRows.reduce(
    (a, r) => a + (r.avgDays != null ? Number(r.avgDays) * Number(r.cnt) : 0),
    0,
  );

  return {
    summary: {
      waitingCount: totalWaitingCount,
      waitingQty: round1(totalWaitingQty),
      oldestDays: oldest != null ? round1(oldest) : null,
      avgWaitDays: totalWaitingCount > 0 ? round1(weightedWaitSum / totalWaitingCount) : null,
      neverStartedWorkOrders: Number(neverStartedAgg[0]?.cnt ?? 0),
      neverStartedOldestDays:
        neverStartedAgg[0]?.oldestDays != null ? round1(Number(neverStartedAgg[0].oldestDays)) : null,
      passedCount: passedRows.reduce((a, r) => a + Number(r.cnt), 0),
    },
    byStation,
    oldestWaiting: oldestRows.map((r) => ({
      rollId: r.rollId,
      barcode: r.barcode,
      itemName: r.itemName,
      colorName: r.colorName,
      stationName: r.stationName,
      workOrderNumber: r.workOrderNumber,
      qty: round1(Number(r.qty)),
      daysWaiting: round1(Number(r.daysWaiting)),
    })),
    neverStarted: neverStartedRows.map((r) => ({
      workOrderId: r.workOrderId,
      workOrderNumber: r.workOrderNumber,
      status: r.status,
      daysOpen: round1(Number(r.daysOpen)),
    })),
  };
}
