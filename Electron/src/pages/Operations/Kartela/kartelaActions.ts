// Kartela sevk/kabul/iptal saf kuralları — ekransız sınanır (kartelaActions.test.ts).
// Davranış tabletle birebir: `mobil/.../KartelaSevk/KartelaSevkScreen.tsx` (okutma retleri) ve
// `mobil/.../KartelaKabul/KartelaKabulScreen.tsx` (`selectedReturns`, sevke göre gruplama, arama).
import type { QueryClient } from "@tanstack/react-query";
import { foldSearchText } from "@/lib/search-fold";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import type { KartelaOutstandingItem, KartelaReceiveReturn } from "./service";

/** Kartela fason kategorisinin kodu — tablet `KARTELA_CATEGORY_CODE` ile aynı. */
export const KARTELA_CATEGORY_CODE = "KARTELA";

/** Depodaki serbest (çuvalsız/sevkiyatsız) toplar — tabletin `RollPickerModal` süzgeci. */
const WAREHOUSE_FREE = { status: "WAREHOUSE", shipmentScope: "free" } as const;

/** Kartelalık Stok sekmesi ve "Kartelalık toplar" kapsamının TEK süzgeci (useDataTable forceFilters biçimi). */
export const KARTELA_MARKED_FILTERS: Record<string, string> = { ...WAREHOUSE_FREE, markedForKartela: "true" };

const asQuery = (f: Record<string, string>) =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [`filter[${k}]`, v]));

/** Seçici kapsamı: kartelalık işaretli serbest depo topları (varsayılan). */
export const KARTELA_MARKED_ROLL_SCOPE = {
  key: "warehouse-free-marked",
  label: "Kartelalık toplar",
  filters: asQuery(KARTELA_MARKED_FILTERS),
};

/** Seçici kapsamı: işaretten bağımsız tüm serbest depo topları. */
export const KARTELA_ROLL_SCOPE = {
  key: "warehouse-free",
  label: "Tüm bitmiş toplar",
  filters: asQuery(WAREHOUSE_FREE),
};

/** Yeni Sevk top seçicisinin kapsamları — ilki varsayılan. */
export const KARTELA_PICKER_SCOPES = [KARTELA_MARKED_ROLL_SCOPE, KARTELA_ROLL_SCOPE];

/** Sevk listesindeki top satırı. */
export interface KartelaPickedRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  qty: number;
}

/** Top kaydı → sevk satırı (okutma ve Kartelalık Stok'tan "Sevke ekle" aynı eşlemeyi kullanır). */
export function rollToPicked(roll: {
  id: string;
  barcode: string | null;
  currentQty: string | number;
  item?: { name: string } | null;
  color?: { name: string } | null;
}): KartelaPickedRoll {
  return {
    id: roll.id,
    barcode: roll.barcode,
    itemName: roll.item?.name ?? "—",
    colorName: roll.color?.name ?? null,
    qty: Number(roll.currentQty),
  };
}

