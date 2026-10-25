// =============================================================================
// Fason belge sözleşmelerinin ORTAK ayar parçası (sevk, doğrudan sevk, kabul makbuzu)
// =============================================================================
// Üç renderer aynı `DocumentConfig` anahtarlarını aynı kuralla okur (`!== false` blocklist,
// boş imza listesi → varsayılan ikili); normalizasyon burada tek kez yazılır ki üç eşlenik
// aynı ayarı farklı yorumlamasın. Renderer çözücüleri (stil, kolon) SALT-OKUNUR çağrılır.
// =============================================================================

import { sanitizeDocumentsConfig, type DocumentConfig } from "../../system-setting.service";
import { resolveDocStyle, type BlankGridConfig, type DocFieldStyle } from "../../document-render/doc-style";
import { resolveDocTable, type DocColSpec, type DocFmtKit } from "../../document-render/doc-model";
import { docNum } from "../../document-render/fmt-num";
import type { ColumnView, ConfigFieldDef, TableDef } from "./tipler";

/** Senaryo toplarının kalite sütununda basılan ÖRNEK metin; kalite kararı değil, yalnız önizleme verisi. */
export const SAMPLE_GRADE_LABEL = "A";

export const plainJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Ham ayar → kayıt kapısının temizlediği `DocumentConfig` (bozuk girdi boş ayar olur). */
export function sanitizeRawConfig(raw: unknown): DocumentConfig {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (sanitizeDocumentsConfig({ s: raw as Record<string, unknown> }).s ?? {})
    : {};
}

export interface ColumnConfig {
  hidden: string[];
  order: string[];
  labels: Record<string, string>;
  blankLabels: string[];
}

/** Üç fason belgesinin ortak, eksiksiz (dondurulabilir) ayar gövdesi — DocumentConfig anahtarlarıyla. */
export interface BaseDocConfig {
  titleOverride: string;
  showLetterhead: boolean;
  showSignatures: boolean;
  signatureLabels: string[];
  footerNote: string;
  sections: Record<string, boolean>;
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
  qr: boolean;
  stamps: { printedAt: boolean; printedBy: boolean; copyLabel: string };
  blocks: { position: "afterHeader" | "beforeSignatures"; text: string }[];
  fields: Record<string, DocFieldStyle>;
  blankGrid: BlankGridConfig | null;
  columns: Record<string, ColumnConfig>;
  /** Ayara göre görünür, sıralı, başlığı çözülmüş kolonlar (`tablolar.<t>` satır anahtarlarıyla). */
  kolonlar: Record<string, ColumnView[]>;
}

const stringList = (v: string[] | undefined): string[] => (v ?? []).filter((x) => typeof x === "string");
const FONT_WEIGHT: Record<number, "light" | "normal" | "bold"> = { [-100]: "light", 0: "normal", 100: "bold" };

/** Bölüm anahtarları: değer = anahtar yokken renderer'ın davranışı (blocklist true, opt-in false). */
export type SectionDefaults = Readonly<Record<string, boolean>>;

export function normalizeBase(
  cfg: DocumentConfig,
  opts: { sections: SectionDefaults; signatureDefaults: readonly string[]; marginMm: number; tables: readonly string[] },
): Omit<BaseDocConfig, "kolonlar"> {
  const st = resolveDocStyle(cfg.style, { marginMm: opts.marginMm });
  const sections: Record<string, boolean> = {};
  for (const [k, dflt] of Object.entries(opts.sections)) {
    const v = cfg.sections?.[k];
    sections[k] = typeof v === "boolean" ? v : dflt;
  }
  const columns: Record<string, ColumnConfig> = {};
  for (const t of opts.tables) {
    const c = cfg.columns?.[t] ?? {};
    columns[t] = {
      hidden: stringList(c.hidden),
      order: stringList(c.order),
      labels: { ...(c.labels ?? {}) },
      blankLabels: stringList(c.blankLabels),
    };
  }
  return {
    titleOverride: cfg.titleOverride ?? "",
    showLetterhead: cfg.showLetterhead !== false,
    showSignatures: cfg.showSignatures !== false,
    signatureLabels: cfg.signatureLabels?.length ? [...cfg.signatureLabels] : [...opts.signatureDefaults],
    footerNote: cfg.footerNote ?? "",
    sections,
    style: {
      pageSize: st.pageSize,
      margins: { ...st.margins },
      fontScale: st.fontScale,
      fontWeight: FONT_WEIGHT[st.weightDelta] ?? "normal",
      tableDensity: st.tableDensity,
      tableStyle: st.tableStyle,
    },
    showLogo: cfg.showLogo !== false,
    logoPosition: cfg.logoPosition === "right" ? "right" : "left",
    qr: cfg.qr === true,
    stamps: {
      printedAt: cfg.stamps?.printedAt === true,
      printedBy: cfg.stamps?.printedBy === true,
      copyLabel: cfg.stamps?.copyLabel ?? "",
    },
    blocks: plainJson(cfg.blocks ?? []),
    fields: plainJson(cfg.fields ?? {}),
    blankGrid: cfg.blankGrid ? plainJson(cfg.blankGrid) : null,
    columns,
  };
}

