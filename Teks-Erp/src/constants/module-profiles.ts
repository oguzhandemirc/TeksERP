// =============================================================================
// TeksERP — KURULUM PROFİLLERİ (modül anahtarı başlangıç setleri)
// =============================================================================
// Bir müşteri "hangi ürünü satın aldı" sorusunun kurulum anındaki cevabı.
// Tasarım §10'un beş satırı. Profil YALNIZ modül anahtarlarını taşır ve
// yalnız TAZE kurulumda (satır hiç yokken) uygulanır — bkz. `jobs/module-profile.job.ts`.
//
// ⚠️ NEDEN TS SABİTİ, `deploy/profiller/*.json` DEĞİL (ölçüldü 2026-09-03):
// `deploy/paketle.ps1`in kopya listesi (dist · prisma · public · assets ·
// dist-web · package*.json · ecosystem.config.js · prisma.config.js) repo
// kökündeki `deploy/`i pakete SOKMAZ ve `kur.ps1` yalnız paketin içindekini
// açar. JSON yolu seçilseydi job üretimde dosyayı bulamaz, taze müşteri
// kurulumu sessizce profilsiz doğardı. TS sabiti `dist/`e derlenir — paketleme
// dokunuşu GEREKMEZ ve "dosya yok" arıza sınıfı tamamen kapanır.
// Emsal: `permission-catalog.ts`, `role-template-catalog.ts`.
//
// ⚠️ DAVRANIŞ BAYRAKLARI PROFİLE GİRMEZ. `prisma/seed.ts` 27 davranış bayrağını
// `upsert.update` ile EZEREK yazıyor; profil de yazsaydı aynı anahtarın İKİ
// yazarı olur ve hangisinin kazandığı KOŞUM SIRASINA kalırdı (seed elle, job
// boot'ta). `bayraklar` bloğu TİP olarak açıldı ama beş profilde de BOŞ —
// Dilim 2'de (invoiceMode vb.) dolacak; şimdi açılmasaydı o gün dosya BİÇİMİ
// değişirdi.
//
// ⚠️ FASON ve KARTELA anahtarsız (tasarım §2 on modül sayıyor, kodda yedi
// anahtar var) → profil satırlarında YAZILMAZLAR. `screen-catalog.ts`
// `planlanan:*` değerleriyle aynı boşluğun ikizi.
// =============================================================================

import { MODULE_SETTING_KEYS } from "./module-flags";

/** Tasarım §10'un satırları (boyahane BUGÜN SATILMIYOR → profil yok). */
export type ModuleProfileId = "basit" | "standart" | "perde" | "perde-dokuma" | "dokuma" | "tam";

export interface ModuleProfile {
  /** Panelde görünen ad. */
  ad: string;
  /** Satıcının profili seçerken okuduğu tek cümle. */
  aciklama: string;
  /**
   * DB anahtarı → değer. YEDİSİ DE zorunlu (bekçi §2 tamlığı ölçer):
   * eksik bırakılan anahtar "kod varsayılanına düşsün" demektir ve o varsayılan
   * profilin yanında GÖRÜNMEZ — profil tablosu okunabilirliğini kaybeder.
   */
  moduller: Readonly<Record<string, boolean>>;
  /**
   * Davranış bayrakları — BUGÜN BOŞ (yukarıdaki "iki yazar" notu). Dilim 2'de
   * dolacak; tip şimdi açık ki o gün dosya biçimi değişmesin.
   */
  bayraklar: Readonly<Record<string, boolean | string | number>>;
}

/**
 * Modül anahtarının DB adı ↔ API/panel alan adı.
 *
 * ⚠️ Üçüncü bir ikilik DEĞİL, iki mevcut kümenin EŞLEŞTİRMESİ: `module-flags.ts`
 * iki `Set` taşır ve hangi DB anahtarının hangi alana denk geldiğini SÖYLEMEZ
 * (Set tip üretmez, servis eşlemesi `system-setting.service`tedir ve onu
 * buradan import etmek dairesel bağımlılık kurardı — aynı dosyanın kendi
 * gerekçesi). Bekçi bu haritayı İKİ YÖNLÜ doğrular: her iki küme birebir
 * kapsanır ve servisin `this.set(SETTING_KEYS.X, input.Y…)` zinciriyle aynıdır.
 */
export const MODULE_FIELD_BY_SETTING_KEY: Readonly<Record<string, string>> = {
  "production.enabled": "productionEnabled",
  "finance.enabled": "financeEnabled",
  "ticaret.enabled": "ticaretEnabled",
  "iplik.enabled": "iplikEnabled",
  "depo.multiEnabled": "depoMultiEnabled",
  "kumasTeknik.enabled": "kumasTeknikEnabled",
  "tezgah.enabled": "tezgahEnabled",
  "devere.enabled": "devereEnabled",
};

/**
 * Modül satırlarının `description` metinleri — TEK KAYNAK.
 *
 * ÜÇ YAZAR var ve üçü de aynı satırı yazabiliyor: `setFeatureFlags` (panelden
 * ilk düzenleme), grandfathering migration'ı (mevcut kurulum), profil job'u
 * (taze kurulum). Ayrışırlarsa AYNI ayar, kuruluma göre BAŞKA açıklamayla
 * görünür. Bekçi (`test_module_profile §6`) üçünü birebirler.
 *
 * ⚠️ Metinler `system-setting.service.ts`teki `this.set(...)` çağrılarından
 * BİREBİR alınmıştır. Değiştirmek isteyen ÜÇ yeri birden değiştirir (migration
 * uygulanmış kurulumlarda geçmişi değiştirmez — orada metin dondu).
 */
