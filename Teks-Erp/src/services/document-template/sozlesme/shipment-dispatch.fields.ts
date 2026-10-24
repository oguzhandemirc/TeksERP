// =============================================================================
// SHIPMENT_DISPATCH sözleşmesi — alan, tablo ve ayar şeması beyanları
// =============================================================================
// Beyan ile inşa ayrı dosyada: özet bekçisi beyanı okur, renderer hizası inşayı.
// =============================================================================

import type { BlankGridConfig, DocFieldStyle } from "../../document-render/doc-style";
import type { renderShipmentDispatchHtml } from "../../document-render/shipment-dispatch.html";
import { COMPANY_FIELDS, DOC_STATUS_FIELDS, LETTERHEAD_EXTRA_TABLE, PRINT_FIELDS } from "./ortak";
import type { ColumnView, ConfigFieldDef, FieldDef, TableDef } from "./tipler";

/** Renderer'ın baskı meta'sı — export edilmeden imzasından türetilir (renderer diff'i 0). */
type DispatchRenderMeta = NonNullable<Parameters<typeof renderShipmentDispatchHtml>[1]>;

/** Sevk irsaliyesinin canlı (donmayan, her baskıda okunan) girdileri. */
export type DispatchLiveOptions = Pick<
  DispatchRenderMeta,
  "itemNameMode" | "cekiNameMode" | "productColorSplit" | "packingLot" | "sackSeq" | "rowNotes" | "rowTags"
>;

export const TABLE_KEYS = ["urun", "cuval", "ceki"] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

/** Renderer `sectionOn` okuduğu bölümler; `listHeader` OPT-IN (renderer `=== true`). */
export const SECTION_DEFAULTS = {
  docNo: true,
  date: true,
  exportCode: true,
  taxNo: true,
  branchName: true,
  customerCode: true,
  direction: true,
  procedureCode: true,
  orders: true,
  vehicleInfo: true,
  urun: true,
  cuval: true,
  ceki: true,
  listHeader: false,
} as const;
export type SectionKey = keyof typeof SECTION_DEFAULTS;

/** Renderer `LABELS.tr.sigDefaults` — boş liste bu ikiliye çözülür (eşdeğerlik bekçisi kilitler). */
export const SIGNATURE_DEFAULTS = ["Teslim Eden", "Teslim Alan"];

export interface DispatchColumnConfig {
  hidden: string[];
  order: string[];
  shown: string[];
  labels: Record<string, string>;
  blankLabels: string[];
}

/** Eksiksiz (dondurulabilir) sevk irsaliyesi ayarı — DocumentConfig anahtarlarıyla. */
export interface DispatchNoteConfig {
  titleOverride: string;
  showLetterhead: boolean;
  showSignatures: boolean;
  signatureLabels: string[];
  footerNote: string;
  footerNotePlacement: "top" | "bottom";
  sections: Record<SectionKey, boolean>;
  style: {
    pageSize: "A4" | "A5";
    margins: { top: number; right: number; bottom: number; left: number };
    fontScale: number;
    fontWeight: "light" | "normal" | "bold";
    tableDensity: "compact" | "normal" | "relaxed";
    tableStyle: "grid" | "zebra" | "plain";
  };
  showLogo: boolean;
  logoPosition: "left" | "right";
  columns: Record<TableKey, DispatchColumnConfig>;
  qr: boolean;
  stamps: { printedAt: boolean; printedBy: boolean; copyLabel: string };
  blocks: { position: "afterHeader" | "beforeSignatures"; text: string }[];
  /** EN eşleniği kapsam dışı (plan P-d) — sözleşme yalnız Türkçe çizer. */
  language: "tr";
  blankWidths: boolean;
  fields: Record<string, DocFieldStyle>;
  blankGrid: BlankGridConfig | null;
  /** Ayara göre kolon düzeni (iç kolonlar dahil aday küme); bağlamda baskıya göre daralır. */
  kolonlar: Record<TableKey, ColumnView[]>;
}

// ── Alanlar ──────────────────────────────────────────────────────────────────

