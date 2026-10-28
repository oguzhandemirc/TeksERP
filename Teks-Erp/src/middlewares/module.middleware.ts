// =============================================================================
// MODÜL REJİM KAPILARI (ticaret · iplik · çoklu depo · üretim · dokuma · tezgah · kalite güvence · maliyet · gelen belge)
// =============================================================================
// `finance.middleware.ts`in birebir ikizi ve aynı gerekçeyle yazıldı: modül
// anahtarı bir GÖRÜNÜRLÜK ayarı DEĞİL, bir REJİM anahtarıdır. Menüyü gizlemek
// yetmez — adresi bilen (ya da eski sekmesi açık kalan) kullanıcı ekranı yine
// açar ve modül kapalıyken deftere satır yazılabilirdi.
//
// ⚠️ Bu kapılar `requirePermission`'ın YERİNE GEÇMEZ, ONA EKLENİR. İki ayrı
// soru: bayrak "bu kurulum bu modülü kullanıyor mu", izin "bu kişi bunu
// yapabilir mi".
//
// ⚠️ Okuma CACHE'SİZ (argümansız `readXEnabled()` → doğrudan DB): bayrak acil
// kapatma anahtarıdır (kk1 tuzağı emsali). Modül sahada yanlış davranırsa tek
// geri dönüş yolu onu kapatmaktır ve kapatmanın etkisi BİR SONRAKİ istekte
// görünmelidir. `getFeatureFlags`'in 30 sn'lik önbelleği yalnız panel yanıtına
// aittir, buraya HİÇ dokunmaz.
//
// ⚠️ JENERİK FABRİKA (`requireModule("ticaret")`) YASAK: iki bekçi kapı
// varlığını middleware'in ADIYLA ölçüyor — `test_feature_flag_contract §14`
// metin, `test_finance_regime_gate` AST identifier. Jenerik yazım her ikisini
// de kör bırakır (kapısız router "kapılı" görünür = yanlış YEŞİL).
//
// -----------------------------------------------------------------------------
// BİLİNÇLİ KAPISIZ (P1) — üretim kapısı bu yüzeylere TAKILMADI:
//   • /api/rolls              KARMA router: KK1 ham giriş motoru (`initial-entry`)
//                             ÇEKİRDEKTİR → router seviyesinde kapı YOK; kapı
//                             UÇ BAZLI: `/rolls/open-fabric` ve
//                             `/rolls/:id/kursun-finish` kapılı. Üretim
//                             KAPALIYKEN de `GET /api/rolls`, `initial-entry`,
//                             okuma uçları (`production-flow`,
//                             `subcontractor-summary`) ve kurtarma uçları
//                             (`rescue-stuck` — takılı topu depoya almanın tek
//                             yolu) AÇIK kalır.
//   • /api/stations · /api/machines · /api/work-sessions
//                             KK1 ve sevk istasyonu da kullanıyor (istasyon/
//                             makine damgası, vardiya oturumu) — çekirdek.
//   • /api/subcontractor*     Fasonun kendi anahtarı (`modul.fason`) Dilim 1
//                             dışında; üretime asmak yanlış modülü kapatırdı.
//   • /api/kartela · /api/swatches
//                             Kartela ayrı bir modül (`modul.kartela`), WO'suz
//                             akış — üretim kapısına girmez.
//   • /api/defect-types · /api/quality-grades · /api/fabric-properties ·
//     /api/reason-presets · /api/labels · /api/label-templates
//                             Ortak katalog ve baskı yüzeyleri; sevk/depo/
//                             kartela yolları da okur.
//   • /api/traveler-templates BELGE tasarımı yüzeyi (`document-template:*`),
//                             üretim değil — kartın KENDİSİ kapılıdır.
//   • /api/reports · /api/dashboard
//                             Karma rapor (sevk + üretim + stok); uç bazlı
//                             ayrım sonraki pakette.
// Bu liste bekçinin (`test_production_regime_gate`) beklenti listesiyle
// BİREBİR olmalı — ayrışırsa ya kapı sessizce düşer ya bekçi ölü satır sayar.
//
// LİSANS TAVANI: okuyucu `readX = readXRaw ∧ tavan`; kapalıyken önce lisansa sorulur —
// modülü lisans kapatıyorsa 403 `LICENSE_MODULE` (bayrak DB'de açık olsa da), yoksa
// `MODULE_DISABLED` (`test_lisans_modul_tavani` her kapıda anahtar eşini ölçer).
// =============================================================================
import { Request, Response, NextFunction } from "express";
import {
  SETTING_KEYS,
  readDepoMultiEnabled,
  readDevereEnabled,
  readDokumaEnabled,
  readEmanetEnabled,
  readGelenBelgeEnabled,
  readIplikEnabled,
  readKaliteGuvenceEnabled,
  readMaliyetEnabled,
  readProductionEnabled,
  readTezgahEnabled,
  readTicaretEnabled,
} from "../services/system-setting.service";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";

