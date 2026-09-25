// =============================================================================
// BEKÇİ — SEVK İRSALİYESİ TEK YÜZEY (2026-09-10 birleştirme)
// =============================================================================
// ⭐ NEDEN VAR. Aynı belgenin ÜÇ yüzeyi vardı (Sevkiyatlar → İrsaliye, Muhasebe →
//    "Fiş", Muhasebe → "Belge") ve üçü de birbirinin eksiğiydi: Excel bir yerde,
//    sürüm çubuğu başka yerde, baskı seçenekleri üçüncüde. Birleştirmede korunması
//    gereken üç şey ölçülüyor:
//
//    1) DIRECT (fasondan doğrudan sevk) ile çuval sevkiyatı AYRI belge tipine ve
//       AYRI rapor ucuna gider. Karışırsa muhasebe fason sevkin irsaliyesini
//       çuval belgesi olarak basmaya çalışır (404) ya da tersi.
//    2) Excel/etiket veri seti YALNIZ istendiğinde çekilir. Eski "Fiş" her
//       açılışta çekiyordu; belgeye bakmak için açan kullanıcı bu isteği hiç
//       kullanmıyordu.
//    3) Sevkiyata özgü kalemler jenerik `PrintedDocDialog`a GÖMÜLMEDİ: slot'suz
//       çağıran (22 belge yüzeyi) hiçbirini çizmez.
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): (a) docType'ı sabit "SHIPMENT_DISPATCH"
// yapmak → §1 kırmızı; (b) `reportQ` enabled'ından `reportWanted`ı düşürmek → §2
// kırmızı; (c) Excel kalemini PrintedDocDialog'un kendi araç çubuğuna gömmek → §3
// kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const getHtml = vi.fn();
const getCurrent = vi.fn();
const getReport = vi.fn();
const getDirectReport = vi.fn();

vi.mock("@/services/printedDocumentService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/printedDocumentService")>();
  return {
    ...actual,
    printedDocumentService: {
      ...actual.printedDocumentService,
      getCurrent: (...a: unknown[]) => getCurrent(...a),
      getHtml: (...a: unknown[]) => getHtml(...a),
    },
  };
});

vi.mock("../AccountingDispatch/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../AccountingDispatch/service")>();
  return {
    ...actual,
    accountingDispatchService: {
      ...actual.accountingDispatchService,
      getReport: (...a: unknown[]) => getReport(...a),
      getDirectReport: (...a: unknown[]) => getDirectReport(...a),
    },
  };
});

// Ölçülen şey belge notu editörü değil; ağ konuşmasın diye işaretle temsil edilir.
vi.mock("./DispatchNoteEditor", () => ({
  DispatchNoteEditor: () => <div>belge-notu-editoru</div>,
}));

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, isAdmin: true }),
}));

vi.mock("@/hooks/useLabelPrinter", () => ({
  useLabelPrinter: () => ({ directEnabled: false, printRollsBulk: vi.fn(), peripheralId: null }),
}));

import { ShipmentDocDialog } from "./ShipmentDocDialog";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";

const HTML = "<html><head><style>@page { size: A4; }</style></head><body>irsaliye</body></html>";

function docFixture() {
  return {
    data: {
      id: "d1",
      docType: "SHIPMENT_DISPATCH",
      sourceId: "s1",
      version: 1,
      status: "ACTIVE",
      documentNo: "SVK0709260006",
      snapshot: { schemaVersion: 1, frozenAt: "2026-09-01T10:00:00.000Z", company: {}, docConfigOverride: null, doc: {} },
      reissueReason: null,
      supersededAt: null,
      voidedAt: null,
      voidReason: null,
      reconstructed: false,
      printedById: null,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      templateStale: false,
    },
  };
}

const REPORT = {
  data: {
    header: { shipmentNo: "SVK0709260006" },
    cekiRows: [{ rollId: "r1" }, { rollId: "r2" }],
    totals: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // "İndir ▾" menüsü YALNIZ PDF köprüsü ya da ek kalem varsa çizilir. Stub
  // olmadan menü hiç açılmaz ve §3'ün "Excel kalemi yok" iddiası boşa düşerdi
  // (sonda C ile ölçüldü: gömülü Excel kalemi testi kırmızıya çevirmiyordu).
  (window as unknown as { api?: unknown }).api = { pdf: { save: vi.fn() } };
  getCurrent.mockResolvedValue(docFixture());
  getHtml.mockResolvedValue(HTML);
  getReport.mockResolvedValue(REPORT);
  getDirectReport.mockResolvedValue(REPORT);
});

