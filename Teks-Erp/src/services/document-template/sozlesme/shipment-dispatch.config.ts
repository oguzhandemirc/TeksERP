// =============================================================================
// SHIPMENT_DISPATCH sözleşmesi — ayar normalizasyonu (renderer çözücüleri SALT-OKUR)
// =============================================================================

import type { PrintedDocSnapshot } from "../../printed-document.service";
import { sanitizeDocumentsConfig, type DocumentConfig } from "../../system-setting.service";
import { renderShipmentDispatchTables } from "../../document-render/shipment-dispatch.html";
import { resolveDocStyle } from "../../document-render/doc-style";
import { resolveDocTable, type DocColSpec, type DocFmtKit } from "../../document-render/doc-model";
import { docNum } from "../../document-render/fmt-num";
import {
  SECTION_DEFAULTS,
  SIGNATURE_DEFAULTS,
  TABLE_KEYS,
  columnViews,
  internalSourceKeys,
  type DispatchColumnConfig,
  type DispatchNoteConfig,
  type SectionKey,
  type TableKey,
} from "./shipment-dispatch.fields";
import type { ColumnView } from "./tipler";

/** Değerleri önemsiz aday zarf — renderer'dan kolon kümesini/başlıklarını almak için. */
export function candidateEnvelope(doc: Record<string, unknown>, cfg: DocumentConfig): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "",
    company: { name: "", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: cfg,
    doc,
  };
}

const CANDIDATE_DOC = {
  header: { destination: "DOMESTIC" },
  products: [{ name: "x", rollCount: 0, totalMeters: 0 }],
  sacks: [{ code: "x", seq: 1, totalMeters: 0, totalKg: 0, packageCount: 0 }],
  cekiRows: [{ sackCode: "x", desen: "x", varyant: "x", meters: 0, kg: 0, barcode: null }],
  totals: { totalRolls: 0, totalMeters: 0, totalKg: 0, sackCount: 0 },
};

const KIT: DocFmtKit = { esc: (v) => String(v ?? ""), fmtTr: docNum({}).tr };

let candidateColumnsCache: Record<TableKey, DocColSpec<never>[]> | null = null;

/** Her canlı anahtar açıkken renderer'ın çizdiği kolonlar = aday küme (varsayılan başlık + sıra). */
function candidateColumns(): Record<TableKey, DocColSpec<never>[]> {
  if (candidateColumnsCache) return candidateColumnsCache;
  const cfg: DocumentConfig = {
    columns: Object.fromEntries(TABLE_KEYS.map((t) => [t, { shown: internalSourceKeys(t) }])),
  };
  const out = renderShipmentDispatchTables(candidateEnvelope(CANDIDATE_DOC, cfg), {
    packingLot: true,
    sackSeq: { prefix: "", showTotal: false },
    itemNameMode: "ikisi",
    cekiNameMode: "ikisi",
    productColorSplit: true,
    rowNotes: { x: "x" },
    rowTags: { x: "x" },
  });
  const result = {} as Record<TableKey, DocColSpec<never>[]>;
  for (const t of TABLE_KEYS) {
    const internalKeys = new Set(internalSourceKeys(t));
    result[t] = (out.tables.find((x) => x.key === t)?.columns ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      align: c.align,
      kind: c.kind,
      value: () => null,
      ...(internalKeys.has(c.key) ? { defaultHidden: true } : {}),
    }));
  }
  candidateColumnsCache = result;
  return result;
}

const stringList = (v: string[] | undefined): string[] => (v ?? []).filter((x) => typeof x === "string");
const FONT_WEIGHT: Record<number, "light" | "normal" | "bold"> = { [-100]: "light", 0: "normal", 100: "bold" };
export const plainJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function normalizeConfig(raw: unknown): DispatchNoteConfig {
  const cfg: DocumentConfig =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (sanitizeDocumentsConfig({ s: raw as Record<string, unknown> }).s ?? {})
      : {};
  const st = resolveDocStyle(cfg.style, { marginMm: 9 });
  const sections = {} as Record<SectionKey, boolean>;
  for (const [b, dflt] of Object.entries(SECTION_DEFAULTS) as [SectionKey, boolean][]) {
    const v = cfg.sections?.[b];
    sections[b] = typeof v === "boolean" ? v : dflt;
  }
  const columns = {} as Record<TableKey, DispatchColumnConfig>;
  for (const t of TABLE_KEYS) {
    const c = cfg.columns?.[t] ?? {};
    const internalKeys = new Set(internalSourceKeys(t));
    columns[t] = {
      hidden: stringList(c.hidden),
      order: stringList(c.order),
      // İç kolonun tek kapısı `internalFields` (plan Z4) — `shown` onu açamaz.
      shown: stringList(c.shown).filter((x) => !internalKeys.has(x)),
      labels: { ...(c.labels ?? {}) },
      blankLabels: stringList(c.blankLabels),
    };
  }
  const layout = {} as Record<TableKey, ColumnView[]>;
  for (const t of TABLE_KEYS) {
    const model = resolveDocTable<never>({
      key: t,
      caption: "",
      cols: candidateColumns()[t],
      rows: [],
      colCfg: { ...columns[t], shown: [...columns[t].shown, ...internalSourceKeys(t)] },
      kit: KIT,
    });
    layout[t] = columnViews(t, model.columns, false);
  }
  return {
    titleOverride: cfg.titleOverride ?? "",
    showLetterhead: cfg.showLetterhead !== false,
    showSignatures: cfg.showSignatures !== false,
    signatureLabels: cfg.signatureLabels?.length ? [...cfg.signatureLabels] : [...SIGNATURE_DEFAULTS],
    footerNote: cfg.footerNote ?? "",
    footerNotePlacement: cfg.footerNotePlacement === "top" ? "top" : "bottom",
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
    columns,
    qr: cfg.qr === true,
    stamps: {
      printedAt: cfg.stamps?.printedAt === true,
      printedBy: cfg.stamps?.printedBy === true,
      copyLabel: cfg.stamps?.copyLabel ?? "",
    },
    blocks: plainJson(cfg.blocks ?? []),
    language: "tr",
    blankWidths: cfg.blankWidths === true,
    fields: plainJson(cfg.fields ?? {}),
    blankGrid: cfg.blankGrid ? plainJson(cfg.blankGrid) : null,
    kolonlar: layout,
  };
}
