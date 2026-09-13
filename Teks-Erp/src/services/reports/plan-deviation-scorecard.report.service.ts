// =============================================================================
// PLAN-SAPMA KARNESİ — "plan dışı onayla depoya inen mal" (2026-08-19)
// =============================================================================
// Tambur plan kapısı (2026-08-19) topun rengi/eni iş emri hedefinden saptığında
// operatöre sorar; "yine de bitir" denirse mal OLDUĞU GİBİ depoya iner ve karar
// bir İMZADIR (SAP "usage decision" karşılığı). Bu karne o imzaları toplar.
//
// Yönetim sorusu: "Bu ay kaç kez plan dışına çıkıldı, ne kadar metraj, hangi
// kumaş/renkte, kim onayladı?" Sayı büyüyorsa sorun tamburda DEĞİL planlamadadır
// (yanlış renkle açılan iş emri) — karne nereye bakılacağını söyler. ISO 9001
// düzeltici-faaliyet girdisi olarak da bu tablo kullanılır.
//
// ── ÇİFT SAYIM KİLİDİ: `confirmationId` ─────────────────────────────────────
// ⚠️ Renk VE en birlikte sapan bir top ALAN BAŞINA satır üretir (2 satır) ama
// BİR imzadır ve depoya BİR KEZ iner. Bu yüzden:
//   • onay sayısı   = COUNT(DISTINCT confirmationId)
//   • sapan metraj  = confirmationId başına TEK qtyM'in toplamı
// Naif `COUNT(*)` / `SUM(qtyM)` o topu iki kez sayar ve rakam sessizce şişer
// (bekçi: `test_plan_deviation_scorecard.ts` bunu negatif sondayla kanıtlar).
//
// ── ALAN KIRILIMINDA SATIR BAZLI SAYIM MEŞRUDUR ─────────────────────────────
// "Renk sapması kaç kez oldu" sorusunun cevabı satır sayısıdır: aynı imzada hem
// renk hem en saptıysa ikisi de gerçekten olmuştur. Karışıklık olmasın diye
// başlık metriği (imza) ile kırılım (olay) ekranda AYRI adlandırılır.
//
// ── ÖLÇÜ METREDİR ───────────────────────────────────────────────────────────
// Proje kuralı (Kalite Karnesi ile aynı): 1000 m'lik bir sapma ile 5 m'lik bir
// sapmayı 1'e 1 saymak oranı anlamsız yapar.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { factoryDaySql } from "../../constants/time";
import { ACTIVE_DEVIATION } from "../helpers/tambur-plan-gate.helper";
import { round1 } from "./_breakdown";

// ---------- Tipler -----------------------------------------------------------

export interface PlanDeviationBreakdownRow {
  key: string;
  label: string;
  /** Bu kırılımdaki imza (onay) sayısı — DISTINCT confirmationId. */
  confirmations: number;
  /** Bu kırılımda plan dışı inen metraj (imza başına tek sayılır). */
  qtyM: number;
}

export interface PlanDeviationDetailRow {
  id: string;
  createdAt: string;
  rollBarcode: string | null;
  childBarcode: string | null;
  workOrderNumber: string;
  field: string;
  rollValue: string | null;
  planValue: string | null;
  qtyM: number;
  source: string;
  confirmedBy: string | null;
}

export interface PlanDeviationScorecard {
  summary: {
    /** İmza sayısı (DISTINCT confirmationId) — "kaç kez plan dışına çıkıldı". */
    confirmations: number;
    /** Plan dışı depoya inen metraj (imza başına tek qtyM). */
    deviatedQtyM: number;
    /** Alan bazlı OLAY sayısı + metrajı (satır bazlı — bkz. başlık notu). */
    byField: { color: { events: number; qtyM: number }; width: { events: number; qtyM: number } };
    /** Etkilenen ayrı top sayısı — aynı top birden çok kez onaylanmış olabilir. */
    affectedRolls: number;
  };
  /** Önceki dönem (compare istenmişse) — aynı iki başlık metriği. */
  previous: { confirmations: number; deviatedQtyM: number } | null;
  byOperator: PlanDeviationBreakdownRow[];
  byItemColor: PlanDeviationBreakdownRow[];
  /** Gün serisi — fabrika takvim gününe göre (gece vardiyası doğru güne yazılsın). */
  daily: { day: string; confirmations: number; qtyM: number }[];
  detail: PlanDeviationDetailRow[];
}

