// =============================================================================
// FREE_DOCUMENT (Serbest Belge) veri sözleşmesi — P-e: donmaz, türün varsayılanı canlı
// =============================================================================
// Sistem renderer'ı (`document-render/free-document.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Kaynak = renderer'ın girdisi (firma + belge); antet/logo/damga/blok/imza ortak katmandan.
// Gövde DÜZ metindir: Sistem `white-space: pre-wrap` ile basar, eşlenik de öyle (satır
// kırmayı `<br>`e çevirmek eşitliği bozardı). İmza varsayılanı KAPALI, etiketi "İmza".
// =============================================================================

import type { PrintedDocSnapshot } from "../../printed-document.service";
import { dateText } from "./finance-common";
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
import { longText, sampleEnvelope } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TemplateContext } from "./tipler";
import { headFields } from "./warehouse-common";

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Belge no", "SB2509260001", "TESLİM TUTANAĞI", "FREE_DOCUMENT"),
  { yol: "belge.alici", etiket: "Sayın (alıcı)", tur: "metin", sinif: "musteri", ornek: "Örnek Konfeksiyon Ltd. Şti." },
  { yol: "belge.govde", etiket: "Gövde metni (düz; satır sonları korunur)", tur: "metin", sinif: "musteri", ornek: "İlgi yazınıza istinaden…" },
  ...COMPANY_FIELDS,
  ...PRINT_FIELDS,
];

/** Tablosuz belge: kolon ayarı yok; `kolonlar` boş nesne olarak şemada beyanlı. */
export type FreeDocumentConfig = Omit<BaseDocConfig, "columns">;

export function normalizeFreeDocumentConfig(raw: unknown): FreeDocumentConfig {
  const cfg = sanitizeRawConfig(raw);
  const { columns: _none, ...base } = normalizeBase(cfg, { sections: {}, signatureDefaults: ["İmza"], marginMm: 12, tables: [] });
  // Serbest belgede imza varsayılanı KAPALI (renderer: `showSignatures === true`).
  return { ...base, showSignatures: cfg.showSignatures === true, kolonlar: {} };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeFreeDocumentConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  return {
    belge: root("belge", {
      no: asText(doc.documentNo),
      tur: "FREE_DOCUMENT",
      baslik: asText(doc.title),
      tarih: dateText(doc.date),
      ...docStatus(extras?.baski),
      alici: asText(doc.recipient),
      govde: asText(doc.body),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: {},
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)) },
    toplamlar: {},
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

const sampleBody = () => ({
  documentNo: "SB2509260001",
  title: "TESLİM TUTANAĞI",
  recipient: "Örnek Konfeksiyon Ltd. Şti.",
  body: "İlgi yazınıza istinaden 25.09.2026 tarihinde\n12 top ham kumaş teslim edilmiştir.\n\nBilgilerinize sunarız.",
  date: "2026-09-25T08:30:00.000Z",
});

function scenarios(): Scenario<never>[] {
  const single = { ...sampleBody(), body: "Tek satırlık duyuru." };
  const many = { ...sampleBody(), body: Array.from({ length: 80 }, (_, i) => `${i + 1}. madde: sevk ve teslim koşulları`).join("\n") };
  const empty = { documentNo: "SB2509260002", title: "DUYURU", recipient: null, body: "", date: "2026-09-25T08:30:00.000Z" };
  const long = { ...sampleBody(), title: longText("Uzun <başlık> & not", 90), recipient: longText("Çok Uzun Adlı Alıcı & Ortakları", 120), body: longText("Gövde <b>kalın değil</b> & kaçış", 600) };
  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek teslim tutanağı (çok satırlı gövde)", snapshot: sampleEnvelope(sampleBody()) },
    { ad: "tek_kalem", aciklama: "Tek satırlık gövde", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "80 satırlık gövde, baskı notu ve basan",
      snapshot: sampleEnvelope(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Arşiv kopyası" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Alıcısız, boş gövdeli belge", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren başlık/alıcı/gövde", snapshot: sampleEnvelope(long) },
    { ad: "iptal", aciklama: "Durum bilgisi (serbest belge sürümsüzdür; filigran üst katmandır)", snapshot: sampleEnvelope(sampleBody()), ek: { baski: { durum: "VOIDED" } } },
  ];
}

export const freeDocumentContract: DocumentContract<FreeDocumentConfig, never> = {
  docType: "FREE_DOCUMENT",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE],
  ayarSemasi: [
    ...baseConfigSchema([], []),
    { yol: "sections", etiket: "Bölümler (serbest belgede yok — boş)", tur: "nesne" },
    { yol: "kolonlar", etiket: "Kolon düzeni (serbest belgede tablo yok — boş)", tur: "nesne" },
  ],
  ayarNormalize: normalizeFreeDocumentConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