export const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "İrsaliye no", tur: "metin", sinif: "musteri", ornek: "SVK-2026-0042" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "SHIPMENT_DISPATCH" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: "SEVK İRSALİYESİ" },
  { yol: "belge.tarih", etiket: "Sevk tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.yurtdisi", etiket: "Yurtdışı sevk mi", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "belge.ihracat_kodu", etiket: "İhracat kodu (şube, yoksa cari)", tur: "metin", sinif: "musteri", ornek: "IST-01" },
  { yol: "belge.gumruk_no", etiket: "Gümrük/ihracat no (yalnız yurtdışı)", tur: "metin", sinif: "musteri", ornek: null },
  { yol: "belge.siparisler", etiket: "Sipariş numaraları", tur: "metin", sinif: "musteri", ornek: "SIP-2026-0107" },
  { yol: "belge.plaka", etiket: "Plaka", tur: "metin", sinif: "musteri", ornek: "34 ABC 123" },
  { yol: "belge.sofor", etiket: "Şoför", tur: "metin", sinif: "musteri", ornek: "Mehmet Yılmaz" },
  { yol: "belge.tasiyici", etiket: "Taşıyıcı", tur: "metin", sinif: "musteri", ornek: "Hızlı Nakliyat" },
  ...COMPANY_FIELDS,
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: "M001" },
  { yol: "karsi_taraf.vergi_no", etiket: "Vergi no", tur: "metin", sinif: "musteri", ornek: "1234567890" },
  { yol: "karsi_taraf.sube", etiket: "Şube", tur: "metin", sinif: "musteri", ornek: "Merkez Şube" },
  { yol: "karsi_taraf.sube_kodu", etiket: "Şube ihracat kodu", tur: "metin", sinif: "musteri", ornek: "IST-01" },
  { yol: "karsi_taraf.ihracat_kodu", etiket: "Cari ihracat kodu", tur: "metin", sinif: "musteri", ornek: "EXP-TR-042" },
  { yol: "toplamlar.top_adedi", etiket: "Toplam top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 5 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 680 },
  { yol: "toplamlar.kg", etiket: "Toplam kg", tur: "sayi", ondalik: 2, birim: "kg", sinif: "musteri", ornek: 73.5 },
  { yol: "toplamlar.cuval_adedi", etiket: "Çuval kaydı adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.cuval_beyan_adedi", etiket: "Beyan edilen fiziksel çuval", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: null },
  ...PRINT_FIELDS,
  { yol: "baski.bizdeki_ad", etiket: "Ürün listesinde bizdeki ad", tur: "mantiksal", sinif: "musteri", ornek: true },
  { yol: "baski.musteri_ad", etiket: "Ürün listesinde müşterideki ad", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "baski.ceki_bizdeki_ad", etiket: "Çeki listesinde bizdeki ad", tur: "mantiksal", sinif: "musteri", ornek: true },
  { yol: "baski.ceki_musteri_ad", etiket: "Çeki listesinde müşterideki ad", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "baski.renk_ayri", etiket: "Müşteri rengi ayrı sütun", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "baski.ambalaj_partisi", etiket: "Ambalaj no + sevk partisi kolonları", tur: "mantiksal", sinif: "musteri", ornek: false },
  { yol: "baski.cuval_sira", etiket: "Çuval sıra kolonu", tur: "mantiksal", sinif: "musteri", ornek: false },
];

export type ColumnDef = TableDef["kolonlar"][number];
/** Müşteri sınıflı kolon; `ek` iç sınıf, renderer kolonu, birim ve toplamı taşır. */
const col = (
  yol: string,
  etiket: string,
  tur: ColumnDef["tur"],
  ek: Pick<ColumnDef, "hiza" | "ornek"> & Partial<ColumnDef>,
): ColumnDef => ({ yol, etiket, tur, sinif: "musteri", ...ek });

