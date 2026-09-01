// =============================================================================
// TeksERP — PATRON ÖZETİ (`GET /api/boss/overview`)
// =============================================================================
// Uzaktan takip eden kişinin tek ekranda gördüğü özet. **YENİ İŞ MANTIĞI YOK** —
// bu dosya mevcut rapor servislerini compose eder, hiçbirinin rakamını yeniden
// hesaplamaz.
//
// ⚠️ NEDEN TEK UÇ. Naif çözüm istemcinin altı ayrı raporu ayrı ayrı çağırmasıydı.
// Bedeli ikiydi: (a) tünel üzerinden telefondan altı gidiş-dönüş, (b) daha
// önemlisi — her istemci hangi raporları çağıracağını KENDİ bilirdi ve
// "ayrışan yüzey" sınıfı bir hata için zemin hazırlardı (panel bir rakamı bir
// kaynaktan, mobil başkasından okur). Tek uç, tek karar noktası.
//
// ⚠️ İZİN SÜZMESİ SERVİS İÇİNDE, ROUTE'TA DEĞİL — `GET /api/search`in kovalar
// bazında uyguladığı desenin aynısı. Route yalnız `verifyToken` taşır; her
// bölüm kullanıcının iznine göre doldurulur ya da `null` bırakılır. Böylece
// YENİ BİR İZİN KODU GEREKMEZ (2026-08-01 dersi: sahada atanması unutulacak
// bir adım daha eklemiyoruz) ve dar yetkili bir kullanıcı 403 yerine kendi
// görebildiği kadarını görür.
// =============================================================================

import { matchesPermission } from "../../middlewares/rbac.middleware";
import { InventoryService } from "../inventory.service";
import { DashboardService } from "../dashboard.service";
import { getStockScorecard } from "../reports/stock-scorecard.report.service";
import { getOpenOrderCoverage } from "../reports/open-order-coverage.report.service";
import { getShipmentScorecard } from "../reports/shipment-scorecard.report.service";
import { getSubcontractScorecard } from "../reports/subcontract-scorecard.report.service";
import type { DateRange } from "../reports/_shared";

/** Özetteki bölümler — istemci `null` gördüğünde kartı ÇİZMEZ. */
export interface BossOverview {
  generatedAt: string;
  range: { from: string; to: string };
  /** Hangi bölümlerin izin yetersizliğinden boş geldiği (istemci "yetkiniz yok" diyebilsin). */
  denied: string[];
  stock: BossStock | null;
  orders: BossOrders | null;
  production: BossProduction | null;
  shipping: BossShipping | null;
  subcontract: BossSubcontract | null;
}

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

/**
 * ⚠️ ÜRETİM KARTI **ADET** BASAR, METRAJ DEĞİL — ve bu bilinçli bir eksiklik.
 * `getProductionFlow` kolon başına yalnız `count` döndürüyor (önizleme
 * kartlarının metrajı var, kolon toplamının yok). "Üretimde N metre" rakamını
 * burada kendi sorgumla üretmek, aynı sorunun İKİNCİ tanımını doğururdu ve
 * 2026-08-27'de tam bu sınıf hata ölçüldü: pano 48 derken envanter 47 diyordu.
 * Kanban ile AYNI kaynaktan, AYNI birimle basılır.
 */
export interface BossProduction {
  columns: Array<{ key: string; label: string; count: number }>;
  stations: Array<{ name: string; queueCount: number; activeCount: number; todayCompleted: number }>;
}

export interface BossShipping {
  shippedQty: number;
  shippedRollCount: number;
  /** Terminine uyan sipariş oranı — `withDeadlineOrders` üzerinden. */
  onTimePct: number;
  completedOrders: number;
  avgLateDays: number | null;
}

export interface BossSubcontract {
  /** Fasonda BEKLEYEN mal — patronun "dışarıda ne var" sorusu. */
  openQty: number;
  openItems: number;
  /** Çekme dahil fire oranı (defterden, tahminden değil). */
  firePct: number;
  avgTurnaroundDays: number | null;
  /** En yaşlı açık sevkin gün sayısı — `oldestOpen` listesinden türetilir. */
  oldestOpenDays: number | null;
}

/** Kaç kart en fazla listelenir — telefon ekranı ve tünel bant genişliği için. */
const TOP_N = 5;

/**
 * Üretim akışı kolonları — etiketler Kanban ile AYNI olmak zorunda.
 * Ayrışırsa patron ile sahadaki operatör aynı kolonu farklı adla konuşur.
 */
const FLOW_COLUMNS = [
  ["hamStok", "Ham Stok"],
  ["yariMamul", "Yarı Mamul"],
  ["fason", "Fason'da"],
  ["kursun", "Kurşun Bekleyen"],
  ["tambur", "Tambur Bekleyen"],
  ["depo", "Depo"],
  ["sevk", "Sevk"],
] as const;

