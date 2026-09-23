// =============================================================================
// ROUTE → MODÜL anahtarı (`SCREEN_CATALOG` masaüstü satırlarının AYNASI)
// =============================================================================
// Panelde modül kapısı 2026-09-14'e dek yalnız KARO ve PALETTEYDİ (`visibleWhen`);
// `ProtectedRoute` yalnız izne bakıyordu ⇒ bayrak KAPALI + izin VAR + adres
// çubuğundan URL → sayfa çiziliyor, backend 403 `MODULE_DISABLED` basıyordu.
// Bu tablo kataloğun `modul` beyanının panel ikizidir (tablet `SCREEN_MODULE`
// emsali); `ProtectedRoute` buradan okur ve kapalı modülün route'unu
// `/forbidden`a düşürür — tüm modüller tek mekanizma.
//
// ⚠️ AYNA MEKANİK BEKÇİYLE KİLİTLİ: `Teks-Erp/scripts/test_screen_catalog §4b`
// bu dosyayı METİN olarak okur ve kataloğun `ModulKey` taşıyan masaüstü
// satırlarıyla İKİ YÖNLÜ birebirler. Çekirdek (`cekirdek:*`) ve planlanan
// (`planlanan:*`) ekranlar buraya GİRMEZ — kapatılabilir anahtarları yok.
//
// ⚠️ Manifesto uçtan OKUNMAZ: `GET /api/admin/screens` `admin:users ∨ admin:settings`
// ister, operatör hesabı alamaz; kapı her kullanıcıda çalışmak zorunda.
//
// ⚠️ ETKİN değer bağlamdan gelir (`useOperationsVisibilityContext`): zincir
// (iplik = ticaret && iplik · devere · dokuma) ve varsayılan yön (production
// belirsizken AÇIK, diğerleri KAPALI) TEK yerde çözülür; burada yalnız okunur.
// =============================================================================
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

/** Bağlamda karşılığı olan modül anahtarları (kumasTeknik/tezgah ekransız — tabloya giremez). */
export type RouteModuleFlag = Extract<
  keyof OperationsVisibilityContext,
  | "productionEnabled"
  | "financeEnabled"
  | "ticaretEnabled"
  | "iplikEnabled"
  | "depoMultiEnabled"
  | "devereEnabled"
  | "dokumaEnabled"
>;

/** Ekran anahtarı (route yolunun ilk iki segmenti; hub tek segment) → modül. */
export const ROUTE_MODULE: Readonly<Record<string, RouteModuleFlag>> = {
  // ── ÜRETİM ──────────────────────────────────────────────────────────────
  "definitions/routes": "productionEnabled",
  "definitions/product-recipes": "productionEnabled",
  "definitions/station-capabilities": "productionEnabled",
  "definitions/traveler-card": "productionEnabled",
  "operations/work-orders": "productionEnabled",
  "operations/kursun-dagitim": "productionEnabled",
  "operations/product-balance": "productionEnabled",
  "reports/production": "productionEnabled",
  "reports/quality": "productionEnabled",
  // ── ÖN MUHASEBE ─────────────────────────────────────────────────────────
  finance: "financeEnabled",
  "finance/cari": "financeEnabled",
  "finance/invoices": "financeEnabled",
  "finance/payments": "financeEnabled",
  "finance/accounts": "financeEnabled",
  "finance/cash-transactions": "financeEnabled",
  "finance/rates": "financeEnabled",
  "finance/cheques": "financeEnabled",
  "finance/allocations": "financeEnabled",
  "finance/period-close": "financeEnabled",
  "reports/finance": "financeEnabled",
  // ── TİCARET · İPLİK · ÇOKLU DEPO ────────────────────────────────────────
  "operations/goods-receipts": "ticaretEnabled",
  "operations/purchase-orders": "ticaretEnabled",
  "operations/stock-counts": "ticaretEnabled",
  "definitions/item-prices": "ticaretEnabled",
  "operations/yarn-stock": "iplikEnabled",
  "operations/warehouse-transfers": "depoMultiEnabled",
  // ── DEVERE · DOKUMA ─────────────────────────────────────────────────────
  "definitions/warp-specs": "devereEnabled",
  "operations/weaving-orders": "dokumaEnabled",
  "operations/machine-stops": "dokumaEnabled",
  "reports/dokuma": "dokumaEnabled",
  "operations/warp-beams": "devereEnabled",
};

/** `:id` · `new` · `edit` segmentleri ebeveyne katlanır (manifesto EKRAN seviyesinde). */
function screenKeyCandidates(pathname: string): string[] {
  const segs = pathname
    .split("/")
    .filter((x) => x && !x.startsWith(":") && x !== "new" && x !== "edit");
  // En uzun eşleşme önce: `finance/cari` → `finance`.
  return [segs.slice(0, 2).join("/"), segs[0] ?? ""].filter(Boolean);
}

/** Yolun ait olduğu modül; modülsüz (çekirdek/planlanan/bilinmeyen) yol → null. */
export function routeModuleOf(pathname: string): RouteModuleFlag | null {
  for (const key of screenKeyCandidates(pathname)) {
    const m = ROUTE_MODULE[key];
    if (m) return m;
  }
  return null;
}

/**
 * Route çizilsin mi? Modülsüz yol her zaman `true`; modüllü yol bağlamdaki ETKİN
 * değere bakar. Karar bayrak yüklenene dek de verilir — yön bağlamın işi.
 */
export function isRouteModuleOpen(pathname: string, ctx: OperationsVisibilityContext): boolean {
  const m = routeModuleOf(pathname);
  return m === null ? true : ctx[m];
}

/** Modül kapısının /forbidden'a taşıdığı durum — sayfa "yetki yok" değil "modül kapalı" der. */
export const FORBIDDEN_MODULE_STATE = { reason: "module" } as const;

export function isForbiddenByModule(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { reason?: unknown }).reason === "module";
}
