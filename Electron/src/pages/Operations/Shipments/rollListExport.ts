// Sevk top listesi (D4-J6, S10) — müşteriye verilecek top–barkod listesi Excel'i.
// Satır ve metre sunucudaki çeki listesinin KENDİSİDİR (GET .../roll-list); burada
// yeniden toplanmaz: TOPLAM satırı sunucunun `totals.totalMeters`ıdır.
import type { SheetSpec } from "@/lib/xlsx-export";
import { upTo3ExcelNumFmt } from "@/lib/number-format";
import { fmtFactoryDate } from "@/lib/factory-time";

export interface ShipmentRollListRow {
  barcode: string | null;
  customerRollNo: string | null;
  customerCode: string | null;
  desen: string;
  varyant: string;
  processText: string | null;
  meters: number;
}

export interface ShipmentRollList {
  shipmentNo: string;
  customerName: string;
  date: string | null;
  frozen: boolean;
  /** Sevk geri alındı (irsaliye VOIDED) — eski sunucu göndermez (undefined → false). */
  voided?: boolean;
  rows: ShipmentRollListRow[];
  totals: { rollCount: number; totalMeters: number };
}

/** Boş hücre: değer yoksa "" (Excel'de gerçekten boş görünür, "—" basılmaz). */
const cell = (v: string | null | undefined): string => v ?? "";

/** Donmamış (sevk edilmemiş) listede canlı içerik değişebilir; müşteriye taslak olduğu yazılır. */
export const DRAFT_MARK = "TASLAK — sevk edilmedi";

/** İptal edilmiş irsaliyenin listesi müşteriye geçerli belge gibi görünmemeli. */
export const VOID_MARK = "İPTAL — sevk geri alındı";

const listMark = (list: ShipmentRollList): string | null =>
  list.voided ? VOID_MARK : list.frozen ? null : DRAFT_MARK;

export function buildRollListSheet(list: ShipmentRollList): SheetSpec {
  const date = list.date ? fmtFactoryDate(list.date, "") : "";
  // Donmamışta tarih sevk değil oluşturma tarihidir (sunucu dispatchedAt ?? createdAt verir);
  // iptal edilmiş belgenin tarihi geri alınan sevkin tarihidir.
  const dateLabel = list.frozen || list.voided ? "Sevk Tarihi" : "Oluşturma Tarihi";
  const mark = listMark(list);
  const title = `Sevk Top Listesi — ${list.shipmentNo}${mark ? ` (${mark})` : ""}`;
  return {
    name: "Top Listesi",
    preamble: [[title], ["Müşteri", list.customerName], [dateLabel, date]],
    columns: [
      { header: "Barkod", key: "barcode", width: 18 },
      { header: "Müşteri Top No", key: "customerRollNo", width: 15 },
      { header: "Müşteri Kodu", key: "customerCode", width: 18 },
      { header: "Desen", key: "desen", width: 26 },
      { header: "Varyant", key: "varyant", width: 16 },
      { header: "İşlem", key: "processText", width: 20 },
      { header: "Metre", key: "meters", width: 11, numFmt: upTo3ExcelNumFmt(), align: "right" },
      { header: "Sevk No", key: "shipmentNo", width: 16 },
      { header: dateLabel, key: "date", width: 12 },
    ],
    rows: list.rows.map((r) => ({
      barcode: cell(r.barcode),
      customerRollNo: cell(r.customerRollNo),
      customerCode: cell(r.customerCode),
      desen: r.desen,
      varyant: r.varyant,
      processText: cell(r.processText),
      meters: r.meters,
      shipmentNo: list.shipmentNo,
      date,
    })),
    totalRow: { barcode: `TOPLAM (${list.totals.rollCount} top)`, meters: list.totals.totalMeters },
    notes: ["Metre BRÜT'tür (sevk anındaki çeki listesi); iadeler ayrı belgeyle izlenir."],
  };
}

export const rollListFileName = (shipmentNo: string, frozen = true, voided = false): string =>
  `Top_Listesi_${shipmentNo}${voided ? "_IPTAL" : frozen ? "" : "_TASLAK"}`;
