// =============================================================================
// CHEQUE_DELIVERY_NOTE (Çek / Senet Teslim Bordrosu) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/finance-doc.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Teslim alan tarafa gider (`hedef: musteri`); teslim edilen banka/cari `karsi_taraf`.
// FARKLI PARA BİRİMLERİ TOPLANMAZ (H6): ara toplamlar para birimi bazında snapshot'tan gelir,
// tek toplam yalnız liste tek para birimindeyken doludur. İç alan beyanı yok.
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import { CREATED_BY_FIELD, NOTES_FIELD, dateText, docHeader, moneyText, type AmountInWordsSource } from "./finance-common";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asNumber,
  asObject,
  asRows,
  asText,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";
import { headFields } from "./warehouse-common";

type Row = Record<string, unknown>;

const SECTIONS = { documentNo: true, date: true, createdBy: true, chequeTable: true, declaration: true } as const;

const CHEQUE_TABLE: TableDef = {
  anahtar: "cekler",
  etiket: "Teslim edilen çek / senetler",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "no" },
    { yol: "belge_no", etiket: "Belge no", tur: "metin", sinif: "musteri", ornek: "CK-2026-0001", hiza: "l", kaynakKolon: "docNo" },
    { yol: "seri_no", etiket: "Seri no", tur: "metin", sinif: "musteri", ornek: "0034512", hiza: "l", kaynakKolon: "serialNo" },
    { yol: "keside_tarihi", etiket: "Keşide tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z", hiza: "c", kaynakKolon: "issueDate" },
    { yol: "vade", etiket: "Vade", tur: "takvim", sinif: "musteri", ornek: "2026-11-09T00:00:00.000Z", hiza: "c", kaynakKolon: "dueDate" },
    { yol: "kesideci", etiket: "Keşideci", tur: "metin", sinif: "musteri", ornek: "Yıldız Konfeksiyon A.Ş.", hiza: "l", kaynakKolon: "drawer" },
    { yol: "banka", etiket: "Banka", tur: "metin", sinif: "musteri", ornek: "Garanti BBVA", hiza: "l", kaynakKolon: "bank" },
    { yol: "para_birimi", etiket: "Para birimi", tur: "metin", sinif: "musteri", ornek: "TRY", hiza: "c", kaynakKolon: "currency" },
    { yol: "tutar", etiket: "Tutar", tur: "para", sinif: "musteri", ornek: "42500.00", hiza: "r", kaynakKolon: "amount", toplam: "tek_toplam" },
  ],
};

