// =============================================================================
// AUDIT İSİM ÇEKİMLERİ — anlatıcının kayıt adları (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// audit `tableName` → kaydın cümle içi adının TAMLAMA (izafet) çekimleri: "SP-2026-0148
// siparişinin", "T12 topunu". Hâl eki NUMARAYA değil İSME gelir; kesme/ünlü uyumu derdi
// doğmaz. İş emri adları `TERIM`den (eski ad yasağı `test_terim_eski_ad`).
// Burada olmayan tablo yedek cümleye düşer ("… <Modül> kaydını …") — fail-open.
// =============================================================================

import { TERIM, type TermCases } from "./terim";

/** Ünsüzle biten, -ı/-i/-u/-ü iyelikli isim: kök + iyelik ünlüsü + ek ünlüleri. */
function iyelik(kok: string, i: string, a: "a" | "e", ki: string): TermCases {
  // kok "sipariş", i "i", a "e", ki "i" → siparişi / siparişini / siparişine …
  const ip = `${kok}${i}`;
  const d = a === "a" ? "da" : "de";
  const dn = a === "a" ? "dan" : "den";
  const yla = a === "a" ? "yla" : "yle";
  return {
    yalin: ip,
    belirtme: `${ip}n${ki}`,
    yonelme: `${ip}n${a}`,
    bulunma: `${ip}n${d}`,
    ayrilma: `${ip}n${dn}`,
    ilgi: `${ip}n${ki}n`,
    vasita: `${ip}${yla}`,
  };
}

/** Ünlüyle biten isim: kök + "s" + iyelik ("şube" → şubesi / şubesini / şubesine …). */
function sIyelik(kok: string, i: string, a: "a" | "e"): TermCases {
  return iyelik(`${kok}s`, i, a, i);
}

/** "<ön> kaydı" — sayısı/adı olan ama özel ismi olmayan kayıtlar için. */
function onEkli(on: string, c: TermCases): TermCases {
  return {
    yalin: `${on} ${c.yalin}`, belirtme: `${on} ${c.belirtme}`, yonelme: `${on} ${c.yonelme}`,
    bulunma: `${on} ${c.bulunma}`, ayrilma: `${on} ${c.ayrilma}`, ilgi: `${on} ${c.ilgi}`, vasita: `${on} ${c.vasita}`,
  };
}

const SIPARIS = iyelik("sipariş", "i", "e", "i");
const RECORD_TERM = iyelik("kayd", "ı", "a", "ı");
const SEVK = iyelik("sevk", "i", "e", "i");

