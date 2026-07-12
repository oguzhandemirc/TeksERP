import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { SackStoreShipment } from "./types";

const renderPage = renderWithProviders;

// Servis tamamen mock — gerçek HTTP yok; sevk çıkışı çağrısını doğrula.
const list = vi.fn();
const dispatch = vi.fn();
const shipmentContents = vi.fn();
vi.mock("./service", () => ({
  sackStoreService: {
    list: (...a: unknown[]) => list(...a),
    dispatch: (...a: unknown[]) => dispatch(...a),
    shipmentContents: (...a: unknown[]) => shipmentContents(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// Sevkiyat onay-akışı bayrağı — test başına kontrol edilebilir (default kapalı).
let confirmationEnabled = false;
vi.mock("@/hooks/usePricingEnabled", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePricingEnabled")>();
  return { ...mod, useShipmentConfirmationEnabled: () => confirmationEnabled };
});
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

const plannedShipment: SackStoreShipment = {
  id: "sh-ready",
  shipmentNo: "SVK-100",
  status: "PLANNED",
  destination: "DOMESTIC",
  procedureCode: null,
  createdAt: "2026-06-10T08:00:00Z",
  customer: { id: "c1", name: "ACME" },
  branch: null,
  sackCount: 2,
  rollCount: 5,
  totalKg: 30,
  totalQty: 150,
};

function page(data: SackStoreShipment[]) {
  return {
    success: true,
    data,
    pagination: { nextCursor: null, hasMore: false, limit: 30 },
  };
}

// Ortak DispatchConfirmDialog sevk onayında çuval dökümünü CANLI çeker
// (yıkıcı-onay kuralı: etkilenen kayıtlar somut listelenir).
const plannedContents = {
  success: true,
  data: {
    id: "sh-ready",
    shipmentNo: "SVK-100",
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
        weightKg: 12.5,
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

describe("SackStorePage — Sevk Kapısı (PLANNED board)", () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue(page([plannedShipment]));
    dispatch.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    shipmentContents.mockReset().mockResolvedValue(plannedContents);
    confirmationEnabled = false;
    // PermissionGate shipping:write ister — aksiyon butonları çıksın.
    useAuthStore.getState().setUser({
      userId: "u1",
      username: "admin",
      permissions: ["shipping:write"],
    });
  });

  // Not: Kart kapsayıcısı role="button" → erişilebilir adı tüm metni kapsar.
  // Aksiyon butonlarını TAM ad eşleşmesiyle hedefle (kartı kapsamaz).
  it("PLANNED kartı yalnız 'Sevk Et' aksiyonunu gösterir; kapı butonları kaldırıldı", async () => {
    renderPage(<SackStorePage />);
    expect(await screen.findByText("SVK-100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sevk Et" })).toBeInTheDocument();
    // Kaldırılan kapı akışı butonları yeni modelde YOK.
    expect(screen.queryByRole("button", { name: "Kapı Önüne Koy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Geri Çek" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hazırlığa Geri Al" })).not.toBeInTheDocument();
  });

  it("Sevk Et → ortak onay dialog'u çuvalları SOMUT listeler, onaylanınca dispatch çağrılır", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    await user.click(screen.getByRole("button", { name: "Sevk Et" }));

    // Yıkıcı-onay kuralı: geri-alınamaz uyarısı + etkilenen her çuval somut listelenir.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();
    expect(await within(dialog).findByText(/CV-260601-001/)).toBeInTheDocument();
    expect(within(dialog).getByText(/CV-260601-002/)).toBeInTheDocument();
    // Karttan (okutmasız) sevkte soft doğrulama notu görünür.
    expect(within(dialog).getByText(/okutulmadan sevk/i)).toBeInTheDocument();
    // Onaydan ÖNCE çağrılmamalı.
    expect(dispatch).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Sevk Et" }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith("sh-ready", {
        plateNumber: null,
        driverName: null,
        carrier: null,
      }),
    );
  });

  it("onay dialog'unda İptal → dispatch çağrılmaz", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    await user.click(screen.getByRole("button", { name: "Sevk Et" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "İptal" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("kapı okutması: çuval kodu okutulunca kart sayaç gösterir ve sevk onayına taşınır", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    // Okutma çubuğuna kod yaz + Enter → resolve (board araması) → kartta sayaç.
    await user.type(
      screen.getByPlaceholderText(/Çuval kodu okut/),
      "CV-260601-001{Enter}",
    );
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "CV-260601-001", limit: 5 })),
    );
    expect(await screen.findByText(/1 \/ 2 çuval okutuldu/)).toBeInTheDocument();
    // Yeşil geri bildirim bandı: kod → sevk no.
    expect(screen.getByText("CV-260601-001")).toBeInTheDocument();

    // Sevk onayında okutulan kod ✓/sayaç olarak taşınır (scannedCodes).
    await user.click(screen.getByRole("button", { name: "Sevk Et" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/1\/2 okutuldu/)).toBeInTheDocument();
  });

  it("sevk onayı KAPALIYKEN bu ekranın yalnız ayar açıkken dolduğu ipucu görünür", async () => {
    confirmationEnabled = false;
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");
    expect(screen.getByText(/Sevk onayı kapalı/i)).toBeInTheDocument();
  });

  it("sevk onayı AÇIKKEN ipucu gizlenir", async () => {
    confirmationEnabled = true;
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");
    expect(screen.queryByText(/Sevk onayı kapalı/i)).not.toBeInTheDocument();
  });

  it("shipping:write yoksa aksiyon butonları gizlenir (PermissionGate)", async () => {
    useAuthStore.getState().setUser({ userId: "u1", username: "viewer", permissions: ["shipping:read"] });
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");
    expect(screen.queryByRole("button", { name: "Sevk Et" })).not.toBeInTheDocument();
  });
});