/**
 * 403 gövdesi: `{ success:false, message, details:{ code, modul } }`.
 *
 * ⚠️ `code` TOP-LEVEL DEĞİL — `error.middleware.ts` `details` altına basar ve
 * istemcilerin bugünkü okuma kalıbı da `e?.details?.code`. Bekçi/istemci
 * `body.code` ararsa sessizce hep `undefined` okur (sahte yeşil).
 */
function modulKapali(modul: string, ad: string): AppError {
  // 403 (404 değil): kaynak VAR, bu kurulumda kapalı. 404 dönmek destek
  // ekibini "uç deploy edilmemiş" diye yanlış yöne gönderirdi.
  return AppError.forbidden(
    `${ad} modülü bu kurulumda kapalı. ${settingScreenPath("modules")} ekranından açılabilir.`,
    { code: "MODULE_DISABLED", modul },
  );
}

/** Ticaret modülü: alış siparişi · mal kabul · fiyat listeleri · stok sayımı. */
export async function requireTicaretEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await readTicaretEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.TICARET_ENABLED, "Ticaret") ?? modulKapali("ticaret", "Ticaret");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * İplik modülü: `YarnStock`/`YarnMovement` kg defteri.
 *
 * ⚠️ BAĞIMLILIK ÖNCE ÖLÇÜLÜR (`MODULE_DEPENDENCIES.iplikEnabled = ticaretEnabled`):
 * iplik ticaret paketinin parçasıdır. Yazma yolu tutarsız çiftin DOĞMASINI
 * engeller (`setFeatureFlags` 400), burası ise zaten var olan tutarsız bir
 * çifte karşı ikinci hattır (elle SQL · eski dump · ham ayar ucu). Mesaj
 * EKSİK OLANI söyler — "iplik kapalı" demek operatörü yanlış anahtara gönderir.
 */
export async function requireIplikEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ticaret = await readTicaretEnabled();
    if (!ticaret) {
      throw licenseModuleError(SETTING_KEYS.TICARET_ENABLED, "Ticaret") ?? AppError.forbidden(
        "İplik modülü Ticaret modülüne bağlıdır; Ticaret modülü bu kurulumda kapalı. " +
          `${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "ticaret", dependent: "iplik" },
      );
    }
    const enabled = await readIplikEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.IPLIK_ENABLED, "İplik") ?? modulKapali("iplik", "İplik");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Devere / levent modülü: çözgü kartı · levent stoğu · levent olay defteri.
 *
 * ⚠️ YALNIZ DEVERE OKUR (1e K3 hükmü 2026-09-14, DEVERE-LEVENT §9.7d): devere modülü iplik/ticarete
 * BAĞLI DEĞİLDİR — hazır ya da fasona sardırılmış levent iplik tüketmez, "iplik KAPALI + devere
 * AÇIK" kurulumu meşrudur. İplik kapısı AKSİYON ANINDA koşar: içeride sarım (`WARP_ISSUE` yazan
 * tek yol) `applyYarnMovementTx`in içindeki `readIplikEnabled` ile 403 MODULE_DISABLED(iplik) alır;
 * fason/hazır alım sarımı iplik defterine hiç dokunmaz. Ölçen: `test_devere_regime_gate §2/§4`,
 * `test_warp_beam_lifecycle §10`.
 */
export async function requireDevereEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await readDevereEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere / levent") ?? modulKapali("devere", "Devere / levent");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** Çoklu depo modülü: depolar arası transfer yüzeyi. */
export async function requireDepoMultiEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await readDepoMultiEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.DEPO_MULTI_ENABLED, "Çoklu depo") ?? modulKapali("depoMulti", "Çoklu depo");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Üretim modülü: rota · reçete · iş emri · kurşun/tambur · parti · refakat kartı.
 *
 * ⚠️ VARSAYILAN AÇIK (`readProductionEnabled` satır yoksa `true` döner) — bu
 * kapı damgası olmayan bir kopyada (eski dump, dev DB) fabrikayı üretimsiz
 * bırakmaz. Ad `requireProductionEnabled`: alan adı `productionEnabled` ve
 * bekçi `REGIME_GATES` bu adı zaten yazıyordu; TR/EN karışımı bir çift
 * (`production.enabled` ↔ `requireUretimEnabled`) üretmemek için hizalandı.
 */
export async function requireProductionEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await readProductionEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim") ?? modulKapali("production", "Üretim");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Dokuma işi modülü: dokuma işi (`WeavingOrder`) · tezgah koşumu · top indirme.
 *
 * ⚠️ ÖN KOŞUL ÖNCE ÖLÇÜLÜR (`MODULE_DEPENDENCIES.dokumaEnabled = productionEnabled`):
 * dokuma üretimin alt yüzeyidir, tezgah izlemenin KARDEŞİ (çocuğu değil). Yazma
 * yolu tutarsız çiftin doğmasını engeller (`setFeatureFlags` 400); burası elle
 * SQL / eski dump / yarım profil kaynaklı bir çifte karşı ikinci hattır. Mesaj
 * EKSİK OLANI söyler (iplik kapısının dersi).
 */
export async function requireDokumaEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const production = await readProductionEnabled();
    if (!production) {
      throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim") ?? AppError.forbidden(
        "Dokuma iş emri modülü Üretim modülüne bağlıdır; Üretim modülü bu kurulumda kapalı. " +
          `${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "production", dependent: "dokuma" },
      );
    }
    const enabled = await readDokumaEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.DOKUMA_ENABLED, "Dokuma iş emri") ?? modulKapali("dokuma", "Dokuma iş emri");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Maliyet & Teklif modülü: ürün maliyeti · standart maliyet · satış teklifi · fiyat listesi ·
 * iplik ihtiyaç planı (MALIYET-TEKLIF-PLAN; uçlar MAL-1… dilimlerinde bu kapıya takılır).
 *
 * ⚠️ ÖN KOŞUL ÖNCE ÖLÇÜLÜR (`MODULE_DEPENDENCIES.maliyetEnabled = productionEnabled`):
 * iplik ihtiyaç planı üretim dengesini okur. Mesaj EKSİK OLANI söyler (iplik kapısının dersi).
 */