export const MODULE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "production.enabled": "Üretim modülü (envanter üretim sekmeleri · iş emri yüzeyleri)",
  "finance.enabled": "Ön muhasebe modülü (cari · fatura · tahsilat · kasa/banka)",
  "ticaret.enabled": "Ticaret modülü (alış siparişi · mal kabul · fiyat listeleri · stok sayımı)",
  "iplik.enabled": "İplik modülü (kg defteri — iplik stok ve hareketleri)",
  "depo.multiEnabled": "Çoklu depo modülü (depo seçici · depo kolonu · depolar arası transfer)",
  "kumasTeknik.enabled": "Kumaş teknik kartı modülü (en · gramaj · kompozisyon · atkı/çözgü)",
  "tezgah.enabled": "Dokuma tezgah izleme modülü",
  "devere.enabled": "Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri)",
};

/** Yedi anahtarı `false` doğuran taban — profil satırları yalnız AÇTIKLARINI yazar. */
function taban(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of MODULE_SETTING_KEYS) out[k] = false;
  return out;
}

/** Taban + verilen anahtarlar `true`. Yazım hatası olan anahtar GÜRÜLTÜLÜ düşer. */
function acik(...keys: string[]): Readonly<Record<string, boolean>> {
  const out = taban();
  for (const k of keys) {
    if (!(k in out)) {
      throw new Error(
        `module-profiles: bilinmeyen modül anahtarı "${k}" — MODULE_SETTING_KEYS ile ayrıştı`,
      );
    }
    out[k] = true;
  }
  return out;
}

/**
 * Tasarım §10 tablosu (kod anahtarı olan yedi sütun).
 *
 * ⚠️ BAĞIMLILIK KURALI PROFİLLERDE DE GEÇERLİDİR (`MODULE_DEPENDENCIES`):
 * iplik → ticaret, tezgah → production. Bekçi §4 her profili SAF yüklemle
 * ölçer; job da uygulamadan önce aynı yüklemi koşturur (tutarsız bir çift
 * "panel açık gösteriyor ama uç 403" arızası doğururdu).
 */
export const MODULE_PROFILES: Readonly<Record<ModuleProfileId, ModuleProfile>> = {
  basit: {
    ad: "Basit — İşlemeci",
    aciklama:
      "Yalnız üretim: iş emri · istasyon · tambur · sevkiyat. Ön muhasebe, " +
      "alış-satış ve iplik defteri kapalı (bugünkü adnansahin kurulumu).",
    moduller: acik("production.enabled"),
    bayraklar: {},
  },
  standart: {
    ad: "Standart",
    aciklama:
      "Üretim + ön muhasebe + ticaret: cari/fatura/tahsilat ve alış siparişi · " +
      "mal kabul · fiyat listesi · stok sayımı.",
    moduller: acik("production.enabled", "finance.enabled", "ticaret.enabled"),
    bayraklar: {},
  },
  perde: {
    ad: "Perde üreticisi",
    aciklama:
      "Üretim + ön muhasebe + kumaş teknik kartı (en · gramaj · kompozisyon). " +
      "Alış-satış yüzeyleri kapalı — mal kabulü KK1'den yapılır.",
    moduller: acik("production.enabled", "finance.enabled", "kumasTeknik.enabled"),
    bayraklar: {},
  },
  /**
   * PERDE + DOKUMA (2026-09-12) — hedef kitle kararının profili.
   *
   * ⚠️ Mevcut `perde` profili DEĞİŞTİRİLMEDİ: o, kumaşı HAZIR ALAN bir kurulumun
   * kimliğidir ve canlı bir kurulumun profil içeriğini değiştirmek sessiz bir
   * davranış değişikliğidir. Dokuyan perdeci ayrı bir satırdır.
   * Tezgah izleme BU profilde KAPALI: "top tezgahtan doğar" motoru Faz 4'te gelir
   * (devere levent üretir, tezgah izleme ayrı bir yetenektir).
   */
  "perde-dokuma": {
    ad: "Perde üreticisi — dokuyan",
    aciklama:
      "Üretim + ön muhasebe + ticaret + iplik kg defteri + teknik kart + devere " +
      "(çözgü hazırlama/levent). Tezgah izleme kapalı — Faz 4'te açılır.",
    moduller: acik(
      "production.enabled",
      "finance.enabled",
      "ticaret.enabled",
      "iplik.enabled",
      "kumasTeknik.enabled",
      "devere.enabled",
    ),
    bayraklar: {},
  },
  dokuma: {
    ad: "Dokuma / örme",
    aciklama:
      "Üretim + ön muhasebe + ticaret + iplik kg defteri + teknik kart + devere + " +
      "tezgah izleme. Çoklu depo kapalı (tek depo).",
    moduller: acik(
      "production.enabled",
      "finance.enabled",
      "ticaret.enabled",
      "iplik.enabled",
      "kumasTeknik.enabled",
      "tezgah.enabled",
      "devere.enabled",
    ),
    bayraklar: {},
  },
  tam: {
    ad: "Tam",
    aciklama: "Yedi modülün hepsi açık — demo ve iç test kurulumları.",
    moduller: acik(...MODULE_SETTING_KEYS),
    bayraklar: {},
  },
};

/** Geçerli profil kimlikleri (env doğrulaması + panel listesi). */
export const MODULE_PROFILE_IDS = Object.keys(MODULE_PROFILES) as ModuleProfileId[];

/** `TEKSERP_PROFIL` değeri geçerli mi (tip daraltıcı). */
export function isModuleProfileId(v: string): v is ModuleProfileId {
  return Object.prototype.hasOwnProperty.call(MODULE_PROFILES, v);
}
