// =============================================================================
// FASON KARNESİ — "hangi boyahane iyi çalışıyor"
// =============================================================================
// Mevcut iki fason raporu (performans + açık sevkler) süre ve adet veriyordu.
// Sahada asıl tartışılan rakam ise hiç yoktu: **FASON FİRESİ** — giden metraj
// ile dönen metraj arasındaki fark. Boyahaneye 1000 m gönderip 960 m almak
// %4 fire demektir ve bu, fatura itirazının da firma seçiminin de dayanağıdır.
//
// ── FİRE YALNIZ KAPANMIŞ KALEMLERDEN HESAPLANIR ─────────────────────────────
// Naif hesap — Σgiden − Σdönen — henüz DÖNMEMİŞ malı fire sayar ve dün sevk
// edilmiş bir partiyi %100 fire gösterir. Bu yüzden her sevk kalemi ikiye
// ayrılır:
//   • KAPANMIŞ (en az bir kabul satırı var) → fire hesabına girer
//   • AÇIK     (hiç dönüş yok)              → ayrı "açık bakiye" olarak raporlanır
// Oran da yalnız kapanmışların paydasıyla hesaplanır. İki kümeyi karıştırmak
// raporu sistematik olarak firmaların aleyhine yanlışlardı.
//
// ── DÖNEN METRAJ: TÜM kabul satırları toplanır (DISTINCT ON DEĞİL) ──────────
// ⚠️ Mevcut `subcontract.report.service` dönüş satırlarını `DISTINCT ON
// (sourceDispatchItemId)` ile TEKE indiriyor — orada doğru, çünkü soru "bu kalem
// kapandı mı" (bool) ve süre. Ama METRAJ için yanlış olurdu: 100 m'lik bir top
// fasondan 2×48 m olarak dönebilir; DISTINCT ON yalnız birini sayıp 52 m'yi
// sahte fire yazardı. Burada SUM edilir.
//
// ── DOĞRUDAN SEVK EDİLENLER FİRE HESABINA GİRMEZ ───────────────────────────
// `directShippedAt` dolu sevkler fasondan müşteriye çıkmıştır; fabrikaya hiç
// dönmezler. Fire kümesinde bırakmak onları %100 fire gösterirdi.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { pctOf, round1 } from "./_breakdown";

// ---------- Tipler -----------------------------------------------------------

export interface SubcontractScorecardRow {
  key: string;
  label: string;
  /** Dönemde sevk edilen kalem adedi. */
  dispatchItems: number;
  dispatchedQty: number;
  /** Kapanmış (dönüşü gelmiş) kalemlerin giden metrajı — fire paydası. */
  closedDispatchedQty: number;
  returnedQty: number;
  /** closedDispatchedQty − returnedQty (negatif olabilir: fazla dönmüş). */
  fireQty: number;
  firePct: number;
  /** Henüz dönmemiş kalem adedi ve metrajı. */
  openItems: number;
  openQty: number;
  /** Kapanmış kalemlerde ortalama dönüş süresi (gün). */
  avgTurnaroundDays: number | null;
  prevFirePct?: number;
  prevDispatchedQty?: number;
}

export interface SubcontractScorecard {
  summary: {
    dispatchedQty: number;
    closedDispatchedQty: number;
    returnedQty: number;
    fireQty: number;
    firePct: number;
    openItems: number;
    openQty: number;
    avgTurnaroundDays: number | null;
    prevFirePct?: number;
    prevDispatchedQty?: number;
  };
  bySubcontractor: SubcontractScorecardRow[];
  /** Dönemde AÇIK kalan en yaşlı sevkler — operasyonel takip listesi. */
  oldestOpen: Array<{
    dispatchId: string;
    dispatchNo: string;
    subcontractorName: string;
    dispatchedAt: string;
    daysOpen: number;
    openItems: number;
    openQty: number;
  }>;
}

// ---------- Ham toplama ------------------------------------------------------

interface SubCell {
  subId: string;
  subName: string;
  dispatchItems: number;
  dispatchedQty: number;
  closedItems: number;
  closedDispatchedQty: number;
  returnedQty: number;
  openItems: number;
  openQty: number;
  turnaroundSum: number;
  turnaroundCount: number;
}

