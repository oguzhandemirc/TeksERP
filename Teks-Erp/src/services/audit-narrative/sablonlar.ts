// =============================================================================
// AUDIT ANLATI ŞABLONLARI — satır → Türkçe cümle parçaları (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// Anahtar önceliği "<tableName>:<event>" > "<tableName>:<action>" > yedek (`yedek.ts`).
// Şablon SAF işlevdir: `(satir, baglam) → Parca[]`; DB'ye gitmez, anlatı hiçbir yere yazılmaz.
// Kapsama `test_audit_anlati` cırcırıyla ölçülür (kodda yazılan çift ↔ şablon).
// =============================================================================

import type { TermCases } from "../../constants/terim";
import { kayitCekimi } from "../../constants/audit-isimler";

export type ParcaTuru = "kisi" | "kayit" | "deger" | "metin";
export interface Parca {
  t: ParcaTuru;
  text: string;
  ref?: { table: string; id: string };
}
export interface Anlati {
  parcalar: Parca[];
  metin: string;
}

/** Anlatıcının okuduğu satır alanları (liste/ayrıntı/işlem aynı biçim). */
export interface NarrativeRow {
  id: string;
  tableName: string;
  action: string;
  recordId: string;
  user?: { fullName?: string | null; username?: string | null } | null;
  changes?: unknown;
  /** `newData.event` — olay işareti (yoksa null). */
  event?: string | null;
}

export interface Degisim {
  alan: string;
  eski: string;
  yeni: string;
  /** Sır alanı: değer ANLATIYA GİRMEZ. */
  gizli: boolean;
}

export interface Baglam {
  kisi: Parca;
  kayit: Parca;
  isim: TermCases;
  modul: string;
  degisimler: Degisim[];
  /** Şablonsuz olayın Türkçe etiketi (şablon olayı kendisi söylüyorsa null). */
  olay: string | null;
}

export type Sablon = (s: NarrativeRow, b: Baglam) => Parca[];

export const m = (text: string): Parca => ({ t: "metin", text });
export const d = (text: string): Parca => ({ t: "deger", text });

/** "Ahmet Y., SP-1 siparişini" gövdesi. */
function subjectParts(b: Baglam, cekim: keyof TermCases): Parca[] {
  return b.kayit.text ? [b.kisi, m(", "), b.kayit, m(` ${b.isim[cekim]} `)] : [b.kisi, m(`, ${kayitCekimi(b.modul)[cekim]} `)];
}

function olayEki(b: Baglam): Parca[] {
  return b.olay ? [m(` (olay: ${b.olay})`)] : [];
}

/** Tek alan farkı cümlesi: "… siparişinin Termin tarihi alanını 18.10.2026 → 25.10.2026 yaptı". */
export function degisimCumlesi(b: Baglam): Parca[] {
  const ds = b.degisimler;
  if (ds.length === 1) {
    const c = ds[0]!;
    if (c.gizli) return [...subjectParts(b, "ilgi"), m(`${c.alan} alanını değiştirdi`)];
    return [...subjectParts(b, "ilgi"), m(`${c.alan} alanını `), d(c.eski), m(" → "), d(c.yeni), m(" yaptı")];
  }
  if (ds.length > 1) {
    const adlar = ds.slice(0, 3).map((c) => c.alan).join(", ");
    return [...subjectParts(b, "bulunma"), m(`${ds.length} alanı değiştirdi: ${adlar}${ds.length > 3 ? " …" : ""}`)];
  }
  return [...subjectParts(b, "belirtme"), m("düzenledi")];
}

export const olusturdu: Sablon = (_s, b) => [...subjectParts(b, "belirtme"), m("oluşturdu"), ...olayEki(b)];
export const duzenledi: Sablon = (_s, b) => [...degisimCumlesi(b), ...olayEki(b)];
export const sildi: Sablon = (_s, b) => [...subjectParts(b, "belirtme"), m("sildi"), ...olayEki(b)];

/** Olay şablonu: "<kişi>, <no> <isim çekimi> <fiil>". */
function olay(cekim: keyof TermCases, fiil: string): Sablon {
  return (_s, b) => [...subjectParts(b, cekim), m(fiil)];
}

