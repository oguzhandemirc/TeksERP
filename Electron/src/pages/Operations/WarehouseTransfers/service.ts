import apiClient from "@/services/apiClient";

export interface TransferListRow {
  id: string;
  transferNo: string;
  status: "COMPLETED" | "CANCELLED";
  createdAt: string;
  cancelledAt: string | null;
  fromWarehouse: { id: string; name: string };
  toWarehouse: { id: string; name: string };
  _count: { movements: number };
}

export interface TransferDetail {
  id: string;
  transferNo: string;
  status: "COMPLETED" | "CANCELLED";
  notes: string | null;
  createdAt: string;
  cancelReason: string | null;
  fromWarehouse: { id: string; code: string; name: string };
  toWarehouse: { id: string; code: string; name: string };
  createdBy: { fullName: string | null; username: string } | null;
  lines: Array<{
    qty: string | number;
    roll: {
      id: string;
      barcode: string | null;
      status: string;
      currentQty: string | number;
      width: string | number | null;
      item: { id: string; name: string };
      color: { id: string; name: string } | null;
    };
  }>;
  totals: { rollCount: number; totalQty: number };
}

export async function listTransfers(params: { page: number; pageSize: number; search?: string }) {
  const res = await apiClient.get("/api/warehouse-transfers", {
    params: { page: params.page, pageSize: params.pageSize, ...(params.search ? { search: params.search } : {}) },
  });
  return res.data as { data: TransferListRow[]; pagination: { total: number } };
}

export async function getTransfer(id: string): Promise<TransferDetail> {
  const res = await apiClient.get(`/api/warehouse-transfers/${id}`);
  return res.data.data as TransferDetail;
}

export async function createTransfer(body: {
  fromWarehouseId: string;
  toWarehouseId: string;
  rollIds: string[];
  /** Çuval-BÜTÜN transfer — çuval içindeki tüm toplarıyla taşınır. */
  sackIds?: string[];
  notes?: string | null;
  clientToken?: string;
}) {
  const res = await apiClient.post("/api/warehouse-transfers", body);
  return res.data as { data: TransferDetail; message?: string };
}

export async function cancelTransfer(id: string, reason?: string) {
  const res = await apiClient.post(`/api/warehouse-transfers/${id}/cancel`, { reason });
  return res.data;
}

/**
 * Transfer edilebilir statüler — backend `warehouse-transfer.service.TRANSFERABLE`
 * ile AYNI küme. Ayrışırsa ekran "bulunamadı" der ya da backend'in reddedeceği
 * topu listeye alır.
 */
const TRANSFERABLE_STATUSES = ["STOCK", "WAREHOUSE", "A1_STOCK", "RETURNED_FROM_SUBCONTRACTOR"];

/**
 * Barkodla top çözümü — transfer ekranı okutulan barkodu id'ye çevirir.
 *
 * İKİ ŞART, ikisi de saha bulgusundan (2026-08-13):
 * ① `filter[statusIn]` GÖNDERİLMEK ZORUNDA — `/api/rolls` statü verilmediğinde
 *    VARSAYILAN olarak yalnız `STOCK` döner (ham stok), dolayısıyla depo topu
 *    (`WAREHOUSE`) barkodu TAM eşleşse bile "bulunamadı" görünüyordu. Sekmeler
 *    her zaman statü gönderdiği için bu varsayılan hiç fark edilmemişti.
 * ② `search` DEĞİL `filter[barcode]` — barkod araması TAM EŞLEŞMEDİR (unique
 *    index seek); birden fazla barkodu boşlukla birleştirip `search`e vermek
 *    HİÇBİRİNİ bulmaz. CSV filtre ise generic yolda `{ in: [...] }`e çevrilir.
 */
export async function lookupRollsByBarcodes(barcodes: string[]): Promise<
  Array<{ id: string; barcode: string | null; itemName: string; colorName: string | null; qty: number; warehouseId: string | null; status: string }>
> {
  const clean = barcodes.map((b) => b.trim()).filter(Boolean);
  if (clean.length === 0) return [];
  const res = await apiClient.get("/api/rolls", {
    params: {
      page: 1,
      pageSize: 200,
      "filter[barcode]": clean.join(","),
      "filter[statusIn]": TRANSFERABLE_STATUSES.join(","),
    },
  });
  type Row = {
    id: string; barcode: string | null; status: string; currentQty: string | number; warehouseId: string | null;
    item?: { name: string }; color?: { name: string } | null;
  };
  const rows = (res.data.data ?? []) as Row[];
  const wanted = new Set(barcodes.map((b) => b.trim().toUpperCase()));
  return rows
    .filter((r) => r.barcode && wanted.has(r.barcode.toUpperCase()))
    .map((r) => ({
      id: r.id,
      barcode: r.barcode,
      itemName: r.item?.name ?? "—",
      colorName: r.color?.name ?? null,
      qty: Number(r.currentQty),
      warehouseId: r.warehouseId,
      status: r.status,
    }));
}

export interface PickedSack {
  id: string;
  sackNo: string;
  warehouseId: string | null;
  warehouseName: string | null;
  customerName: string | null;
  shipmentAssigned: boolean;
  rollCount: number;
  totalQty: number;
}

/**
 * Çuval kodu çözümü — transfer formu CV kodu okutunca çuvalı üye özetiyle alır.
 * Uygunluk HÜKMÜ backend create tx'indedir; burası yalnız karar verdirecek
 * bilgiyi taşır (konum, sevkiyat bağı, kaç top / kaç metre).
 */
export async function lookupSacksByCodes(codes: string[]): Promise<{ sacks: PickedSack[]; notFound: string[] }> {
  const clean = codes.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return { sacks: [], notFound: [] };
  const res = await apiClient.get("/api/warehouse-transfers/sack-lookup", {
    params: { codes: clean.join(",") },
  });
  return res.data.data as { sacks: PickedSack[]; notFound: string[] };
}
