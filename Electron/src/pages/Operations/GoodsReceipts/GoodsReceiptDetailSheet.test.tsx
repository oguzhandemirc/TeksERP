// =============================================================================
// BEKÇİ — fiş detayı: sipariş uyarı bandı + bağlı sipariş satırı
// =============================================================================
// ⭐ UYARI BANDI GERÇEKTEN ÇİZİLİR. Bu dosyanın var oluş sebebi bir HATA SINIFI:
//    `PurchaseOrderSyncBand` ve `receiptSync` yazılmış, testleri yeşil koşmuş ama
//    hiçbir ekran onları IMPORT ETMEMİŞTİ — yani saf katman doğruydu, kullanıcı
//    hiçbir şey görmüyordu. Saf test o boşluğu göremez; render eden bir bekçi görür.
// ⭐ SENKRON SONUCU SUNUCUDA SAKLANMAZ: "fazla mal geldi" / "bu ürün siparişte
//    yok" yalnız oluşturma yanıtında gelir. Panel kapanana kadar duran bu bant
//    onu gösteren TEK yüzeydir; toast'a bırakmak = bilgiyi kaybetmek.
// ⭐ SİPARİŞSİZ FİŞTE TEK BAYT DEĞİŞMEZ (fabrika "sıfır görünür fark" kuralı).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";
import type { GoodsReceiptDetail } from "./service";

const getGoodsReceipt = vi.fn();
vi.mock("./service", () => ({
  getGoodsReceipt: (...a: unknown[]) => getGoodsReceipt(...a),
  cancelGoodsReceipt: vi.fn(),
  createInvoiceFromReceipt: vi.fn(),
}));

// Baskı yüzeyleri bu testin konusu değil (yazıcı/IPC bağımlılıkları taşırlar).
vi.mock("@/components/print/PrintedDocDialog", () => ({ PrintedDocDialog: () => null }));
vi.mock("@/components/print/BulkRollLabelButton", () => ({ BulkRollLabelButton: () => null }));

import { GoodsReceiptDetailSheet } from "./GoodsReceiptDetailSheet";

const DETAIL: GoodsReceiptDetail = {
  id: "r1",
  receiptNo: "MK1408260001",
  status: "ACTIVE",
  deliveryNoteNo: "IRS-77",
  currency: "TRY",
  notes: null,
  createdAt: "2026-08-14T10:00:00Z",
  warehouse: { id: "w1", code: "D1", name: "Merkez Depo" },
  supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" },
  createdBy: null,
  rolls: [],
  lines: [],
  totals: { rollCount: 0, totalQty: 0 },
};

const SYNC: ReceiptPurchaseOrderSync = {
  id: "po-1",
  orderNo: "AS1408260001",
  status: "PARTIAL",
  changed: true,
  overReceiptLines: [2],
  unmatchedItemIds: ["item-x"],
};

describe("GoodsReceiptDetailSheet — alış siparişi yüzeyleri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoodsReceipt.mockResolvedValue(DETAIL);
  });

  it("⭐ oluşturma yanıtındaki uyarılar KALICI banda basılır (toast'a bırakılmaz)", async () => {
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} sync={SYNC} />);

    expect(await screen.findByText(/FAZLA mal geldi/)).toBeInTheDocument();
    expect(screen.getByText(/bu siparişte YOK/)).toBeInTheDocument();
  });

  it("⭐ bant DETAY YÜKLENMEDEN de görünür (yavaş sunucuda uyarı kaybolmaz)", async () => {
    // Yanıt hiç çözülmez → panel "Yükleniyor…" dalında kalır.
    getGoodsReceipt.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} sync={SYNC} />);

    expect(await screen.findByText(/FAZLA mal geldi/)).toBeInTheDocument();
    expect(screen.getByText("Yükleniyor…")).toBeInTheDocument();
  });

  it("⭐ senkron yoksa TEK BAYT çizilmez (listeden açılan fiş / siparişsiz akış)", async () => {
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText("Merkez Depo")).toBeInTheDocument();
    expect(screen.queryByText(/FAZLA mal geldi/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bu siparişte YOK/)).not.toBeInTheDocument();
  });

  it("⭐ bağlı sipariş satırı numarası + DURUMU ile basılır", async () => {
    getGoodsReceipt.mockResolvedValue({
      ...DETAIL,
      purchaseOrder: {
        id: "po-1",
        orderNo: "AS1408260001",
        status: "PARTIAL",
        currency: "TRY",
        expectedDate: null,
      },
    } satisfies GoodsReceiptDetail);

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText("Alış siparişi")).toBeInTheDocument();
    expect(screen.getByText("AS1408260001")).toBeInTheDocument();
    // Durum enum ADIYLA değil satın almacının sorusuyla yazılır (labels.ts).
    expect(screen.getByText("(Kısmen geldi)")).toBeInTheDocument();
  });

  it("siparişsiz fişte 'Alış siparişi' satırı HİÇ çizilmez (boş '—' bile yok)", async () => {
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText("Merkez Depo")).toBeInTheDocument();
    expect(screen.queryByText("Alış siparişi")).not.toBeInTheDocument();
  });

  it("⭐ para birimi çelişkisi SÖYLENİR — backend onu engellemez, fatura fişin biriminde kesilir", async () => {
    getGoodsReceipt.mockResolvedValue({
      ...DETAIL,
      currency: "TRY",
      purchaseOrder: {
        id: "po-1",
        orderNo: "AS1408260001",
        status: "OPEN",
        currency: "USD",
        expectedDate: null,
      },
    } satisfies GoodsReceiptDetail);

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText(/Sipariş USD, fiş TRY/)).toBeInTheDocument();
  });

  it("para birimleri aynıysa uyarı basılmaz (gürültü yok)", async () => {
    getGoodsReceipt.mockResolvedValue({
      ...DETAIL,
      purchaseOrder: {
        id: "po-1",
        orderNo: "AS1408260001",
        status: "OPEN",
        currency: "TRY",
        expectedDate: null,
      },
    } satisfies GoodsReceiptDetail);

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText("AS1408260001")).toBeInTheDocument();
    expect(screen.queryByText(/faturalanır/)).not.toBeInTheDocument();
  });
});
