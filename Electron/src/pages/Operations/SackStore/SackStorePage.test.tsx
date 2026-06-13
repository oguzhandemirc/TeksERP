import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { SackStoreShipment } from "./types";

const renderPage = renderWithProviders;

// Servis tamamen mock — gerçek HTTP yok; durum-geçişi çağrılarını doğrula.
const list = vi.fn();
const dispatch = vi.fn();
const moveToDoor = vi.fn();
const pullBack = vi.fn();
const unready = vi.fn();
vi.mock("./service", () => ({
  sackStoreService: {
    list: (...a: unknown[]) => list(...a),
    dispatch: (...a: unknown[]) => dispatch(...a),
    moveToDoor: (...a: unknown[]) => moveToDoor(...a),
    pullBack: (...a: unknown[]) => pullBack(...a),
    unready: (...a: unknown[]) => unready(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// İçerik slide-over kendi lazy query'sini açar — testte gürültüyü kes.
vi.mock("./ShipmentContentsSheet", () => ({ ShipmentContentsSheet: () => null }));
// PageHeader chrome'u (favoriler/komut paleti → Preferences/Router bağımlılığı)
// test edilen davranış değil; sade bir başlığa indir.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));

import { SackStorePage } from "./SackStorePage";

const readyShipment: SackStoreShipment = {
  id: "sh-ready",
  shipmentNo: "SVK-100",
  status: "READY",
  destination: "DOMESTIC",
  procedureCode: null,
  readyAt: "2026-06-10T08:00:00Z",
  customer: { id: "c1", name: "ACME" },
  branch: null,
  sackCount: 2,
  rollCount: 5,
  totalKg: 30,
  totalQty: 150,
};

const atDoorShipment: SackStoreShipment = {
  ...readyShipment,
  id: "sh-door",
  shipmentNo: "SVK-200",
  status: "AT_DOOR",
};

function page(data: SackStoreShipment[]) {
  return {
    success: true,
    data,
    pagination: { nextCursor: null, hasMore: false, limit: 30 },
  };
}

describe("SackStorePage — Çuval Depo durum geçişleri", () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue(page([readyShipment]));
    dispatch.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    moveToDoor.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    pullBack.mockReset().mockResolvedValue({ success: true, data: { id: "sh-door" } });
    unready.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    // PermissionGate shipping:write ister — aksiyon butonları çıksın.
    useAuthStore.getState().setUser({
      userId: "u1",
      username: "admin",
      permissions: ["shipping:write"],
    });
  });

  // Not: Kart kapsayıcısı role="button" → erişilebilir adı tüm metni kapsar.
  // Aksiyon butonlarını TAM ad eşleşmesiyle hedefle (kartı kapsamaz).
  it("READY kartı 'Kapı Önüne Koy' + 'Hazırlığa Geri Al' aksiyonlarını gösterir", async () => {
    renderPage(<SackStorePage />);
    expect(await screen.findByText("SVK-100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kapı Önüne Koy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hazırlığa Geri Al" })).toBeInTheDocument();
    // Geri-çek yalnız AT_DOOR'da olur → READY kartında bu buton yok.
    expect(screen.queryByRole("button", { name: "Çuval Depoya Geri Çek" })).not.toBeInTheDocument();
  });

  it("Sevk Et → onay dialog'u açılır (yıkıcı/geri-alınamaz uyarısı), onaylanınca dispatch(id) çağrılır", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    await user.click(screen.getByRole("button", { name: "Sevk Et" }));

    // Onay metni: irreversible uyarısı görünmeli (yıkıcı işlem kuralı).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/sevk edilsin mi/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();
    // Onaydan ÖNCE çağrılmamalı.
    expect(dispatch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Sevk Et" }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith("sh-ready"));
    // Yanlış geçiş tetiklenmemeli.
    expect(moveToDoor).not.toHaveBeenCalled();
    expect(unready).not.toHaveBeenCalled();
  });

  it("onay dialog'unda İptal → mutation çağrılmaz", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    await user.click(screen.getByRole("button", { name: "Kapı Önüne Koy" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "İptal" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(moveToDoor).not.toHaveBeenCalled();
  });

  it("AT_DOOR kartında 'Çuval Depoya Geri Çek' → onay → pullBack(id)", async () => {
    list.mockResolvedValue(page([atDoorShipment]));
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-200");

    await user.click(screen.getByRole("button", { name: "Çuval Depoya Geri Çek" }));
    const dialog = await screen.findByRole("dialog");
    // Dialog onay etiketi kısa "Geri Çek".
    await user.click(within(dialog).getByRole("button", { name: "Geri Çek" }));

    await waitFor(() => expect(pullBack).toHaveBeenCalledWith("sh-door"));
  });

  it("shipping:write yoksa aksiyon butonları gizlenir (PermissionGate)", async () => {
    useAuthStore.getState().setUser({ userId: "u1", username: "viewer", permissions: ["shipping:read"] });
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");
    expect(screen.queryByRole("button", { name: "Sevk Et" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kapı Önüne Koy" })).not.toBeInTheDocument();
  });
});
