// =============================================================================
// TRAVELER_CARD (Refakat Kartı) veri sözleşmesi — P-e: kart DONMAZ, canlı çözülür
// =============================================================================
// Sistem renderer'ı (`document-render/traveler-card.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Kaynak donmuş zarf değil, baskı anında `resolvePrintPlan`ın çözdüğü kart içeriği +
// kimlik/parti meta'sıdır. Uzman modu kataloğuyla (`config/traveler-card-fields.ts`,
// `TRAVELER_LOOPS`) hiza `TRAVELER_KEY_MAP`te tutulur; bekçi iki tarafı da ölçer.
// Hücre stilleri ve bölüm sırası AYARDAN türetilir (Liquid'de hesap yok).
// =============================================================================

import type { NUMBER_ROUNDING_HALF_UP } from "../../document-render/fmt-num";
import { resolveTravelerCompanyName } from "../../document-render/traveler-card-raw";
import type { TravelerBatchLine, TravelerCardMeta, TravelerCardSnapshot } from "../../document-render/traveler-card.html";
import { TERIM } from "../../../constants/terim";
import { dateText } from "./finance-common";
import { PRINT_FIELDS, asNumber, asText, fillFields, printRoot, rootFields } from "./ortak";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, TableDef, TemplateContext } from "./tipler";
import { TRAVELER_CONFIG_SCHEMA, normalizeTravelerCardTemplateConfig, type TravelerCardTemplateConfig } from "./traveler-card.config";
import { sampleSeriesCode } from "./senaryolar";
import { travelerCardScenarios } from "./traveler-card.scenarios";

export interface TravelerCardSource {
  card: Omit<TravelerCardSnapshot, "config" | "template">;
  meta: Omit<TravelerCardMeta, "qrSvg" | "draft" | "status">;
  /** Motor sayı biçimi (`docNum`) — kart sayıları tam sayıdır, yarım yukarı (`Math.round`). */
  numberRounding: typeof NUMBER_ROUNDING_HALF_UP;
}

const TYPE_LABELS: Record<string, string> = { ORDER_PRODUCTION: "Siparişe Özel", STOCK_PRODUCTION: "Stok" };

const f = (yol: string, etiket: string, tur: FieldDef["tur"], ornek: FieldDef["ornek"]): FieldDef => ({
  yol,
  etiket,
  tur,
  sinif: "musteri",
  ornek,
});
/** Tam sayı gösterimli alan (kart sayıları kuruşsuz basılır). */
const int = (d: FieldDef): FieldDef => ({ ...d, ondalik: 0 });

// Örnek kart no seriden türetilir (bayat literal yazılmaz; test_bayat_kod_literali).
const SAMPLE_CARD_NO = sampleSeriesCode("workOrder", 7);

const ROOT_FIELDS: FieldDef[] = [
  f("belge.no", "Kart no", "metin", SAMPLE_CARD_NO),
  f("belge.tur", "Belge türü", "metin", "TRAVELER_CARD"),
  f("belge.kart_no", "Kart no", "metin", SAMPLE_CARD_NO),
  f("belge.barkod", "Barkod / karekod metni", "metin", SAMPLE_CARD_NO),
  f("belge.is_emri_no", `${TERIM.terbiyeIsEmri.tekil} no`, "metin", SAMPLE_CARD_NO),
  int(f("belge.surum", "Kart sürümü", "sayi", 1)),
  f("belge.durum", "Kart durumu (ACTIVE/VOIDED/COMPLETED/REPRINTED)", "metin", "ACTIVE"),
  f("belge.iptal_nedeni", "İptal nedeni", "metin", null),
  f("belge.basim_zamani", "Basım tarihi", "tarih_saat", "2026-08-03T06:12:00.000Z"),
  f("belge.tur_kodu", `${TERIM.terbiyeIsEmri.tekil} türü kodu`, "metin", "ORDER_PRODUCTION"),
  f("belge.tur_metni", "Tür + rota", "metin", "Siparişe Özel · Rota: Standart"),
  f("belge.rota", "Rota adı", "metin", "Standart Boyama Rotası"),
  f("belge.urun_kodu", "Kumaş kodu", "metin", "KMS-001"),
  f("belge.urun_adi", "Kumaş adı", "metin", "Pamuklu Astar"),
  f("belge.renk", "Renk", "metin", "Bej"),
  f("belge.en", "En (cm)", "sayi", 150),
  f("belge.kat_tipi", "Kat tipi", "metin", "Top"),
  f("belge.ozellikler", "Özellikler (virgüllü)", "metin", "Su İticilik, Zımparalı"),
  int(f("belge.hedef_metraj", "Hedef metraj", "sayi", 4850)),
  int(f("belge.hedef_agirlik", "Hedef ağırlık (kg)", "sayi", 810)),
  f("belge.baslangic", "Planlanan başlangıç", "takvim", "2026-08-03T00:00:00.000Z"),
  f("belge.bitis", "Planlanan bitiş", "takvim", "2026-08-11T00:00:00.000Z"),
  f("firma.ad", "Firma adı (kart ayarı → kurulum adı)", "metin", "Örnek Tekstil A.Ş."),
  f("firma.adres", "Firma adresi (kart ayarı)", "metin", "OSB 5. Cad. No:12 Bursa"),
  f("firma.telefon", "Firma telefonu (kart ayarı)", "metin", "0224 000 00 00"),
  int(f("toplamlar.parti_sayisi", "Parti sayısı", "sayi", 3)),
  int(f("toplamlar.parti_top", "Toplam top adedi", "sayi", 12)),
  int(f("toplamlar.parti_metraj", "Partilerin toplam metrajı", "sayi", 2565)),
  int(f("toplamlar.siparis_sayisi", "Bağlı sipariş sayısı", "sayi", 2)),
  int(f("toplamlar.siparis_miktar", "Siparişlerin toplam miktarı", "sayi", 1240)),
  ...PRINT_FIELDS,
];

