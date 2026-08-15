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
const mockCreateInvoice = createInvoiceFromReceipt as unknown as ReturnType<typeof vi.fn>;

// Baskı yüzeyleri bu testin konusu değil (yazıcı/IPC bağımlılıkları taşırlar).
vi.mock("@/components/print/PrintedDocDialog", () => ({ PrintedDocDialog: () => null }));
vi.mock("@/components/print/BulkRollLabelButton", () => ({ BulkRollLabelButton: () => null }));

// Yetki kapıları: test kullanıcısı oturumsuz olduğu için PermissionGate her şeyi
// gizlerdi; "Alış Faturası Oluştur" düğmesi de o kapının arkasında.
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

// Fatura detayı ayrı bir yüzey (kendi bekçisi var) — burada YALNIZ AÇILDIĞI
// ölçülüyor: B2'nin kesildiği yer tam olarak burasıydı (toast basılıyor, belge
// gösterilmiyordu).
vi.mock("@/pages/Finance/InvoiceDetailDialog", () => ({
  InvoiceDetailDialog: ({ invoiceId }: { invoiceId: string }) => (
    <div data-testid="fatura-detay">{invoiceId}</div>
  ),
}));

import userEvent from "@testing-library/user-event";
import { createInvoiceFromReceipt } from "./service";
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

// =============================================================================
// B1 (ham enum) · B2 (taslak açılır) · C2 (ham stok rozeti) · C4 (fason bacağı)
// =============================================================================
describe("GoodsReceiptDetailSheet — dil, belge ve tedarikçi yüzeyleri", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGoodsReceipt.mockResolvedValue(DETAIL);
  });

  it("⭐ B1 — top durumu TÜRKÇE basılır, ham enum EKRANA ÇIKMAZ", async () => {
    getGoodsReceipt.mockResolvedValue({
      ...DETAIL,
      rolls: [
        {
          id: "roll-1",
          barcode: "TP0001",
          status: "WAREHOUSE",
          currentQty: 100,
          width: null,
          item: { id: "i1", name: "PATOS" },
          color: null,
        },
      ],
      totals: { rollCount: 1, totalQty: 100 },
    } satisfies GoodsReceiptDetail);

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);

    expect(await screen.findByText("Depoda")).toBeInTheDocument();
    expect(screen.queryByText("WAREHOUSE")).not.toBeInTheDocument();
  });

  it("⭐ B2 — 'Alış Faturası Oluştur' doğan TASLAĞI AÇAR (yalnız toast değil)", async () => {
    mockCreateInvoice.mockResolvedValue({ data: { id: "inv-9", docNo: "AF0001" } });
    const user = userEvent.setup();

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);
    await user.click(await screen.findByText("Alış Faturası Oluştur"));

    // Belge üreten eylem belgeyi gösterir; id doğru taslağın id'sidir.
    expect(await screen.findByTestId("fatura-detay")).toHaveTextContent("inv-9");
  });

  it("fatura üretilmediyse taslak diyaloğu HİÇ açılmaz", async () => {
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);
    expect(await screen.findByText("Merkez Depo")).toBeInTheDocument();
    expect(screen.queryByTestId("fatura-detay")).not.toBeInTheDocument();
  });

  it("⭐ C4 — FASON tedarikçi bacağı basılır (kolon boş kalmaz)", async () => {
    getGoodsReceipt.mockResolvedValue({
      ...DETAIL,
      supplier: null,
      subcontractorSupplier: { id: "f1", code: "F001", name: "BOYER BOYA" },
    } satisfies GoodsReceiptDetail);

    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);
    expect(await screen.findByText("BOYER BOYA")).toBeInTheDocument();
  });

  it("⭐ C2 — ham stok fişi ROZETLE ayrışır; normal fişte rozet YOK", async () => {
    getGoodsReceipt.mockResolvedValue({ ...DETAIL, rawStockEntry: true } satisfies GoodsReceiptDetail);
    const { unmount } = renderWithProviders(
      <GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />,
    );
    expect(await screen.findByText("Ham stok")).toBeInTheDocument();
    unmount();

    getGoodsReceipt.mockResolvedValue(DETAIL);
    renderWithProviders(<GoodsReceiptDetailSheet id="r1" onOpenChange={() => {}} />);
    expect(await screen.findByText("Merkez Depo")).toBeInTheDocument();
    expect(screen.queryByText("Ham stok")).not.toBeInTheDocument();
  });
});
