// =============================================================================
// FABRİKA ÖZETİ — patron bulutu `ozet` projeksiyonunun TEK kaynağı (`snapshots.ts`)
// =============================================================================
// **YENİ İŞ MANTIĞI YOK**: mevcut rapor servislerini compose eder, hiçbir rakamı
// yeniden hesaplamaz ("ayrışan yüzey" sınıfı — rakam rapor ekranıyla birebir;
// bekçi `test_bulut_ozet_mutabakat`). İzin sınırı bulutta bölüm adıdır (§3.3);
// fabrika izinleri buraya taşınmaz.
// =============================================================================

import { InventoryService } from "../services/inventory.service";
import { DashboardService } from "../services/dashboard.service";
import { getStockScorecard } from "../services/reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../services/reports/open-order-coverage.report.service";
import { getShipmentScorecard } from "../services/reports/shipment-scorecard.report.service";
import { getSubcontractScorecard } from "../services/reports/subcontract-scorecard.report.service";
import type { DateRange } from "../services/reports/_shared";

/** Özetteki bölümler — üretim bölümü akış verisi yoksa `null`. */
export interface FactoryOverview {
  generatedAt: string;
  range: { from: string; to: string };
  stock: OverviewStock;
  orders: OverviewOrders;
  production: OverviewProduction | null;
  shipping: OverviewShipping;
  subcontract: OverviewSubcontract;
}

export interface OverviewStock {
  rawQty: number;
  semiQty: number;
  finishedQty: number;
  deadQty: number;
  deadStockDays: number;
  topItems: Array<{ label: string; qty: number }>;
}

export interface OverviewOrders {
  openLineCount: number;
  openQty: number;
  uncoveredQty: number;
  coveragePct: number;
  overdueLines: number;
  overdueQty: number;
  topCustomers: Array<{ label: string; qty: number }>;
}

/**
 * ⚠️ ÜRETİM KARTI **ADET** BASAR, METRAJ DEĞİL — ve bu bilinçli bir eksiklik.
 * `getProductionFlow` kolon başına yalnız `count` döndürüyor (önizleme
 * kartlarının metrajı var, kolon toplamının yok). "Üretimde N metre" rakamını
 * burada kendi sorgumla üretmek, aynı sorunun İKİNCİ tanımını doğururdu ve
 * 2026-08-27'de tam bu sınıf hata ölçüldü: pano 48 derken envanter 47 diyordu.
 * Kanban ile AYNI kaynaktan, AYNI birimle basılır.
 */
export interface OverviewProduction {
  columns: Array<{ key: string; label: string; count: number }>;
  stations: Array<{ name: string; queueCount: number; activeCount: number; todayCompleted: number }>;
}

export interface OverviewShipping {
  shippedQty: number;
  shippedRollCount: number;
  /** Terminine uyan sipariş oranı — `withDeadlineOrders` üzerinden. */
  onTimePct: number;
  completedOrders: number;
  avgLateDays: number | null;
}

export interface OverviewSubcontract {
  /** Fasonda BEKLEYEN mal — patronun "dışarıda ne var" sorusu. */
  openQty: number;
  openItems: number;
  /** Çekme dahil fire oranı (defterden, tahminden değil). */
  firePct: number;
  avgTurnaroundDays: number | null;
  /** En yaşlı açık sevkin gün sayısı — `oldestOpen` listesinden türetilir. */
  oldestOpenDays: number | null;
}

/** "En çok" listelerinin uzunluğu (patron ekranı kartları). */
const TOP_N = 5;

/**
 * Üretim akışı kolonları — etiketler Kanban ile AYNI olmak zorunda.
 * Ayrışırsa patron ile sahadaki operatör aynı kolonu farklı adla konuşur.
 */
export const FLOW_COLUMNS = [
  ["hamStok", "Ham Stok"],
  ["yariMamul", "Yarı Mamul"],
  ["fason", "Fason'da"],
  ["kursun", "Kurşun Bekleyen"],
  ["tambur", "Tambur Bekleyen"],
  ["depo", "Depo"],
  ["sevk", "Sevk"],
] as const;

export async function getFactoryOverview(range: DateRange): Promise<FactoryOverview> {
  const [stockRes, ordersRes, flowRes, stationsRes, shipRes, subRes] = await Promise.all([
    getStockScorecard(),
    getOpenOrderCoverage(),
    new InventoryService().getProductionFlow({ includeQueues: true, includeSevk: true }),
    DashboardService.getStationsLiveState(),
    getShipmentScorecard(range),
    getSubcontractScorecard(range),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    stock: {
      rawQty: stockRes.summary.rawQty,
      semiQty: stockRes.summary.semiQty,
      finishedQty: stockRes.summary.finishedQty,
      deadQty: stockRes.summary.deadQty,
      deadStockDays: stockRes.summary.deadStockDays,
      topItems: stockRes.byItem.slice(0, TOP_N).map((r) => ({ label: r.label, qty: r.qty })),
    },
    orders: {
      openLineCount: ordersRes.summary.openLineCount,
      openQty: ordersRes.summary.openQty,
      uncoveredQty: ordersRes.summary.uncoveredQty,
      coveragePct: ordersRes.summary.coveragePct,
      overdueLines: ordersRes.summary.overdueUncoveredLines,
      overdueQty: ordersRes.summary.overdueUncoveredQty,
      topCustomers: ordersRes.byCustomer.slice(0, TOP_N).map((r) => ({ label: r.label, qty: r.openQty })),
    },
    production: flowRes.data
      ? {
          columns: FLOW_COLUMNS.map(([key, label]) => ({
            key,
            label,
            // `total` kolonun TAM sayımıdır (önizleme dizisi yalnız ilk 10); `.length` her kolonu 10'da tavanlardı.
            count: flowRes.data![key].total,
          })),
          stations: stationsRes.map((st) => ({
            name: st.name,
            queueCount: st.queueCount,
            activeCount: st.activeCount,
            todayCompleted: st.todayCompletedCount,
          })),
        }
      : null,
    shipping: shippingSection(shipRes),
    subcontract: subcontractSection(subRes),
  };
}

/**
 * Dönemli iki bölümün eşlemesi — patron bulutu (`cloud-sync` · `ozet`) aynı bölümü dört
 * standart pencere için ayrı ayrı basar; eşleme ikinci kez yazılmasın diye buradan okur.
 */
export function shippingSection(shipRes: Awaited<ReturnType<typeof getShipmentScorecard>>): OverviewShipping {
  return {
    shippedQty: shipRes.summary.shippedQty,
    shippedRollCount: shipRes.summary.shippedRollCount,
    onTimePct: shipRes.summary.onTimePct,
    completedOrders: shipRes.summary.completedOrders,
    avgLateDays: shipRes.summary.avgLateDays,
  };
}

export function subcontractSection(subRes: Awaited<ReturnType<typeof getSubcontractScorecard>>): OverviewSubcontract {
  return {
    openQty: subRes.summary.openQty,
    openItems: subRes.summary.openItems,
    firePct: subRes.summary.firePct,
    avgTurnaroundDays: subRes.summary.avgTurnaroundDays,
    // `oldestOpen` en yaşlıdan sıralı gelir; boşsa açık sevk yok demektir.
    oldestOpenDays: subRes.oldestOpen[0]?.daysOpen ?? null,
  };
}
