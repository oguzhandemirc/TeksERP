// =============================================================================
// KÜP `finans` — alacak yaşlandırması, KESİT (R1-SEMKUP; yalnız helper ölçü)
// =============================================================================
// Cari Yaşlandırma'nın çekirdeğine (`getAgingReport`, `asOf` = aralığın sonu) bağlıdır; ikinci
// bir bakiye formülü yazılmaz. Para birimleri TOPLANMAZ (para birimi başına satır). Vade kovası
// süzgeci yalnız DÖKÜMÜ daraltır: cari bakiyesi/kovası yeniden hesaplanmaz, seçilen kovalar okunur.
// İzin `report:finance` + `financeEnabled` (kaynak uç ikisini birden ister — ölçüldü).
// =============================================================================
import { Currency } from "@prisma/client";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, getAgingReport, isOverdueBucket, type AgingBucketKey } from "../../finance-aging.report";
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import { helperFromRows } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticMeasure } from "../tipler";

const FINANCE_PERMISSION = "report:finance";
const FINANCE_MODULE = "financeEnabled";
const ASOF_NOTE = "Alacaklar seçilen aralığın son günü itibarıyladır; para birimleri ayrı gösterilir, toplanmaz.";

interface BucketRow { cariId: string; cariName: string; currency: string; bucket: AgingBucketKey; amount: number }

async function bucketRows(input: HelperInput): Promise<BucketRow[]> {
  const aging = await getAgingReport({ asOf: input.range.to });
  return aging.blocks.flatMap((b) =>
    b.rows.flatMap((r) => AGING_BUCKETS.map((bucket) => ({ cariId: r.cariId, cariName: r.name, currency: b.currency, bucket, amount: Number(r.net[bucket]) }))),
  );
}

function bucketKey(dimensionId: string, r: BucketRow): string {
  if (dimensionId === "cari") return r.cariId;
  if (dimensionId === "paraBirimi") return r.currency;
  return r.bucket;
}

function bucketLabel(dimensionId: string, r: BucketRow): string {
  if (dimensionId === "cari") return r.cariName;
  if (dimensionId === "paraBirimi") return r.currency;
  return AGING_BUCKET_LABELS[r.bucket];
}

/** Kuruş hassasiyeti: kaynak tutarları ondalık metindir; toplam iki haneye yuvarlanır. */
const cents = (v: number): number => Math.round(v * 100) / 100;

function agingHelper(keep: (b: AgingBucketKey) => boolean) {
  return async (input: HelperInput): Promise<HelperResult> =>
    helperFromRows(input, (await bucketRows(input)).filter((r) => keep(r.bucket)), {
      key: bucketKey, label: bucketLabel, weight: (r) => Math.abs(r.amount), currency: (r) => r.currency,
      aggregate: (rows) => cents(rows.reduce((a, r) => a + r.amount, 0)),
    }, [ASOF_NOTE]);
}

function measure(id: string, keep: (b: AgingBucketKey) => boolean, parity: SemanticMeasure["parity"]): SemanticMeasure {
  return {
    id, permission: FINANCE_PERMISSION, module: FINANCE_MODULE, kind: "helper",
    helper: { dimensions: ["cari", "paraBirimi", "vadeKovasi"], perCurrency: true, compute: agingHelper(keep) }, parity,
  };
}

export const financeCube: SemanticCube = {
  id: "finans",
  name: "Alacaklar",
  permission: FINANCE_PERMISSION,
  module: FINANCE_MODULE,
  source: helperOnlySource,
  timeColumn: "p.at",
  measures: [
    measure("alacak.vadesiGecmis", isOverdueBucket, { report: "finance/alacaklar", field: "anaSayi", legacy: "finance/aging" }),
    measure("alacak.acikToplam", () => true, { report: "finance/aging", field: "blocks[].totals.openTotal" }),
  ],
  dimensions: [
    helperOnlyDimension("cari", "Cari", "uuid"),
    helperOnlyDimension("paraBirimi", "Para birimi", "enum", Object.values(Currency)),
    helperOnlyDimension("vadeKovasi", "Vade", "enum", AGING_BUCKETS),
  ],
  notes: [ASOF_NOTE],
};