describe("ShipmentDocDialog — tek belge yüzeyi", () => {
  it("§1 çuval sevkiyatı SHIPMENT_DISPATCH'e gider; belge notu editörü çizilir", async () => {
    renderWithProviders(
      <ShipmentDocDialog shipmentId="s1" open onOpenChange={() => {}} shipmentNo="SVK1" status="DISPATCHED" />,
    );

    await waitFor(() => expect(getHtml).toHaveBeenCalled());
    expect(getHtml.mock.calls[0]?.[0]).toBe("SHIPMENT_DISPATCH");
    expect(await screen.findByText("belge-notu-editoru")).toBeInTheDocument();
  });

  it("§1b DIRECT satırı SUBCONTRACTOR_DIRECT_SHIP + getDirectReport kullanır; çuval yüzeyleri çizilmez", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ShipmentDocDialog shipmentId="d1" open onOpenChange={() => {}} kind="DIRECT" shipmentNo="FSD1" status="DISPATCHED" />,
    );

    await waitFor(() => expect(getHtml).toHaveBeenCalled());
    expect(getHtml.mock.calls[0]?.[0]).toBe("SUBCONTRACTOR_DIRECT_SHIP");
    // Çuval YOKTUR: liste seçimi ve irsaliye açıklaması bu dalda anlamsız.
    expect(screen.queryByText("belge-notu-editoru")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Baskı seçenekleri/ }));
    expect(screen.queryByText("Basılacak listeler")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /^İndir/ }));
    await waitFor(() => expect(getDirectReport).toHaveBeenCalledWith("d1"));
    expect(getReport).not.toHaveBeenCalled();
  });

  it("§2 rapor YALNIZ menü açılınca çekilir; Excel gelene dek pasiftir", async () => {
    const user = userEvent.setup();
    let resolveReport: ((v: unknown) => void) | undefined;
    getReport.mockImplementation(() => new Promise((r) => (resolveReport = r)));

    renderWithProviders(
      <ShipmentDocDialog shipmentId="s1" open onOpenChange={() => {}} shipmentNo="SVK1" status="DISPATCHED" />,
    );
    await waitFor(() => expect(getHtml).toHaveBeenCalled());
    // Belgeyi görmek için açan kullanıcı rapor isteğini ödemez.
    expect(getReport).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: /^İndir/ }));
    await waitFor(() => expect(getReport).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("Excel (hazırlanıyor…)")).toHaveAttribute("aria-disabled", "true");

    resolveReport?.(REPORT);
    await waitFor(() => expect(screen.getByText("Excel")).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("§3 slot'suz PrintedDocDialog hiçbir sevkiyat kalemi çizmez (negatif sonda)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PrintedDocDialog
        docType="SHIPMENT_DISPATCH"
        sourceId="s1"
        open
        onOpenChange={() => {}}
        title="Sevk İrsaliyesi"
        writePermission="shipping:write"
      />,
    );

    await waitFor(() => expect(getHtml).toHaveBeenCalled());
    expect(screen.queryByText("belge-notu-editoru")).not.toBeInTheDocument();

    // "Yazdır" ek kalem taşımadığı için MENÜ değil SADE DÜĞMEDİR: tıklayınca
    // menü açılmaz, doğrudan basar.
    await user.click(await screen.findByRole("button", { name: /^Yazdır/ }));
    expect(screen.queryByText("Belgeyi yazdır")).not.toBeInTheDocument();
    expect(screen.queryByText(/Top etiketlerini bas/)).not.toBeInTheDocument();

    // "İndir ▾" AÇILIR (PDF köprüsü var) ama içinde YALNIZ PDF vardır.
    await user.click(await screen.findByRole("button", { name: /^İndir/ }));
    expect(await screen.findByText("PDF kaydet")).toBeInTheDocument();
    expect(screen.queryByText(/Excel/)).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: /Baskı seçenekleri/ }));
    expect(screen.queryByText("Basılacak listeler")).not.toBeInTheDocument();
    // Jenerik yüzeyin KENDİ tek-seferlik tikleri yerinde kalır.
    expect(screen.getByText(/Çuval notlarını bu baskıda göster/)).toBeInTheDocument();
  });
});