const KIT: DocFmtKit = { esc: (v) => String(v ?? ""), fmtTr: docNum({}).tr };

/** Renderer kolonları (anahtar/başlık/hiza) → sözleşme satır anahtarlı görünüm. */
export function columnViewsOf(table: TableDef, cols: ReadonlyArray<{ key: string; label: string; align: "l" | "r" | "c" }>): ColumnView[] {
  return cols.flatMap((c) => {
    const def = table.kolonlar.find((k) => k.kaynakKolon === c.key);
    return def ? [{ anahtar: def.yol, kaynak: c.key, etiket: c.label, hiza: c.align, toplam: def.toplam ?? null }] : [];
  });
}

/** Kolon ayarını renderer'ın tablo çözücüsüyle uygular (hidden/order/labels/blankLabels; başlık ham). */
export function resolveColumns(table: TableDef, specs: DocColSpec<never>[], colCfg: ColumnConfig): ColumnView[] {
  const model = resolveDocTable<never>({ key: table.anahtar, caption: "", cols: specs, rows: [], colCfg, kit: KIT });
  return columnViewsOf(table, model.columns);
}

/** `tables`: [ayar kolon anahtarı (`columns.<x>`), bağlam tablo anahtarı (`kolonlar.<y>`)]. */
export function baseConfigSchema(sectionKeys: readonly string[], tables: ReadonlyArray<readonly [string, string]>): ConfigFieldDef[] {
  return [
    { yol: "titleOverride", etiket: "Başlık (boş = varsayılan)", tur: "metin" },
    { yol: "showLetterhead", etiket: "Künye basılsın", tur: "mantiksal" },
    { yol: "showSignatures", etiket: "İmza kutuları", tur: "mantiksal" },
    { yol: "signatureLabels", etiket: "İmza etiketleri", tur: "liste" },
    { yol: "footerNote", etiket: "Alt not", tur: "metin" },
    ...sectionKeys.map((b): ConfigFieldDef => ({ yol: `sections.${b}`, etiket: `Bölüm: ${b}`, tur: "mantiksal" })),
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
    ...tables.flatMap(([t, k]): ConfigFieldDef[] => [
      { yol: `columns.${t}.hidden`, etiket: `${t}: gizli kolonlar`, tur: "liste" },
      { yol: `columns.${t}.order`, etiket: `${t}: kolon sırası`, tur: "liste" },
      { yol: `columns.${t}.labels`, etiket: `${t}: kolon başlıkları`, tur: "nesne" },
      { yol: `columns.${t}.blankLabels`, etiket: `${t}: başlıksız kolonlar`, tur: "liste" },
      { yol: `kolonlar.${k}`, etiket: `${k}: çözülmüş kolon düzeni`, tur: "liste" },
    ]),
    { yol: "qr", etiket: "Doğrulama karekodu", tur: "mantiksal" },
    { yol: "stamps.printedAt", etiket: "Basım zamanı damgası", tur: "mantiksal" },
    { yol: "stamps.printedBy", etiket: "Basan damgası", tur: "mantiksal" },
    { yol: "stamps.copyLabel", etiket: "Nüsha etiketi", tur: "metin" },
    { yol: "blocks", etiket: "Serbest metin blokları", tur: "liste" },
    { yol: "fields", etiket: "Alan yazı ayarları", tur: "nesne" },
    { yol: "blankGrid", etiket: "Boş grid", tur: "nesne" },
  ];
}
