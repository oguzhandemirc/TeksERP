// =============================================================================
// TRAVELER_CARD sözleşmesinin AYAR yarısı — kart ayarı + ondan türetilen görünüm
// =============================================================================
// Hücre stilleri renderer'ın çözümünün eşidir (Liquid'de hesap yok); global ölçek ve
// kalınlık satır içi stile önceden uygulanır.
// =============================================================================

import { cssFixed } from "../../document-render/fmt-num";
import { DENSITY, PX_SCALE, resolveFrozenPageSize } from "../../document-render/traveler-card.density";
import { resolveSectionOrder } from "../../document-render/traveler-card.sections";
import { normalizeTravelerCardConfig, type TravelerCardConfig } from "../../system-setting.service";
import { asObject } from "./ortak";
import { plainJson } from "./subcontractor-common";
import type { ConfigFieldDef } from "./tipler";

// ── Ayar: kart ayarı (`normalizeTravelerCardConfig`) + ondan türetilen görünüm ──────────────

interface CellView {
  anahtar: string;
  etiket: string;
  vurgu: boolean;
  /** Satır içi stil (boş = yok); global ölçek/kalınlık uygulanmış. */
  stil: string;
}
interface ColumnStyleView {
  sinif: string;
  baslik: string;
  stil: string;
}
interface TotalView {
  goster: boolean;
  stil: string;
  /** TOPLAM etiketinin kapladığı kolon sayısı (0 = etiket yok). */
  etiket_genislik: number;
  /** Etiketten sonraki hücrelerin sınıf sırası. */
  duzen: string[];
}

export type TravelerCardTemplateConfig = Omit<TravelerCardConfig, "sections" | "fields" | "blankGrid"> & {
  sections: NonNullable<TravelerCardConfig["sections"]>;
  fields: NonNullable<TravelerCardConfig["fields"]>;
  blankGrid: TravelerCardConfig["blankGrid"] | null;
  bolumler: string[];
  ozet_hucreleri: CellView[];
  siparis_kolonlari: ColumnStyleView[];
  siparis_toplam: TotalView;
  parti_kolonlari: ColumnStyleView[];
  parti_toplam: TotalView;
  kolonlar: Record<string, never>;
};

const DERIVED_KEYS = ["kolonlar", "bolumler", "ozet_hucreleri", "siparis_kolonlari", "siparis_toplam", "parti_kolonlari", "parti_toplam"] as const;

interface SpecCell {
  show: boolean;
  size: string;
  weight: string;
  px?: number;
}
const CELL_WEIGHTS = new Set(["light", "medium", "bold", "black"]);
const OVR_WEIGHT: Record<string, number> = { light: 400, medium: 600, bold: 800, black: 900 };
const FULL_WEIGHT: Record<string, number> = { light: 400, normal: 600, medium: 700, bold: 800, black: 900 };

/** Renderer'ın hücre çözümünün eşi (eski boolean şekil dahil). */
function specCell(v: unknown): SpecCell {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const o = v as Record<string, unknown>;
  const px = typeof o.px === "number" && Number.isFinite(o.px) ? o.px : undefined;
  return {
    show: o.show !== false,
    size: o.size === "sm" || o.size === "lg" ? (o.size as string) : "md",
    weight: typeof o.weight === "string" && CELL_WEIGHTS.has(o.weight) ? o.weight : "normal",
    ...(px != null ? { px } : {}),
  };
}

/** Renderer'ın baskı sonrası global ölçek/kalınlık kaydırmasını satır içi stile uygular. */
function scaled(decls: Array<[string, number]>, fontScale: number, weightDelta: number): string {
  return decls
    .map(([k, v]) => {
      if (k === "font-size" && fontScale !== 1) return `${k}: ${Number(cssFixed(v * fontScale, 2))}px`;
      if (k === "font-size") return `${k}:${v}px`;
      return weightDelta !== 0 ? `${k}: ${Math.min(900, Math.max(200, v + weightDelta))}` : `${k}:${v}`;
    })
    .join(";");
}

type CellMap = Record<string, number>;
interface Styler {
  d: (typeof DENSITY)[keyof typeof DENSITY];
  /** Yalnız ayarda verilen boyut/kalınlık (renderer'ın hücre ezmesi). */
  ovr: (c: SpecCell, map: CellMap) => string;
  /** Tam stil (toplam satırı: boyut + kalınlık hep yazılır). */
  full: (c: SpecCell, map: CellMap) => string;
}

