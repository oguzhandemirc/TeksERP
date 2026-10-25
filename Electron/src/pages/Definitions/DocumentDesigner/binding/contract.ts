/**
 * Belge veri sözleşmesi (backend `GET /api/document-templates/contracts/:docType`)
 * istemci tipleri + veri ağacı. Tel anahtarları (`yol`, `etiket`, `sinif`…) backend
 * `sozlesme/tipler.ts` ile aynıdır; burada yalnız okunur.
 */

export type FieldType = "metin" | "sayi" | "tarih" | "tarih_saat" | "takvim" | "para" | "gorsel" | "mantiksal";
export type SampleValue = string | number | boolean | null;

export interface ContractField {
  yol: string;
  etiket: string;
  tur: FieldType;
  ondalik?: number;
  birim?: string;
  sinif: "musteri" | "ic";
  ornek: SampleValue;
  icKod?: string;
}

export interface ContractColumn extends ContractField {
  hiza: "l" | "r" | "c";
  kaynakKolon?: string;
  toplam?: string;
}

export interface ContractTable {
  anahtar: string;
  etiket: string;
  kolonlar: ContractColumn[];
}

export interface ContractConfigField {
  yol: string;
  etiket: string;
  tur: string;
  secenekler?: readonly string[];
}

export interface ContractView {
  docType: string;
  hedef: "musteri" | "ic";
  contractVersion: number;
  kokler: ContractField[];
  tablolar: ContractTable[];
  ayarSemasi: ContractConfigField[];
  icAlanlar: Array<{ kod: string; yol: string; tablo: string | null; kaynakKolon: string | null }>;
  senaryolar: Array<{ ad: string; aciklama: string }>;
}

/** Bağlam kökleri — sıra veri ağacının sırasıdır. */
export const ROOT_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["belge", "Belge"],
  ["firma", "Firma"],
  ["karsi_taraf", "Karşı taraf"],
  ["tablolar", "Tablolar"],
  ["toplamlar", "Toplamlar"],
  ["baski", "Baskı"],
  ["ayar", "Belge ayarları"],
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  metin: "Metin",
  sayi: "Sayı",
  tarih: "Tarih",
  tarih_saat: "Tarih ve saat",
  takvim: "Takvim günü",
  para: "Para",
  gorsel: "Görsel",
  mantiksal: "Evet/Hayır",
};

export interface TreeNode {
  id: string;
  label: string;
  /** Şablondaki tam yol: kökte "belge.no", kolonda "tablolar.urun[].ad". */
  path: string;
  kind: "group" | "field" | "table" | "column";
  field?: ContractField;
  tableKey?: string;
  children?: TreeNode[];
}

/** Sözleşme → kökler · tablolar (kolonlarıyla) · ayar şeması ağacı. */
export function buildContractTree(c: ContractView): TreeNode[] {
  const out: TreeNode[] = [];
  for (const [root, label] of ROOT_LABELS) {
    const children = childrenOf(c, root);
    if (children.length) out.push({ id: root, label, path: root, kind: "group", children });
  }
  return out;
}

function childrenOf(c: ContractView, root: string): TreeNode[] {
  if (root === "tablolar") {
    return c.tablolar.map((t) => ({
      id: `tablolar.${t.anahtar}`,
      label: t.etiket,
      path: `tablolar.${t.anahtar}`,
      kind: "table" as const,
      tableKey: t.anahtar,
      children: t.kolonlar.map((k) => ({
        id: `tablolar.${t.anahtar}[].${k.yol}`,
        label: k.etiket,
        path: `tablolar.${t.anahtar}[].${k.yol}`,
        kind: "column" as const,
        field: k,
        tableKey: t.anahtar,
      })),
    }));
  }
  if (root === "ayar") {
    return c.ayarSemasi
      .filter((a) => a.tur === "metin" || a.tur === "sayi" || a.tur === "mantiksal" || a.tur === "secim")
      .map((a) => ({
        id: `ayar.${a.yol}`,
        label: a.etiket,
        path: `ayar.${a.yol}`,
        kind: "field" as const,
        field: { yol: `ayar.${a.yol}`, etiket: a.etiket, tur: configType(a.tur), sinif: "musteri" as const, ornek: null },
      }));
  }
  return c.kokler
    .filter((f) => f.yol.startsWith(`${root}.`))
    .map((f) => ({ id: f.yol, label: f.etiket, path: f.yol, kind: "field" as const, field: f }));
}

function configType(t: string): FieldType {
  if (t === "sayi") return "sayi";
  if (t === "mantiksal") return "mantiksal";
  return "metin";
}

/** İç alan opt-in edilmemişse kilitli: bağlamda YOKTUR, şablon ona atıf yaparsa render düşer. */
export function isFieldLocked(field: ContractField | undefined, internalFields: readonly string[]): boolean {
  if (!field || field.sinif !== "ic") return false;
  return !field.icKod || !internalFields.includes(field.icKod);
}

/** "İç alanı aç": kod listeye bir kez eklenir (sıra korunur). */
export function openInternalField(internalFields: readonly string[], code: string): string[] {
  return internalFields.includes(code) ? [...internalFields] : [...internalFields, code];
}

export const CUSTOMER_INTERNAL_WARNING =
  "Bu bir müşteri belgesi: iç alan açılırsa müşteriye giden çıktıda görünür. Yalnız bilerek açın.";

/** Bağlı yolu sözleşme alanına çözer; `satir.x` döngü değişkeni verilen tabloda aranır. */
export function resolveField(c: ContractView, path: string, loop?: { variable: string; tableKey: string }): ContractField | undefined {
  if (loop && path.startsWith(`${loop.variable}.`)) {
    const key = path.slice(loop.variable.length + 1);
    return c.tablolar.find((t) => t.anahtar === loop.tableKey)?.kolonlar.find((k) => k.yol === key);
  }
  return c.kokler.find((f) => f.yol === path);
}

/** Toplam kutusu yalnız `toplamlar.*` alanlarını bağlar. */
export function totalFields(c: ContractView): ContractField[] {
  return c.kokler.filter((f) => f.yol.startsWith("toplamlar."));
}

/** Örnek değerin kanvasta görünen metni. */
export function sampleText(f: ContractField | undefined, fallback: string): string {
  if (!f || f.ornek === null || f.ornek === "") return fallback;
  if (typeof f.ornek === "boolean") return f.ornek ? "Evet" : "Hayır";
  return String(f.ornek);
}