export const TABLE_DEFS: TableDef[] = [
  LETTERHEAD_EXTRA_TABLE,
  {
    anahtar: "urun",
    etiket: "Ürün listesi",
    kolonlar: [
      col("ad", "Stok adı (bizdeki)", "metin", { hiza: "l", ornek: "Pamuklu Astar · Bej", kaynakKolon: "name" }),
      col("musteri_ad", "Müşterideki stok adı", "metin", { hiza: "l", ornek: "AKTOS · SAND", kaynakKolon: "customerName" }),
      col("musteri_urun_adi", "Müşterideki stok adı (renksiz)", "metin", { hiza: "l", ornek: "AKTOS", kaynakKolon: "customerName" }),
      col("musteri_renk", "Müşterideki renk", "metin", { hiza: "l", ornek: "SAND", kaynakKolon: "customerColor" }),
      col("top_adedi", "Top adedi", "sayi", { hiza: "r", ornek: 3, ondalik: 0, kaynakKolon: "rollCount", toplam: "top_adedi" }),
      col("metre", "Toplam metre", "sayi", { hiza: "r", ornek: 480, ondalik: 2, birim: "m", kaynakKolon: "totalMeters", toplam: "metre" }),
    ],
  },
  {
    anahtar: "cuval",
    etiket: "Çuval listesi",
    kolonlar: [
      col("kod", "Çuval no", "metin", { hiza: "l", ornek: "Ç-01", kaynakKolon: "code" }),
      col("sira", "Sevkiyat içi sıra", "sayi", { hiza: "r", ornek: 1, ondalik: 0 }),
      col("sira_etiketi", "Sıra etiketi", "metin", { hiza: "r", ornek: "SP1/2", kaynakKolon: "seq" }),
      col("ambalaj_no", "Ambalaj no", "sayi", { hiza: "r", ornek: 1, ondalik: 0, kaynakKolon: "packageNo" }),
      col("sevk_partisi", "Sevk partisi", "metin", { hiza: "l", ornek: "P-1", kaynakKolon: "packingGroupName" }),
      col("parti_kodu", "Sevk partisi kodu", "metin", { hiza: "l", ornek: null,
        kaynakKolon: "packingGroupCode",
        sinif: "ic",
        icKod: "cuval_parti_kodu",
      }),
      col("metre", "Metre toplamı", "sayi", { hiza: "r", ornek: 480, ondalik: 2, birim: "m", kaynakKolon: "totalMeters", toplam: "metre" }),
      col("kg", "Kg toplamı", "sayi", { hiza: "r", ornek: 42.5, ondalik: 2, birim: "kg", kaynakKolon: "totalKg", toplam: "kg" }),
      col("top_adedi", "Top adedi", "sayi", { hiza: "r", ornek: 3, ondalik: 0, kaynakKolon: "packageCount", toplam: "top_adedi" }),
      col("aciklama", "Çuval yorumu", "metin", { hiza: "l", ornek: "Kontrol et", kaynakKolon: "note", sinif: "ic", icKod: "cuval_aciklama" }),
      col("iz", "Çuval izi", "metin", { hiza: "l", ornek: "Eksik", kaynakKolon: "tag", sinif: "ic", icKod: "cuval_iz" }),
    ],
  },
  {
    anahtar: "ceki",
    etiket: "Çeki listesi",
    kolonlar: [
      col("cuval_kodu", "Çuval no", "metin", { hiza: "l", ornek: "Ç-01", kaynakKolon: "sackCode" }),
      col("sira", "Sevkiyat içi sıra", "sayi", { hiza: "r", ornek: 1, ondalik: 0 }),
      col("sira_etiketi", "Sıra etiketi", "metin", { hiza: "r", ornek: "SP1/2", kaynakKolon: "seq" }),
      col("ambalaj_no", "Ambalaj no", "sayi", { hiza: "r", ornek: 1, ondalik: 0, kaynakKolon: "packageNo" }),
      col("sevk_partisi", "Sevk partisi", "metin", { hiza: "l", ornek: "P-1", kaynakKolon: "packingGroupName" }),
      col("parti_kodu", "Sevk partisi kodu", "metin", { hiza: "l", ornek: null,
        kaynakKolon: "packingGroupCode",
        sinif: "ic",
        icKod: "ceki_parti_kodu",
      }),
      col("barkod", "Barkod no", "metin", { hiza: "l", ornek: "TR-260607-R0200", kaynakKolon: "barcode" }),
      col("parti_no", "Parti no", "metin", { hiza: "l", ornek: null, kaynakKolon: "batchNumber" }),
      col("desen", "Desen (bizdeki)", "metin", { hiza: "l", ornek: "Pamuklu Astar", kaynakKolon: "desen" }),
      col("varyant", "Varyant (bizdeki)", "metin", { hiza: "l", ornek: "Bej", kaynakKolon: "varyant" }),
      col("musteri_desen", "Müşterideki desen", "metin", { hiza: "l", ornek: "AKTOS", kaynakKolon: "customerDesen" }),
      col("musteri_varyant", "Müşterideki varyant", "metin", { hiza: "l", ornek: "SAND", kaynakKolon: "customerVaryant" }),
      col("en", "En", "sayi", { hiza: "c", ornek: 150, ondalik: 0, birim: "cm", kaynakKolon: "width" }),
      col("metre", "Metre", "sayi", { hiza: "r", ornek: 480, ondalik: 2, birim: "m", kaynakKolon: "meters", toplam: "metre" }),
      col("kg", "Kg (çuvalın ilk satırında)", "sayi", { hiza: "r", ornek: 42.5, ondalik: 2, birim: "kg", kaynakKolon: "kg", toplam: "kg" }),
    ],
  },
];

export const tableDef = (t: string): TableDef => TABLE_DEFS.find((x) => x.anahtar === t)!;

/** Tablonun iç kolonlarının renderer anahtarları — Sistem'de `defaultHidden` olanlar. */
export const internalSourceKeys = (t: TableKey): string[] =>
  tableDef(t)
    .kolonlar.filter((c) => c.sinif === "ic" && c.kaynakKolon)
    .map((c) => c.kaynakKolon as string);

