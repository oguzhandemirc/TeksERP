// =============================================================================
// PAYMENT_RECEIPT (Tahsilat / Ödeme Makbuzu) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/finance-doc.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Makbuz ödemenin izidir: satır tablosu yok, tek tutar. İç belgedir (`hedef: ic`); tutar
// snapshot'tan aynen gelir. İmza etiketlerinin varsayılanı YÖNE bağlıdır → ayarda boş liste
// "varsayılan" demektir, şablon yöne göre seçer. İç alan beyanı yok.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  CREATED_BY_FIELD,
  NOTES_FIELD,
  PARTY_FIELDS,
  dateText,
  docHeader,
  moneyText,
  qtyFields,
  qtyPair,
  type AmountInWordsSource,
} from "./finance-common";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
  asText,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TemplateContext } from "./tipler";
import { headFields } from "./warehouse-common";

type Row = Record<string, unknown>;

const SECTIONS = { documentNo: true, date: true, account: true, createdBy: true } as const;

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Makbuz no", "THS1408260001", "TAHSİLAT MAKBUZU", "PAYMENT_RECEIPT"),
  { yol: "belge.yon", etiket: "Yön kodu (IN = tahsilat, OUT = ödeme)", tur: "metin", sinif: "musteri", ornek: "IN" },
  { yol: "belge.yon_etiketi", etiket: "Yön (Tahsilat Makbuzu / Ödeme Makbuzu)", tur: "metin", sinif: "musteri", ornek: "Tahsilat Makbuzu" },
  { yol: "belge.odeme_sekli", etiket: "Ödeme şekli", tur: "metin", sinif: "musteri", ornek: "Havale / EFT" },
  { yol: "belge.kasa_banka", etiket: "Kasa / banka hesabı", tur: "metin", sinif: "musteri", ornek: "Ziraat Bankası — TL Vadesiz" },
  { yol: "belge.para_birimi", etiket: "Para birimi", tur: "metin", sinif: "musteri", ornek: "TRY" },
  ...qtyFields("belge.kur", "Döviz kuru", 40.25, 2),
  CREATED_BY_FIELD,
  NOTES_FIELD,
  ...PARTY_FIELDS.filter((f) => f.yol !== "karsi_taraf.vergi_bilgisi"),
  ...COMPANY_FIELDS,
  { yol: "toplamlar.tutar", etiket: "Tutar", tur: "para", sinif: "musteri", ornek: "50000.00" },
  { yol: "toplamlar.tutar_tl", etiket: "Tutarın TL karşılığı", tur: "para", sinif: "musteri", ornek: null },
  ...PRINT_FIELDS,
];

/** Tutar yazıyla: makbuz tutarı, belgenin para biriminde. */
export const PAYMENT_AMOUNT_IN_WORDS: AmountInWordsSource = { tutar: "toplamlar.tutar", paraBirimi: "belge.para_birimi" };

/** Tablosuz belge: kolon ayarı yok; `kolonlar` boş nesne olarak şemada beyanlı. */
export type PaymentReceiptConfig = Omit<BaseDocConfig, "columns">;

export function normalizePaymentReceiptConfig(raw: unknown): PaymentReceiptConfig {
  const { columns: _none, ...base } = normalizeBase(sanitizeRawConfig(raw), { sections: SECTIONS, signatureDefaults: [], marginMm: 9, tables: [] });
  return { ...base, kolonlar: {} };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizePaymentReceiptConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = docHeader(doc);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "PAYMENT_RECEIPT",
      baslik: docTitle(config.titleOverride, asText(h.directionLabel) ?? ""),
      tarih: dateText(h.date),
      ...docStatus(extras?.baski),
      yon: asText(h.direction),
      yon_etiketi: asText(h.directionLabel),
      odeme_sekli: asText(h.methodLabel),
      kasa_banka: asText(h.accountName),
      para_birimi: asText(h.currency),
      ...qtyPair("kur", h.exchangeRate),
      duzenleyen: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(h.partyName), kod: asText(h.partyCode) }),
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)) },
    toplamlar: root("toplamlar", { tutar: moneyText(doc.amount), tutar_tl: moneyText(doc.amountTry) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("PAYMENT_RECEIPT");
  const header = (d: Row) => d.header as Row;

  const outUsd = base();
  outUsd.header = { ...header(outUsd), direction: "OUT", directionLabel: "Ödeme Makbuzu", currency: "USD", exchangeRate: "40.1", methodLabel: "Nakit", accountName: null };
  outUsd.amount = "1250.5";
  outUsd.amountTry = "50145.05";
  outUsd.notes = null;

  const big = base();
  big.amount = "987654321.09";
  big.notes = "Toplu tahsilat";

  const empty: Row = {
    header: {
      documentNo: "THS1408260002", date: null, direction: "IN", directionLabel: "Tahsilat Makbuzu", partyName: "Örnek Tekstil Ltd. Şti.",
      partyCode: null, method: "CASH", methodLabel: "Nakit", accountName: null, currency: "TRY", exchangeRate: null, createdBy: null,
    },
    amount: null,
    amountTry: null,
    notes: null,
  };

  const long = base();
  long.header = { ...header(long), partyName: longText("Çok Uzun Adlı Cari Tekstil"), partyCode: "CR-<01>", accountName: longText("Banka & Hesap", 80), methodLabel: "Çek <ciro>" };
  long.notes = longText("Makbuz notu", 160);

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek tahsilat makbuzu (TL)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Dövizli ödeme makbuzu — TL karşılığı satırı, yöne göre imza etiketleri", snapshot: sampleEnvelope(outUsd) },
    {
      ad: "cok_sayfa",
      aciklama: "Büyük tutar (makbuz tek sayfadır; zorunlu senaryo adı)",
      snapshot: sampleEnvelope(big),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Kasa kopyası" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanlar boş: tarihsiz, kodsuz, hesapsız, tutarsız (— basılır)", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Tahsilat geri alındı" } },
    },
  ];
}

export const paymentReceiptContract: DocumentContract<PaymentReceiptConfig, never> = {
  docType: "PAYMENT_RECEIPT",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE],
  ayarSemasi: [...baseConfigSchema(Object.keys(SECTIONS), []), { yol: "kolonlar", etiket: "Kolon düzeni (makbuzda tablo yok — boş)", tur: "nesne" }],
  ayarNormalize: normalizePaymentReceiptConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
