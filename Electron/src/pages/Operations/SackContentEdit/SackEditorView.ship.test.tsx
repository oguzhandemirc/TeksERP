import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// ═══════════════════════════════════════════════════════════════════════════
// BEKÇİ — çuval editöründen TEK ÇUVAL SEVKİ (2026-09-04 saha isteği)
//
// Ölçülen üç şey:
//   §1  Editörde "Sevk Et" var ve tıklanınca LİSTEDEKİ İLE AYNI diyalog
//       (`CreateShipmentDialog`) tek elemanlı seçimle açılır → kısayol bir
//       BYPASS değil (sipariş zorunluluğu / tartı / onay rejimi hep o
//       diyaloğun içindeki kapılardan geçer).
//   §2  Kilitli (sevkiyata atanmış) çuvalda buton HİÇ ÇİZİLMEZ.
//   §3  Boş çuvalda buton PASİF (backend "Boş çuval sevk edilemez" der).
//   §4  Müşterisiz çuvalda buton yine ÇİZİLİR ve diyaloğa `customer: null`
//       gider → cari seçimi diyaloğun işi (sevkiyat müşterisiz olamaz, ÇUVAL
//       olabilir).
// ═══════════════════════════════════════════════════════════════════════════

const contentsData = vi.fn();
vi.mock("./useSackData", () => ({
  useSackContents: () => contentsData(),
  invalidateSackHub: vi.fn(),
}));

vi.mock("./useSackWeighAction", () => ({
  useSackWeighAction: () => ({ busy: false, hasScale: false, weigh: vi.fn() }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useShippingManualWeightRestrictedEnabled: () => false,
}));

// IO yapan / ağır çocuklar — bu bekçinin konusu değil.
vi.mock("./EditorScanBar", () => ({ EditorScanBar: () => null }));
vi.mock("./SackContentsTable", () => ({ SackContentsTable: () => null }));
vi.mock("./SackContentDumpMenu", () => ({ SackContentDumpMenu: () => null }));
vi.mock("./StaleLabelsBanner", () => ({ StaleLabelsBanner: () => null }));
vi.mock("./ContentMismatchBanner", () => ({ ContentMismatchBanner: () => null }));
vi.mock("./WeighSackDialog", () => ({ WeighSackDialog: () => null }));
vi.mock("./AddKartelaDialog", () => ({ AddKartelaDialog: () => null }));
vi.mock("./DeleteSackDialog", () => ({ DeleteSackDialog: () => null }));
vi.mock("./DistributeSackDialog", () => ({ DistributeSackDialog: () => null }));
vi.mock("./SackNoteDialog", () => ({ SackNoteDialog: () => null }));
vi.mock("./ReassignCustomerDialog", () => ({ ReassignCustomerDialog: () => null }));
vi.mock("@/components/labels/SackLabelDialog", () => ({ SackLabelDialog: () => null }));

// ⚠️ Diyalog CASUS: gerçek `CreateShipmentDialog` yerine props'u kaydeden bir
// stub. Ölçtüğümüz şey "sevk oldu mu" değil — "kısayol ORTAK KAPIYA mı
// bağlandı, hangi yükle". Kendi uçlarını çağıran bir kopya yazılsaydı bu
// casusa hiçbir şey gelmezdi ve §1 kırmızıya düşerdi.
const shipDialogProps = vi.fn();
vi.mock("./CreateShipmentDialog", () => ({
  CreateShipmentDialog: (p: { sacks: unknown[] | null }) => {
    shipDialogProps(p.sacks);
    return p.sacks ? <div data-testid="ship-dialog" /> : null;
  },
}));

import { SackEditorView } from "./SackEditorView";
import type { EditorTarget } from "./types";

const target: EditorTarget = {
  sackId: "sk1",
  sackNo: "CV-260904-001",
  customerId: "c1",
  customerName: "ACME Tekstil",
  branchId: null,
  branchName: null,
  branchCode: null,
};

function setContents(over: Record<string, unknown> = {}) {
  contentsData.mockReturnValue({
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    data: {
      data: {
        id: "sk1",
        sackNo: "CV-260904-001",
        seq: 1,
        weightKg: 12,
        notes: null,
        shipment: null,
        rolls: [{ id: "r1", currentQty: 100 }],
        swatches: [],
        ...over,
      },
    },
  });
}

function renderEditor(t = target) {
  return renderWithProviders(
    <SackEditorView target={t} onExit={vi.fn()} onReassigned={vi.fn()} onSwitchSack={vi.fn()} />,
  );
}

beforeEach(() => {
  shipDialogProps.mockClear();
  setContents();
});

describe("Çuval editörü — tek çuval sevki", () => {
  it("§1 'Sevk Et' ORTAK CreateShipmentDialog'u tek çuvalla açar (bypass değil)", async () => {
    renderEditor();
    const btn = screen.getByRole("button", { name: /Sevk Et/i });
    expect(btn).toBeEnabled();

    // Açılmadan önce diyalog kapalı (sacks=null) olmalı — mount edilmiş olması
    // sevk niyeti demek DEĞİL.
    expect(screen.queryByTestId("ship-dialog")).toBeNull();

    await userEvent.click(btn);
    expect(screen.getByTestId("ship-dialog")).toBeTruthy();

    const sacks = shipDialogProps.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(sacks).toHaveLength(1);
    expect(sacks[0]).toMatchObject({
      id: "sk1",
      sackNo: "CV-260904-001",
      customer: { id: "c1", name: "ACME Tekstil" },
    });
  });

  it("§2 kilitli çuvalda (sevkiyata atanmış) 'Sevk Et' ÇİZİLMEZ", () => {
    setContents({ shipment: { id: "sh1", shipmentNo: "SVK-1", status: "PLANNED" } });
    renderEditor();
    expect(screen.queryByRole("button", { name: /Sevk Et/i })).toBeNull();
  });

  it("§3 boş çuvalda buton PASİF (backend 'Boş çuval sevk edilemez' der)", () => {
    setContents({ rolls: [], swatches: [] });
    renderEditor();
    expect(screen.getByRole("button", { name: /Sevk Et/i })).toBeDisabled();
  });

  it("§4 müşterisiz çuvalda buton ÇİZİLİR, diyaloğa customer:null gider", async () => {
    renderEditor({ ...target, customerId: null, customerName: null });
    await userEvent.click(screen.getByRole("button", { name: /Sevk Et/i }));
    const sacks = shipDialogProps.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    // Cari SEVK ANINDA atanır — çuvalın müşterisiz olması sevki engellemez,
    // yalnız diyalogdaki cari seçicisini zorunlu kılar.
    expect(sacks[0]).toMatchObject({ customer: null });
  });
});
