// P3 Emanet Çıkış: liste süzgeci sunucuya gider · hata "belge yok" sanılmaz · yeni belge önizlemesi engeli gösterir ve
// clientToken deneme başına (belirsiz hatada yapışır, kesin 4xx'te yenilenir) · iptal önizlemesi etkilenen HER kaydı
// listeler · bulunabilirlik (karo emanet bayrağına bağlı, palet, modül tablosu).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { ConsignmentDispatchesPage } from "../ConsignmentDispatchesPage";
import { ConsignmentDispatchFormDialog } from "../ConsignmentDispatchFormDialog";
import { ConsignmentCancelDialog } from "../ConsignmentCancelDialog";
import type { DraftItem } from "../draft";
import type { ConsignmentDispatchListResult, ConsignmentDispatchPreview } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useDevereEnabled: () => true,
  useFeatureFlags: () => ({ data: { data: { iplikEnabled: true } } }),
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string | null;
    onChange: (id: string | null) => void;
    placeholder?: string;
  }) => (
    <button type="button" data-testid="pick-customer" onClick={() => onChange("cA")}>
      {value ?? placeholder ?? "Müşteri seç…"}
    </button>
  ),
}));
const BEAM: DraftItem = {
  key: "beam:b1",
  input: { kind: "WARP_BEAM", warpBeamId: "b1" },
  label: "Levent L-1",
  sub: "Çözgü A · 900 m",
};
const YARN: DraftItem = {
  key: "yarn:l1:w1",
  input: { kind: "YARN", yarnItemId: "i1", warehouseId: "w1", lotId: "l1", qtyKg: "12.5" },
  label: "İplik lot 77",
  sub: "",
};
vi.mock("../BeamPicker", () => ({
  BeamPicker: ({ open, onPick }: { open: boolean; onPick: (i: DraftItem) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick(BEAM)}>
        levent-sec
      </button>
    ) : null,
}));
vi.mock("../YarnLinePicker", () => ({
  YarnLinePicker: ({ open, onPick }: { open: boolean; onPick: (i: DraftItem) => void }) =>
    open ? (
      <button type="button" onClick={() => onPick(YARN)}>
        lot-sec
      </button>
    ) : null,
}));

const svc = { list: vi.fn(), preview: vi.fn(), create: vi.fn(), cancelPreview: vi.fn(), cancel: vi.fn() };
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listConsignmentDispatches: (...a: unknown[]) => svc.list(...a),
  previewConsignmentDispatch: (...a: unknown[]) => svc.preview(...a),
  createConsignmentDispatch: (...a: unknown[]) => svc.create(...a),
  getConsignmentCancelPreview: (...a: unknown[]) => svc.cancelPreview(...a),
  cancelConsignmentDispatch: (...a: unknown[]) => svc.cancel(...a),
}));

const LIST: ConsignmentDispatchListResult = {
  data: [
    {
      id: "d1",
      dispatchNo: "EC-2026-0001",
      ownerCustomer: { id: "cA", name: "Gül Perde" },
      dispatchedAt: "2026-11-08T09:00:00Z",
      cancelledAt: null,
      beamCount: 2,
      beamLengthM: "1800.00",
      yarnKg: "12.500",
    },
  ],
  nextCursor: null,
  summary: { count: 1, activeCount: 1, beamCount: 2, yarnKg: "12.500" },
};
const preview = (blocked: boolean): ConsignmentDispatchPreview => ({
  ownerCustomer: { id: "cA", name: "Gül Perde" },
  lines: [
    {
      kind: "WARP_BEAM",
      refId: "b1",
      label: "L-1",
      qty: "900.00",
      unit: "METER",
      ownerCustomerId: "cA",
      blockedReason: blocked ? "CONSIGNMENT_BEAM_NOT_READY" : null,
    },
  ],
  totals: { beamCount: 1, beamLengthM: "900.00", yarnKg: "0" },
  canCreate: !blocked,
  warnings: [],
});

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  svc.list.mockResolvedValue(LIST);
});

