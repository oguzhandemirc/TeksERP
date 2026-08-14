// =============================================================================
// BEKÇİ — oluşturma yanıtındaki sipariş senkronu KALICI YÜZEYE ULAŞIYOR MU
// =============================================================================
// Senkron sonucu (fazla kabul / siparişte olmayan ürün) sunucuda SAKLANMAZ:
// yalnız `POST /goods-receipts` yanıtında bir kez gelir. Formdan panele giden bu
// zincir koparsa hiçbir şey patlamaz — uyarı sessizce yok olur ve depocu fazla
// gelen malı hiç öğrenmez. Bileşenler burada BİLEREK stub'lanır: ölçülen şey
// zincirin kendisidir, çocukların içeriği değil (onların kendi bekçileri var).
//
// ⭐ Uyarı, fişi oluşturan kişinin düştüğü panele taşınır.
// ⭐ BAŞKA BİR FİŞE TAŞINMAZ: listeden açılan fişte bant çizilmez. Yanlış fişin
//    üstünde duran doğru bir uyarı, hiç uyarmamaktan kötüdür.
// =============================================================================
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";

const SYNC: ReceiptPurchaseOrderSync = {
  id: "po-1",
  orderNo: "AS1408260001",
  status: "PARTIAL",
  changed: true,
  overReceiptLines: [2],
  unmatchedItemIds: [],
};

// PageHeader chrome'u (favoriler → PreferencesProvider bağımlılığı) bu testin
// konusu değil (SackStorePage.test.tsx ile aynı gerekçe).
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ⚠️ Uygulama vitest config'inde `restoreMocks: true` — inline `mockResolvedValue`
// ilk testten sonra sıfırlanır ve ikinci test sessizce BOŞ liste görür. Kayıt
// beforeEach'te kurulur (OrderShipmentsCard.test ile aynı desen).
const listGoodsReceipts = vi.fn();
vi.mock("./service", () => ({
  listGoodsReceipts: (...a: unknown[]) => listGoodsReceipts(...a),
}));

const ROWS = {
  data: [
    {
      id: "r1",
      receiptNo: "MK-1",
      status: "ACTIVE",
      deliveryNoteNo: null,
      createdAt: "2026-08-14T10:00:00Z",
      cancelledAt: null,
      warehouse: { id: "w1", name: "Merkez" },
      supplier: null,
      _count: { rolls: 1 },
    },
    {
      id: "r2",
      receiptNo: "MK-2",
      status: "ACTIVE",
      deliveryNoteNo: null,
      createdAt: "2026-08-14T11:00:00Z",
      cancelledAt: null,
      warehouse: { id: "w1", name: "Merkez" },
      supplier: null,
      _count: { rolls: 2 },
    },
  ],
  pagination: { total: 2, totalPages: 1 },
};

// Form: "kaydettim" olayını tek düğmeyle taklit eder (gerçek form kendi bekçisinde).
vi.mock("./GoodsReceiptFormDialog", () => ({
  GoodsReceiptFormDialog: ({
    onCreated,
  }: {
    onCreated: (id: string, sync?: ReceiptPurchaseOrderSync | null) => void;
  }) => (
    <button type="button" onClick={() => onCreated("r1", SYNC)}>
      stub-kaydet
    </button>
  ),
}));

// Panel: aldığı `sync` prop'unu okunabilir biçimde yazar.
vi.mock("./GoodsReceiptDetailSheet", () => ({
  GoodsReceiptDetailSheet: ({
    id,
    sync,
  }: {
    id: string | null;
    sync?: ReceiptPurchaseOrderSync | null;
  }) => <div data-testid="sheet">{`${id ?? "kapalı"}|${sync ? sync.orderNo : "senkron-yok"}`}</div>,
}));

import { GoodsReceiptsPage } from "./GoodsReceiptsPage";

describe("GoodsReceiptsPage — senkron uyarısının taşınması", () => {
  beforeEach(() => {
    listGoodsReceipts.mockResolvedValue(ROWS);
  });

  it("⭐ oluşturma yanıtındaki senkron, açılan fiş paneline TAŞINIR", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoodsReceiptsPage />);

    expect(await screen.findByTestId("sheet")).toHaveTextContent("kapalı|senkron-yok");
    await user.click(screen.getByText("stub-kaydet"));

    expect(screen.getByTestId("sheet")).toHaveTextContent("r1|AS1408260001");
  });

  it("⭐ BAŞKA bir fiş açılınca uyarı onunla birlikte GİTMEZ", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoodsReceiptsPage />);

    await user.click(await screen.findByText("stub-kaydet"));
    expect(screen.getByTestId("sheet")).toHaveTextContent("r1|AS1408260001");

    // Listeden ikinci fişi aç — uyarı ona ait değil.
    await user.click(await screen.findByText("MK-2"));
    expect(screen.getByTestId("sheet")).toHaveTextContent("r2|senkron-yok");
  });
});
