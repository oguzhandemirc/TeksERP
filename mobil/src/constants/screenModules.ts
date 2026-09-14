// =============================================================================
// Ekran → MODÜL anahtarı (TEK KAYNAK, `SCREEN_CATALOG` mobil satırlarının aynası)
// =============================================================================
// Backend `constants/screen-catalog.ts` her mobil ekranın `modul`unu beyan eder
// ama o beyan 2026-09-14'e dek tablette OKUNMUYORDU: ekranlar yalnız izinle
// gizleniyor, kapalı modülün kartı çiziliyor, tıklayan 403 `MODULE_DISABLED`
// yiyordu. Bu tablo o beyanın tablet ikizidir; `useVisibleScreens` buradan
// okur ve kart + navigator AYNI listeden beslenir (biri gizli öteki açık olamaz).
//
// ⚠️ AYNA MEKANİK BEKÇİYLE KİLİTLİ: `Teks-Erp/scripts/test_screen_catalog §3b`
// bu dosyayı METİN olarak okur ve kataloğun `ModulKey` taşıyan mobil satırlarıyla
// İKİ YÖNLÜ birebirler. Çekirdek (`cekirdek:*`) ve planlanan (`planlanan:*`)
// ekranlar buraya GİRMEZ — kapatılabilir bir anahtarları yok.
//
// ⚠️ VARSAYILAN YÖN = backend okuyucusunun satır-yok değeri, tek kaynak
// `DEFAULT_FEATURE_FLAGS` (`production` AÇIK; yeni modüller KAPALI). Üretim için
// fail-closed yazmak, referans fabrikada bayrak yüklenene dek KK1/Tambur
// kartlarının kaybolup geri gelmesi demekti — "sıfır görünür fark" ihlali
// (panel `resolveSettingsModuleState` ile aynı doktrin).
// =============================================================================

import type { MobileScreenKey } from '../types/permissions';
import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '../services/featureFlag.service';

/** Tablette ekranı olan modül anahtarları (`FeatureFlags` alan adıyla). */
export type MobileModuleFlag = 'productionEnabled' | 'dokumaEnabled' | 'devereEnabled';

/** Ekran → modül. Satırı olmayan ekran koşulsuzdur (yalnız izin). */
export const SCREEN_MODULE: Partial<Record<MobileScreenKey, MobileModuleFlag>> = {
  KK1: 'productionEnabled',
  KursunQc: 'productionEnabled',
  Tambur: 'productionEnabled',
  HizliIsEmri: 'productionEnabled',
  KursunDagitim: 'productionEnabled',
  // Tablet TEZGAH ekranı (2026-09-14) — dokuma modülü; tezgah izlemenin kardeşi, üretime bağlı.
  Dokuma: 'dokumaEnabled',
  // Tablet LEVENT SARIM ekranı (2026-09-14, §11) — devere modülü; üretim zincirine BAĞLI DEĞİL.
  Devere: 'devereEnabled',
  // Tablet FASON DOKUMA KABUL ekranı (G2t, 2026-09-14) — dokuma modülü; oturumsuz.
  FasonDokuma: 'dokumaEnabled',
};

export type MobileModuleState = Record<MobileModuleFlag, boolean>;

/** Bayraklar yüklenmemişken varsayılana düşen çözücü — yön alan başına, tek kaynak. */
export function resolveMobileModuleState(
  flags: Partial<Pick<FeatureFlags, MobileModuleFlag>> | undefined | null
): MobileModuleState {
  // ⚠️ ETKİN değer: dokuma → production zinciri burada çözülür (backend `requireDokumaEnabled`
  // ve panel `useOperationsVisibilityContext` ile aynı sıra).
  const productionEnabled = flags?.productionEnabled ?? DEFAULT_FEATURE_FLAGS.productionEnabled;
  return {
    productionEnabled,
    dokumaEnabled: productionEnabled && (flags?.dokumaEnabled ?? DEFAULT_FEATURE_FLAGS.dokumaEnabled),
    // Devere HAM bayrak: hazır levent alan fabrika üretim modülü olmadan da açar (K3 emsali — bağımlılık yok).
    devereEnabled: flags?.devereEnabled ?? DEFAULT_FEATURE_FLAGS.devereEnabled,
  };
}

/** `useVisibleScreens` koşul haritası: modülü KAPALI olan her ekran `false`. */
export function conditionalScreens(
  flags: Partial<Pick<FeatureFlags, MobileModuleFlag>> | undefined | null
): Partial<Record<MobileScreenKey, boolean>> {
  const state = resolveMobileModuleState(flags);
  const out: Partial<Record<MobileScreenKey, boolean>> = {};
  for (const [screen, modul] of Object.entries(SCREEN_MODULE) as [MobileScreenKey, MobileModuleFlag][]) {
    out[screen] = state[modul];
  }
  return out;
}
