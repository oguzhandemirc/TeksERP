// =============================================================================
// KÜP `stok` — depodaki bitmiş kumaş, KESİT (R1-SEMKUP)
// =============================================================================
// Stok & Ölü Stok karnesine bağlı helper ölçüler: tarih aralığından BAĞIMSIZ, bugünün durumudur
// (geçmiş kesit yok — ay sonu görüntüsü R1-ZAMAN'da). Ölü stok kumaş kırılımı vermez: siparişe
// ayrılmamış pay kumaş+renk havuzundan düşülür, kumaşa bölmek ikinci bir hesap olurdu.
// =============================================================================
import { getStockScorecard, type StockItemRow } from "../../stock-scorecard.report.service";
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import { helperFromRows, totalOnly } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticMeasure } from "../tipler";

const INVENTORY_PERMISSION = "report:inventory";
const INVENTORY_MODULE = "cekirdek:stok-giris";
const SNAPSHOT_NOTE = "Stok bugünün durumudur; seçilen tarih aralığından bağımsızdır.";

async function computeFinished(input: HelperInput): Promise<HelperResult> {
  const s = await getStockScorecard();
  return helperFromRows<StockItemRow>(input, s.byItem, {
    key: (_d, r) => r.key,
    label: (_d, r) => r.label,
    weight: (r) => r.qty,
    aggregate: (rows) => Math.round(rows.reduce((a, r) => a + r.qty, 0) * 10) / 10,
  }, [SNAPSHOT_NOTE]);
}

function summaryOnly(pick: (s: Awaited<ReturnType<typeof getStockScorecard>>["summary"]) => number) {
  return async (_input: HelperInput): Promise<HelperResult> => totalOnly(pick((await getStockScorecard()).summary), [SNAPSHOT_NOTE]);
}

function measure(id: string, dims: string[], compute: (i: HelperInput) => Promise<HelperResult>, parity: SemanticMeasure["parity"]): SemanticMeasure {
  return { id, permission: INVENTORY_PERMISSION, module: INVENTORY_MODULE, kind: "helper", helper: { dimensions: dims, perCurrency: false, compute }, parity };
}

export const stockCube: SemanticCube = {
  id: "stok",
  name: "Depo stoku",
  permission: INVENTORY_PERMISSION,
  module: INVENTORY_MODULE,
  source: helperOnlySource,
  timeColumn: "p.at",
  measures: [
    measure("stok.oluMetre", [], summaryOnly((s) => s.deadQty), { report: "inventory/depo", field: "anaSayi", legacy: "inventory/scorecard" }),
    measure("stok.yasiBilinmeyenMetre", [], summaryOnly((s) => s.unagedQty), { report: "inventory/scorecard", field: "summary.unagedQty" }),
    measure("stok.bitmisMetre", ["kumas"], computeFinished, { report: "inventory/scorecard", field: "summary.finishedQty" }),
  ],
  dimensions: [helperOnlyDimension("kumas", "Kumaş", "uuid")],
  notes: [SNAPSHOT_NOTE],
};
