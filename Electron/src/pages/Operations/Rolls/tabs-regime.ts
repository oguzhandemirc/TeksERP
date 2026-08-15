// =============================================================================
// ENVANTER SEKMELERİ — TİCARET REJİMİ SÜZGECİ (saf katman)
// =============================================================================
// Alım-satım firması üretim YAPMIYOR: "Üretimde · Üretim Akışı · Fasonda ·
// Kurşun Bekleyen · Tambur Bekleyen" sekmeleri o kurulumda TANIM GEREĞİ boş
// ve kullanıcı "neden hep boş" diye onlara tıklamaya devam ediyor. Rejimde
// süzülürler.
//
// ⚠️ `STATUS_GROUPS` ANAHTARLARI SİLİNMEZ (ARCHIVE emsali, 2026-08-05):
// anahtar `service.ts`te kalır, yalnız SEKME gizlenir. Silmek, o statü
// kümesinin tek kaynağını yok eder ve `RollStatusTabKey` union'ını bozar.
//
// ⚠️ SÜZGEÇ SAF: bileşenin içinde bir `filter` olarak kalsaydı hem komut
// paleti (`?tab=` derin bağlantıları) hem "Envanter Özeti" indirmesi kendi
// listesini kurardı ve üçü zamanla ayrışırdı — palette görünen sekme sayfada
// olmayabilirdi.
// =============================================================================
import { ROLL_TABS, type RollTabDef, type RollTabKey } from "./tabs-config";

/**
 * Ticaret rejiminde GİZLENEN sekmeler — hepsi bir üretim adımına bakar.
 *
 * ⚠️ "Çuvalda" LİSTEDE DEĞİL ve bu bilinçli: çuval ticaret kurulumunda da
 * gerçek bir depo nesnesidir (Hızlı Sevk onu kullanıcıdan gizler ama fiziksel
 * çuvalla çalışan da olabilir) ve o sekme "sevke hazırlanan mal" sorusunu
 * cevaplıyor — üretim sorusu değil.
 */
const PRODUCTION_ONLY_TABS: RollTabKey[] = [
  "PRODUCTION",
  "KANBAN",
  "SUBCONTRACTOR",
  "KURSUN_PENDING",
  "TAMBUR_PENDING",
];

/**
 * Ticarette "Bitmiş Depo" adı YANLIŞ: bir şey ÜRETİLİP bitmedi, mal satın
 * alınıp depoya girdi. Etiket değişir, anahtar (`FINISHED_STOCK`) DEĞİŞMEZ —
 * anahtar URL'de, kayıtlı sekme sırasında ve komut paletinde yaşıyor.
 */
const TRADE_LABELS: Partial<Record<RollTabKey, string>> = {
  FINISHED_STOCK: "Depo",
  RAW_STOCK: "Yeni Giren",
};

/**
 * Rejime göre sekme listesi — TEK KAYNAK (şerit · palet · özet indirmesi).
 *
 * ⚠️ YÜKLEM `productionEnabled`'DIR, `financeEnabled` DEĞİL (2026-08-14 saha
 * bildirimi). Önceki hâli "muhasebe açıksa üretim sekmelerini gizle" diyordu ve
 * bu, ön muhasebeyi açan bir FABRİKANIN üretim sekmelerini sessizce
 * kaybetmesine yol açıyordu. İki soru ayrıdır ve ikisi de aynı anda EVET
 * olabilir: "muhasebe tutuyor muyum" · "üretim yapıyor muyum".
 *
 * `financeEnabled` yalnız ETİKETLERİ etkiler: ticaret kurulumunda bir şey
 * üretilip bitmediği için "Bitmiş Depo" adı yanlıştır.
 */
export function resolveRollTabs(
  productionEnabled: boolean,
  financeEnabled = false,
): RollTabDef[] {
  const base = productionEnabled
    ? ROLL_TABS
    : ROLL_TABS.filter((t) => !PRODUCTION_ONLY_TABS.includes(t.key));
  if (!financeEnabled) return base;
  return base.map((t) =>
    TRADE_LABELS[t.key] ? { ...t, label: TRADE_LABELS[t.key] as string } : t,
  );
}

/**
 * TEK sekmenin rejime göre çözülmüş adı — Envanter DIŞINDAKİ ekranlar için.
 *
 * ⚠️⚠️ ENVANTER SEKMESİNE YÖNLENDİREN HER CÜMLE BURADAN GEÇMELİ, adı elle
 * YAZMAMALI. 2026-08-15'te tam bu oldu: Mal Kabul'ün başarı toast'ı ve fiş
 * detayındaki "Ham stok" rozeti sekme adlarını sabit yazıyordu ("Bitmiş Depo" /
 * "Ham Stok"), oysa Mal Kabul ekranı YALNIZ ticaret kurulumunda çıkıyor ve o
 * kurulumda `financeEnabled` AÇIK olduğu için şeritte "Depo" / "Yeni Giren"
 * yazıyor. Yani kullanıcıyı OLMAYAN bir sekmeye gönderiyorduk — hem de tam
 * olarak o cümlenin çözmek için yazıldığı şikâyeti ("malı bulamıyorum") yeniden
 * üreterek.
 *
 * `productionEnabled` bilerek SORULMAZ: bu iki sekme (RAW_STOCK/FINISHED_STOCK)
 * üretim süzgecinin dışındadır ve her rejimde çizilir. Yine de liste bir gün
 * değişirse yer tutucuya düşmek yerine ham etikete düşülür (yönlendirme cümlesi
 * "undefined" basmamalı).
 */
export function rollTabLabel(key: RollTabKey, financeEnabled: boolean): string {
  const fromRegime = resolveRollTabs(true, financeEnabled).find((t) => t.key === key);
  if (fromRegime) return fromRegime.label;
  return ROLL_TABS.find((t) => t.key === key)?.label ?? key;
}

/** Komut paleti girişinin anahtar ön eki — palet ve sayfa AYNI kuralı okusun. */
export const ROLL_TAB_ENTRY_PREFIX = "rolls-tab:";

/**
 * Komut paletindeki `Envanter · <sekme>` girişi görünür mü?
 *
 * ⚠️ Paletin girişleri MODÜL YÜKLEME ANINDA kuruluyor (statik dizi), yani
 * bayrağı oraya enjekte etmek mümkün değil — süzgeç render anında uygulanır.
 * Uygulanmazsa palet, sayfada OLMAYAN bir sekmeye derin bağlantı verir ve
 * tıklayan kullanıcı sessizce başka bir sekmede açılır (tabs-config.ts'in
 * başındaki uyarının tam olarak anlattığı arıza).
 *
 * Roll sekmesi olmayan girişler bu süzgeçten ETKİLENMEZ.
 */
export function isRollTabEntryVisible(entryKey: string, productionEnabled: boolean): boolean {
  if (!entryKey.startsWith(ROLL_TAB_ENTRY_PREFIX)) return true;
  const tabKey = entryKey.slice(ROLL_TAB_ENTRY_PREFIX.length);
  return resolveRollTabs(productionEnabled).some((t) => t.key === tabKey);
}