export async function requireMaliyetEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const production = await readProductionEnabled();
    if (!production) {
      throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim") ?? AppError.forbidden(
        "Maliyet & Teklif modülü Üretim modülüne bağlıdır; Üretim modülü bu kurulumda kapalı. " +
          `${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "production", dependent: "maliyet" },
      );
    }
    const enabled = await readMaliyetEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.MALIYET_ENABLED, "Maliyet & Teklif") ?? modulKapali("maliyet", "Maliyet & Teklif");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Gelen belge taslağı modülü (Gülkesim OCR, D1): müşteri irsaliyesi/çeki listesi fotoğrafı → OCR
 * taslak → panelde gözden geçirme → onayla emanet top girişi (uçlar D2+ dilimlerinde bu kapıya takılır).
 *
 * ⚠️ ÖN KOŞUL ÖNCE ÖLÇÜLÜR (`MODULE_DEPENDENCIES.gelenBelgeEnabled = emanetEnabled`): onay
 * `Roll.ownerCustomerId` yazar, o alan emanet kapalıyken yazılamaz. Mesaj EKSİK OLANI söyler.
 */
export async function requireGelenBelgeEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const emanet = await readEmanetEnabled();
    if (!emanet) {
      throw licenseModuleError(SETTING_KEYS.EMANET_ENABLED, "Emanet / konsinye mülkiyet") ?? AppError.forbidden(
        "Gelen belge taslağı modülü Emanet / konsinye mülkiyet modülüne bağlıdır; Emanet / konsinye mülkiyet modülü bu kurulumda kapalı. " +
          `${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "emanet", dependent: "gelenBelge" },
      );
    }
    const enabled = await readGelenBelgeEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.GELEN_BELGE_ENABLED, "Gelen belge taslağı") ?? modulKapali("gelenBelge", "Gelen belge taslağı");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Tezgah izleme modülü: Tezgah Salonu canlı ekranı (`/api/loom-floor`).
 *
 * ⚠️ ÖN KOŞUL ÖNCE ÖLÇÜLÜR (`MODULE_DEPENDENCIES.tezgahEnabled = productionEnabled`);
 * dokuma işi modülünün KARDEŞİDİR, çocuğu değil — `dokumaEnabled` burada sorulmaz
 * (izlemesiz dokuma da satılır; ekranın dokuma blokları ayrıca dokuma bayrağına bakar).
 */
export async function requireTezgahEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const production = await readProductionEnabled();
    if (!production) {
      throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim") ?? AppError.forbidden(
        "Tezgah izleme modülü Üretim modülüne bağlıdır; Üretim modülü bu kurulumda kapalı. " +
          `${settingScreenPath("modules")} ekranından açılabilir.`,
        { code: "MODULE_DISABLED", modul: "production", dependent: "tezgah" },
      );
    }
    const enabled = await readTezgahEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.TEZGAH_ENABLED, "Tezgah izleme") ?? modulKapali("tezgah", "Tezgah izleme");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Kalite Güvence modülü (K4P): 4 puan muayene · kural setleri · lab testleri · sertifikalar.
 *
 * Ön koşul YOK (`MODULE_DEPENDENCIES` satırı bilerek yazılmadı): muayene KK1'de doğar ve
 * KK1 üretim kapalıyken de açıktır — üretime bağlamak üretimsiz kurulumda muayeneyi kapatırdı.
 */
export async function requireKaliteGuvenceEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const enabled = await readKaliteGuvenceEnabled();
    if (!enabled) {
      throw licenseModuleError(SETTING_KEYS.KALITE_GUVENCE_ENABLED, "Kalite Güvence") ?? modulKapali("kaliteGuvence", "Kalite Güvence");
    }
    next();
  } catch (e) {
    next(e);
  }
}
