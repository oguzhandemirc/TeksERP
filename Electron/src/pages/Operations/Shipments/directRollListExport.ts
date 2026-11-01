// Fasondan doğrudan sevk (DirectShipment) top listesi Excel'i (D4-KUC3a; D4-J6 emsali, PDF=Excel ilkesi).
// Kaynak detay ekranının AYNI yanıtıdır (`/api/shipping/direct-shipments/:id`) ve kolonlar ekrandaki tabloyla tek
// listeden (`DIRECT_ROLL_COLUMNS`) gelir; TOPLAM sunucunun `totalQty`/`rollCount`ıdır, satırlardan yeniden toplanmaz.
import type { SheetSpec } from "@/lib/xlsx-export";
import { upTo3ExcelNumFmt } from "@/lib/number-format";
import { fmtFactoryDate } from "@/lib/factory-time";
import type { DirectShipmentDetail } from "./types";

type DirectRoll = DirectShipmentDetail["rolls"][number];

/** Ekrandaki "Sevk Edilen Toplar" tablosunun kolonları — başlık ve Excel aynı listeden. */
export const DIRECT_ROLL_COLUMNS = [
  { key: "barcode", header: "Barkod", width: 18 },
  { key: "item", header: "Ürün / Renk", width: 32 },
  { key: "width", header: "En (cm)", width: 10 },
  { key: "qualityGrade", header: "Kalite", width: 10 },
  { key: "meters", header: "Metre", width: 11 },
] as const;

/** Barkodsuz (açık kumaş) satır ekranda da Excel'de de aynı metinle görünür. */
export const directRollBarcode = (r: DirectRoll): string => r.barcode ?? "açık kumaş";
export const directRollItem = (r: DirectRoll): string => (r.colorName ? `${r.itemName} · ${r.colorName}` : r.itemName);

export function buildDirectRollListSheet(d: DirectShipmentDetail): SheetSpec {
  return {
    name: "Top Listesi",
    preamble: [
      [`Fasondan Sevk Top Listesi — ${d.shipmentNo}`],
      ["Müşteri", d.customer.name],
      ["Fason Firma", `${d.dispatch.subcontractor.name} (${d.dispatch.dispatchNo})`],
      ["Sevk Tarihi", fmtFactoryDate(d.shippedAt, "")],
    ],
    columns: DIRECT_ROLL_COLUMNS.map((c) =>
      c.key === "meters"
        ? { header: c.header, key: c.key, width: c.width, numFmt: upTo3ExcelNumFmt(), align: "right" as const }
        : c.key === "width"
          ? { header: c.header, key: c.key, width: c.width, numFmt: "0", align: "right" as const }
          : { header: c.header, key: c.key, width: c.width },
    ),
    rows: d.rolls.map((r) => ({
      barcode: directRollBarcode(r),
      item: directRollItem(r),
      width: r.width ?? "",
      qualityGrade: r.qualityGrade ?? "",
      meters: r.currentQty,
    })),
    totalRow: { barcode: `TOPLAM (${d.rollCount} top)`, meters: d.totalQty },
    notes: ["Metre BRÜT'tür (sevk edilen toplar); iadeler ayrı belgeyle izlenir."],
  };
}

export const directRollListFileName = (shipmentNo: string): string => `Top_Listesi_${shipmentNo}`;
