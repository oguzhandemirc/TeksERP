// =============================================================================
// TeksERP - System Setting / modules
// =============================================================================
// Modül anahtarı okuyucuları (Raw + lisans tavanlı) · devere/dokuma · rapor kapıları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { applyModuleCeiling } from "../../lib/license/module-ceiling";
import { asBoolean, asNumber } from "./core";
import { DEFAULT_DOKUMA_ROLL_BIRTH, DOKUMA_ROLL_BIRTH_MODES, type DokumaRollBirth } from "./defaults";
import { SETTING_KEYS } from "./keys";


/**
 * Üretim modülü açık mı. ⚠️ VARSAYILAN **TRUE** — ayar satırı yoksa fabrika
 * bugünkü davranışını aynen sürdürür. Diğer bayraklar varsayılan KAPALI
 * olduğu için bu tersliği bilerek yazıyoruz: burada "kapalı" demek, kurulmuş
 * bir fabrikanın üretim ekranlarını yok etmek olurdu.
 */
export async function readProductionEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.PRODUCTION_ENABLED },
    select: { value: true },
  });
  // ⚠️ SATIR-YOK SİGORTASI — SADELEŞTİRME (`asBoolean`a çevirme) YASAK.
  // 2026-09-02 grandfathering damgasından sonra canlıda satır HEP var, yani bu
  // dal orada bir daha ÖLÇÜLMEZ; ama damgası olmayan her kopyada (eski dump,
  // geliştirici DB'si, damganın "geçmişi olan kurulum" koşulunun elediği taze
  // kurulum) tek ayakta duran şey budur. `requireProductionEnabled` artık
  // gerçek bir route kapısı olduğu için burayı `false`a çevirmek, üretim
  // modülünün TAMAMINI (tabletler dahil) sessizce kapatır.
  if (!setting) return true;
  return setting.value === true || setting.value === "true";
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readProductionEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readProductionEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.PRODUCTION_ENABLED, await readProductionEnabledRaw(tx));
}

/**
 * Ticaret modülü açık mı? Default FALSE.
 *
 * ⚠️ GÖRÜNÜRLÜK değil REJİM anahtarı: kapalıyken menü satırı çizilmez, route
 * 403 verir (`requireTicaretEnabled`) ve ticari kancalar no-op olur.
 * ⚠️ Okuma CACHE'SİZ (`module.middleware.ts` argümansız çağırır) — acil
 * kapatma yolu. Mevcut kurulumdaki değeri migration DAMGALAR (20260902230000);
 * aşağıdaki varsayılan yalnız satır-yok sigortasıdır.
 */
export async function readTicaretEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TICARET_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readTicaretEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readTicaretEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.TICARET_ENABLED, await readTicaretEnabledRaw(tx));
}

/**
 * İplik modülü açık mı? Default FALSE. HAM değer döner.
 *
 * ⚠️ ETKİN DEĞER BURADA ÇÖZÜLMEZ: iplik ticarete bağımlıdır ve "ticaret &&
 * iplik" birleşimi TEK yerde — `requireIplikEnabled` kapısında — yapılır.
 * Burada da çözülseydi panel toggle'ı kendi yazdığını geri okuyamaz, kullanıcı
 * ipliği açar ve anahtar kapalı görünmeye devam ederdi.
 */
export async function readIplikEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.IPLIK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readIplikEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readIplikEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.IPLIK_ENABLED, await readIplikEnabledRaw(tx));
}

/** İplik YÜZEYİ açık mı: zincir (ticaret → iplik, `MODULE_DEPENDENCIES`) TEK yerde — iplik verisini gösteren okuma
 *  yüzeyleri bunu sorar (`requireIplikEnabled` aynı iki seviyeyi hangi modülün kapalı olduğunu söylemek için ayrı ölçer). */
export async function readIplikSurfaceEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return (await readTicaretEnabled(tx)) && (await readIplikEnabled(tx));
}

/**
 * Çoklu depo modülü açık mı? Default FALSE.
 *
 * ⚠️ Bu anahtar 2026-09-02'de bir VERİ TÜREVİNİN (panelde aktif depo sayısı >
 * 1) yerine geçti; mevcut kurulumun değeri o türev ÖLÇÜLEREK damgalandı.
 * Bundan sonra ikinci depoyu açmak yüzeyleri kendiliğinden AÇMAZ — bilinçli
 * bir davranış değişikliği (bkz. migration 20260902230000 başlığı).
 */