/** Olay + (varsa) tek alan farkı. */
function olayFarkli(cekim: keyof TermCases, fiil: string): Sablon {
  return (s, b) => {
    const c = b.degisimler.length === 1 ? b.degisimler[0]! : null;
    const ek = c && !c.gizli ? [m(": "), d(c.eski), m(" → "), d(c.yeni)] : [];
    return [...olay(cekim, fiil)(s, b), ...ek];
  };
}

/** Oluştur/düzenle/sil üçlüsü şablonlu tablolar (isimleri `audit-isimler.ts`te). */
export const CUD_TABLOLARI = [
  "ORDER", "PURCHASE_ORDER", "ROLL", "WORK_ORDER", "WEAVING_ORDER", "SHIPMENT", "SACK", "BATCH",
  "CHEQUE", "INVOICE", "PAYMENT", "SUBCONTRACTOR_DISPATCH", "SUBCONTRACTOR_RECEIPT", "DIRECT_SHIPMENT",
  "SWATCH", "MANIFEST", "TRAVELER_CARD", "STOCK_COUNT", "WARP_BEAM", "CUSTOMER", "SUBCONTRACTOR",
  "users", "devices", "system_settings",
  "WORK_ORDER_STEP", "MACHINE_STOP_EVENT", "MACHINE_COLLECTOR", "MACHINE_SPEC", "WORK_SESSION", "DOCUMENT_TEMPLATE",
  "TRAVELER_CARD_TEMPLATE", "NumberSeries", "packing_groups", "CHEQUE_DELIVERY_NOTE", "CREDENTIAL_RESET_REQUEST",
  "CUSTOMER_BRANCH", "CUSTOMER_COLOR_ALIAS", "DEFECT_TYPE", "FACTORY_TIMEZONE_PERIOD", "USER_QUICK_PIN",
  "ITEM_PRICE", "WORK_ORDER_TARGET_VALUE",
  "LAB_TEST", "LAB_TEST_TYPE", "CUSTOMER_LAB_SPEC", "CERTIFICATE", "CERTIFICATE_FILE", "REPORT_CATEGORY",
  "REPORT_DEFINITION", "REPORT_DEFINITION_VERSION", "REPORT_PRESET", "REPORT_SHARE", "COST_PARAMETER_SET",
  "FINISHING_RATE", "WEFT_SPEC", "WEAVE_DESIGN", "ITEM", "PRODUCT_RECIPE", "YARN_COST_PRICE", "ROLL_INSPECTION", "FOUR_POINT_RULE_SET",
  "STANDARD_COST_VERSION", "NOTIFICATION_PROFILE", "NOTIFICATION_FACTORY_DEFAULT",
  "SALES_QUOTE", "PRICE_LIST",
  "CUSTOMER_DELIVERY_NOTE", "CUSTOMER_DELIVERY_NOTE_LINE", "DOCUMENT_SCAN", "ROLL_METER_READING", "DELIVERY_NOTE_ALIAS",
  "SENDER_TEMPLATE", "DELIVERY_NOTE_CUSTOMER_DEFAULT",
  "ROLL_METER_ACK", "ROLL_METER_STOCK_APPLY", "ROLL_CUSTOMER_CODE", "CARI_HOLD",
  "MACHINE_COST_RATE", "SERVICE_CONSUMABLE_NORM", "EXPENSE_ALLOCATION",
] as const;

