// =============================================================================
// SHIPMENT_DISPATCH (Sevk İrsaliyesi) veri sözleşmesi — pilot
// =============================================================================
// Sistem renderer'ı (`document-render/shipment-dispatch.html.ts`) DEĞİŞMEZ ve
// burada YALNIZ OKUNUR: kolon görünürlüğü/sırası/başlığı, belge başlığı ve ad
// rejimi kararları onun çözücülerinden alınır ki eşlenik ayrı kural kurmasın.
// Rakamlar donmuş snapshot'tan okunur — toplam BRÜTTÜR ve yeniden hesaplanmaz.
// Beyanlar `.fields`, ayar `.config`, senaryolar `.scenarios` dosyasındadır.
// =============================================================================

import type { PrintedDocSnapshot } from "../../printed-document.service";
import { renderShipmentDispatchTables } from "../../document-render/shipment-dispatch.html";
import { customerNameOr, resolveDocNameMode } from "../../document-render/shipment-name-mode";
import { formatSackSeqLabel } from "../../helpers/sack-seq.helper";
import { pickExportCode, procedureCodeForDestination } from "../../helpers/shipment-destination.helper";
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
import { candidateEnvelope, normalizeConfig, plainJson } from "./shipment-dispatch.config";
import {
  CONFIG_SCHEMA,
  ROOT_FIELDS,
  TABLE_DEFS,
  TABLE_KEYS,
  columnViews,
  tableDef,
  type DispatchLiveOptions,
  type DispatchNoteConfig,
} from "./shipment-dispatch.fields";
import { scenarios } from "./shipment-dispatch.scenarios";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, PrintInput, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;
type RowValues = Record<string, ContextValue | undefined>;

const customerNameOrNull = (cust: string | null, ours: string | null): string | null =>
  ours === null && !cust?.trim() ? null : customerNameOr(cust, ours ?? "");

/** Bu baskıda gerçekten çizilecek tablolar ve başlık — renderer'ın kendi çözücüsünden. */
function effectiveTables(doc: Row, config: DispatchNoteConfig, optIn: ReadonlySet<string>, live: DispatchLiveOptions) {
  // Bölümler zorla açık: liste aç/kapa `ayar.sections`tadır, kolon düzeni ondan bağımsızdır.
  const columns = Object.fromEntries(
    TABLE_KEYS.map((tb) => [
      tb,
      {
        ...config.columns[tb],
        shown: [
          ...config.columns[tb].shown,
          ...tableDef(tb)
            .kolonlar.filter((c) => c.sinif === "ic" && c.icKod && optIn.has(c.icKod) && c.kaynakKolon)
            .map((c) => c.kaynakKolon as string),
        ],
      },
    ]),
  );
  return renderShipmentDispatchTables(
    candidateEnvelope(doc, { titleOverride: config.titleOverride, language: "tr", columns }),
    {
      itemNameMode: live.itemNameMode,
      cekiNameMode: live.cekiNameMode,
      productColorSplit: live.productColorSplit,
      packingLot: live.packingLot,
      sackSeq: live.sackSeq,
      rowNotes: live.rowNotes ?? {},
      rowTags: live.rowTags ?? {},
    },
  );
}

/** Kolon düzeni — opt-in edilmemiş iç kolon düzende de görünmez. */
function contextLayout(
  effective: ReturnType<typeof effectiveTables>,
  optIn: ReadonlySet<string>,
  colorSplit: boolean,
): Record<string, ContextValue> {
  const layout: Record<string, ContextValue> = {};
  for (const tb of TABLE_KEYS) {
    const cols = effective.tables.find((x) => x.key === tb)?.columns ?? [];
    layout[tb] = columnViews(tb, cols, colorSplit)
      .filter((g) => {
        const def = tableDef(tb).kolonlar.find((c) => c.yol === g.anahtar);
        return def?.sinif !== "ic" || (def.icKod !== undefined && optIn.has(def.icKod));
      })
      .map((g) => ({ ...g }));
  }
  return layout;
}

function docValues(h: Row, title: string | null, printInput: PrintInput | undefined): RowValues {
  const destination = h.destination === "EXPORT" ? "EXPORT" : "DOMESTIC";
  return {
    no: asText(h.shipmentNo),
    tur: "SHIPMENT_DISPATCH",
    baslik: title,
    tarih: asText(h.date),
    ...docStatus(printInput),
    yurtdisi: destination === "EXPORT",
    ihracat_kodu:
      h.exportCode !== undefined
        ? asText(h.exportCode)
        : pickExportCode({ branchCode: asText(h.branchCode), customerExportCode: asText(h.customerExportCode) }),
    gumruk_no: procedureCodeForDestination(destination, asText(h.procedureCode)),
    siparisler: asText(h.orderNos),
    plaka: asText(h.plateNumber),
    sofor: asText(h.driverName),
    tasiyici: asText(h.carrier),
  };
}

function productRows(products: Row[]): RowValues[] {
  return products.map((p) => {
    const name = asText(p.name);
    return {
      ad: name,
      musteri_ad: customerNameOrNull(asText(p.customerName), name),
      musteri_urun_adi: customerNameOrNull(asText(p.customerItemOnly) ?? asText(p.customerName), name),
      musteri_renk: asText(p.customerColorOnly),
      top_adedi: asNumber(p.rollCount),
      metre: asNumber(p.totalMeters),
    };
  });
}