const col = (yol: string, etiket: string, tur: FieldDef["tur"], ornek: FieldDef["ornek"]) => ({ ...f(yol, etiket, tur, ornek), hiza: "l" as "l" | "r" | "c" });
const align = <T extends { hiza: string }>(c: T, hiza: "r" | "c"): T => ({ ...c, hiza });

const STEPS_TABLE: TableDef = {
  anahtar: "adimlar",
  etiket: "Rota adımları (sıraya göre)",
  kolonlar: [
    align(col("sira", "Sıra (1'den)", "sayi", 1), "c"),
    align(col("adim_no", "Rota adım numarası", "sayi", 1), "c"),
    col("istasyon", "İstasyon", "metin", "Boyahane"),
    col("dis_istasyon", "Fason (dış) istasyon mu", "mantiksal", true),
    col("fason_firma", "Planlanan fason firma", "metin", "Yıldız Boyahane"),
    col("talimat", "Adım talimatı", "metin", "Yıkama yapma"),
  ],
};

const BATCHES_TABLE: TableDef = {
  anahtar: "partiler",
  etiket: "Partiler (baskı anında canlı)",
  kolonlar: [
    align(col("sira", "Sıra", "sayi", 1), "c"),
    col("parti_no", "Parti no", "metin", sampleSeriesCode("batchDaily", 1)),
    align(col("top_adedi", "Top adedi", "sayi", 4), "r"),
    align(col("metraj", "Metraj", "sayi", 1240), "r"),
    col("sevk_no", "Sevk irsaliye no", "metin", sampleSeriesCode("subcontractorDispatch", 1)),
    col("sevk_firma", "Sevk edilen firma", "metin", "Yıldız Boyahane"),
    align(col("sevk_ek", "Önceki açık sevk sayısı", "sayi", 0), "r"),
  ],
};

const ORDERS_TABLE: TableDef = {
  anahtar: "siparisler",
  etiket: "Bağlı siparişler",
  kolonlar: [
    align(col("sira", "Sıra", "sayi", 1), "c"),
    col("siparis_no", "Sipariş no", "metin", "SIP-2026-0110"),
    col("musteri", "Müşteri", "metin", "Örnek Tekstil A.Ş."),
    col("urun", "Ürün", "metin", "Pamuklu Astar"),
    col("renk", "Renk", "metin", "Bej"),
    align(col("miktar", "Miktar", "sayi", 600), "r"),
  ],
};

const PROPERTIES_TABLE: TableDef = {
  anahtar: "ozellikler",
  etiket: "Hedef özellikler",
  kolonlar: [col("ad", "Özellik", "metin", "Su İticilik")],
};

/**
 * Uzman modu kataloğu ↔ sözleşme yolu. Anahtar `{{alan}}` (döngüde `döngü.alan`), değer bağlam
 * yolu; `| qr` filtreyle üretilen görseli söyler. Katalog ya da sözleşme büyüyünce İKİ taraf
 * birlikte eklenir (`test_belge_sozlesme §7`).
 */
