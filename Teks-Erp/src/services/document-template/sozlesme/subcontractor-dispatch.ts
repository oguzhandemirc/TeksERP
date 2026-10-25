// =============================================================================
// SUBCONTRACTOR_DISPATCH (Fason Sevk — KUMAŞ İRSALİYESİ) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/fason-ceki.html.ts`) DEĞİŞMEZ ve burada YALNIZ
// OKUNUR. Izgara sayfalaması veri katmanındadır: `tablolar.izgara` sayfalara bölünmüş
// hücre dizisidir (grup × satır renderer'ın çözücüleriyle); şablon hesap yapmaz.
// Fason çeki TASLAĞI ayrı tür değildir: aynı sözleşme, `baski.taslak` + TASLAK üst katmanı.
// Fasoncu kimliği `karsi_taraf`; opt-in iç kolon yok → `hedef: musteri`. Metre BRÜT
// gönderilendir (donmuş toplam); dönen metre kabul makbuzunun işidir.
// =============================================================================

import { resolveGridGroups, resolveGridRows, FASON_DENSITY, resolveFasonPageSize } from "../../document-render/fason-ceki.density";
import { docTitle } from "../../document-render/doc-style";
import type { DocColSpec } from "../../document-render/doc-model";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
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
import { ROOT_FIELDS, SUMMARY_TABLE, TABLE_DEFS } from "./subcontractor-dispatch.fields";
import { scenarios } from "./subcontractor-dispatch.scenarios";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ConfigFieldDef, ContextObject, ContextValue, DocumentContract, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;
type RowValues = Record<string, ContextValue | undefined>;

/** Renderer'ın okuduğu bölümler: `accountNo` ve `fabricHeader` OPT-IN (`=== true`), diğerleri blocklist. */
export const DISPATCH_SECTIONS = {
  subcontractorInfo: true,
  workOrderInfo: true,
  accountNo: false,
  batchInfo: true,
  fabricHeader: false,
  requestedColor: true,
  vehicleInfo: true,
  dyeColorLine: true,
  productionProps: true,
  instructionWarning: true,
  gridWidth: true,
  dyehouseNote: true,
  notes: true,
} as const;

const TABLES = [["totals", "ozet"]] as const;

export interface FasonDispatchConfig extends BaseDocConfig {
  blankWidths: boolean;
  /** Satır başına grup (3/4/5) ve grup başına satır — sayfa başına top = grup × satır. */
  gridGroups: number;
  gridRows: number;
  placements: { batchInfo: "left" | "right" };
}


const tableOf = (key: string): TableDef => TABLE_DEFS.find((t) => t.anahtar === key)!;