/**
 * Kalem başına giden/dönen tek sorguda toplanır, firma kırılımı JS'te.
 *
 * ⚠️ `receivedAt` en ERKEN kabul satırından alınır (süre hesabı için); metraj
 * ise TÜM satırların toplamıdır. İkisi ayrı sorulardır ve tek agregasyonda
 * karıştırılırsa ya süre ya metraj yanlış çıkar.
 */
async function collectDispatchItems(range: DateRange): Promise<SubCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      subId: string;
      subName: string;
      dispatchedQty: number;
      returnedQty: number | null;
      firstReceivedAt: Date | null;
      dispatchedAt: Date;
    }>
  >(Prisma.sql`
    SELECT
      sub.id   AS "subId",
      sub.name AS "subName",
      sdi."dispatchedQty"::float AS "dispatchedQty",
      ret.qty                    AS "returnedQty",
      ret."firstReceivedAt"      AS "firstReceivedAt",
      sd."dispatchedAt"          AS "dispatchedAt"
    FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    JOIN subcontractors sub          ON sub.id = sd."subcontractorId"
    LEFT JOIN LATERAL (
      SELECT
        SUM(nr."initialQty")::float AS qty,
        MIN(sr."receivedAt")        AS "firstReceivedAt"
      FROM subcontractor_receipt_items sri
      JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
      JOIN rolls nr                  ON nr.id = sri."newRollId"
      WHERE sri."sourceDispatchItemId" = sdi.id
        AND sr."cancelledAt" IS NULL
    ) ret ON true
    WHERE sd."dispatchedAt" >= ${range.from}
      AND sd."dispatchedAt" <= ${range.to}
      AND sd."cancelledAt" IS NULL
      -- Fasondan doğrudan müşteriye çıkan mal fabrikaya DÖNMEZ; fire kümesinde
      -- bırakmak onu %100 fire gösterirdi.
      AND sd."directShippedAt" IS NULL
  `);

  const map = new Map<string, SubCell>();
  for (const r of rows) {
    let cell = map.get(r.subId);
    if (!cell) {
      cell = {
        subId: r.subId, subName: r.subName,
        dispatchItems: 0, dispatchedQty: 0,
        closedItems: 0, closedDispatchedQty: 0, returnedQty: 0,
        openItems: 0, openQty: 0, turnaroundSum: 0, turnaroundCount: 0,
      };
      map.set(r.subId, cell);
    }
    const disp = Number(r.dispatchedQty);
    cell.dispatchItems += 1;
    cell.dispatchedQty += disp;
    // "Kapandı" ölçütü DÖNÜŞ SATIRININ VARLIĞIDIR (metraj > 0 değil): fasondan
    // sıfır metrajla dönen bir kalem de kapanmıştır ve firesi %100'dür.
    if (r.firstReceivedAt !== null) {
      cell.closedItems += 1;
      cell.closedDispatchedQty += disp;
      cell.returnedQty += Number(r.returnedQty ?? 0);
      cell.turnaroundSum += (r.firstReceivedAt.getTime() - r.dispatchedAt.getTime()) / 86_400_000;
      cell.turnaroundCount += 1;
    } else {
      cell.openItems += 1;
      cell.openQty += disp;
    }
  }
  return [...map.values()];
}

// ---------- Ana giriş --------------------------------------------------------

function toRow(c: SubCell): SubcontractScorecardRow {
  const fire = c.closedDispatchedQty - c.returnedQty;
  return {
    key: c.subId,
    label: c.subName,
    dispatchItems: c.dispatchItems,
    dispatchedQty: round1(c.dispatchedQty),
    closedDispatchedQty: round1(c.closedDispatchedQty),
    returnedQty: round1(c.returnedQty),
    fireQty: round1(fire),
    firePct: pctOf(fire, c.closedDispatchedQty),
    openItems: c.openItems,
    openQty: round1(c.openQty),
    avgTurnaroundDays:
      c.turnaroundCount > 0 ? Math.round((c.turnaroundSum / c.turnaroundCount) * 10) / 10 : null,
  };
}