/** Detay tablosu tavanı — karne bir SAYAÇ ekranıdır, döküm değil. */
const DETAIL_LIMIT = 200;

// ---------- Yardımcı ---------------------------------------------------------

/**
 * Aynı imzanın satırlarını TEKE indirir: `(confirmationId → qtyM)`.
 * Metraj toplamı bu harita üzerinden alınır — satırları toplamak çift sayardı.
 */
function collapseByConfirmation(
  rows: { confirmationId: string; qtyM: Prisma.Decimal }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!m.has(r.confirmationId)) m.set(r.confirmationId, Number(r.qtyM));
  }
  return m;
}

// ---------- Ana sorgu --------------------------------------------------------

export async function getPlanDeviationScorecard(
  range: DateRange,
  compareRange: DateRange | null,
): Promise<PlanDeviationScorecard> {
  // ⚠️ GERİ ALINMIŞ İMZA SAYILMAZ (2026-09-13): tümden geri alınmış bir kapanışın
  // sapması karnede tam ağırlıkla duruyordu. `finalize` kaynağında `qtyM` topun
  // TAMAMI olduğu için geri alınıp yeniden finalize edilen top İKİ tam imza + İKİ
  // tam metraj üretiyordu. Süzgeç ÜÇ sorgunun ÜÇÜNDE de var — biri unutulursa
  // kusur yarım kapanır (gün serisi ham SQL'de, karşılaştırma dönemi aşağıda).
  const where = { ...ACTIVE_DEVIATION, createdAt: { gte: range.from, lte: range.to } };

  const rows = await prisma.rollPlanDeviation.findMany({
    where,
    select: {
      id: true,
      confirmationId: true,
      field: true,
      rollValue: true,
      planValue: true,
      qtyM: true,
      source: true,
      createdAt: true,
      rollId: true,
      roll: { select: { barcode: true, item: { select: { name: true } }, color: { select: { name: true } } } },
      childRoll: { select: { barcode: true } },
      workOrder: { select: { workOrderNumber: true } },
      confirmedBy: { select: { fullName: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const byConfirmation = collapseByConfirmation(rows);
  const deviatedQtyM = [...byConfirmation.values()].reduce((a, b) => a + b, 0);

  // Alan kırılımı — SATIR bazlı (olay sayısı), metrajı da satırdan okur.
  const byField = {
    color: { events: 0, qtyM: 0 },
    width: { events: 0, qtyM: 0 },
  };
  for (const r of rows) {
    const bucket = r.field === "color" ? byField.color : r.field === "width" ? byField.width : null;
    if (!bucket) continue;
    bucket.events += 1;
    bucket.qtyM += Number(r.qtyM);
  }

  // Kırılımlar: imza bazlı say (aynı imzayı iki kez saymamak için önce
  // confirmationId → kova eşlemesi kurulur).
  const buildBreakdown = (
    keyOf: (r: (typeof rows)[number]) => { key: string; label: string },
  ): PlanDeviationBreakdownRow[] => {
    const seen = new Set<string>();
    const acc = new Map<string, PlanDeviationBreakdownRow>();
    for (const r of rows) {
      if (seen.has(r.confirmationId)) continue;
      seen.add(r.confirmationId);
      const { key, label } = keyOf(r);
      const cur = acc.get(key) ?? { key, label, confirmations: 0, qtyM: 0 };
      cur.confirmations += 1;
      cur.qtyM += Number(r.qtyM);
      acc.set(key, cur);
    }
    return [...acc.values()]
      .map((x) => ({ ...x, qtyM: round1(x.qtyM) }))
      .sort((a, b) => b.qtyM - a.qtyM);
  };

  const byOperator = buildBreakdown((r) => ({
    key: r.confirmedBy?.username ?? "—",
    // Onaylayan bilinmiyorsa gizlenmez: "kim onayladı" sorusunun cevapsız kaldığı
    // satır da bir bulgudur (dahili/servis çağrısı ya da eski kayıt).
    label: r.confirmedBy?.fullName ?? r.confirmedBy?.username ?? "Bilinmiyor",
  }));

  const byItemColor = buildBreakdown((r) => {
    const item = r.roll?.item?.name ?? "—";
    const color = r.roll?.color?.name ?? "Renksiz";
    return { key: `${item}|${color}`, label: `${item} · ${color}` };
  });

  // Gün serisi — FABRİKA takvim günü (gece vardiyası bir önceki güne kaymasın).
  const daily = await prisma.$queryRaw<{ day: Date; confirmations: bigint; qty: Prisma.Decimal }[]>`
    SELECT ${factoryDaySql('per_conf."createdAt"')} AS day,
           COUNT(DISTINCT "confirmationId") AS confirmations,
           COALESCE(SUM(per_conf.qty), 0) AS qty
    FROM (
      -- İmza başına TEK metraj: iç sorgu satırları confirmationId'ye indirir.
      SELECT DISTINCT ON ("confirmationId") "confirmationId", "createdAt", "qtyM" AS qty
      FROM roll_plan_deviations
      WHERE "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
        AND "revokedAt" IS NULL
      ORDER BY "confirmationId", "createdAt"
    ) per_conf
    GROUP BY 1
    ORDER BY 1
  `;

  const detail: PlanDeviationDetailRow[] = rows.slice(0, DETAIL_LIMIT).map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    rollBarcode: r.roll?.barcode ?? null,
    childBarcode: r.childRoll?.barcode ?? null,
    workOrderNumber: r.workOrder?.workOrderNumber ?? "—",
    field: r.field,
    rollValue: r.rollValue,
    planValue: r.planValue,
    qtyM: Number(r.qtyM),
    source: r.source,
    confirmedBy: r.confirmedBy?.fullName ?? r.confirmedBy?.username ?? null,
  }));

  // Karşılaştırma dönemi — istenmezse İKİNCİ SORGU HİÇ KOŞMAZ.
  let previous: PlanDeviationScorecard["previous"] = null;
  if (compareRange) {
    const prevRows = await prisma.rollPlanDeviation.findMany({
      where: { ...ACTIVE_DEVIATION, createdAt: { gte: compareRange.from, lte: compareRange.to } },
      select: { confirmationId: true, qtyM: true },
    });
    const prevMap = collapseByConfirmation(prevRows);
    previous = {
      confirmations: prevMap.size,
      deviatedQtyM: round1([...prevMap.values()].reduce((a, b) => a + b, 0)),
    };
  }

  return {
    summary: {
      confirmations: byConfirmation.size,
      deviatedQtyM: round1(deviatedQtyM),
      byField: {
        color: { events: byField.color.events, qtyM: round1(byField.color.qtyM) },
        width: { events: byField.width.events, qtyM: round1(byField.width.qtyM) },
      },
      affectedRolls: new Set(rows.map((r) => r.rollId)).size,
    },
    previous,
    byOperator,
    byItemColor,
    daily: daily.map((d) => ({
      // PG `date` → JS Date UTC gece yarısı gelir (proje varsayımı, bekçili).
      day: d.day.toISOString().slice(0, 10),
      confirmations: Number(d.confirmations),
      qtyM: round1(Number(d.qty)),
    })),
    detail,
  };
}
