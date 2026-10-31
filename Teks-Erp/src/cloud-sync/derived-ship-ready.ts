// İş emrinin sevke hazırlığı — buluta giden türetilmiş görünüm (D4-J5, `is-emri.sevkeHazir`). Sınıflama
// fabrikada `ship-readiness.helper` + `ready-works.service computeReadyWorks` ile yapılır (panelin "Sevke
// Hazır İşler" listesiyle aynı sayı); bulut ve uygulama yalnız taşır/etiketler (bekçi `test_bulut_sevke_hazir`).
import { Prisma } from "@prisma/client";
import { effectiveShipReadyPolicy, type ShipReadyState } from "../services/helpers/ship-readiness.helper";
import { computeReadyWorks } from "../services/ready-works.service";

/** Tel durum kodu — fabrika hazırlık durumunun bire bir karşılığı. */
const WIRE_STATE: Record<ShipReadyState, ShipReadyWire["durum"]> = { READY: "HAZIR", PARTIAL: "KISMEN", NONE: "YOK" };

export interface ShipReadyWire {
  durum: "HAZIR" | "KISMEN" | "YOK";
  hazirTop: number;
  hazirMetre: Prisma.Decimal;
}

/** İş emri başına hazırlık; canlı (hazır ∪ işlemde) topu olmayan iş emri → null (panel listesinde de yok). */
export async function workOrderReadyWorksWire(workOrderIds: readonly string[]): Promise<Map<string, ShipReadyWire | null>> {
  const out = new Map<string, ShipReadyWire | null>(workOrderIds.map((id) => [id, null]));
  if (workOrderIds.length === 0) return out;
  const rows = await computeReadyWorks("workOrder", await effectiveShipReadyPolicy(), workOrderIds);
  for (const r of rows) {
    if (!out.has(r.id)) continue;
    out.set(r.id, {
      durum: WIRE_STATE[r.state],
      hazirTop: r.readyCount,
      hazirMetre: new Prisma.Decimal(r.readyMeters),
    });
  }
  return out;
}
