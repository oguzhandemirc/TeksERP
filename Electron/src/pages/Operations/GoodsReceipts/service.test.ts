// =============================================================================
// BEKÇİ — mal kabul fişi oluşturma gövdesi (alış siparişi bağı)
// =============================================================================
// ⭐ SİPARİŞ SEÇİLMEZSE GÖVDE BUGÜNKÜYLE BİREBİR AYNIDIR. "Ticaret paketi
//    fabrikada sıfır görünür fark üretir" kuralı istek gövdesini de kapsar:
//    `purchaseOrderId: null` göndermek teknik olarak geçerlidir ama fabrikadaki
//    fişin gövdesini değiştirir ve bir gün "bu alan neden hep null" diye
//    okunacak ölü bir sözleşme bırakır.
// ⭐ SEÇİLİRSE GERÇEKTEN GİDER. Bu, özelliğin kesildiği yerdi: bileşen yazılmış
//    ama forma takılmamış, alan da gövdeye hiç konulmamıştı — ekranda sipariş
//    seçiliyor, fiş siparişsiz kaydediliyordu (sessiz ve tam ters bir sonuç).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import { createGoodsReceipt } from "./service";

vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

const BASE = {
  warehouseId: "wh-1",
  supplierId: null,
  deliveryNoteNo: null,
  currency: "TRY" as const,
  clientToken: "tok-1",
  lines: [],
};

describe("createGoodsReceipt — alış siparişi alanı", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: { data: { id: "r1" } } });
  });

  it("⭐ sipariş seçilmemişse `purchaseOrderId` anahtarı gövdede HİÇ YOKTUR", async () => {
    await createGoodsReceipt({ ...BASE, purchaseOrderId: null });
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect("purchaseOrderId" in body).toBe(false);
    // Kalan alanlar bugünküyle aynı — fazladan/eksik anahtar yok.
    expect(Object.keys(body).sort()).toEqual(
      ["clientToken", "currency", "deliveryNoteNo", "lines", "supplierId", "warehouseId"].sort(),
    );
  });

  it("alan hiç geçilmezse de gövde aynıdır (eski çağıranlar bozulmaz)", async () => {
    await createGoodsReceipt(BASE);
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect("purchaseOrderId" in body).toBe(false);
  });

  it("⭐ sipariş seçilmişse id gövdeye KONUR", async () => {
    await createGoodsReceipt({ ...BASE, purchaseOrderId: "po-9" });
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.purchaseOrderId).toBe("po-9");
    expect(body.warehouseId).toBe("wh-1");
  });

  it("boş string sipariş id'si GÖNDERİLMEZ (seçici 'siparişsiz'i '' ile temsil eder)", async () => {
    await createGoodsReceipt({ ...BASE, purchaseOrderId: "" });
    const body = mockPost.mock.calls[0]![1] as Record<string, unknown>;
    expect("purchaseOrderId" in body).toBe(false);
  });

  it("yol TAM yazılır — apiClient.baseURL '/api' içermez", async () => {
    await createGoodsReceipt(BASE);
    expect(mockPost.mock.calls[0]![0]).toBe("/api/goods-receipts");
  });
});