function makeStyler(cfg: TravelerCardConfig): Styler {
  const pageSize = resolveFrozenPageSize(cfg.pageSize);
  const pxScale = PX_SCALE[pageSize];
  const fontScale = cfg.fontScale > 0 ? Math.min(1.4, Math.max(0.7, cfg.fontScale)) : 1;
  const weightDelta = cfg.fontWeight === "light" ? -100 : cfg.fontWeight === "bold" ? 100 : 0;
  const pxOf = (c: SpecCell, map: CellMap): number | undefined =>
    c.px != null ? Math.round(c.px * pxScale * 100) / 100 : map[c.size];
  return {
    d: DENSITY[pageSize],
    ovr: (c, map) => {
      const decls: Array<[string, number]> = [];
      const size = pxOf(c, map);
      if (size != null) decls.push(["font-size", size]);
      if (OVR_WEIGHT[c.weight] != null) decls.push(["font-weight", OVR_WEIGHT[c.weight]!]);
      return scaled(decls, fontScale, weightDelta);
    },
    full: (c, map) =>
      scaled([["font-size", pxOf(c, map) ?? map.md!], ["font-weight", FULL_WEIGHT[c.weight] ?? 600]], fontScale, weightDelta),
  };
}

const SUMMARY_CELLS: Array<[string, string, boolean]> = [
  ["color", "Renk", false],
  ["width", "En", false],
  ["targetQuantity", "Hedef Metraj", true],
  ["targetWeight", "Hedef Ağırlık", false],
  ["foldType", "Kat Tipi", false],
  ["startDate", "Başlangıç", false],
  ["endDate", "Bitiş", false],
];
const ORDER_COLUMNS: Array<[string, string, string]> = [
  ["orderNumber", "o-num", "Sipariş No"],
  ["customer", "o-cus", "Müşteri"],
  ["item", "o-item", "Ürün"],
  ["color", "o-color", "Renk"],
  ["quantity", "o-qty", "Miktar"],
];
const BATCH_COLUMNS: Array<[string, string, string]> = [
  ["batchNumber", "b-no", "Parti No"],
  ["rollCount", "b-cnt", "Top"],
  ["quantity", "b-qty", "Metraj"],
  ["dispatch", "b-disp", "Sevk"],
];

function summaryCellsOf(cfg: TravelerCardConfig, st: Styler): CellView[] {
  const sf = cfg.specFields as unknown as Record<string, unknown>;
  const specMap = { sm: st.d.specSm, lg: st.d.specLg };
  return SUMMARY_CELLS.flatMap(([anahtar, etiket, vurgu]) => {
    const c = specCell(sf[anahtar]);
    return c.show ? [{ anahtar, etiket, vurgu, stil: st.ovr(c, specMap) }] : [];
  });
}

function columnsOf(defs: Array<[string, string, string]>, fields: unknown, map: CellMap, st: Styler): ColumnStyleView[] {
  const src = fields as Record<string, unknown>;
  return defs.flatMap(([k, sinif, baslik]) => {
    const c = specCell(src[k]);
    return c.show ? [{ sinif, baslik, stil: st.ovr(c, map) }] : [];
  });
}

function orderViewOf(cfg: TravelerCardConfig, st: Styler): { columns: ColumnStyleView[]; total: TotalView } {
  const d = st.d;
  const columns = columnsOf(ORDER_COLUMNS, cfg.orderFields, { sm: d.ordSm, lg: d.ordLg }, st);
  const total = specCell(cfg.orderTotal);
  return {
    columns,
    total: {
      goster: total.show && columns.some((c) => c.sinif === "o-qty"),
      stil: st.full(total, { sm: d.ordSm, md: d.ord, lg: d.ordLg }),
      etiket_genislik: Math.max(0, columns.length - 1),
      duzen: ["o-qty"],
    },
  };
}

function batchViewOf(cfg: TravelerCardConfig, st: Styler): { columns: ColumnStyleView[]; total: TotalView } {
  const d = st.d;
  const columns = columnsOf(BATCH_COLUMNS, cfg.batchFields, { sm: d.batSm, lg: d.batLg }, st);
  const total = specCell(cfg.batchTotal);
  const layout = ["b-seq", ...columns.map((c) => c.sinif)];
  const firstNum = layout.findIndex((c) => c === "b-cnt" || c === "b-qty");
  return {
    columns,
    total: {
      goster: total.show && firstNum > 0,
      stil: st.full(total, { sm: d.batSm, md: d.bat, lg: d.batLg }),
      etiket_genislik: Math.max(0, firstNum),
      duzen: firstNum > 0 ? layout.slice(firstNum) : [],
    },
  };
}