export async function readDepoMultiEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEPO_MULTI_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readDepoMultiEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readDepoMultiEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.DEPO_MULTI_ENABLED, await readDepoMultiEnabledRaw(tx));
}

/** Kumaş teknik kartı modülü açık mı? Default FALSE. YER TUTUCU — arkasında
 *  henüz yüzey yok, bu yüzden middleware'i de YAZILMADI (ölü kapı yazmıyoruz). */
export async function readKumasTeknikEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KUMAS_TEKNIK_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readKumasTeknikEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readKumasTeknikEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.KUMAS_TEKNIK_ENABLED, await readKumasTeknikEnabledRaw(tx));
}

/** Dokuma tezgah izleme modülü açık mı? Default FALSE. YER TUTUCU (üretime bağımlı). */
export async function readTezgahEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.TEZGAH_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readTezgahEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readTezgahEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.TEZGAH_ENABLED, await readTezgahEnabledRaw(tx));
}

/** Devere / levent modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü
 *  davranış: devere yoktu). HAM değer döner; zinciri (ticaret → iplik → devere)
 *  `requireDevereEnabled` ölçer. */
export async function readDevereEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVERE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readDevereEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readDevereEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.DEVERE_ENABLED, await readDevereEnabledRaw(tx));
}

/** G3 Emanet / konsinye mülkiyet modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü davranış:
 *  sahiplik alanı yoktu). Bağımlılık yok; owner yazan uçların gövde kapısı bunu okur. */
export async function readEmanetEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.EMANET_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readEmanetEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readEmanetEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.EMANET_ENABLED, await readEmanetEnabledRaw(tx));
}

/** K4P Kalite Güvence modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü davranış: muayene/lab/sertifika
 *  yüzeyi yoktu). Bağımlılık yok. */