/** tableName → cümle içi ad çekimleri (tamlama biçimi). */
export const AUDIT_ISIMLERI: Readonly<Record<string, TermCases>> = {
  ORDER: SIPARIS,
  PURCHASE_ORDER: onEkli("alış", SIPARIS),
  ROLL: iyelik("top", "u", "a", "u"),
  WORK_ORDER: TERIM.terbiyeIsEmri.cekimKucuk,
  WEAVING_ORDER: TERIM.dokumaIsEmri.cekimKucuk,
  SHIPMENT: iyelik("sevkiyat", "ı", "a", "ı"),
  SACK: iyelik("çuval", "ı", "a", "ı"),
  BATCH: { yalin: "partisi", belirtme: "partisini", yonelme: "partisine", bulunma: "partisinde", ayrilma: "partisinden", ilgi: "partisinin", vasita: "partisiyle" },
  CHEQUE: iyelik("çek", "i", "e", "i"),
  INVOICE: { yalin: "faturası", belirtme: "faturasını", yonelme: "faturasına", bulunma: "faturasında", ayrilma: "faturasından", ilgi: "faturasının", vasita: "faturasıyla" },
  PAYMENT: { yalin: "ödemesi", belirtme: "ödemesini", yonelme: "ödemesine", bulunma: "ödemesinde", ayrilma: "ödemesinden", ilgi: "ödemesinin", vasita: "ödemesiyle" },
  SUBCONTRACTOR_DISPATCH: onEkli("fason", SEVK),
  SUBCONTRACTOR_RECEIPT: onEkli("fason mal kabul", RECORD_TERM),
  DIRECT_SHIPMENT: onEkli("fasondan", SEVK),
  SWATCH: { yalin: "kartelası", belirtme: "kartelasını", yonelme: "kartelasına", bulunma: "kartelasında", ayrilma: "kartelasından", ilgi: "kartelasının", vasita: "kartelasıyla" },
  MANIFEST: { yalin: "çeki listesi", belirtme: "çeki listesini", yonelme: "çeki listesine", bulunma: "çeki listesinde", ayrilma: "çeki listesinden", ilgi: "çeki listesinin", vasita: "çeki listesiyle" },
  TRAVELER_CARD: iyelik("refakat kart", "ı", "a", "ı"),
  STOCK_COUNT: iyelik("sayım", "ı", "a", "ı"),
  WARP_BEAM: iyelik("levent", "i", "e", "i"),
  CUSTOMER: { yalin: "müşterisi", belirtme: "müşterisini", yonelme: "müşterisine", bulunma: "müşterisinde", ayrilma: "müşterisinden", ilgi: "müşterisinin", vasita: "müşterisiyle" },
  SUBCONTRACTOR: onEkli("fason firma", RECORD_TERM),
  users: { yalin: "kullanıcısı", belirtme: "kullanıcısını", yonelme: "kullanıcısına", bulunma: "kullanıcısında", ayrilma: "kullanıcısından", ilgi: "kullanıcısının", vasita: "kullanıcısıyla" },
  devices: iyelik("cihaz", "ı", "a", "ı"),
  system_settings: iyelik("ayar", "ı", "a", "ı"),
  // ── Sık yazılan yapılandırma/saha kayıtları (en sık 30 çift, 2026-10-25 ölçümü)
  WORK_ORDER_STEP: onEkli(TERIM.terbiyeIsEmri.tekilKucuk, iyelik("adım", "ı", "a", "ı")),
  MACHINE_STOP_EVENT: onEkli("tezgah", iyelik("duruş", "u", "a", "u")),
  MACHINE_COLLECTOR: onEkli("makine", iyelik("kart", "ı", "a", "ı")),
  MACHINE_SPEC: onEkli("tezgah", sIyelik("künye", "i", "e")),
  WORK_SESSION: onEkli("çalışma", iyelik("oturum", "u", "a", "u")),
  DOCUMENT_TEMPLATE: onEkli("belge", iyelik("şablon", "u", "a", "u")),
  TRAVELER_CARD_TEMPLATE: onEkli("refakat kartı", iyelik("şablon", "u", "a", "u")),
  NumberSeries: onEkli("numara", sIyelik("seri", "i", "e")),
  packing_groups: onEkli("paketleme", iyelik("grub", "u", "a", "u")),
  CHEQUE_DELIVERY_NOTE: onEkli("çek teslim", sIyelik("bordro", "u", "a")),
  CREDENTIAL_RESET_REQUEST: onEkli("kimlik sıfırlama", iyelik("taleb", "i", "e", "i")),
  CUSTOMER_BRANCH: onEkli("müşteri", sIyelik("şube", "i", "e")),
  CUSTOMER_COLOR_ALIAS: onEkli("müşteri renk", iyelik("kod", "u", "a", "u")),
  DEFECT_TYPE: onEkli("hata", iyelik("tip", "i", "e", "i")),
  FACTORY_TIMEZONE_PERIOD: onEkli("saat dilimi", iyelik("dönem", "i", "e", "i")),
  USER_QUICK_PIN: onEkli("hızlı PIN", RECORD_TERM),
  PAYMENT_ALLOCATION: onEkli("fatura kapama", RECORD_TERM),
  LABEL_PRINT_EVENT: onEkli("etiket baskı", RECORD_TERM),
  ITEM_PRICE: onEkli("ürün", iyelik("fiyat", "ı", "a", "ı")),
  WORK_ORDER_TARGET_VALUE: onEkli("hedef gramaj", RECORD_TERM),
  // ── Lab · sertifika · özel rapor · maliyet (main'den gelen yeni audit tabloları, 2026-10-25)
  LAB_TEST: onEkli("lab", iyelik("test", "i", "e", "i")),
  LAB_TEST_TYPE: onEkli("lab test", iyelik("tür", "ü", "e", "ü")),
  CUSTOMER_LAB_SPEC: onEkli("müşteri lab", iyelik("spesifikasyon", "u", "a", "u")),
  CERTIFICATE: sIyelik("sertifika", "ı", "a"),
  CERTIFICATE_FILE: onEkli("sertifika", sIyelik("belge", "i", "e")),
  // ── Gelen belge taslağı (Gülkesim OCR D2, 2026-10-29)
  CUSTOMER_DELIVERY_NOTE: onEkli("gelen belge", iyelik("taslağ", "ı", "a", "ı")),
  CUSTOMER_DELIVERY_NOTE_LINE: onEkli("gelen belge", iyelik("satır", "ı", "a", "ı")),
  DOCUMENT_SCAN: onEkli("belge", sIyelik("tarama", "ı", "a")),
  // ── Kurşun metre defteri (H1, 2026-10-29)
  ROLL_METER_READING: onEkli("kurşun metre", sIyelik("okuma", "ı", "a")),
  ROLL_METER_ACK: onEkli("metre sapma", iyelik("onay", "ı", "a", "ı")),
  ROLL_METER_STOCK_APPLY: onEkli("kurşun metre stok", sIyelik("uygulama", "ı", "a")),
  ROLL_CUSTOMER_CODE: onEkli("müşteri", iyelik("barkod", "u", "a", "u")),
  DELIVERY_NOTE_ALIAS: onEkli("gelen belge", sIyelik("eşleme", "i", "e")),
  SENDER_TEMPLATE: onEkli("gönderen", iyelik("şablon", "u", "a", "u")),
  DELIVERY_NOTE_CUSTOMER_DEFAULT: onEkli("gelen belge", iyelik("varsayılan ürün", "ü", "e", "ü")),
  REPORT_CATEGORY: onEkli("rapor", sIyelik("kategori", "i", "e")),
  REPORT_DEFINITION: onEkli("özel", iyelik("rapor", "u", "a", "u")),
  REPORT_DEFINITION_VERSION: onEkli("özel rapor", iyelik("sürüm", "ü", "e", "ü")),
  REPORT_PRESET: onEkli("rapor ön", iyelik("ayar", "ı", "a", "ı")),
  REPORT_SHARE: onEkli("rapor", iyelik("paylaşım", "ı", "a", "ı")),
  COST_PARAMETER_SET: onEkli("maliyet parametre", iyelik("set", "i", "e", "i")),
  FINISHING_RATE: onEkli("apre", sIyelik("tarife", "i", "e")),
  WEFT_SPEC: onEkli("atkı", iyelik("spesifikasyon", "u", "a", "u")),
  YARN_COST_PRICE: onEkli("iplik maliyet", iyelik("fiyat", "ı", "a", "ı")),
  ROLL_INSPECTION: onEkli("top", sIyelik("muayene", "i", "e")),
  FOUR_POINT_RULE_SET: onEkli("4 puan kural", iyelik("set", "i", "e", "i")),
  STANDARD_COST_VERSION: onEkli("standart maliyet", iyelik("sürüm", "ü", "e", "ü")),
  // ── Bildirim tercih katmanı (N4-MOTOR)
  NOTIFICATION_PROFILE: onEkli("bildirim", iyelik("profil", "i", "e", "i")),
  NOTIFICATION_FACTORY_DEFAULT: onEkli("bildirim fabrika", iyelik("varsayılan", "ı", "a", "ı")),
  SALES_QUOTE: onEkli("satış", iyelik("teklif", "i", "e", "i")),
  PRICE_LIST: onEkli("fiyat", sIyelik("liste", "i", "e")),
};

/** Tablonun çekimleri; yoksa null (yedek cümle "<Modül> kaydı" kurar). */
export function auditIsmi(tableName: string): TermCases | null {
  return AUDIT_ISIMLERI[tableName] ?? null;
}

/** Modül etiketli yedek ad: "Top İadesi kaydını". */
export function kayitCekimi(modul: string): TermCases {
  return onEkli(modul, RECORD_TERM);
}
