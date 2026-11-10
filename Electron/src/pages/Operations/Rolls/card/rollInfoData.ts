// Top bilgileri tablosunun saf yardımcıları — özellik ayrımı ve basılan değerler listesi (veri güdümlü, ad yazılmaz).
import type { Roll, RollLabelSnapshot } from "../types";

export const num = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false });

/** Kg kaynağı — iç izdir; belgeye basılmaz. Eski satırda kaynak yok → yalnız kg. */
export const WEIGHT_SOURCE_LABELS: Record<"SCALE" | "MANUAL" | "SIMULATED", string> = { SCALE: "Kantar", MANUAL: "Elle", SIMULATED: "Simüle" };

/**
 * Değeri olan aktif özellik kendi satırına ("Kurşun gramajı | 50 gr"); değersiz (işaret) özellikler
 * tek "İşlemler" satırında toplanır. Sıra backend'den geldiği gibi korunur.
 */
export function splitRollProperties(props: Roll["properties"]): { valued: Array<{ key: string; label: string; value: string }>; flags: string[] } {
  const valued: Array<{ key: string; label: string; value: string }> = [];
  const flags: string[] = [];
  for (const p of props ?? []) {
    if (p.value?.name) valued.push({ key: p.propertyId, label: p.property.name, value: p.value.name });
    else flags.push(p.property.name);
  }
  return { valued, flags };
}

/**
 * Son basımda etikete giden değerler — `printed` bloğu (2026-11-10) varsa ondan, yoksa eski snapshot'ın
 * üst düzey adlarından (yalnız müşteri/sipariş/kumaş/renk). Boş alan listelenmez.
 */
export function printedValueRows(snap: RollLabelSnapshot | null | undefined): Array<[string, string]> {
  if (!snap) return [];
  const p = snap.printed ?? {};
  const rows: Array<[string, string | number | null | undefined, string?]> = [
    ["Müşteri", snap.customerName],
    ["Sipariş", snap.orderNumber],
    ["Kumaş", p.itemName ?? snap.itemName],
    ["Renk", p.colorName ?? snap.colorName],
    ["Metre", p.lengthMeters, " m"],
    ["Kalite", p.qualityGrade],
    ["Parti no", p.labelBatchNo],
    ["Bizim parti", p.batchNumber],
    ["Kg", p.weightKg, " kg"],
    ["En", p.widthCm, " cm"],
    ["Kat", p.foldType],
    ["Alıcı", p.consigneeName],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v, unit]) => [k, typeof v === "number" ? `${num(v)}${unit ?? ""}` : String(v)]);
}