export function normalizeTravelerCardTemplateConfig(raw: unknown): TravelerCardTemplateConfig {
  const clean: Record<string, unknown> = { ...asObject(raw) };
  for (const k of DERIVED_KEYS) delete clean[k];
  const cfg = normalizeTravelerCardConfig(clean);
  const st = makeStyler(cfg);
  const orders = orderViewOf(cfg, st);
  const batches = batchViewOf(cfg, st);
  const sections = resolveSectionOrder(cfg.sections);
  return plainJson({
    ...cfg,
    sections,
    fields: cfg.fields ?? {},
    blankGrid: cfg.blankGrid ?? null,
    bolumler: sections.filter((s) => s.enabled !== false).map((s) => s.key),
    ozet_hucreleri: summaryCellsOf(cfg, st),
    siparis_kolonlari: orders.columns,
    siparis_toplam: orders.total,
    parti_kolonlari: batches.columns,
    parti_toplam: batches.total,
    kolonlar: {},
  });
}

export const TRAVELER_CONFIG_SCHEMA: ConfigFieldDef[] = [
  { yol: "companyName", etiket: "Kart firma adı (boş = kurulum adı)", tur: "metin" },
  { yol: "addressLine", etiket: "Adres satırı", tur: "metin" },
  { yol: "phone", etiket: "Telefon", tur: "metin" },
  { yol: "pageSize", etiket: "Sayfa boyutu", tur: "secim", secenekler: ["A4", "A5"] },
  { yol: "margins.top", etiket: "Üst kenar (mm)", tur: "sayi" },
  { yol: "margins.right", etiket: "Sağ kenar (mm)", tur: "sayi" },
  { yol: "margins.bottom", etiket: "Alt kenar (mm)", tur: "sayi" },
  { yol: "margins.left", etiket: "Sol kenar (mm)", tur: "sayi" },
  { yol: "fontScale", etiket: "Yazı ölçeği", tur: "sayi" },
  { yol: "fontWeight", etiket: "Yazı kalınlığı", tur: "secim", secenekler: ["light", "normal", "bold"] },
  { yol: "showOperationGrid", etiket: "Operasyon kaydı", tur: "mantiksal" },
  { yol: "showNotes", etiket: "Talimatlar", tur: "mantiksal" },
  { yol: "showOrders", etiket: "Bağlı siparişler", tur: "mantiksal" },
  { yol: "showProperties", etiket: "Özellikler", tur: "mantiksal" },
  { yol: "specFields", etiket: "Özet tablo hücreleri", tur: "nesne" },
  { yol: "specColumns", etiket: "Özet tablo sütun sayısı", tur: "sayi" },
  { yol: "orderFields", etiket: "Sipariş kolonları", tur: "nesne" },
  { yol: "orderTotal", etiket: "Sipariş toplam satırı", tur: "nesne" },
  { yol: "showBatches", etiket: "Partiler", tur: "mantiksal" },
  { yol: "batchFields", etiket: "Parti kolonları", tur: "nesne" },
  { yol: "batchTotal", etiket: "Parti toplam satırı", tur: "nesne" },
  { yol: "sections", etiket: "Bölüm sırası ve aç/kapa", tur: "liste" },
  { yol: "fields", etiket: "Alan yazı ayarları", tur: "nesne" },
  { yol: "blankGrid", etiket: "Boş tablo", tur: "nesne" },
  { yol: "footerNote", etiket: "Alt not", tur: "metin" },
  { yol: "bolumler", etiket: "Basılacak bölümler (sıralı, ayardan)", tur: "liste" },
  { yol: "ozet_hucreleri", etiket: "Özet tablo hücreleri (ayardan; anahtar/etiket/vurgu/stil)", tur: "liste" },
  { yol: "siparis_kolonlari", etiket: "Sipariş kolonları (ayardan; sinif/baslik/stil)", tur: "liste" },
  { yol: "siparis_toplam", etiket: "Sipariş toplam satırı (ayardan)", tur: "nesne" },
  { yol: "parti_kolonlari", etiket: "Parti kolonları (ayardan; sinif/baslik/stil)", tur: "liste" },
  { yol: "parti_toplam", etiket: "Parti toplam satırı (ayardan)", tur: "nesne" },
  { yol: "kolonlar", etiket: "Kolon düzeni (kartta yok — boş)", tur: "nesne" },
];
