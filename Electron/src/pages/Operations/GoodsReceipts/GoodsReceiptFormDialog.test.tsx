// =============================================================================
// BEKÇİ — mal kabul formundaki alış siparişi bölümü GERÇEKTEN TAKILI MI
// =============================================================================
// ⭐ BU DOSYA BİR HATA SINIFI İÇİN VAR: `GoodsReceiptOrderSection` (seçici +
//    tedarikçi devralma + bekleyen kalem tablosu + "kalemleri siparişten doldur")
//    tamamen yazılmış, saf kuralları (`receiptOrderFields`) bekçiliydi ve testler
//    yeşil koşuyordu — ama forma HİÇ IMPORT EDİLMEMİŞTİ. Yani kod doğruydu,
//    kullanıcı hiçbir şey görmüyordu ve hiçbir test bunu göremiyordu. Saf bekçi
//    "kural doğru mu" sorusuna bakar; bu bekçi "ekranda VAR MI" sorusuna bakar.
// ⭐ FABRİKADA TEK BAYT ÇİZİLMEZ (ticaret paketinin "sıfır görünür fark" kuralı).
//    Görünürlük kararı bölümün KENDİ saf fonksiyonundadır; buradaki iddia,
//    kararın forma da yansıdığıdır.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";
// TİP-ONLY import — `vi.mock` fabrikaları hoist edilir, değer taşıyan import'a
// dokunamaz; tip silindiği için burada güvenlidir.
import type { DraftLine } from "./ReceiptLineRows";

// Rejim bayrağı + yetki: iki iddiayı da kurabilmek için değişken.
let financeEnabled = true;
let canReadPurchaseOrders = true;

vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled } } }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => canReadPurchaseOrders,
    hasAnyPermission: () => canReadPurchaseOrders,
    hasAllPermissions: () => canReadPurchaseOrders,
  }),
}));

// Formun ağır çocukları — bu testin konusu değil (kendi bekçileri var).
vi.mock("./ReceiptImportButton", () => ({ ReceiptImportButton: () => null }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));
vi.mock("./ReceiptLineRows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ReceiptLineRows")>();
  // Saf yardımcılar (emptyLine/expandLines/receiptTotals) GERÇEK kalır — form
  // onlarla çalışıyor. Editörün yerine tek düğme: "kaydedilebilir bir satır
  // girildi" olayını taklit eder (hücre hücre yazmak bu testin konusu değil).
  return {
    ...actual,
    ReceiptLineRows: ({
      lines,
      onChange,
    }: {
      lines: DraftLine[];
      onChange: (lines: DraftLine[]) => void;
    }) => (
      <div>
        <span data-testid="satir-sayisi">{lines.length}</span>
        <button
          type="button"
          onClick={() =>
            onChange([{ ...actual.emptyLine(), itemId: "item-1", initialQty: 100, count: 1 }])
          }
        >
          stub-satır-gir
        </button>
      </div>
    ),
  };
});

const createGoodsReceipt = vi.fn();
vi.mock("./service", () => ({
  createGoodsReceipt: (...a: unknown[]) => createGoodsReceipt(...a),
}));
vi.mock("./useItemTypes", () => ({
  useItemTypes: () => new Map<string, string>(),
  yarnIdsFrom: () => new Set<string>(),
}));
vi.mock("@/hooks/useWarehouses", () => ({
  useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [] }),
  useDefaultWarehouse: () => ({ id: "w1", code: "D1", name: "Merkez Depo" }),
  WAREHOUSES_QUERY_KEY: ["warehouses"],
}));
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn().mockRejectedValue(new Error("stub")), post: vi.fn() },
}));

// Alış siparişi uçları — saf yardımcılar (fmtQty/toNum) GERÇEK kalır, yoksa
// bölüm çizilirken patlar.
const listPurchaseOrders = vi.fn();
const getPurchaseOrder = vi.fn();
vi.mock("../PurchaseOrders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../PurchaseOrders/service")>();
  return {
    ...actual,
    listPurchaseOrders: (...a: unknown[]) => listPurchaseOrders(...a),
    getPurchaseOrder: (...a: unknown[]) => getPurchaseOrder(...a),
  };
});

import { GoodsReceiptFormDialog } from "./GoodsReceiptFormDialog";

