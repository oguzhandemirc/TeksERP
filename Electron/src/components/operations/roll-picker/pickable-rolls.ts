// Seçicilerin top listesi — tek eşleme (liste satırı → seçilebilir top); transfer ve Parti Ekle aynı yoldan okur.
import apiClient from "@/services/apiClient";

export interface PickedRoll {
  id: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  qty: number;
  warehouseId: string | null;
  status: string;
}

/** `/api/rolls` süzgeçleri (`filter[...]` anahtarlarıyla) + arama; ilk `limit` satır. */
export async function listPickableRolls(
  filters: Record<string, string>,
  opts: { search?: string; limit?: number } = {},
): Promise<PickedRoll[]> {
  const res = await apiClient.get("/api/rolls", {
    params: { page: 1, pageSize: opts.limit ?? 100, ...filters, ...(opts.search ? { search: opts.search } : {}) },
  });
  type Row = {
    id: string; barcode: string | null; status: string; currentQty: string | number; warehouseId: string | null;
    item?: { name: string }; color?: { name: string } | null;
  };
  return ((res.data.data ?? []) as Row[]).map((r) => ({
    id: r.id,
    barcode: r.barcode,
    itemName: r.item?.name ?? "—",
    colorName: r.color?.name ?? null,
    qty: Number(r.currentQty),
    warehouseId: r.warehouseId,
    status: r.status,
  }));
}