/** Renderer kolonu → bağlam satır anahtarı. `customerName` ayrık renk kipinde renksiz adı taşır. */
function rowFieldFor(t: TableKey, sourceKey: string, colorSplit: boolean): ColumnDef | undefined {
  if (t === "urun" && sourceKey === "customerName") {
    return tableDef(t).kolonlar.find((c) => c.yol === (colorSplit ? "musteri_urun_adi" : "musteri_ad"));
  }
  return tableDef(t).kolonlar.find((c) => c.kaynakKolon === sourceKey);
}

export function columnViews(
  t: TableKey,
  cols: ReadonlyArray<{ key: string; label: string; align: "l" | "r" | "c" }>,
  colorSplit: boolean,
): ColumnView[] {
  return cols.flatMap((c) => {
    const def = rowFieldFor(t, c.key, colorSplit);
    if (!def) return [];
    return [{ anahtar: def.yol, kaynak: c.key, etiket: c.label, hiza: c.align, toplam: def.toplam ?? null }];
  });
}

// ── Ayar ─────────────────────────────────────────────────────────────────────

export const CONFIG_SCHEMA: ConfigFieldDef[] = [
  { yol: "titleOverride", etiket: "Başlık (boş = varsayılan)", tur: "metin" },
  { yol: "showLetterhead", etiket: "Künye basılsın", tur: "mantiksal" },
  { yol: "showSignatures", etiket: "İmza kutuları", tur: "mantiksal" },
  { yol: "signatureLabels", etiket: "İmza etiketleri", tur: "liste" },
  { yol: "footerNote", etiket: "Alt not", tur: "metin" },
  { yol: "footerNotePlacement", etiket: "Alt not konumu", tur: "secim", secenekler: ["top", "bottom"] },
  ...(Object.keys(SECTION_DEFAULTS) as SectionKey[]).map(
    (b): ConfigFieldDef => ({ yol: `sections.${b}`, etiket: `Bölüm: ${b}`, tur: "mantiksal" }),
  ),
  { yol: "style.pageSize", etiket: "Sayfa boyutu", tur: "secim", secenekler: ["A4", "A5"] },
  { yol: "style.margins.top", etiket: "Üst kenar (mm)", tur: "sayi" },
  { yol: "style.margins.right", etiket: "Sağ kenar (mm)", tur: "sayi" },
  { yol: "style.margins.bottom", etiket: "Alt kenar (mm)", tur: "sayi" },
  { yol: "style.margins.left", etiket: "Sol kenar (mm)", tur: "sayi" },
  { yol: "style.fontScale", etiket: "Yazı ölçeği", tur: "sayi" },
  { yol: "style.fontWeight", etiket: "Yazı kalınlığı", tur: "secim", secenekler: ["light", "normal", "bold"] },
  { yol: "style.tableDensity", etiket: "Tablo yoğunluğu", tur: "secim", secenekler: ["compact", "normal", "relaxed"] },
  { yol: "style.tableStyle", etiket: "Tablo çizgisi", tur: "secim", secenekler: ["grid", "zebra", "plain"] },
  { yol: "showLogo", etiket: "Logo", tur: "mantiksal" },
  { yol: "logoPosition", etiket: "Logo konumu", tur: "secim", secenekler: ["left", "right"] },
  ...TABLE_KEYS.flatMap((t): ConfigFieldDef[] => [
    { yol: `columns.${t}.hidden`, etiket: `${t}: gizli kolonlar`, tur: "liste" },
    { yol: `columns.${t}.order`, etiket: `${t}: kolon sırası`, tur: "liste" },
    { yol: `columns.${t}.shown`, etiket: `${t}: açılan opt-in kolonlar (iç kolon hariç)`, tur: "liste" },
    { yol: `columns.${t}.labels`, etiket: `${t}: kolon başlıkları`, tur: "nesne" },
    { yol: `columns.${t}.blankLabels`, etiket: `${t}: başlıksız kolonlar`, tur: "liste" },
    { yol: `kolonlar.${t}`, etiket: `${t}: çözülmüş kolon düzeni`, tur: "liste" },
  ]),
  { yol: "qr", etiket: "Doğrulama karekodu", tur: "mantiksal" },
  { yol: "stamps.printedAt", etiket: "Basım zamanı damgası", tur: "mantiksal" },
  { yol: "stamps.printedBy", etiket: "Basan damgası", tur: "mantiksal" },
  { yol: "stamps.copyLabel", etiket: "Nüsha etiketi", tur: "metin" },
  { yol: "blocks", etiket: "Serbest metin blokları", tur: "liste" },
  { yol: "language", etiket: "Dil", tur: "secim", secenekler: ["tr"] },
  { yol: "blankWidths", etiket: "En değerleri boş", tur: "mantiksal" },
  { yol: "fields", etiket: "Alan yazı ayarları", tur: "nesne" },
  { yol: "blankGrid", etiket: "Boş grid", tur: "nesne" },
];
