import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

/**
 * PATRON ÖZETİ — backend `services/boss/overview.service.ts` ile BİREBİR.
 *
 * ⚠️ Her bölüm `null` OLABİLİR ve bu bir hata DEĞİLDİR: kullanıcının o bölüme
 * izni yoksa sunucu sorguyu hiç koşmaz ve adını `denied` dizisine yazar. İstemci
 * o kartı ÇİZMEZ — boş bir kart göstermek "veri yok" yalanı olurdu.
 */
export interface BossStock {
  rawQty: number;
  semiQty: number;
  finishedQty: number;
  deadQty: number;
  deadStockDays: number;
  topItems: Array<{ label: string; qty: number }>;
}

export interface BossOrders {
  openLineCount: number;
  openQty: number;
  uncoveredQty: number;
  coveragePct: number;
  overdueLines: number;
  overdueQty: number;
  topCustomers: Array<{ label: string; qty: number }>;
}

export interface BossProduction {
  /** ⚠️ ADET, metraj DEĞİL — Kanban ile aynı kaynak ve aynı birim. */
  columns: Array<{ key: string; label: string; count: number }>;
  stations: Array<{
    name: string;
    queueCount: number;
    activeCount: number;
    todayCompleted: number;
  }>;
}

export interface BossShipping {
  shippedQty: number;
  shippedRollCount: number;
  onTimePct: number;
  completedOrders: number;
  avgLateDays: number | null;
}

export interface BossSubcontract {
  openQty: number;
  openItems: number;
  firePct: number;
  avgTurnaroundDays: number | null;
  oldestOpenDays: number | null;
}

export interface BossOverview {
  generatedAt: string;
  range: { from: string; to: string };
  denied: string[];
  stock: BossStock | null;
  orders: BossOrders | null;
  production: BossProduction | null;
  shipping: BossShipping | null;
  subcontract: BossSubcontract | null;
}

export const bossService = {
  /**
   * TEK istek — beş bölüm birden. Bölümleri ayrı ayrı çağırmak tünel üzerinden
   * telefondan beş gidiş-dönüş demekti; daha önemlisi her istemci hangi raporu
   * çağıracağını kendi bilirdi ("ayrışan yüzey" sınıfı).
   */
  overview: (range?: { dateFrom?: string; dateTo?: string }): Promise<ApiResponse<BossOverview>> =>
    apiClient
      .get<ApiResponse<BossOverview>>("/api/boss/overview", { params: range })
      .then((r) => r.data),
};