/** Renderer alt tablosunun kolonları (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
const SUMMARY_SPECS: DocColSpec<never>[] = [
  { key: "cins", label: "CİNSİ", align: "l", width: "38%", cellClass: "cins", kind: { t: "text" }, value: () => null },
  ...(["en:EN", "top:TOP", "metre:METRE", "fiyat:FİYATI", "tutar:TUTARI"] as const).map((s): DocColSpec<never> => {
    const [key, label] = s.split(":") as [string, string];
    return { key, label, align: "l", kind: { t: "text" }, value: () => null };
  }),
];

const EXTRA_SCHEMA: ConfigFieldDef[] = [
  { yol: "blankWidths", etiket: "En değerleri boş (elle yazılacak)", tur: "mantiksal" },
  { yol: "gridGroups", etiket: "Izgara: satır başına grup (3–5)", tur: "sayi" },
  { yol: "gridRows", etiket: "Izgara: grup başına satır", tur: "sayi" },
  { yol: "placements.batchInfo", etiket: "Parti no tarafı", tur: "secim", secenekler: ["left", "right"] },
];

export function normalizeFasonDispatchConfig(raw: unknown): FasonDispatchConfig {
  const cfg = sanitizeRawConfig(raw);
  const base = normalizeBase(cfg, {
    sections: DISPATCH_SECTIONS,
    signatureDefaults: ["Teslim Eden", "Teslim Alan"],
    marginMm: FASON_DENSITY[resolveFasonPageSize(cfg.style?.pageSize)].marginMm,
    tables: TABLES.map(([t]) => t),
  });
  return {
    ...base,
    kolonlar: { ozet: resolveColumns(SUMMARY_TABLE, SUMMARY_SPECS, base.columns.totals!) },
    blankWidths: cfg.blankWidths === true,
    gridGroups: resolveGridGroups(cfg.gridGroups),
    gridRows: resolveGridRows(cfg.gridRows),
    placements: { batchInfo: cfg.placements?.batchInfo === "left" ? "left" : "right" },
  };
}

/** Renderer'ın `uniqNonEmpty` kuralı: kırpılmış, boşsuz, ilk görülme sırasıyla tekil. */
function uniqueTrimmed(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = (typeof v === "string" ? v : "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Izgara hücreleri: sayfa başına grup × satır, sütun öncelikli top numarası (renderer `renderGridPage`). */
function gridCells(rolls: Row[], groups: number, rows: number): RowValues[] {
  const slots = groups * rows;
  const pages = Math.max(1, Math.ceil(rolls.length / slots));
  const out: RowValues[] = [];
  for (let p = 0; p < pages; p++) {
    for (let r = 0; r < rows; r++) {
      for (let g = 0; g < groups; g++) {
        const topNo = p * slots + g * rows + r + 1;
        const roll = rolls[topNo - 1];
        out.push({
          top_no: topNo,
          metre: roll ? asNumber(roll.dispatchedQty) : null,
          sayfa_basi: r === 0 && g === 0,
          sayfa_sonu: r === rows - 1 && g === groups - 1,
          satir_basi: g === 0,
          satir_sonu: g === groups - 1,
        });
      }
    }
  }
  return out;
}

/** Talimat kutusu verisi — renderer'ın "veri boşluğu" yüklemi (ayar değil HAM veri). */
function commandValues(doc: Row) {
  const cmd = doc.commands && typeof doc.commands === "object" ? asObject(doc.commands) : null;
  const works = asRows<{ name?: unknown; value?: unknown }>(cmd?.works).filter((w) => typeof w.name === "string");
  const hasColor = (asText(cmd?.color) ?? "").trim() !== "";
  const hasWorks = works.some((w) => (w.name as string).trim() !== "");
  const hasInstruction = (asText(doc.instruction) ?? "").trim() !== "";
  const targets = Array.isArray(doc.targetProperties) ? doc.targetProperties.filter((x): x is string => typeof x === "string") : [];
  const hasTarget = targets.some((p) => p.trim() !== "");
  const sortedWorks = works
    .filter((w) => (w.name as string).trim())
    .sort((a, b) => (a.name as string).localeCompare(b.name as string, "tr"))
    .map((w) => ({ ad: w.name as string, deger: asText(w.value) }));
  return {
    present: cmd !== null,
    color: asText(cmd?.color),
    works: sortedWorks,
    targets,
    emptyData: cmd !== null && !hasColor && !hasWorks && !hasInstruction && !hasTarget,
  };
}

function buildContext(
  snapshot: PrintedDocSnapshot,
  rawConfig: unknown,
  internalFields: readonly string[],
  extras?: BuildExtras<never>,
): TemplateContext {
  const config = normalizeFasonDispatchConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const sub = asObject(doc.subcontractor);
  const wo = asObject(doc.workOrder);
  const totals = asObject(doc.totals);
  const rolls = asRows(doc.rolls);
  const cmd = commandValues(doc);
  const requested = asText(doc.requestedColor);
  const root = (rootKey: string, values: RowValues): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = (key: string, values: RowValues[]): ContextObject[] => values.map((r) => fillFields(tableOf(key).kolonlar, r, optIn));
  const named = (list: string[]): RowValues[] => list.map((ad) => ({ ad }));

  return {
    belge: root("belge", {
      no: asText(doc.dispatchNo),
      tur: "SUBCONTRACTOR_DISPATCH",
      baslik: docTitle(config.titleOverride, "KUMAŞ İRSALİYESİ"),
      tarih: asText(doc.dispatchedAt),
      ...docStatus(extras?.baski),
      plaka: asText(doc.plateNumber),
      sofor: asText(doc.driverName),
      notlar: asText(doc.notes),
      is_emri_no: asText(wo.workOrderNumber),
      istasyon: asText(asObject(asObject(doc.step).station).name),
      en: asNumber(wo.width),
      parti_no: asText(doc.batchNumber),
      cins: asText(rolls[0]?.itemName),
      istenen_renk: requested,
      renk: requested ?? asText(rolls[0]?.colorName),
      talimat: asText(doc.instruction),
      komut_var: cmd.present,
      boyanacak_renk: cmd.color,
      talimat_girilmemis: cmd.emptyData,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(sub.name), kod: asText(sub.code) }),
    tablolar: {
      antet_ek: rows("antet_ek", letterheadExtraRows(snapshot)),
      izgara: rows("izgara", gridCells(rolls, config.gridGroups, config.gridRows)),
      ozet: rows("ozet", [
        {
          cins: asText(rolls[0]?.itemName),
          en: asNumber(wo.width),
          top_adedi: asNumber(totals.rollCount),
          metre: asNumber(totals.totalQty),
          fiyat: null,
          tutar: null,
        },
      ]),
      toplar: rows(
        "toplar",
        rolls.map((r) => ({
          sira: asNumber(r.sequence),
          barkod: asText(r.barcode),
          urun: asText(r.itemName),
          renk: asText(r.colorName),
          metre: asNumber(r.dispatchedQty),
          kg: asNumber(r.dispatchedWeight),
          kalite: asText(r.qualityGrade),
        })),
      ),
      kumaslar: rows("kumaslar", named(uniqueTrimmed(rolls.map((r) => r.itemName)))),
      renkler: rows("renkler", named(uniqueTrimmed([requested, ...rolls.map((r) => r.colorName)]))),
      islemler: rows("islemler", cmd.works),
      hedef_ozellikler: rows("hedef_ozellikler", named(cmd.targets)),
    },
    // Donmuş toplamlar olduğu gibi (brüt gönderilen); şablon yeniden toplamaz.
    toplamlar: root("toplamlar", {
      top_adedi: asNumber(totals.rollCount),
      metre: asNumber(totals.totalQty),
      kg: asNumber(totals.totalWeight),
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

export const subcontractorDispatchContract: DocumentContract<FasonDispatchConfig, never> = {
  docType: "SUBCONTRACTOR_DISPATCH",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: TABLE_DEFS,
  ayarSemasi: [...baseConfigSchema(Object.keys(DISPATCH_SECTIONS), TABLES), ...EXTRA_SCHEMA],
  ayarNormalize: normalizeFasonDispatchConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