function sackRows(sacks: Row[], live: DispatchLiveOptions, seqLabel: (seq: unknown) => string | null): RowValues[] {
  const rowNotes = live.rowNotes ?? {};
  const rowTags = live.rowTags ?? {};
  return sacks.map((s) => {
    const code = asText(s.code);
    return {
      kod: code,
      sira: asNumber(s.seq),
      sira_etiketi: seqLabel(s.seq),
      ambalaj_no: asNumber(s.packageNo),
      sevk_partisi: asText(s.packingGroupName),
      parti_kodu: asText(s.packingGroupCode),
      metre: asNumber(s.totalMeters),
      kg: asNumber(s.totalKg),
      top_adedi: asNumber(s.packageCount),
      aciklama: code !== null ? asText(rowNotes[code]) : null,
      iz: code !== null ? asText(rowTags[code]) : null,
    };
  });
}

function cekiRowValues(cekiRows: Row[], seqLabel: (seq: unknown) => string | null): RowValues[] {
  return cekiRows.map((c) => {
    const desen = asText(c.desen);
    const varyant = asText(c.varyant);
    return {
      cuval_kodu: asText(c.sackCode),
      sira: asNumber(c.seq),
      sira_etiketi: seqLabel(c.seq),
      ambalaj_no: asNumber(c.packageNo),
      sevk_partisi: asText(c.packingGroupName),
      parti_kodu: asText(c.packingGroupCode),
      barkod: asText(c.barcode),
      parti_no: asText(c.batchNumber),
      desen,
      varyant,
      musteri_desen: customerNameOrNull(asText(c.customerDesen), desen),
      musteri_varyant: customerNameOrNull(asText(c.customerVaryant), varyant),
      en: asNumber(c.width),
      metre: asNumber(c.meters),
      kg: asNumber(c.kg),
      hata_notu: asText(c.defectNote),
    };
  });
}

function buildContext(
  snapshot: PrintedDocSnapshot,
  rawConfig: unknown,
  internalFields: readonly string[],
  extras?: BuildExtras<DispatchLiveOptions>,
): TemplateContext {
  const config = normalizeConfig(rawConfig);
  const optIn = new Set(internalFields);
  const live: DispatchLiveOptions = extras?.canli ?? {};
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const t = asObject(doc.totals);
  const products = asRows(doc.products);
  const sacks = asRows(doc.sacks);
  const cekiRows = asRows(doc.cekiRows);
  const mod = resolveDocNameMode(live);
  const seqLabel = (seq: unknown): string | null =>
    live.sackSeq ? formatSackSeqLabel(asNumber(seq), sacks.length, live.sackSeq) : null;

  const effective = effectiveTables({ ...doc, header: h, totals: t, products, sacks, cekiRows }, config, optIn, live);
  const title = effective.header[0]?.[0] ?? null;
  const root = (rootKey: string, values: RowValues): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const buildRows = (tb: string, rows: RowValues[]): ContextObject[] =>
    rows.map((r) => fillFields(tableDef(tb).kolonlar, r, optIn));

  return {
    belge: root("belge", docValues(h, title, extras?.baski)),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", {
      ad: asText(h.customerName),
      kod: asText(h.customerCode),
      vergi_no: asText(h.customerTaxNumber),
      sube: asText(h.branchName),
      sube_kodu: asText(h.branchCode),
      ihracat_kodu: asText(h.customerExportCode),
    }),
    tablolar: {
      antet_ek: buildRows("antet_ek", letterheadExtraRows(snapshot)),
      urun: buildRows("urun", productRows(products)),
      cuval: buildRows("cuval", sackRows(sacks, live, seqLabel)),
      ceki: buildRows("ceki", cekiRowValues(cekiRows, seqLabel)),
    },
    // Donmuş toplamlar olduğu gibi: belge BRÜTTÜR (iade ayrı belge), şablon yeniden toplamaz.
    toplamlar: root("toplamlar", {
      top_adedi: asNumber(t.totalRolls),
      metre: asNumber(t.totalMeters),
      kg: asNumber(t.totalKg),
      cuval_adedi: asNumber(t.sackCount),
      cuval_beyan_adedi: asNumber(t.manualSackCount),
    }),
    ayar: {
      ...(plainJson(config) as unknown as Record<string, ContextValue>),
      kolonlar: contextLayout(effective, optIn, mod.productColorSplit),
    },
    ic_acik: internalFlags(optIn),
    baski: root("baski", {
      ...printRoot(extras?.baski, config.stamps.copyLabel),
      bizdeki_ad: mod.showOurName,
      musteri_ad: mod.showCustomerName,
      ceki_bizdeki_ad: mod.cekiShowOurName,
      ceki_musteri_ad: mod.cekiShowCustomerName,
      renk_ayri: mod.productColorSplit,
      ambalaj_partisi: live.packingLot === true,
      cuval_sira: !!live.sackSeq,
    }),
  };
}

/** Her iç alan kodu için DAİMA mantıksal değer (opt-in değilse false). */
function internalFlags(optIn: ReadonlySet<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of [...ROOT_FIELDS, ...TABLE_DEFS.flatMap((tb) => tb.kolonlar)]) {
    if (a.sinif === "ic" && a.icKod) out[a.icKod] = optIn.has(a.icKod);
  }
  return out;
}

export const shipmentDispatchContract: DocumentContract<DispatchNoteConfig, DispatchLiveOptions> = {
  docType: "SHIPMENT_DISPATCH",
  hedef: "musteri",
  contractVersion: 2, // 2: KQ-D8 ceki hata_notu (iç, opt-in)
  kokler: ROOT_FIELDS,
  tablolar: TABLE_DEFS,
  ayarSemasi: CONFIG_SCHEMA,
  ayarNormalize: normalizeConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