export const TRAVELER_KEY_MAP: Readonly<Record<string, string>> = {
  cardNumber: "belge.kart_no",
  barcode: "belge.barkod",
  workOrderNumber: "belge.is_emri_no",
  version: "belge.surum",
  printedAt: "belge.basim_zamani",
  companyName: "firma.ad",
  addressLine: "firma.adres",
  phone: "firma.telefon",
  footerNote: "ayar.footerNote",
  qrSvg: "belge.barkod | qr",
  itemCode: "belge.urun_kodu",
  itemName: "belge.urun_adi",
  colorName: "belge.renk",
  width: "belge.en",
  foldType: "belge.kat_tipi",
  properties: "belge.ozellikler",
  typeText: "belge.tur_metni",
  routeName: "belge.rota",
  targetQuantity: "belge.hedef_metraj",
  targetWeight: "belge.hedef_agirlik",
  startDate: "belge.baslangic",
  endDate: "belge.bitis",
  batchCount: "toplamlar.parti_sayisi",
  batchRollTotal: "toplamlar.parti_top",
  batchQtyTotal: "toplamlar.parti_metraj",
  orderCount: "toplamlar.siparis_sayisi",
  orderQtyTotal: "toplamlar.siparis_miktar",
  steps: "tablolar.adimlar",
  "steps.seq": "tablolar.adimlar[].sira",
  "steps.stationName": "tablolar.adimlar[].istasyon",
  "steps.subcontractorName": "tablolar.adimlar[].fason_firma",
  "steps.notes": "tablolar.adimlar[].talimat",
  batches: "tablolar.partiler",
  "batches.seq": "tablolar.partiler[].sira",
  "batches.batchNumber": "tablolar.partiler[].parti_no",
  "batches.rollCount": "tablolar.partiler[].top_adedi",
  "batches.quantity": "tablolar.partiler[].metraj",
  "batches.dispatchNo": "tablolar.partiler[].sevk_no",
  "batches.subcontractorName": "tablolar.partiler[].sevk_firma",
  orders: "tablolar.siparisler",
  "orders.seq": "tablolar.siparisler[].sira",
  "orders.orderNumber": "tablolar.siparisler[].siparis_no",
  "orders.customerName": "tablolar.siparisler[].musteri",
  "orders.itemName": "tablolar.siparisler[].urun",
  "orders.colorName": "tablolar.siparisler[].renk",
  "orders.quantity": "tablolar.siparisler[].miktar",
};


// ── Bağlam ───────────────────────────────────────────────────────────────────────────────

type CardPart = Partial<TravelerCardSource["card"]>;
type MetaPart = Partial<TravelerCardSource["meta"]>;
const NO_INTERNAL = new Set<string>();

function docValues(card: CardPart, meta: MetaPart, extras: BuildExtras<never> | undefined): Record<string, ContextValue | undefined> {
  const type = asText(card.type);
  const route = card.routeTemplate ? asText(card.routeTemplate.name) : null;
  const props = Array.isArray(card.targetProperties) ? card.targetProperties : [];
  return {
    no: asText(meta.cardNumber),
    tur: "TRAVELER_CARD",
    kart_no: asText(meta.cardNumber),
    barkod: asText(meta.barcode),
    is_emri_no: asText(card.workOrderNumber),
    surum: asNumber(meta.version),
    durum: asText(extras?.baski?.durum),
    iptal_nedeni: asText(meta.voidReason ?? extras?.baski?.iptalNedeni),
    basim_zamani: dateText(meta.printedAt),
    tur_kodu: type,
    tur_metni: type == null ? null : (TYPE_LABELS[type] ?? type) + (card.routeTemplate ? ` · Rota: ${card.routeTemplate.name}` : ""),
    rota: route,
    urun_kodu: card.targetItem ? asText(card.targetItem.code) : null,
    urun_adi: card.targetItem ? asText(card.targetItem.name) : null,
    renk: card.targetColor ? asText(card.targetColor.name) : null,
    en: asNumber(card.width),
    kat_tipi: asText(card.foldType),
    ozellikler: props.map((p) => p.property.name).join(", "),
    hedef_metraj: asNumber(card.targetQuantity),
    hedef_agirlik: asNumber(card.targetWeight),
    baslangic: dateText(card.plannedStartDate),
    bitis: dateText(card.plannedEndDate),
  };
}