export async function readKaliteGuvenceEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KALITE_GUVENCE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readKaliteGuvenceEnabledRaw` yalnız panel geri-okuması
 *  ve bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readKaliteGuvenceEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.KALITE_GUVENCE_ENABLED, await readKaliteGuvenceEnabledRaw(tx));
}

/** Devere Faz 2: lot zorunlu mu? Default FALSE (satır yoksa lotsuz satır yazılır, yalnız
 *  uyarı — bugünkü davranış). Enforcement reader: cache'siz, aksiyon anında okunur. */
export async function readDevereLotRequired(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Devere Faz 3: tezgah bağı defteri açık mı? Default FALSE (satır yoksa levent READY'de kalır — bugünkü davranış).
 *  Enforcement reader: cache'siz, aksiyon anında. */
export async function readDevereMountTracking(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_MOUNT_TRACKING }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Devere Faz 3: bağlamada yöntem + başlangıç zorunlu mu? Default FALSE. */
export async function readDevereMountTrackingRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_MOUNT_TRACKING_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Devere Faz 4: tezgahtan doğan top leventten OTOMATİK tüketim düşer mi? Default FALSE (satır yoksa elle — bugünkü davranış). */
export async function readDevereAutoConsume(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_AUTO_CONSUME }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Z1: levent sarımında dokuma işi bağı zorunlu mu? Default FALSE (serbest levent meşru — bugünkü davranış). HAM değer. */
export async function readDevereBeamWeavingLinkRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_BEAM_WEAVING_LINK_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Z1: tezgah koşumu dokuma işine bağlı açılmalı mı? Default FALSE (stoka dokuma meşru — bugünkü davranış). HAM değer. */
export async function readDokumaRunWeavingOrderRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Z1: dokuma işi en az bir sipariş satırına bağlı olmalı mı? Default FALSE (stoka dokuma meşru). HAM değer. */
export async function readDokumaOrderLineLinkRequired(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_ORDER_LINE_LINK_REQUIRED }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** S1: top doğuş yolu — satır yok / çöp → `TABLET_DOFF` (bugünkü davranış; `includes` sigortası). HAM değer. */
export async function readDokumaRollBirth(tx?: Pick<typeof prisma, "systemSetting">): Promise<DokumaRollBirth> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_ROLL_BIRTH }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && DOKUMA_ROLL_BIRTH_MODES.includes(v as DokumaRollBirth) ? (v as DokumaRollBirth) : DEFAULT_DOKUMA_ROLL_BIRTH;
}

/** Dokuma firesi % — varsayılan 0 (bugünkü davranış: ham ihtiyaç yalnız çekmeyle büyür); üst sınır dahil. */
export const DEFAULT_DOKUMA_WEAVING_WASTE_PCT = 0;
export const DOKUMA_WEAVING_WASTE_PCT_MAX = 50;
/** Dokuma firesi HAM değer — satır yok / çöp / aralık dışı → 0 (çarpan uygulanmaz, sessiz büyütme yok). */
export async function readDokumaWeavingWastePct(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const setting = await (tx ?? prisma).systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_WEAVING_WASTE_PCT }, select: { value: true } });
  if (!setting) return DEFAULT_DOKUMA_WEAVING_WASTE_PCT;
  const n = asNumber(setting.value);
  return n === null || !Number.isFinite(n) || n < 0 || n > DOKUMA_WEAVING_WASTE_PCT_MAX ? DEFAULT_DOKUMA_WEAVING_WASTE_PCT : n;
}

/** Dokuma işi modülü açık mı? Default FALSE (satır yoksa kapalı — dünkü davranış:
 *  fabrika dokumuyor, kumaş hazır geliyor). HAM değer döner; ön koşulu (production)
 *  `requireDokumaEnabled` ölçer. */
/**
 * Rapor görünürlük listesinin ÜÇ SONUÇLU okuması.
 *
 * ⚠️ İKİ SONUÇ YETMEZ (`uc-sonuc-iki-degil`): "liste boş" ile "listeyi OKUYAMADIM" aynı
 * şey değildir. İkisini de boş diziye çevirmek, bozuk/elle düzenlenmiş bir satırda
 * KAPALI raporları sessizce AÇARDI — kapının çözdüğünden büyük bir arıza.
 *
 * ⚠️ SATIR YOK ⇒ `okundu` + boş liste (ölçüm var, sonuç "hiçbiri kapalı değil").
 *    DEĞER dizi-of-string DEĞİL ⇒ `olculemedi` (kapı fail-closed 403 verir).
 * ⚠️ Okuma CACHE'SİZ, modül kapılarının kalıbı: görünürlük acil kapatma anahtarıdır ve
 *    kapatmanın etkisi BİR SONRAKİ istekte görünmelidir. `getFeatureFlags`in 30 sn'lik
 *    önbelleği yalnız panel yanıtına aittir, buraya hiç dokunmaz.
 */
export type ReportsClosedKeysRead =
  | { durum: "okundu"; kapali: string[] }
  | { durum: "olculemedi"; neden: string };

export async function readReportsClosedKeys(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<ReportsClosedKeysRead> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.REPORTS_CLOSED_KEYS },
    select: { value: true },
  });
  if (!setting) return { durum: "okundu", kapali: [] };
  const ham = setting.value;
  if (!Array.isArray(ham)) {
    return { durum: "olculemedi", neden: `beklenen JSON dizi, gelen ${typeof ham}` };
  }
  if (!ham.every((x): x is string => typeof x === "string")) {
    return { durum: "olculemedi", neden: "dizinin her ögesi string olmalı" };
  }
  return { durum: "okundu", kapali: ham };
}

/** Yeni rapor merkezi (Raporlar v2) açık mı? Default false (bugün: eski rapor menüsü). */
export async function readReportsV2Enabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.REPORTS_V2_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export async function readDokumaEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DOKUMA_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readDokumaEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readDokumaEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.DOKUMA_ENABLED, await readDokumaEnabledRaw(tx));
}

/** Maliyet & Teklif modülü açık mı? Default FALSE (satır yoksa kapalı — modül sıfırdan doğdu).
 *  HAM değer döner; ön koşulu (production) `requireMaliyetEnabled` ölçer. */
export async function readMaliyetEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.MALIYET_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readMaliyetEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readMaliyetEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.MALIYET_ENABLED, await readMaliyetEnabledRaw(tx));
}

/** Gelen belge taslağı (OCR) modülü açık mı? Default FALSE (satır yoksa kapalı — modül sıfırdan doğdu).
 *  HAM değer döner; ön koşulu (emanet) `requireGelenBelgeEnabled` ölçer. */
export async function readGelenBelgeEnabledRaw(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_ENABLED },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}
