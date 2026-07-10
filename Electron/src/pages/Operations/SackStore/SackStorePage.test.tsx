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
const shipmentContents = vi.fn();
vi.mock("./service", () => ({
  sackStoreService: {
    list: (...a: unknown[]) => list(...a),
    dispatch: (...a: unknown[]) => dispatch(...a),
    moveToDoor: (...a: unknown[]) => moveToDoor(...a),
    pullBack: (...a: unknown[]) => pullBack(...a),
    unready: (...a: unknown[]) => unready(...a),
    shipmentContents: (...a: unknown[]) => shipmentContents(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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

// Ortak DispatchConfirmDialog sevk onayında çuval dökümünü CANLI çeker
// (yıkıcı-onay kuralı: etkilenen kayıtlar somut listelenir).
const readyContents = {
  success: true,
  data: {
    id: "sh-ready",
    shipmentNo: "SVK-100",
    status: "READY" as const,
    readyAt: null,
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
        manualCode: "AMB00001",
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
        manualCode: null,
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

describe("SackStorePage — Çuval Depo durum geçişleri", () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue(page([readyShipment]));
    dispatch.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    moveToDoor.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    pullBack.mockReset().mockResolvedValue({ success: true, data: { id: "sh-door" } });
    unready.mockReset().mockResolvedValue({ success: true, data: { id: "sh-ready" } });
    shipmentContents.mockReset().mockResolvedValue(readyContents);
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
  it("READY kartı 'Kapı Önüne Koy' + 'Hazırlığa Geri Al' aksiyonlarını gösterir", async () => {
    renderPage(<SackStorePage />);
    expect(await screen.findByText("SVK-100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kapı Önüne Koy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hazırlığa Geri Al" })).toBeInTheDocument();
    // Geri-çek yalnız AT_DOOR'da olur → READY kartında bu buton yok.
    expect(screen.queryByRole("button", { name: "Çuval Depoya Geri Çek" })).not.toBeInTheDocument();
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
    expect(within(dialog).getByText(/AMB00001/)).toBeInTheDocument();
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

  it("kapı okutması: çuval kodu okutulunca kart sayaç gösterir ve sevk onayına taşınır", async () => {
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    // Okutma çubuğuna kod yaz + Enter → resolve (board araması) → kartta sayaç.
    await user.type(
      screen.getByPlaceholderText(/Çuval kodu okut/),
      "AMB00001{Enter}",
    );
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "AMB00001", limit: 5 })),
    );
    expect(await screen.findByText(/1 \/ 2 çuval okutuldu/)).toBeInTheDocument();
    // Yeşil geri bildirim bandı: kod → sevk no.
    expect(screen.getByText("AMB00001")).toBeInTheDocument();

    // Sevk onayında okutulan kod ✓/sayaç olarak taşınır (scannedCodes).
    await user.click(screen.getByRole("button", { name: "Sevk Et" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/1\/2 okutuldu/)).toBeInTheDocument();
  });

  it("onay-akışı bayrağı AÇIKKEN READY kartında doğrudan 'Sevk Et' yok — ikincil menüden erişilir", async () => {
    confirmationEnabled = true;
    const user = userEvent.setup();
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");

    // İki-adım disiplini: birincil yol Kapı Önüne Koy; doğrudan Sevk Et butonu yok.
    expect(screen.getByRole("button", { name: "Kapı Önüne Koy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sevk Et" })).not.toBeInTheDocument();

    // Kapıyı atlama yolu kayıp değil: "..." menüsünde, onay dialoğuna gider.
    await user.click(screen.getByRole("button", { name: "Diğer aksiyonlar" }));
    await user.click(await screen.findByRole("menuitem", { name: /Sevk Et \(kapıyı atla\)/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/geri alınamaz/i)).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("shipping:write yoksa aksiyon butonları gizlenir (PermissionGate)", async () => {
    useAuthStore.getState().setUser({ userId: "u1", username: "viewer", permissions: ["shipping:read"] });
    renderPage(<SackStorePage />);
    await screen.findByText("SVK-100");
    expect(screen.queryByRole("button", { name: "Sevk Et" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kapı Önüne Koy" })).not.toBeInTheDocument();
  });
});
