// =============================================================================
// MODÜL REJİM KAPILARI (ticaret · iplik · çoklu depo · üretim)
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
//                             ÇEKİRDEKTİR, aynı dosyada kurşun uçları da var.
//                             Router seviyesinde kapı KK1'i öldürür → uç bazlı
//                             karar sonraki pakete bırakıldı.
//                             ⚠️ SONUCU AÇIKÇA YAZIYORUZ (ölçüldü 2026-09-02):
//                             üretim KAPALIYKEN de `GET /api/rolls`,
//                             `POST /api/rolls/initial-entry`,
//                             `/rolls/open-fabric`, `/rolls/:id/kursun-finish`,
//                             `/rolls/production-flow` ve
//                             `/rolls/subcontractor-summary` AÇIK kalır; yani
//                             "üretim modülü kapalı" bugün bu router için
//                             GEÇERLİ DEĞİLDİR. "Karma router" demek eksik bir
//                             cümleydi — okuyan kişi kapının orada da işlediğini
//                             sanabilirdi.
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
// =============================================================================
import { Request, Response, NextFunction } from "express";
import {
  readDepoMultiEnabled,
  readDevereEnabled,
  readDokumaEnabled,
  readIplikEnabled,
  readProductionEnabled,
  readTicaretEnabled,
} from "../services/system-setting.service";
import { AppError } from "../utils/app-error";

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
    `${ad} modülü bu kurulumda kapalı. Genel Ayarlar → Modüller bölümünden açılabilir.`,
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
      throw modulKapali("ticaret", "Ticaret");
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
      throw AppError.forbidden(
        "İplik modülü Ticaret modülüne bağlıdır; Ticaret modülü bu kurulumda kapalı. " +
          "Genel Ayarlar → Modüller bölümünden açılabilir.",
        { code: "MODULE_DISABLED", modul: "ticaret", dependent: "iplik" },
      );
    }
    const enabled = await readIplikEnabled();
    if (!enabled) {
      throw modulKapali("iplik", "İplik");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Devere / levent modülü: çözgü kartı · levent stoğu · levent olay defteri.
 *
 * ⚠️ ZİNCİR ELLE ÖLÇÜLÜR (ticaret → iplik → devere): `MODULE_DEPENDENCIES` tek
 * ön koşul taşır ve geçişli kapanış ÜRETMEZ. `requireIplikEnabled` iki seviye
 * ölçüyor; devere üç. Zincir ölçülmezse "ticaret kapalı + iplik açık + devere
 * açık" gibi (elle SQL / eski dump / yarım profil kaynaklı) tutarsız bir
 * kurulumda levent doğarken yazılacak `WARP_ISSUE` hareketi kapısız kalırdı.
 *
 * ⚠️ Mesaj EKSİK OLANI söyler ve EN DIŞTAKİNDEN başlar — operatörü "iplik
 * kapalı" diye yanlış anahtara göndermemek için (iplik kapısının dersi).
 */
export async function requireDevereEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ticaret = await readTicaretEnabled();
    if (!ticaret) {
      throw AppError.forbidden(
        "Devere modülü İplik modülüne, o da Ticaret modülüne bağlıdır; Ticaret modülü bu kurulumda kapalı. " +
          "Sistem → Modüller bölümünden açılabilir.",
        { code: "MODULE_DISABLED", modul: "ticaret", dependent: "devere" },
      );
    }
    const iplik = await readIplikEnabled();
    if (!iplik) {
      throw AppError.forbidden(
        "Devere modülü İplik modülüne bağlıdır; İplik modülü bu kurulumda kapalı. " +
          "Sistem → Modüller bölümünden açılabilir.",
        { code: "MODULE_DISABLED", modul: "iplik", dependent: "devere" },
      );
    }
    const enabled = await readDevereEnabled();
    if (!enabled) {
      throw modulKapali("devere", "Devere / levent");
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
      throw modulKapali("depoMulti", "Çoklu depo");
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
      throw modulKapali("production", "Üretim");
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
      throw AppError.forbidden(
        "Dokuma işi modülü Üretim modülüne bağlıdır; Üretim modülü bu kurulumda kapalı. " +
          "Sistem → Modüller bölümünden açılabilir.",
        { code: "MODULE_DISABLED", modul: "production", dependent: "dokuma" },
      );
    }
    const enabled = await readDokumaEnabled();
    if (!enabled) {
      throw modulKapali("dokuma", "Dokuma işi");
    }
    next();
  } catch (e) {
    next(e);
  }
}
