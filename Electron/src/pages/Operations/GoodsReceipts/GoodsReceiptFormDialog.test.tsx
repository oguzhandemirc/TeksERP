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
// ⭐⭐ B5 TOAST'INDAKİ SEKME ADI SABİT YAZILMAZ. Bu dosyanın iki iddiası
//    2026-08-15'e kadar `"Bitmiş Depo"` / `"Ham Stok"` diyordu ve YANLIŞI
//    KİLİTLİYORDU: mock'ta `financeEnabled = true` (yani ticaret kurulumu) ve o
//    rejimde Envanter şeridi aynı sekmeleri "Depo" / "Yeni Giren" diye çiziyor.
//    Yani toast, ekranda OLMAYAN bir sekmeye yönlendiriyordu — hem de tam olarak
//    B5'in çözmek için yazıldığı şikâyeti ("malı bulamıyorum") yeniden üreterek.
//    Beklentiler artık `tabs-regime`den ÜRETİLİR; toast ile şerit ayrışamaz.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { resolveRollTabs } from "@/pages/Operations/Rolls/tabs-regime";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";
// TİP-ONLY import — `vi.mock` fabrikaları hoist edilir, değer taşıyan import'a
// dokunamaz; tip silindiği için burada güvenlidir.
import type { DraftLine } from "./ReceiptLineRows";

// Rejim bayrağı + yetki: iki iddiayı da kurabilmek için değişken.
let financeEnabled = true;
let canReadPurchaseOrders = true;

/** Envanter şeridinin GERÇEKTEN çizdiği sekme adı — beklentinin tek kaynağı. */
const stripLabel = (key: "RAW_STOCK" | "FINISHED_STOCK", finance: boolean): string => {
  const tab = resolveRollTabs(true, finance).find((t) => t.key === key);
  if (!tab) throw new Error(`Sekme şeritte yok: ${key}`);
  return tab.label;
};

vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled } } }),
  // C8: lot zorunluluğu bu testlerin konusu değil — KAPALI (bugünkü davranış); ayrı bekçi `GoodsReceiptFormDialog.lotRequired.test`.
  useDevereLotRequired: () => false,
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => canReadPurchaseOrders,
    hasAnyPermission: () => canReadPurchaseOrders,
    hasAllPermissions: () => canReadPurchaseOrders,
  }),
}));