export async function getSubcontractScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<SubcontractScorecard> {
  const [cells, prevCells, openRows] = await Promise.all([
    collectDispatchItems(range),
    compareRange ? collectDispatchItems(compareRange) : Promise.resolve<SubCell[]>([]),
    // AÇIK sevkler + yaş. Yaş MUTLAK penceredir (iki an arası fark), takvim günü
    // DEĞİL → saat diliminden bağımsızdır ve çıplak now() doğrudur.
    prisma.$queryRaw<
      Array<{
        dispatchId: string;
        dispatchNo: string;
        subcontractorName: string;
        dispatchedAt: Date;
        daysOpen: number;
        openItems: bigint;
        openQty: number | null;
      }>
    >(Prisma.sql`
      SELECT
        sd.id            AS "dispatchId",
        sd."dispatchNo"  AS "dispatchNo",
        sub.name         AS "subcontractorName",
        sd."dispatchedAt" AS "dispatchedAt",
        -- tz-ok: iki an arasındaki MUTLAK fark (kaç gündür açık); takvim günü
        -- sorusu değil, bu yüzden fabrika saat dilimine kesilmez.
        EXTRACT(EPOCH FROM (now() - sd."dispatchedAt")) / 86400.0 AS "daysOpen",
        COUNT(*)                          AS "openItems",
        SUM(sdi."dispatchedQty")::float   AS "openQty"
      FROM subcontractor_dispatch_items sdi
      JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
      JOIN subcontractors sub          ON sub.id = sd."subcontractorId"
      WHERE sd."cancelledAt" IS NULL
        AND sd."directShippedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subcontractor_receipt_items sri
          JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
          WHERE sri."sourceDispatchItemId" = sdi.id AND sr."cancelledAt" IS NULL
        )
      GROUP BY sd.id, sd."dispatchNo", sub.name, sd."dispatchedAt"
      ORDER BY sd."dispatchedAt" ASC
      LIMIT 25
    `),
  ]);

  const bySubcontractor = cells.map(toRow).sort((a, b) => b.dispatchedQty - a.dispatchedQty);

  if (compareRange) {
    const prev = new Map(prevCells.map((c) => [c.subId, toRow(c)]));
    for (const row of bySubcontractor) {
      const p = prev.get(row.key);
      row.prevFirePct = p ? p.firePct : 0;
      row.prevDispatchedQty = p ? p.dispatchedQty : 0;
    }
  }

  const agg = (list: SubCell[]) =>
    list.reduce(
      (a, c) => ({
        dispatchedQty: a.dispatchedQty + c.dispatchedQty,
        closedDispatchedQty: a.closedDispatchedQty + c.closedDispatchedQty,
        returnedQty: a.returnedQty + c.returnedQty,
        openItems: a.openItems + c.openItems,
        openQty: a.openQty + c.openQty,
        turnaroundSum: a.turnaroundSum + c.turnaroundSum,
        turnaroundCount: a.turnaroundCount + c.turnaroundCount,
      }),
      { dispatchedQty: 0, closedDispatchedQty: 0, returnedQty: 0, openItems: 0, openQty: 0, turnaroundSum: 0, turnaroundCount: 0 },
    );

  const t = agg(cells);
  const fire = t.closedDispatchedQty - t.returnedQty;
  const summary: SubcontractScorecard["summary"] = {
    dispatchedQty: round1(t.dispatchedQty),
    closedDispatchedQty: round1(t.closedDispatchedQty),
    returnedQty: round1(t.returnedQty),
    fireQty: round1(fire),
    firePct: pctOf(fire, t.closedDispatchedQty),
    openItems: t.openItems,
    openQty: round1(t.openQty),
    avgTurnaroundDays:
      t.turnaroundCount > 0 ? Math.round((t.turnaroundSum / t.turnaroundCount) * 10) / 10 : null,
  };
  if (compareRange) {
    const p = agg(prevCells);
    summary.prevFirePct = pctOf(p.closedDispatchedQty - p.returnedQty, p.closedDispatchedQty);
    summary.prevDispatchedQty = round1(p.dispatchedQty);
  }

  return {
    summary,
    bySubcontractor,
    oldestOpen: openRows.map((r) => ({
      dispatchId: r.dispatchId,
      dispatchNo: r.dispatchNo,
      subcontractorName: r.subcontractorName,
      dispatchedAt: r.dispatchedAt.toISOString(),
      daysOpen: Math.round(Number(r.daysOpen) * 10) / 10,
      openItems: Number(r.openItems),
      openQty: round1(Number(r.openQty ?? 0)),
    })),
  };
}