const OLAY_SABLONLARI: Record<string, Sablon> = {
  // Terbiye iş emri
  "WORK_ORDER:SPLIT_SOURCE": olay("belirtme", "böldü"),
  "WORK_ORDER:SPLIT_TARGET": olay("belirtme", "bölmeyle oluşturdu"),
  "WORK_ORDER:TARGET_COLOR_CHANGED": olayFarkli("ilgi", "hedef rengini değiştirdi"),
  "WORK_ORDER:TARGET_WIDTH_CHANGED": olayFarkli("ilgi", "hedef enini değiştirdi"),
  "WORK_ORDER:ORDER_LINK_ADDED": olay("yonelme", "sipariş bağladı"),
  "WORK_ORDER:ORDER_LINK_REMOVED": olay("ayrilma", "sipariş bağını kaldırdı"),
  "WORK_ORDER:ARCHIVED": olay("belirtme", "arşivledi"),
  // Top
  "ROLL:ARCHIVED": olay("belirtme", "arşivledi"),
  "ROLL:MANUAL_MOVE": olay("belirtme", "elle taşıdı"),
  "ROLL:ROLL_DETACHED_FROM_WO": olay("belirtme", "terbiye iş emrinden ayırdı"),
  "ROLL:CANCEL_RESTORED": olay("belirtme", "iptalden geri getirdi"),
  "ROLL:TAMBUR_UNDO_SINGLE": olay("ilgi", "tambur kaydını geri aldı"),
  // Sipariş
  "ORDER:ORDER_LINE_COLOR_CHANGED": olayFarkli("ilgi", "satır rengini değiştirdi"),
  // Sayım
  "STOCK_COUNT:STOCK_COUNT_COMPLETED": olay("belirtme", "tamamladı"),
  "STOCK_COUNT:STOCK_COUNT_CANCELLED": olay("belirtme", "iptal etti"),
  "STOCK_COUNT:STOCK_COUNT_REVERSED": olay("belirtme", "geri aldı"),
  // Çek/senet
  "CHEQUE:COLLECT": olay("belirtme", "tahsil etti"),
  "CHEQUE:DEPOSIT": olay("belirtme", "bankaya verdi"),
  "CHEQUE:ENDORSE": olay("belirtme", "ciro etti"),
  "CHEQUE:BOUNCE": olay("belirtme", "karşılıksız olarak işaretledi"),
  "CHEQUE:RETURN": olay("belirtme", "iade etti"),
  "CHEQUE:CANCEL": olay("belirtme", "iptal etti"),
  "CHEQUE:PAY": olay("belirtme", "ödedi"),
  // Cihaz
  "devices:REVOKED": olay("ilgi", "erişimini kaldırdı"),
  "devices:MERGED": olay("belirtme", "ana cihaz kaydıyla birleştirdi"),
  "devices:UNMERGED": olay("ilgi", "birleştirmesini geri aldı"),
  "devices:PROOF_RESET": olay("ilgi", "kanıtını sıfırladı (aynı donanımla yeniden bağlanacak)"),
  // Fatura kapama
  "PAYMENT_ALLOCATION:ALLOCATIONS_RELEASED": olay("belirtme", "çözdü"),
  // Etiket basımı (kaydın numarası yok: yalnız eylem)
  "LABEL_PRINT_EVENT:LABEL_PRINTED": (_s, b) => [b.kisi, m(", etiket bastı")],
  "LABEL_PRINT_EVENT:CREATE": (_s, b) => [b.kisi, m(", etiket basımını kaydetti")],
  // Basılı belge (kayıt şablonsuz basıldı: sistem şablonu)
  "PRINTED_DOCUMENT:SYSTEM_TEMPLATE_PRINT": olay("belirtme", "sistem şablonuyla bastı"),
};

function katalogKur(): Readonly<Record<string, Sablon>> {
  const out: Record<string, Sablon> = {};
  for (const t of CUD_TABLOLARI) {
    out[`${t}:CREATE`] = olusturdu;
    out[`${t}:UPDATE`] = duzenledi;
    out[`${t}:DELETE`] = sildi;
  }
  return { ...out, ...OLAY_SABLONLARI };
}

export const SABLONLAR: Readonly<Record<string, Sablon>> = katalogKur();

/** Anahtar önceliği: tablo:olay > tablo:işlem; yoksa null (yedek). */
export function sablonBul(s: NarrativeRow): { anahtar: string; sablon: Sablon; olayKarsilandi: boolean } | null {
  if (s.event) {
    const k = `${s.tableName}:${s.event}`;
    if (SABLONLAR[k]) return { anahtar: k, sablon: SABLONLAR[k]!, olayKarsilandi: true };
  }
  const k = `${s.tableName}:${s.action}`;
  return SABLONLAR[k] ? { anahtar: k, sablon: SABLONLAR[k]!, olayKarsilandi: false } : null;
}