/**
 * BÖLÜM → O BÖLÜMÜ AÇAN İZİNLER (herhangi biri yeterli).
 *
 * ⚠️ TEK SABİT OLMAK ZORUNDA. Kodlar `can(p, "report:inventory")` gibi çağrı
 * yerlerine dağılsaydı `test_permission_catalog`in AST tarayıcısı onları
 * çözemez ve dosya "beyansız dinamik izin kaynağı" diye testi düşürürdü —
 * ilk yazımda tam bu oldu. Tablo hem o kapsamı verir hem de bölüm↔izin
 * eşlemesini tek okunur yere toplar.
 */
const BOSS_SECTION_PERMISSIONS = {
  stock: ["report:inventory"],
  orders: ["report:sales"],
  production: ["report:production", "roll:read"],
  shipping: ["report:sales", "shipping:read"],
  subcontract: ["report:subcontract"],
} as const satisfies Record<string, readonly string[]>;

export type BossSectionKey = keyof typeof BOSS_SECTION_PERMISSIONS;

/**
 * ⚠️ İZİN EŞLEŞMESİ `matchesPermission` İLE. Düz `includes` yazılsaydı `report:*`
 * gibi joker izinler eşleşmez, tam yetkili bir kullanıcı bile boş ekran görürdü
 * — RBAC'in kendi kuralı tek yerde yaşamalı.
 */
function canSee(perms: string[], section: BossSectionKey): boolean {
  return BOSS_SECTION_PERMISSIONS[section].some((code) => matchesPermission(perms, code));
}

export async function getBossOverview(params: {
  permissions: string[];
  range: DateRange;
}): Promise<BossOverview> {
  const { permissions: p, range } = params;
  const denied: string[] = [];

  // Her bölüm KENDİ iznine bakar ve izinsizse SORGU HİÇ KOŞMAZ (yalnız yanıttan
  // düşürmek, yetkisiz kullanıcıya ait olmayan bir yükü DB'ye bindirirdi).
  const wantStock = canSee(p, "stock");
  const wantOrders = canSee(p, "orders");
  const wantProduction = canSee(p, "production");
  const wantShipping = canSee(p, "shipping");
  const wantSubcontract = canSee(p, "subcontract");

  for (const section of Object.keys(BOSS_SECTION_PERMISSIONS) as BossSectionKey[]) {
    if (!canSee(p, section)) denied.push(section);
  }

  const [stockRes, ordersRes, flowRes, stationsRes, shipRes, subRes] = await Promise.all([
    wantStock ? getStockScorecard() : null,
    wantOrders ? getOpenOrderCoverage() : null,
    wantProduction
      ? new InventoryService().getProductionFlow({ includeQueues: true, includeSevk: true })
      : null,
    wantProduction ? DashboardService.getStationsLiveState() : null,
    wantShipping ? getShipmentScorecard(range) : null,
    wantSubcontract ? getSubcontractScorecard(range) : null,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    denied,
    stock: stockRes
      ? {
          rawQty: stockRes.summary.rawQty,
          semiQty: stockRes.summary.semiQty,
          finishedQty: stockRes.summary.finishedQty,
          deadQty: stockRes.summary.deadQty,
          deadStockDays: stockRes.summary.deadStockDays,
          topItems: stockRes.byItem
            .slice(0, TOP_N)
            .map((r) => ({ label: r.label, qty: r.qty })),
        }
      : null,
    orders: ordersRes
      ? {
          openLineCount: ordersRes.summary.openLineCount,
          openQty: ordersRes.summary.openQty,
          uncoveredQty: ordersRes.summary.uncoveredQty,
          coveragePct: ordersRes.summary.coveragePct,
          overdueLines: ordersRes.summary.overdueUncoveredLines,
          overdueQty: ordersRes.summary.overdueUncoveredQty,
          topCustomers: ordersRes.byCustomer
            .slice(0, TOP_N)
            .map((r) => ({ label: r.label, qty: r.openQty })),
        }
      : null,
    production:
      flowRes?.data && stationsRes
        ? {
            columns: FLOW_COLUMNS.map(([key, label]) => ({
              key,
              label,
              // `total` kolonun TAM sayımıdır (önizleme dizisi yalnız ilk 10).
              // `.length` yazmak her kolonu 10'da tavanlardı — sessiz ve yanlış.
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
    shipping: shipRes
      ? {
          shippedQty: shipRes.summary.shippedQty,
          shippedRollCount: shipRes.summary.shippedRollCount,
          onTimePct: shipRes.summary.onTimePct,
          completedOrders: shipRes.summary.completedOrders,
          avgLateDays: shipRes.summary.avgLateDays,
        }
      : null,
    subcontract: subRes
      ? {
          openQty: subRes.summary.openQty,
          openItems: subRes.summary.openItems,
          firePct: subRes.summary.firePct,
          avgTurnaroundDays: subRes.summary.avgTurnaroundDays,
          // `oldestOpen` en yaşlıdan sıralı gelir; boşsa açık sevk yok demektir.
          oldestOpenDays: subRes.oldestOpen[0]?.daysOpen ?? null,
        }
      : null,
  };
}
