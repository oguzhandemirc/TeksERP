import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Servis mock — dialog çuval dökümünü canlı çeker, dispatch payload'ını doğrula.
const shipmentContents = vi.fn();
const dispatch = vi.fn();
vi.mock("./service", () => ({
  sackStoreService: {
    shipmentContents: (...a: unknown[]) => shipmentContents(...a),
    dispatch: (...a: unknown[]) => dispatch(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DispatchConfirmDialog } from "./DispatchConfirmDialog";

const info = { id: "sh1", shipmentNo: "SVK-500", customerName: "ACME", branchName: null };

const contents = {
  success: true,
  data: {
    id: "sh1",
    shipmentNo: "SVK-500",
    status: "PLANNED" as const,
    plateNumber: null,
    driverName: null,
    carrier: null,
    customer: { id: "c1", name: "ACME" },
    branch: null,
    sackCount: 2,
    sacks: [
      {
        id: "sk1",
        sackNo: "CV-260601-001",
        seq: 1,
        weightKg: 10,
        rollCount: 3,
        swatchCount: 0,
        totalQty: 90,
        contents: [],
        rolls: [],
        swatches: [],
      },
      {
        id: "sk2",
        sackNo: "CV-260601-002",
        seq: 2,
        weightKg: null,
        rollCount: 2,
        swatchCount: 0,
        totalQty: 60,
        contents: [],
        rolls: [],
        swatches: [],
      },
    ],
  },
};

describe("DispatchConfirmDialog — ortak sevk onayı", () => {
  beforeEach(() => {
    shipmentContents.mockReset().mockResolvedValue(contents);
    dispatch.mockReset().mockResolvedValue({ success: true, data: { id: "sh1" } });
  });

  it("çuvalları somut listeler; okutma bilgisi yoksa soft doğrulama notu gösterir", async () => {
    renderWithProviders(<DispatchConfirmDialog shipment={info} onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/CV-260601-001/)).toBeInTheDocument();
    expect(within(dialog).getByText(/CV-260601-002/)).toBeInTheDocument();
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/okutulmadan sevk/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/okutuldu/)).not.toBeInTheDocument();
  });

  it("scannedCodes verilince X/Y sayacı işler (sackNo eşleşmesi), not gizlenir", async () => {
    renderWithProviders(
      <DispatchConfirmDialog
        shipment={info}
        scannedCodes={["cv-260601-001"]} // sackNo, küçük harf — normalize eşleşmeli
        onOpenChange={() => {}}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/1\/2 okutuldu/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/okutulmadan sevk/i)).not.toBeInTheDocument();
  });

  it("onaylanınca taşıma bilgileriyle dispatch çağrılır; İptal'de çağrılmaz", async () => {
    const user = userEvent.setup();
    const onDispatched = vi.fn();
    renderWithProviders(
      <DispatchConfirmDialog shipment={info} onOpenChange={() => {}} onDispatched={onDispatched} />,
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/CV-260601-001/);

    await user.type(within(dialog).getByLabelText(/Plaka/), "34ABC123");
    await user.type(within(dialog).getByLabelText(/Şoför/), "Ali");
    await user.type(within(dialog).getByLabelText(/Nakliyeci/), "Hızlı Nakliyat");
    expect(dispatch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Sevk Et" }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith("sh1", {
        plateNumber: "34ABC123",
        driverName: "Ali",
        carrier: "Hızlı Nakliyat",
      }),
    );
    await waitFor(() => expect(onDispatched).toHaveBeenCalledWith("sh1"));

    // Başarıda dialog KAPANMAZ — irsaliye baskı paneli gösterilir (kamyon
    // irsaliyesiz çıkamaz; operatör ekran değiştirmeden basar).
    expect(await within(dialog).findByText(/Sevk edildi — SVK-500/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /İrsaliyeyi Bas/ })).toBeInTheDocument();
  });
});