// Toast metni B5'in TEK yüzeyi — mesajın içeriği ölçülüyor.
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Formun ağır çocukları — bu testin konusu değil (kendi bekçileri var).
vi.mock("./ReceiptImportButton", () => ({ ReceiptImportButton: () => null }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));
vi.mock("@/components/forms/ItemSelect", () => ({ ItemSelect: () => null }));
// Tedarikçi seçicisinin KENDİ bekçisi var (`supplierParty.test.ts`); burada
// yalnız formun geri kalanı ölçülüyor.
vi.mock("@/components/forms/SupplierSelect", () => ({ SupplierSelect: () => null }));
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

  it("⭐ C4 — FASON tedarikçili siparişte miras DOĞRU BACAĞA yazılır", async () => {
    // Eski miras satırı yalnız `supplier.id` okuyordu: fason tedarikçili
    // siparişte hiçbir şey devralınmaz, fiş tedarikçisiz kaydedilir ve backend
    // "taraf uyuşmuyor" derdi — ekranda ise devralma yazıyor görünürdü.
    getPurchaseOrder.mockResolvedValue({
      id: "po-1",
      orderNo: "AS1408260001",
      status: "OPEN",
      currency: "TRY",
      supplier: null,
      subcontractorSupplier: { id: "f1", code: "F001", name: "BOYER BOYA" },
      lines: [],
    });
    listPurchaseOrders.mockResolvedValue({
      data: [
        {
          id: "po-1",
          orderNo: "AS1408260001",
          status: "OPEN",
          currency: "TRY",
          orderDate: "2026-08-14T00:00:00Z",
          expectedDate: null,
          supplier: null,
          subcontractorSupplier: { id: "f1", code: "F001", name: "BOYER BOYA" },
        },
      ],
      pagination: { total: 1, totalPages: 1 },
    });
    createGoodsReceipt.mockResolvedValue({ data: { id: "r1" } });
    const user = userEvent.setup();

    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest(
      "select",
    ) as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");

    // Devralma ekranda AÇIKÇA yazılır (seçicide de, bant cümlesinde de).
    expect(await screen.findByText(/Tedarikçi siparişten alındı/)).toBeInTheDocument();
    expect(screen.getAllByText(/BOYER BOYA/).length).toBeGreaterThan(0);
    await user.click(screen.getByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() =>
      expect(createGoodsReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ subcontractorId: "f1", supplierId: null }),
      ),
    );
  });

  it("⭐ sipariş SEÇİLİNCE kalemler OTOMATİK dolar (EK 4); 'Siparişten yeniden doldur' ikincil düğme EKLER — elle girileni SİLMEZ, mükerrer yazmaz", async () => {
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

    // ⭐ EK 4: sipariş seçildiği anda bekleyen 2 kalem satır oldu (düğmeye basılmadan). Sonda: otomatik çağrı
    // düşünce burada "0" kalır.
    await vi.waitFor(() => expect(screen.getByTestId("satir-sayisi")).toHaveTextContent("2"));
    expect(screen.queryByText("Kalemleri siparişten doldur")).toBeNull();
    const again = await screen.findByText("Siparişten yeniden doldur");
    expect(again.closest("button")).toHaveAttribute("title", expect.stringContaining("girdiğin satırlar korunur"));

    // Kullanıcı satırları silip ELLE bir satır girdi (stub listeyi 1 satırla DEĞİŞTİRİR) — otomatik doldurma
    // yeniden DAYATMAZ (yalnız seçim anında); ikincil düğme ekler, elle girileni silmez.
    await user.click(screen.getByText("stub-satır-gir"));
    expect(screen.getByTestId("satir-sayisi")).toHaveTextContent("1");
    await user.click(again);
    // 1 elle + 2 siparişten = 3 (merge: üstüne yazma yok).
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

// =============================================================================
// C2 (ham stok tiki) + B5 (toast "nereye düştü") — GÖVDEYE VE EKRANA ULAŞIYOR MU
// =============================================================================
describe("GoodsReceiptFormDialog — ham stok girişi ve kayıt geri bildirimi", () => {
  beforeEach(() => {
    financeEnabled = true;
    canReadPurchaseOrders = true;
    listPurchaseOrders.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 0 } });
    createGoodsReceipt.mockResolvedValue({
      data: { id: "r1", receiptNo: "MK1508260001", totals: { rollCount: 3, yarnLineCount: 0 } },
    });
  });

  it("⭐ 'Ham stok olarak al' tiki GÖVDEYE ULAŞIR (özelliğin kesileceği yer)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    await user.click(await screen.findByText(/ham stok olarak alınsın/));
    await user.click(screen.getByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() =>
      expect(createGoodsReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ rawStockEntry: true }),
      ),
    );
  });

  it("tik atılmazsa varsayılan KAPALIDIR (bugünkü davranış)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    await user.click(await screen.findByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() =>
      expect(createGoodsReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ rawStockEntry: false }),
      ),
    );
  });

  it("⭐ B5 — toast HEDEF SEKMEYİ söyler ve sayıyı YANITTAN alır (taslaktan değil)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    // Taslakta 1 satır var; yanıt 3 top diyor. Taslaktan sayan bir toast "1 top"
    // derdi — envanterde 3 top varken.
    await user.click(await screen.findByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("3 top");
    // ⚠️ Bu senaryo `financeEnabled = true` ile koşuyor (ticaret kurulumu) —
    // yani beklenen ad ŞERİTTEKİ addır, fabrika adı DEĞİL.
    expect(msg).toContain(stripLabel("FINISHED_STOCK", true));
    expect(msg).not.toContain(stripLabel("FINISHED_STOCK", false));
  });

  it("⭐ B5 — ham stok fişinde toast HAM STOK sekmesini söyler", async () => {
    createGoodsReceipt.mockResolvedValue({
      data: {
        id: "r1",
        receiptNo: "MK1508260002",
        rawStockEntry: true,
        totals: { rollCount: 2, yarnLineCount: 0 },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    await user.click(await screen.findByText(/ham stok olarak alınsın/));
    await user.click(screen.getByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain(stripLabel("RAW_STOCK", true));
    expect(msg).not.toContain(stripLabel("RAW_STOCK", false));
    // Tutulamayacak süreç vaadi verilmez: Fason Sevk yüzeyi `workorder:*`
    // arkasında ve ham stok fişi açabilen tek rol (WEB_TRADE) o izni taşımıyor.
    expect(msg).not.toMatch(/fason/i);
  });

  it("atlanan satır varsa UYARI basılır — başarı cümlesi onu örtmez", async () => {
    createGoodsReceipt.mockResolvedValue({
      data: {
        id: "r1",
        receiptNo: "MK3",
        totals: { rollCount: 0, yarnLineCount: 0 },
        failed: [{ index: 0, itemId: "i1", reason: "Ürün pasif" }],
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );

    await user.click(await screen.findByText("stub-satır-gir"));
    await user.click(screen.getByText(/Fişi Oluştur/));

    await vi.waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
