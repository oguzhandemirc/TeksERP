import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import { labelService } from "@/services/labelService";

// =============================================================================
// BEKÇİ: "basıldı" bildirimleri GENEL hata toast'ını tetiklemez
// =============================================================================
// SAHA BİLDİRİMİ (2026-08-06): "iş emrinden refakat kartı çıkarırken sunucu
// hatası yazıyor ama yine de çıkarıyor."
//
// Kök neden BASKI DEĞİLDİ: baskı tamamen istemci tarafındadır (izole iframe →
// yazıcı). Kâğıt çıktıktan SONRA atılan `print-event` bildirimi ayrı bir
// istektir ve çağıranlar onu bilerek yutar ("best-effort"). Ama yutma İŞE
// YARAMIYORDU: `apiClient` interceptor'ı 5xx'te "Sunucu hatası…", sunucu
// kapalıyken "Sunucuya ulaşılamıyor" toast'ını `catch` çalışmadan ÖNCE basıyor.
// Elinde kâğıt tutan operatör bunu "baskı başarısız" diye okuyup tekrar
// bastırıyordu — tam da mükerrer kayıt/kâğıt üreten davranış.
//
// Sözleşme: bu iki istek `suppressErrorToast` TAŞIR; sonucu söyleyen cümleyi
// çağıran basar (refakat kartı: "kâğıt geçerli, kayıt güncellenmedi" uyarısı;
// çuval etiketi: kayıp zaten `labelDirty` işaretiyle görünür kalır).
//
// ⚠️ Bu bayrak düşerse hiçbir şey ÇÖKMEZ — yalnız operatör yanlış cümleyi
// okur. Bekçinin varlık sebebi budur.
// =============================================================================

vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

describe("print-event bildirimleri — genel hata toast'ını bastırır", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: { success: true, data: null } });
  });

  it("refakat kartı: POST /traveler-cards/:id/print-event suppressErrorToast taşır", async () => {
    await workOrderService.recordTravelerCardPrint("card-1");
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, , config] = mockPost.mock.calls[0] ?? [];
    expect(url).toBe("/api/traveler-cards/card-1/print-event");
    expect(config).toMatchObject({ suppressErrorToast: true });
  });

  it("çuval etiketi: POST /labels/sacks/:id/print-event suppressErrorToast taşır", async () => {
    await labelService.recordSackPrintEvent("sack-1");
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, , config] = mockPost.mock.calls[0] ?? [];
    expect(url).toBe("/api/labels/sacks/sack-1/print-event");
    expect(config).toMatchObject({ suppressErrorToast: true });
  });
});