const SUBTOTAL_TABLE: TableDef = {
  anahtar: "ara_toplamlar",
  etiket: "Para birimi bazında ara toplamlar",
  kolonlar: [
    { yol: "para_birimi", etiket: "Para birimi", tur: "metin", sinif: "musteri", ornek: "TRY", hiza: "l" },
    { yol: "adet", etiket: "Adet", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2, hiza: "r" },
    { yol: "tutar", etiket: "Tutar", tur: "para", sinif: "musteri", ornek: "61250.50", hiza: "r" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer `chequeTableCols` eşi (anahtar/başlık/hiza/genişlik). */
const CHEQUE_SPECS: DocColSpec<never>[] = [
  { key: "no", label: "SIRA", align: "c", width: "40px", kind: TEXT, value: () => null },
  { key: "docNo", label: "BELGE NO", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "serialNo", label: "SERİ NO", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "issueDate", label: "KEŞİDE", align: "c", width: "80px", kind: TEXT, value: () => null },
  { key: "dueDate", label: "VADE", align: "c", width: "80px", kind: TEXT, value: () => null },
  { key: "drawer", label: "KEŞİDECİ", align: "l", kind: TEXT, value: () => null },
  { key: "bank", label: "BANKA", align: "l", kind: TEXT, value: () => null },
  { key: "currency", label: "PARA", align: "c", width: "50px", kind: TEXT, value: () => null },
  { key: "amount", label: "TUTAR", align: "r", width: "100px", kind: TEXT, value: () => null, foot: { value: null } },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Bordro no", "BRD-2026-0001", "ALINAN ÇEK / SENET TESLİM BORDROSU", "CHEQUE_DELIVERY_NOTE"),
  { yol: "belge.yon", etiket: "Yön kodu (RECEIVED = alınan, ISSUED = verilen)", tur: "metin", sinif: "musteri", ornek: "RECEIVED" },
  { yol: "belge.yon_etiketi", etiket: "Yön (Alınan / Verilen)", tur: "metin", sinif: "musteri", ornek: "Alınan" },
  CREATED_BY_FIELD,
  NOTES_FIELD,
  { yol: "karsi_taraf.ad", etiket: "Teslim edilen (banka / cari / serbest metin)", tur: "metin", sinif: "musteri", ornek: "Ziraat Bankası — TL Vadesiz" },
  { yol: "karsi_taraf.tur_etiketi", etiket: "Teslim edilenin türü (satır etiketi)", tur: "metin", sinif: "musteri", ornek: "Teslim Edilen Banka" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.adet", etiket: "Çek / senet adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  { yol: "toplamlar.para_birimi_sayisi", etiket: "Para birimi sayısı", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.tek_toplam", etiket: "Tek toplam (yalnız tek para biriminde dolu)", tur: "para", sinif: "musteri", ornek: "61250.50" },
  { yol: "toplamlar.tek_para_birimi", etiket: "Tek toplamın para birimi", tur: "metin", sinif: "musteri", ornek: "TRY" },
  ...PRINT_FIELDS,
];

/** Tutar yazıyla: tek toplam (karışık para biriminde boş — yazılmaz), tek para biriminde. */
export const CHEQUE_AMOUNT_IN_WORDS: AmountInWordsSource = { tutar: "toplamlar.tek_toplam", paraBirimi: "toplamlar.tek_para_birimi" };

export type ChequeDeliveryNoteConfig = BaseDocConfig;

export function normalizeChequeDeliveryNoteConfig(raw: unknown): ChequeDeliveryNoteConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Teslim Eden", "Teslim Alan"],
    marginMm: 9,
    tables: ["chequeTable"],
  });
  return { ...base, kolonlar: { cekler: resolveColumns(CHEQUE_TABLE, CHEQUE_SPECS, base.columns.chequeTable!) } };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeChequeDeliveryNoteConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = docHeader(doc);
  const lines = asRows(doc.lines);
  const totals = asRows(doc.totals);
  const single = totals.length === 1 ? totals[0]! : null;
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = lines.map((l, i) =>
    fillFields(
      CHEQUE_TABLE.kolonlar,
      {
        sira: i + 1,
        belge_no: asText(l.docNo),
        seri_no: asText(l.serialNo),
        keside_tarihi: dateText(l.issueDate),
        vade: dateText(l.dueDate),
        kesideci: asText(l.drawerName),
        banka: asText(l.bankName),
        para_birimi: asText(l.currency),
        tutar: moneyText(l.amount),
      },
      optIn,
    ),
  );

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "CHEQUE_DELIVERY_NOTE",
      baslik: docTitle(config.titleOverride, `${asText(h.kindLabel) ?? ""} Çek / Senet Teslim Bordrosu`),
      tarih: dateText(h.date),
      ...docStatus(extras?.baski),
      yon: asText(h.kind),
      yon_etiketi: asText(h.kindLabel),
      duzenleyen: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(h.targetName), tur_etiketi: asText(h.targetKindLabel) }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      cekler: rows,
      ara_toplamlar: totals.map((t) => fillFields(SUBTOTAL_TABLE.kolonlar, { para_birimi: asText(t.currency), adet: asNumber(t.count), tutar: moneyText(t.amount) }, optIn)),
    },
    toplamlar: root("toplamlar", {
      adet: lines.length,
      para_birimi_sayisi: totals.length,
      tek_toplam: single ? moneyText(single.amount) : null,
      tek_para_birimi: single ? asText(single.currency) : null,
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("CHEQUE_DELIVERY_NOTE");
  const header = (d: Row) => d.header as Row;
  const line = (i: number, currency = "TRY"): Row => ({
    docNo: sampleSeriesCode("chequeReceived", i), serialNo: String(34500 + i).padStart(7, "0"), issueDate: "2026-09-20T09:00:00.000Z",
    dueDate: "2026-11-30T00:00:00.000Z", drawerName: `Keşideci ${i}`, bankName: i % 2 ? "Garanti BBVA" : "Akbank", currency, amount: (1000 + i * 250.25).toFixed(2),
  });

  const one = base();
  one.lines = [line(1)];
  one.totals = [{ currency: "TRY", count: 1, amount: "1250.25" }];

  const many = base();
  many.lines = Array.from({ length: 48 }, (_, i) => line(i + 1));
  many.totals = [{ currency: "TRY", count: 48, amount: "342000.00" }];

  const issued = base();
  issued.header = { ...header(issued), kind: "ISSUED", kindLabel: "Verilen", targetName: "Tedarikçi A.Ş.", targetKindLabel: null };
  issued.lines = [line(1), line(2, "USD"), line(3, "EUR")];
  issued.totals = [{ currency: "TRY", count: 1, amount: "1250.25" }, { currency: "USD", count: 1, amount: "1500.50" }, { currency: "EUR", count: 1, amount: "1750.75" }];

  const empty: Row = {
    header: { documentNo: null, date: null, kind: "RECEIVED", kindLabel: "Alınan", targetName: null, targetKindLabel: null, createdBy: null },
    lines: [{ docNo: null, serialNo: null, issueDate: null, dueDate: null, drawerName: null, bankName: null, currency: "TRY", amount: null }],
    totals: [],
    notes: null,
  };

  const long = base();
  long.header = { ...header(long), targetName: longText("Çok Uzun Adlı Banka & Şube"), targetKindLabel: "Teslim <Edilen>", createdBy: "Ali <Veli>" };
  long.lines = [{ ...line(1), drawerName: longText("Keşideci Tekstil", 120), bankName: "Banka & <Şube>", amount: "987654321.09" }];
  long.totals = [{ currency: "TRY", count: 1, amount: "987654321.09" }];
  long.notes = longText("Bordro notu", 160);

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek bordrosu (iki para birimi — tek toplam yok)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek çek, tek para birimi — tek toplam dolu", snapshot: sampleEnvelope(one) },
    {
      ad: "cok_sayfa",
      aciklama: "48 çek — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Bankaya teslim" } },
    },
    { ad: "verilen_karisik", aciklama: "Verilen (kendi) çekler, üç para birimi, tür etiketsiz hedef", snapshot: sampleEnvelope(issued) },
    { ad: "bos_opsiyonel", aciklama: "Numarasız taslak: hedefsiz, tarihsiz, tutarsız çek, ara toplam yok", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin; büyük tutar", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Bordro geri alındı" } },
    },
  ];
}

export const chequeDeliveryNoteContract: DocumentContract<ChequeDeliveryNoteConfig, never> = {
  docType: "CHEQUE_DELIVERY_NOTE",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, CHEQUE_TABLE, SUBTOTAL_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["chequeTable", "cekler"]]),
  ayarNormalize: normalizeChequeDeliveryNoteConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