describe("Emanet Çıkış listesi", () => {
  it("satır + özet şeridi sunucudan; durum çipi süzgeci SUNUCUYA gider", async () => {
    renderWithProviders(<ConsignmentDispatchesPage />);
    expect(await screen.findByText("EC-2026-0001")).toBeInTheDocument();
    expect(screen.getByTestId("consignment-summary")).toHaveTextContent("1 belge");
    expect(svc.list.mock.calls[0]![0]).toMatchObject({ status: "ALL" });
    fireEvent.click(screen.getByRole("button", { name: "İptal" }));
    await waitFor(() =>
      expect(svc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "CANCELLED" }), null, 50),
    );
  });

  it("hata 'yüklenemedi' der (belge yok sanılmaz); boş liste ayrı cümle", async () => {
    svc.list.mockRejectedValueOnce(Object.assign(new Error("x"), { response: { status: 500 } }));
    const { unmount } = renderWithProviders(<ConsignmentDispatchesPage />);
    expect(await screen.findByText("Emanet çıkış listesi yüklenemedi.")).toBeInTheDocument();
    unmount();
    svc.list.mockResolvedValueOnce({
      ...LIST,
      data: [],
      summary: { count: 0, activeCount: 0, beamCount: 0, yarnKg: "0" },
    });
    renderWithProviders(<ConsignmentDispatchesPage />);
    expect(await screen.findByTestId("consignment-empty")).toHaveTextContent("Henüz emanet çıkışı yok");
  });
});

async function openFormWithBeam() {
  renderWithProviders(<ConsignmentDispatchFormDialog open onOpenChange={() => {}} onCreated={() => {}} />);
  fireEvent.click(screen.getByTestId("pick-customer"));
  fireEvent.click(screen.getByRole("button", { name: /Levent ekle/ }));
  fireEvent.click(screen.getByText("levent-sec"));
}

describe("Yeni emanet çıkışı", () => {
  it("önizleme engelini satırda Türkçe yazar, kaydı kapatır (ham kod basılmaz)", async () => {
    svc.preview.mockResolvedValue(preview(true));
    await openFormWithBeam();
    expect(await screen.findByText("Levent hazır (boşta) değil")).toBeInTheDocument();
    expect(screen.queryByText(/CONSIGNMENT_/)).toBeNull();
    expect(screen.getByRole("button", { name: "Çıkışı Kaydet" })).toBeDisabled();
    expect(svc.preview).toHaveBeenCalledWith(
      expect.objectContaining({ ownerCustomerId: "cA", items: [BEAM.input] }),
    );
  });

  it("clientToken: belirsiz hatada (5xx) AYNI token, kesin 4xx'ten sonra YENİ token", async () => {
    svc.preview.mockResolvedValue(preview(false));
    svc.create
      .mockRejectedValueOnce(Object.assign(new Error("ağ"), { response: { status: 503 } }))
      .mockRejectedValueOnce(Object.assign(new Error("ret"), { response: { status: 409 } }))
      .mockResolvedValueOnce({ id: "d9", dispatchNo: "EC-9" });
    await openFormWithBeam();
    const save = await screen.findByRole("button", { name: "Çıkışı Kaydet" });
    await waitFor(() => expect(save).toBeEnabled());
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Çıkışı Kaydet" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Çıkışı Kaydet" }));
      await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(i + 1));
      tokens.push((svc.create.mock.calls[i]![0] as { clientToken: string }).clientToken);
    }
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[2]).not.toBe(tokens[1]);
  });

  it("iplik kalemi lot + depo + kg taşır (YARN lotId zorunlu)", async () => {
    svc.preview.mockResolvedValue({
      ...preview(false),
      lines: [
        {
          kind: "YARN",
          refId: "l1",
          label: "77",
          qty: "12.5",
          unit: "KG",
          ownerCustomerId: "cA",
          blockedReason: null,
        },
      ],
    });
    renderWithProviders(<ConsignmentDispatchFormDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByTestId("pick-customer"));
    fireEvent.click(screen.getByRole("button", { name: /İplik lotu ekle/ }));
    fireEvent.click(screen.getByText("lot-sec"));
    await waitFor(() => expect(svc.preview).toHaveBeenCalled());
    expect(svc.preview.mock.calls[0]![0].items[0]).toEqual({
      kind: "YARN",
      yarnItemId: "i1",
      warehouseId: "w1",
      lotId: "l1",
      qtyKg: "12.5",
    });
  });
});