/** Okutulan topun kartelaya gidemeyeceği sebep; `null` = uygun (son söz backend'de). */
export function rollScanRejection(roll: {
  status: string;
  shipmentId?: string | null;
  sackId?: string | null;
  shipment?: { shipmentNo: string } | null;
  sack?: { sackNo: string } | null;
}): string | null {
  if (roll.status !== "WAREHOUSE") {
    const label = rollStatusLabels[roll.status as RollStatus] ?? roll.status;
    return `Top kartelaya gönderilemez — durum: ${label}. Sadece depodaki bitmiş toplar.`;
  }
  if (roll.shipmentId) {
    return `Top ${roll.shipment?.shipmentNo ?? "bir"} sevkiyatına bağlı — önce sevkiyattan çıkarın.`;
  }
  if (roll.sackId) return `Top ${roll.sack?.sackNo ?? "bir"} çuvalında — önce çuvaldan çıkarın.`;
  return null;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** `POST /api/kartela/dispatch` gövdesi — tablet `buildDispatchPayload` ile aynı alanlar. */
export function buildDispatchPayload(input: {
  subcontractorId: string;
  rolls: readonly { id: string }[];
  plateNumber: string;
  driverName: string;
  notes: string;
}) {
  return {
    subcontractorId: input.subcontractorId,
    rollIds: input.rolls.map((r) => r.id),
    plateNumber: orNull(input.plateNumber),
    driverName: orNull(input.driverName),
    notes: orNull(input.notes),
  };
}

/** Top başına kabul girişi: adet + varsayılan ölçü + yalnız farklı olan kartelaların ölçüsü. */
export interface ReceiveEntry {
  count: string;
  defCm: string;
  defKg: string;
  /** 0-bazlı sıra → o kartelanın ölçüsü; boş alan varsayılana düşer. */
  exceptions: Record<number, { cm?: string; kg?: string }>;
}

export const EMPTY_ENTRY: ReceiveEntry = { count: "", defCm: "", defKg: "", exceptions: {} };

/** "12,5" → 12.5; boş/sıfır/negatif → null (tablet `parseNum`). */
export function parseMeasure(s: string | undefined): number | null {
  const n = parseFloat((s ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseCount(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Varsayılandan GERÇEKTEN farklı kartela sıraları (tablet kayıtta yalnız bunları saklar). */
export function differingIndexes(e: ReceiveEntry): number[] {
  const n = parseCount(e.count);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ex = e.exceptions[i];
    if (!ex) continue;
    const cmDiff = ex.cm != null && parseMeasure(ex.cm) !== parseMeasure(e.defCm);
    const kgDiff = ex.kg != null && parseMeasure(ex.kg) !== parseMeasure(e.defKg);
    if (cmDiff || kgDiff) out.push(i);
  }
  return out;
}

/**
 * `returns` dizisi — tablet `selectedReturns` ile birebir: adetsiz top gönderilmez; istisna yoksa
 * sade bulk, varsa `items[count]` (farklı olmayan sıra null → backend bulk'a düşer). Ölçüm kapalıysa
 * cm/kg alanı çizilmez ve boş kalır → bulk null.
 */
export function buildReceiveReturns(
  rollIds: readonly string[],
  entries: Readonly<Record<string, ReceiveEntry>>,
): KartelaReceiveReturn[] {
  const out: KartelaReceiveReturn[] = [];
  for (const rollId of rollIds) {
    const e = entries[rollId];
    if (!e) continue;
    const count = parseCount(e.count);
    if (count <= 0) continue;
    const bulkLengthCm = parseMeasure(e.defCm);
    const bulkWeightKg = parseMeasure(e.defKg);
    const differs = new Set(differingIndexes(e));
    if (differs.size === 0) {
      out.push({ rollId, count, bulkLengthCm, bulkWeightKg });
      continue;
    }
    const items = Array.from({ length: count }, (_, i) => {
      const ex = differs.has(i) ? e.exceptions[i] : undefined;
      return { lengthCm: ex ? parseMeasure(ex.cm) : null, weightKg: ex ? parseMeasure(ex.kg) : null };
    });
    out.push({ rollId, count, bulkLengthCm, bulkWeightKg, items });
  }
  return out;
}

/** Bir kartela sevki (iş) — outstanding düz listesinden sevke göre gruplanır. */
export interface KartelaJob {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  firm: { id: string; name: string };
  rolls: KartelaOutstandingItem[];
  totalQty: number;
  itemNames: string[];
  colorNames: string[];
}

const uniq = (arr: (string | null | undefined)[]) => Array.from(new Set(arr.filter((s): s is string => !!s)));

export function groupOutstanding(items: readonly KartelaOutstandingItem[]): KartelaJob[] {
  const map = new Map<string, KartelaJob>();
  for (const o of items) {
    let j = map.get(o.dispatch.id);
    if (!j) {
      j = { dispatchId: o.dispatch.id, dispatchNo: o.dispatch.dispatchNo, dispatchedAt: o.dispatch.dispatchedAt,
        firm: o.dispatch.subcontractor, rolls: [], totalQty: 0, itemNames: [], colorNames: [] };
      map.set(o.dispatch.id, j);
    }
    j.rolls.push(o);
    j.totalQty += Number(o.dispatchedQty) || 0;
  }
  const list = Array.from(map.values());
  for (const j of list) {
    j.itemNames = uniq(j.rolls.map((r) => r.roll.item.name));
    j.colorNames = uniq(j.rolls.map((r) => r.roll.color?.name));
  }
  // Yeni → eski (tablet ile aynı).
  return list.sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt));
}

/** Tablet araması: 2 karakterden kısa terim süzmez; firma · sevk no · kumaş · renk · top barkodu. */
export function filterJobs(jobs: readonly KartelaJob[], search: string): KartelaJob[] {
  const q = foldSearchText(search);
  if (q.length < 2) return [...jobs];
  const hit = (s?: string | null) => !!s && foldSearchText(s).includes(q);
  return jobs.filter(
    (j) =>
      hit(j.firm.name) ||
      hit(j.dispatchNo) ||
      j.itemNames.some(hit) ||
      j.colorNames.some(hit) ||
      j.rolls.some((r) => hit(r.roll.barcode)),
  );
}

/** Kabul iptali 409'unda engelleyen kart numaraları — kod yalnız `details.code`dan okunur. */
export function blockedSwatchCardNumbers(err: unknown): string[] | null {
  const details = (err as { response?: { data?: { details?: { code?: string; blocked?: unknown } } } } | null)
    ?.response?.data?.details;
  if (!details || details.code !== "SWATCHES_DOWNSTREAM" || !Array.isArray(details.blocked)) return null;
  const cards = details.blocked.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  return cards.length > 0 ? cards : null;
}

/** Sevk/kabul/iptal sonrası tazelenen listeler: Sevkler · Bekleyen Kabul · Kabuller · Kartelada Toplar · Hareketler · Kartela Stoğu. */
export const KARTELA_REFRESH_KEYS: readonly (readonly string[])[] = [
  ["kartela"], // detaylar, bekleyen kabul, hareketler, kartela stoğu
  ["kartela-dispatches"],
  ["kartela-receipts"],
  ["rolls"], // Kartelada Toplar (rolls:KARTELA_SENT) + Kumaş Stoğu
  ["roll-picker"],
];

export function refreshKartelaLists(qc: QueryClient): void {
  for (const queryKey of KARTELA_REFRESH_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
}