describe("GoodsReceiptFormDialog — alış siparişi bölümü", () => {
  beforeEach(() => {
    financeEnabled = true;
    canReadPurchaseOrders = true;
    listPurchaseOrders.mockResolvedValue({
      data: [
        {
          id: "po-1",
          orderNo: "AS1408260001",
          status: "OPEN",
          currency: "TRY",
          orderDate: "2026-08-14T00:00:00Z",
          expectedDate: null,
          supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" },
        },
      ],
      pagination: { total: 1, totalPages: 1 },
    });
    getPurchaseOrder.mockResolvedValue({
      id: "po-1",
      orderNo: "AS1408260001",
      status: "OPEN",
      currency: "TRY",
      supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" },
      lines: [],
    });
  });

  it("⭐ TİCARET rejiminde bölüm forma TAKILIDIR (seçici ekranda)", async () => {
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    expect(await screen.findByText("Alış siparişi (opsiyonel)")).toBeInTheDocument();
  });

  it("⭐ FABRİKADA (finance kapalı) bölüm HİÇ çizilmez", async () => {
    financeEnabled = false;
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    // Form açıldı (ölçüm körlüğü zemini) ama sipariş alanı yok.
    expect(await screen.findByText("Yeni Mal Kabul")).toBeInTheDocument();
    expect(screen.queryByText("Alış siparişi (opsiyonel)")).not.toBeInTheDocument();
  });

  it("⭐ SEÇİLEN SİPARİŞ GÖVDEYE GİDER (özelliğin kesildiği yer buydu)", async () => {
    // Ekranda sipariş seçili, kayıt siparişsiz — sessiz ve tam ters bir sonuç.
    // Bu iddia hem seçicinin forma bağlı olduğunu hem de değerin isteğe
    // ulaştığını ölçer.
    createGoodsReceipt.mockResolvedValue({ data: { id: "r1" } });
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest(
      "select",
    ) as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");
    await user.click(screen.getByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() =>
      expect(createGoodsReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ purchaseOrderId: "po-1" }),
      ),
    );
  });

  it("⭐ tedarikçi SİPARİŞTEN devralınır (backend çelişkiyi 400 ile reddediyor)", async () => {
    createGoodsReceipt.mockResolvedValue({ data: { id: "r1" } });
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest(
      "select",
    ) as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");

    // Devralma ekranda AÇIKÇA yazılır (sessiz düzeltme yok) …
    expect(await screen.findByText(/Tedarikçi siparişten alındı/)).toBeInTheDocument();
    // … ve gövdeye de yansır.
    await user.click(screen.getByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));
    await vi.waitFor(() =>
      expect(createGoodsReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ supplierId: "s1", purchaseOrderId: "po-1" }),
      ),
    );
  });

  it("⭐ 'Kalemleri siparişten doldur' satırları EKLER — elle girileni SİLMEZ", async () => {
    getPurchaseOrder.mockResolvedValue({
      id: "po-1",
      orderNo: "AS1408260001",
      status: "OPEN",
      currency: "TRY",
      supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" },
      lines: [
        {
          id: "l1",
          lineNo: 1,
          itemId: "i1",
          qty: 500,
          receivedQty: 0,
          unitPrice: 42.5,
          notes: null,
          item: { id: "i1", code: "K1", name: "PATOS GRİ", unit: "MT", itemType: "FABRIC" },
          remainingQty: 500,
          over: false,
        },
        {
          id: "l2",
          lineNo: 2,
          itemId: "i2",
          qty: 200,
          receivedQty: 0,
          unitPrice: null,
          notes: null,
          item: { id: "i2", code: "İ1", name: "30/1 PENYE", unit: "KG", itemType: "YARN" },
          remainingQty: 200,
          over: false,
        },
      ],
    });
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest(
      "select",
    ) as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");

    // Önce ELLE bir satır gir (doldurma bunu silmemeli).
    await user.click(screen.getByText("stub-satır-gir"));
    expect(screen.getByTestId("satir-sayisi")).toHaveTextContent("1");

    await user.click(await screen.findByText("Kalemleri siparişten doldur"));

    // 1 elle + 2 siparişten = 3. Doldurma "üstüne yazsaydı" 2 olurdu.
    await vi.waitFor(() => expect(screen.getByTestId("satir-sayisi")).toHaveTextContent("3"));
  });

  it("⭐ yanıttaki SENKRON SONUCU yukarı taşınır — toast'a bırakılıp yutulmaz", async () => {
    // Bu iddia olmadan zincir sessizce kopabilir: form kaydeder, panel açılır,
    // "fazla mal geldi" bilgisi hiçbir yere ulaşmaz ve GERİ DE ALINAMAZ (sunucu
    // onu saklamıyor). Sonda: `onCreated(res.data.id)` — ikinci argüman düşünce
    // bu test kırmızı verir.
    const sync: ReceiptPurchaseOrderSync = {
      id: "po-1",
      orderNo: "AS1408260001",
      status: "PARTIAL",
      changed: true,
      overReceiptLines: [2],
      unmatchedItemIds: [],
    };
    createGoodsReceipt.mockResolvedValue({ data: { id: "r1", purchaseOrder: sync } });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={onCreated} />,
    );

    await user.click(await screen.findByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("r1", sync));
  });

  it("sipariş bağı yoksa ikinci argüman null gider (panel bant çizmez)", async () => {
    createGoodsReceipt.mockResolvedValue({ data: { id: "r1" } });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={onCreated} />,
    );

    await user.click(await screen.findByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("r1", null));
  });

  it("okuma yetkisi olmayan kullanıcıya çizilmez (rejim açık olsa bile)", async () => {
    canReadPurchaseOrders = false;
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    expect(await screen.findByText("Yeni Mal Kabul")).toBeInTheDocument();
    expect(screen.queryByText("Alış siparişi (opsiyonel)")).not.toBeInTheDocument();
  });
});