describe("İptal önizlemesi", () => {
  it("etkilenen her kaydı ve sarım hizmet bağını listeler; gerekçe ≥3 olmadan iptal kapalı", async () => {
    svc.cancelPreview.mockResolvedValue({
      id: "d1",
      dispatchNo: "EC-2026-0001",
      canCancel: true,
      blockedReason: null,
      affected: [
        { kind: "WARP_BEAM", refId: "b1", label: "Levent L-1", qty: "900.00", unit: "METER" },
        { kind: "YARN", refId: "l1", label: "Lot 77 · Ana Depo", qty: "12.5", unit: "KG" },
      ],
      billingLinks: [
        { linkId: "k1", warpBeamId: "b1", invoiceId: "f1", invoiceNo: null, invoiceStatus: "DRAFT" },
      ],
    });
    svc.cancel.mockResolvedValue({ id: "d1", dispatchNo: "EC-2026-0001" });
    renderWithProviders(<ConsignmentCancelDialog dispatchId="d1" onOpenChange={() => {}} />);
    expect(await screen.findByText("Levent L-1")).toBeInTheDocument();
    expect(screen.getByText("Lot 77 · Ana Depo")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-billing-links")).toHaveTextContent("Taslak");
    const btn = screen.getByRole("button", { name: "İptal Et" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("İptal gerekçesi"), { target: { value: "Yanlış müşteri" } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(svc.cancel).toHaveBeenCalledWith("d1", "Yanlış müşteri"));
  });

  it("faturalı levent bağı iptali kapatır, nedeni Türkçe yazar", async () => {
    svc.cancelPreview.mockResolvedValue({
      id: "d1",
      dispatchNo: "EC-1",
      canCancel: false,
      blockedReason: "CONSIGNMENT_BEAM_INVOICED",
      affected: [{ kind: "WARP_BEAM", refId: "b1", label: "Levent L-1", qty: "900", unit: "METER" }],
      billingLinks: [
        { linkId: "k1", warpBeamId: "b1", invoiceId: "f1", invoiceNo: "HF-12", invoiceStatus: "CONFIRMED" },
      ],
    });
    renderWithProviders(<ConsignmentCancelDialog dispatchId="d1" onOpenChange={() => {}} />);
    expect(await screen.findByTestId("cancel-blocked")).toHaveTextContent("önce faturayı iptal edin");
    fireEvent.change(screen.getByLabelText("İptal gerekçesi"), { target: { value: "deneme" } });
    expect(screen.getByRole("button", { name: "İptal Et" })).toBeDisabled();
    expect(screen.getByTestId("cancel-billing-links")).toHaveTextContent("HF-12 · Onaylı");
  });
});

describe("Bulunabilirlik", () => {
  it("karo (emanet bayrağına bağlı, izin route ile aynı) · palet · modül tablosu", () => {
    const tile = operationsTiles.find((t) => t.to === "/operations/emanet-cikis");
    expect(tile?.permission).toBe("consignment:read");
    expect(tile?.visibleWhen?.({ emanetEnabled: true } as never)).toBe(true);
    expect(tile?.visibleWhen?.({ emanetEnabled: false } as never)).toBe(false);
    expect(allCommandEntries.some((e) => e.to === "/operations/emanet-cikis")).toBe(true);
    expect(ROUTE_MODULE["operations/emanet-cikis"]).toBe("emanetEnabled");
  });
});