function tableRows(
  steps: TravelerCardSource["card"]["steps"],
  batches: TravelerBatchLine[],
  orderLinks: TravelerCardSource["card"]["orderLinks"],
  props: TravelerCardSource["card"]["targetProperties"],
): Record<string, ContextObject[]> {
  const none = NO_INTERNAL;
  return {
    adimlar: steps.map((st, i) =>
      fillFields(STEPS_TABLE.kolonlar, {
        sira: i + 1,
        adim_no: st.stepSequence,
        istasyon: st.station ? asText(st.station.name) : null,
        dis_istasyon: st.station?.type === "EXTERNAL",
        fason_firma: st.plannedSubcontractor ? asText(st.plannedSubcontractor.name) : null,
        talimat: asText(st.notes),
      }, none),
    ),
    partiler: batches.map((b, i) =>
      fillFields(BATCHES_TABLE.kolonlar, {
        sira: i + 1,
        parti_no: asText(b.batchNumber),
        top_adedi: asNumber(b.rollCount),
        metraj: asNumber(b.quantity),
        sevk_no: b.dispatch ? asText(b.dispatch.dispatchNo) : null,
        sevk_firma: b.dispatch ? asText(b.dispatch.subcontractorName) : null,
        sevk_ek: b.dispatch ? asNumber(b.dispatch.moreCount) : null,
      }, none),
    ),
    siparisler: orderLinks.map((l, i) =>
      fillFields(ORDERS_TABLE.kolonlar, {
        sira: i + 1,
        siparis_no: asText(l.orderLine?.order?.orderNumber),
        musteri: asText(l.orderLine?.order?.customer?.name),
        urun: asText(l.orderLine?.item?.name),
        renk: asText(l.orderLine?.color?.name),
        miktar: asNumber(l.orderLine?.quantity),
      }, none),
    ),
    ozellikler: props.map((p) => fillFields(PROPERTIES_TABLE.kolonlar, { ad: asText(p.property?.name) }, none)),
  };
}

function buildContext(
  source: TravelerCardSource,
  rawConfig: unknown,
  _internalFields: readonly string[],
  extras?: BuildExtras<never>,
): TemplateContext {
  const config = normalizeTravelerCardTemplateConfig(rawConfig);
  const none = new Set<string>();
  const card = (source?.card ?? {}) as Partial<TravelerCardSource["card"]>;
  const meta = (source?.meta ?? {}) as Partial<TravelerCardSource["meta"]>;
  const root = (key: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, key), values, none);

  const steps = [...(Array.isArray(card.steps) ? card.steps : [])].sort((a, b) => a.stepSequence - b.stepSequence);
  const orderLinks = Array.isArray(card.orderLinks) ? card.orderLinks : [];
  const batches: TravelerBatchLine[] = Array.isArray(meta.batches) ? meta.batches : [];
  const props = Array.isArray(card.targetProperties) ? card.targetProperties : [];
  return {
    belge: root("belge", docValues(card, meta, extras)),
    firma: root("firma", {
      ad: resolveTravelerCompanyName(config, { companyName: meta.companyName }),
      adres: config.addressLine.trim(),
      telefon: config.phone.trim(),
    }),
    karsi_taraf: {},
    tablolar: tableRows(steps, batches, orderLinks, props),
    toplamlar: root("toplamlar", {
      parti_sayisi: batches.length,
      parti_top: batches.reduce((s, b) => s + (asNumber(b.rollCount) ?? 0), 0),
      parti_metraj: batches.reduce((s, b) => s + (asNumber(b.quantity) ?? 0), 0),
      siparis_sayisi: orderLinks.length,
      siparis_miktar: orderLinks.reduce((s, l) => s + (asNumber(l.orderLine?.quantity) ?? 0), 0),
    }),
    ayar: config as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, null)),
  };
}

export const travelerCardContract: DocumentContract<TravelerCardTemplateConfig, never, TravelerCardSource> = {
  docType: "TRAVELER_CARD",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [STEPS_TABLE, BATCHES_TABLE, ORDERS_TABLE, PROPERTIES_TABLE],
  ayarSemasi: TRAVELER_CONFIG_SCHEMA,
  ayarNormalize: normalizeTravelerCardTemplateConfig,
  insa: buildContext,
  senaryolar: travelerCardScenarios,
};
