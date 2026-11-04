import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OrderNeredeDetail } from "./types";

const getNerede = vi.fn();
vi.mock("./service", () => ({
  orderService: { getNerede: (...a: unknown[]) => getNerede(...a) },
}));

import { OrderNeredeCard } from "./OrderNeredeCard";

const DETAIL: OrderNeredeDetail = {
  orderId: "o1",
  nerede: { kind: "FASON", tone: "orange", text: "Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha", extraPlaces: 1, overdue: true, overdueText: "Termini geçti" },
  sevk: { kind: "NONE", text: "Henüz gönderilmedi", shipped: 0, requested: 2400, unit: "MT" },
  workOrders: [
    {
      id: "w1",
      workOrderNumber: "IE-0042",
      status: "IN_PROGRESS",
      itemName: "Saten",
      colorName: "1234 Ekru",
      targetQuantity: 2400,
      unit: "MT",
      steps: [
        { id: "s1", sequence: 1, name: "Ham kontrol", isExternal: false, state: "DONE", rollCount: 0, qty: 0, fason: [], text: "Ham kontrol" },
        {
          id: "s2", sequence: 2, name: "Boyahane (Fason)", isExternal: true, state: "CURRENT", rollCount: 8, qty: 1600,
          fason: [{ firmId: "f1", firmName: "Akın Boya", rollCount: 8, qty: 1600, days: 3, text: "Akın Boya · 8 top · 3 gündür" }],
          text: "Boyahane (Fason) · Akın Boya, 8 top, 3 gündür",
        },
        { id: "s3", sequence: 3, name: "Tambur", isExternal: false, state: "CURRENT", rollCount: 4, qty: 1250, fason: [], text: "Tambur · 4 top · 1.250 m" },
        { id: "s4", sequence: 4, name: "Kalite", isExternal: false, state: "TODO", rollCount: 0, qty: 0, fason: [], text: "Kalite" },
      ],
      ready: { rollCount: 6, qty: 1800, text: "Sevke hazır · 6 top · 1.800 m" },
      lastMovementAt: "2026-11-04T11:32:00.000Z",
      lastMovementText: "04.11.2026 14:32",
    },
    {
      id: "w2", workOrderNumber: "IE-0043", status: "PLANNED", itemName: null, colorName: null, targetQuantity: null, unit: null,
      steps: [], ready: { rollCount: 0, qty: 0, text: "" }, lastMovementAt: null, lastMovementText: null,
    },
  ],
};

describe("OrderNeredeCard — yan panel", () => {
  // Gövde bloklu: beforeEach'in dönüş değeri vitest'te temizlik fonksiyonudur (mockReset mock'u döndürür).
  beforeEach(() => {
    getNerede.mockReset();
  });

  it("her iş emri için kart: ilerleme çizgisi, aşama başına top/metre, sevke hazır, son hareket", async () => {
    getNerede.mockResolvedValue({ success: true, data: DETAIL });
    renderWithProviders(<OrderNeredeCard orderId="o1" status="APPROVED" open />);
    expect(await screen.findByTestId("order-nerede-card")).toBeInTheDocument();
    expect(getNerede).toHaveBeenCalledTimes(1); // sipariş başına TEK istek
    expect(screen.getAllByTestId("nerede-wo")).toHaveLength(2);
    expect(screen.getByTestId("nerede-trail").textContent).toBe(
      "✓ Ham kontrol→● Boyahane (Fason)→● Tambur→○ Kalite",
    );
    expect(screen.getByText("Boyahane (Fason) · Akın Boya, 8 top, 3 gündür")).toBeInTheDocument();
    expect(screen.getByText("Tambur · 4 top · 1.250 m")).toBeInTheDocument();
    // Topu olmayan adım satır olarak tekrarlanmaz (yalnız çizgide).
    expect(screen.queryByText("Kalite")).toBeNull();
    expect(screen.getByText("Sevke hazır · 6 top · 1.800 m")).toBeInTheDocument();
    expect(screen.getByText("Son hareket: 04.11.2026 14:32")).toBeInTheDocument();
    expect(screen.getByText("Son hareket: kayıt yok")).toBeInTheDocument();
    expect(screen.getByText("Saten · 1234 Ekru · hedef 2.400 m")).toBeInTheDocument();
    expect(screen.getByText("Termini geçti")).toBeInTheDocument();
    expect(screen.getByText("Henüz gönderilmedi")).toBeInTheDocument();
  });

  it("iptal siparişte sunucunun 'Henüz gönderilmedi' cümlesi yerine 'Sipariş iptal edildi' yazar", async () => {
    getNerede.mockResolvedValue({ success: true, data: DETAIL });
    renderWithProviders(<OrderNeredeCard orderId="o1" status="CANCELLED" open />);
    expect(await screen.findByText("Sipariş iptal edildi")).toBeInTheDocument();
    expect(screen.queryByText("Henüz gönderilmedi")).toBeNull();
  });

  it("kapalı panelde istek atılmaz", () => {
    renderWithProviders(<OrderNeredeCard orderId="o1" status="APPROVED" open={false} />);
    expect(getNerede).not.toHaveBeenCalled();
  });

  it("veri yoksa (eski sunucu / hata yakalandı) kart çizilmez", async () => {
    getNerede.mockResolvedValue(null);
    const { container } = renderWithProviders(<OrderNeredeCard orderId="o1" status="APPROVED" open />);
    await waitFor(() => expect(getNerede.mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("sunucu hata dönerse kart çizilmez (sayfa kırılmaz)", async () => {
    getNerede.mockRejectedValue(new Error("Sunucu hatası"));
    const { container } = renderWithProviders(<OrderNeredeCard orderId="o1" status="APPROVED" open />);
    await waitFor(() => expect(getNerede.mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
