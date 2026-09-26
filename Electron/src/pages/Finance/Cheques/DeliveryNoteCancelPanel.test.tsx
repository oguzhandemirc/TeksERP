// BEKÇİ — Bordro iptal paneli (K3): önizleme hareket taşımıyorsa bugünkü onay (sebep opsiyonel, seçim
//   gönderilmez); taşıyorsa etkilenen HER kıymet listelenir, geri alınamayan seçilemez ve nedeni yazılır,
//   sebep + seçim zorunlu, istek YALNIZ seçilen kimliklerle gider; hepsi seçilince "bordro da iptal" söylenir.
// NEGATİF SONDA (2026-09-26, md5 ile geri alındı): seçim gövdeye koşulsuz konmadı (moving → undefined) → ⭐ ❌.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { DeliveryNoteRow } from "./service";

const h = vi.hoisted(() => ({ preview: vi.fn(), cancel: vi.fn() }));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  getDeliveryNoteCancelPreview: h.preview,
  cancelChequeDeliveryNote: h.cancel,
}));

import { DeliveryNoteCancelPanel } from "./DeliveryNoteCancelPanel";

const note = { id: "n1", docNo: "BRD1", deliveryDate: "2026-09-26T00:00:00Z", _count: { items: 3 } } as unknown as DeliveryNoteRow;
const item = (id: string, o: Record<string, unknown> = {}) => ({
  chequeId: id, docNo: id, amount: "100", currency: "TRY", status: "AT_BANK", action: "DEPOSIT", reversed: false, reversible: true, reason: null, ...o,
});

beforeEach(() => {
  h.preview.mockReset();
  h.cancel.mockReset().mockResolvedValue({ message: "ok" });
});

describe("DeliveryNoteCancelPanel", () => {
  it("belge-only bordro → bugünkü onay: seçim gönderilmez, sebep opsiyonel", async () => {
    h.preview.mockResolvedValue({ id: "n1", docNo: "BRD1", status: "ACTIVE", hasMovements: false, items: [item("C1", { action: null, reversible: false })] });
    const user = userEvent.setup();
    renderWithProviders(<DeliveryNoteCancelPanel note={note} onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Bordroyu İptal Et" }));
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith("n1", undefined, undefined));
  });

  it("⭐ hareketli bordro → her kıymet listelenir, geri alınamayan seçilemez; sebep + seçim zorunlu; yalnız seçilenler gider", async () => {
    h.preview.mockResolvedValue({
      id: "n1", docNo: "BRD1", status: "ACTIVE", hasMovements: true,
      items: [item("C1"), item("C2", { status: "COLLECTED", reversible: false, reason: "C2 zaten tahsil edildi" }), item("C3")],
    });
    const user = userEvent.setup();
    renderWithProviders(<DeliveryNoteCancelPanel note={note} onClose={() => {}} />);
    expect(await screen.findByText("C2 zaten tahsil edildi")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "C2 geri al" })).toBeDisabled();
    const btn = screen.getByRole("button", { name: /Seçilenleri Geri Al/ });
    expect(btn).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "C1 geri al" }));
    expect(btn).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "yanlış banka");
    expect(btn).toBeEnabled();
    expect(screen.getByText(/Seçilmeyenler ve bordronun imzalı belgesi olduğu gibi kalır/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "C3 geri al" }));
    // C2 canlı ama geri alınamaz (tahsil) — bordro KAPANMAZ, ekran bunu yanlış vaat etmez.
    expect(screen.queryByText(/bordro da iptal edilecek/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Seçilenleri Geri Al \(2\)/ }));
    await waitFor(() => expect(h.cancel).toHaveBeenCalledTimes(1));
    expect(h.cancel.mock.calls[0]).toEqual(["n1", "yanlış banka", ["C1", "C3"]]);
  });

  it("bütün canlı kalemler seçilince 'bordro da iptal edilecek' söylenir (geri alınmış kalem sayılmaz)", async () => {
    h.preview.mockResolvedValue({
      id: "n1", docNo: "BRD1", status: "ACTIVE", hasMovements: true,
      items: [item("C1"), item("C2", { status: "PORTFOLIO", reversed: true, reversible: false })],
    });
    const user = userEvent.setup();
    renderWithProviders(<DeliveryNoteCancelPanel note={note} onClose={() => {}} />);
    await user.click(await screen.findByRole("checkbox", { name: "C1 geri al" }));
    expect(screen.getByText(/bordro da iptal edilecek/)).toBeInTheDocument();
    expect(screen.getByText("Geri alındı")).toBeInTheDocument();
  });
});
