// =============================================================================
// MODÜL KAPISI HARİTASI — matrisin uç kapı beklentisinin TEK kaynağı
// =============================================================================
// Modül → o modülün kapısı arkasındaki GET sondaları. Beklenen sonuç profilin modül
// kümesinden TÜRER (`beklenenModulDurumu`): kapalı modül → 403 `details.code ===
// "MODULE_DISABLED"`, açık modül → 2xx. Bağımlılık `MODULE_DEPENDENCIES` + okuma
// kapısının elle ölçtüğü geçişli zincirdir (devere → iplik → ticaret).
// ⚠️ `scripts/test_module_flag_off.ts` MODULLER tablosunun sondaları bunun İKİZİDİR;
// ikisi birlikte değişir (tabloyu ortak lib'e taşımak O13b'nin borcudur).
// =============================================================================
import { MODULE_DEPENDENCIES } from "../../src/constants/module-flags";

export interface ModulSondasi {
  /** `FeatureFlags` modül alanı. */
  alan: string;
  /** Kapı arkasındaki GET uçları. */
  uclar: string[];
}

export const MODUL_SONDALARI: readonly ModulSondasi[] = [
  { alan: "financeEnabled", uclar: ["/api/finance/cari", "/api/finance/invoices", "/api/finance/cash-boxes"] },
  { alan: "ticaretEnabled", uclar: ["/api/stock-counts", "/api/item-prices", "/api/purchase-orders", "/api/goods-receipts"] },
  { alan: "iplikEnabled", uclar: ["/api/yarn/stocks"] },
  { alan: "devereEnabled", uclar: ["/api/warp-specs"] },
  { alan: "dokumaEnabled", uclar: ["/api/weaving-orders"] },
  { alan: "depoMultiEnabled", uclar: ["/api/warehouse-transfers"] },
  { alan: "productionEnabled", uclar: ["/api/routes", "/api/product-recipes", "/api/work-orders", "/api/production-balance"] },
];

/** Okuma kapısının elle ölçtüğü ek zincir: devere iplik ister (iplik ticareti ister). */
const EK_BAGIMLILIK: Readonly<Record<string, string>> = { devereEnabled: "iplikEnabled" };

/** Taze (seed'li) kurulumun modül varsayılanı: yalnız üretim açık doğar. */
export const MODUL_VARSAYILANI: Readonly<Record<string, boolean>> = { productionEnabled: true };

/** Modülün etkin olup olmadığı: kendi bayrağı VE ön koşulları (geçişli). */
export function beklenenModulDurumu(alan: string, ayarlar: Record<string, unknown>): boolean {
  const kendi = ayarlar[alan] !== undefined ? ayarlar[alan] === true : MODUL_VARSAYILANI[alan] === true;
  if (!kendi) return false;
  const onKosul = MODULE_DEPENDENCIES[alan] ?? EK_BAGIMLILIK[alan];
  return onKosul ? beklenenModulDurumu(onKosul, ayarlar) : true;
}
