// =============================================================================
// TeksERP — KURULUM PROFİLLERİ (modül anahtarı başlangıç setleri)
// =============================================================================
// Bir müşteri "hangi ürünü satın aldı" sorusunun kurulum anındaki cevabı.
// Tasarım §10'un beş satırı. Profil YALNIZ modül anahtarlarını taşır ve
// yalnız TAZE kurulumda (satır hiç yokken) uygulanır — bkz. `jobs/module-profile.job.ts`.
//
// ⚠️ NEDEN TS SABİTİ, `deploy/profiller/*.json` DEĞİL (ölçüldü 2026-09-03):
// `deploy/paketle.ps1`in kopya listesi (dist · prisma · public · assets ·
// package*.json · ecosystem.config.js · prisma.config.js) repo
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
// ⚠️ FASON ve KARTELA anahtarsız (tasarım §2'de modül, kodda anahtarı
// yok) → profil satırlarında YAZILMAZLAR. `screen-catalog.ts`
// `planlanan:*` değerleriyle aynı boşluğun ikizi.
// =============================================================================

import { MODULE_SETTING_KEYS } from "./module-flags";

/** Tasarım §10'un satırları (boyahane aynası BUGÜN SATILMIYOR → profil yok; hizmet veren satılır). */
export type ModuleProfileId = "basit" | "standart" | "perde" | "perde-dokuma" | "dokuma" | "hizmet" | "tam";

export interface ModuleProfile {
  /** Panelde görünen ad. */
  ad: string;
  /** Satıcının profili seçerken okuduğu tek cümle. */
  aciklama: string;
  /**
   * DB anahtarı → değer. HEPSİ zorunlu (bekçi §2 tamlığı ölçer):
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
  "dokuma.enabled": "dokumaEnabled",
  "emanet.enabled": "emanetEnabled",
  "kaliteGuvence.enabled": "kaliteGuvenceEnabled",
  "maliyet.enabled": "maliyetEnabled",
  "gelenBelge.enabled": "gelenBelgeEnabled",
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
  // Metin migration damgasıyla BİREBİR kalır (test_module_profile §6b/§6d) — görünen ad değişikliğinin dışında.
  "production.enabled": "Üretim modülü (envanter üretim sekmeleri · iş emri yüzeyleri)",
  "finance.enabled": "Ön muhasebe modülü (cari · fatura · tahsilat · kasa/banka)",
  "ticaret.enabled": "Ticaret modülü (alış siparişi · mal kabul · fiyat listeleri · stok sayımı)",
  "iplik.enabled": "İplik modülü (kg defteri — iplik stok ve hareketleri)",
  "depo.multiEnabled": "Çoklu depo modülü (depo seçici · depo kolonu · depolar arası transfer)",
  "kumasTeknik.enabled": "Kumaş teknik kartı modülü (en · gramaj · kompozisyon · atkı/çözgü)",
  "tezgah.enabled": "Dokuma tezgah izleme modülü",
  "devere.enabled": "Devere / levent modülü (çözgü kartı · levent stoğu · levent defteri)",
  // Metin migration damgasıyla BİREBİR kalır (test_module_profile §6b/§6d) — görünen ad değişikliğinin dışında.
  "dokuma.enabled": "Dokuma işi modülü (dokuma işi planlama · tezgah koşumu · top indirme)",
  "emanet.enabled": "Emanet / konsinye mülkiyet modülü (müşterinin malı: top · levent · iplik lotu; sevk sahiplik kapısı)",
  "kaliteGuvence.enabled": "Kalite Güvence modülü (4 puan muayene · lab testleri · sertifika takibi)",
  "maliyet.enabled": "Maliyet & Teklif: ürün maliyeti, standart maliyet, satış teklifi, fiyat listesi, iplik ihtiyaç planı",
  "gelenBelge.enabled": "Gelen belge taslağı modülü (müşteri irsaliyesi fotoğrafından OCR taslak · gözden geçirme · onayla emanet top girişi)",
};

/** Bütün modül anahtarlarını `false` doğuran taban — profil satırları yalnız AÇTIKLARINI yazar. */
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
 * Tasarım §10 tablosu (kod anahtarı olan sütunlar).
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
      "Yalnız üretim: terbiye iş emri · istasyon · tambur · sevkiyat. Ön muhasebe, " +
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
      "(çözgü hazırlama/levent) + dokuma iş emri. Tezgah izleme kapalı — Faz 4'te açılır.",
    moduller: acik(
      "production.enabled",
      "finance.enabled",
      "ticaret.enabled",
      "iplik.enabled",
      "kumasTeknik.enabled",
      "devere.enabled",
      "dokuma.enabled",
    ),
    bayraklar: {},
  },
  dokuma: {
    ad: "Dokuma / örme",
    aciklama:
      "Üretim + ön muhasebe + ticaret + iplik kg defteri + teknik kart + devere + " +
      "dokuma iş emri + tezgah izleme. Çoklu depo kapalı (tek depo).",
    moduller: acik(
      "production.enabled",
      "finance.enabled",
      "ticaret.enabled",
      "iplik.enabled",
      "kumasTeknik.enabled",
      "tezgah.enabled",
      "devere.enabled",
      "dokuma.enabled",
    ),
    bayraklar: {},
  },
  /**
   * HİZMET VEREN — fason işlemci (2026-10-29, DALGA2-HIZMET-TASARIM §7): müşterinin malını
   * işleyip geri gönderir. Gelen belge emanete bağlıdır (`MODULE_DEPENDENCIES`), emanet kapalı
   * olursa onay çıkışsız kapı olur. Ölçüm/faturalama ayarları profile GİRMEZ (ayar paketi betiği).
   * Maliyet (2026-10-31, kullanıcı kararı S2): makine saat ücreti · sarf normu · kârlılık bu modülde;
   * bağımlılığı (üretim) profilde açık. Profil yalnız TAZE kurulumda uygulanır — kurulu fabrika değişmez.
   */
  hizmet: {
    ad: "Hizmet veren (fason işlemci)",
    aciklama:
      "Üretim + ön muhasebe + ticaret (hizmet fiyatı · mal kabul) + emanet (müşterinin malı) + " +
      "gelen belge taslağı (irsaliye fotoğrafından giriş) + maliyet (makine saat ücreti · sarf normu · " +
      "kârlılık). Dokuma, tezgah izleme ve iplik kapalı.",
    moduller: acik(
      "production.enabled",
      "finance.enabled",
      "ticaret.enabled",
      "emanet.enabled",
      "gelenBelge.enabled",
      "maliyet.enabled",
    ),
    bayraklar: {},
  },
  tam: {
    ad: "Tam",
    aciklama: "Bütün modüller açık — demo ve iç test kurulumları.",
    // Maliyet de dahil (patron kararı 2026-10-24, MALIYET-TEKLIF-PLAN §8-3); lisans tavanı yine korur.
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
