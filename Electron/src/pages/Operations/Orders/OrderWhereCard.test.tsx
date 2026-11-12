import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { Order, OrderLine, OrderWhereDetail } from "./types";

const getWhere = vi.fn();
vi.mock("./service", () => ({
  orderService: { getWhere: (...a: unknown[]) => getWhere(...a) },
}));
const flags = { productionEnabled: true };
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: flags }, isSuccess: true }),
}));

import { OrderWhereCard } from "./OrderWhereCard";

const ORDER = {
  id: "o1",
  status: "APPROVED",
  shippedQty: 0,
  manualClosedById: null,
  lines: [{ quantity: 2400, unit: "MT" } as OrderLine],
} as Pick<Order, "id" | "status" | "shippedQty" | "manualClosedById" | "lines">;

const DETAIL: OrderWhereDetail = {
  orderId: "o1",
  nerede: {
    durum: "YERLER",
    yerler: [
      { tur: "FASON", id: "f1", ad: "Akın Boya", topSayisi: 8, metre: 1600, gun: 3 },
      { tur: "ASAMA", id: "st3", ad: "Tambur", topSayisi: 4, metre: 1250, gun: null },
    ],
    sonHareket: "2026-11-04T11:32:00.000Z",
  },
  isEmirleri: [
    {
      id: "w1",
      no: "IE-0042",
      durum: "IN_PROGRESS",
      kumas: "Saten",
      renk: "1234 Ekru",
      hedefMetre: 2400,
      adimlar: [
        { id: "s1", ad: "Ham kontrol", asama: "GECTI", topSayisi: 0, metre: 0, fasonTop: 0 },
        { id: "s2", ad: "Fason", asama: "BURADA", topSayisi: 8, metre: 1600, fasonTop: 8 },
        { id: "s3", ad: "Tambur", asama: "BURADA", topSayisi: 4, metre: 1250, fasonTop: 0 },
        { id: "s4", ad: "Kalite", asama: "SIRADA", topSayisi: 0, metre: 0, fasonTop: 0 },
      ],
      fason: [{ firmaId: "f1", firmaAd: "Akın Boya", topSayisi: 8, metre: 1600, gun: 3 }],
      hazir: { topSayisi: 6, metre: 1800 },
      gitti: { topSayisi: 0, metre: 0 },
      sonHareket: "2026-11-04T11:32:00.000Z",
    },
    {
      id: "w2",
      no: "IE-0043",
      durum: "PLANNED",
      kumas: null,
      renk: null,
      hedefMetre: null,
      adimlar: [],
      fason: [],
      hazir: { topSayisi: 0, metre: 0 },
      gitti: { topSayisi: 0, metre: 0 },
      sonHareket: null,
    },
  ],
};

describe("OrderWhereCard — yan panel", () => {
  beforeEach(() => {
    getWhere.mockReset();
    flags.productionEnabled = true;
  });

  it("her iş emri için kart: ilerleme çizgisi, aşama başına top/metre, son hareket", async () => {
    getWhere.mockResolvedValue({ success: true, data: DETAIL });
    renderWithProviders(<OrderWhereCard order={ORDER} open />);
    expect(await screen.findByTestId("order-where-card")).toBeInTheDocument();
    expect(getWhere).toHaveBeenCalledTimes(1); // sipariş başına TEK istek
    expect(screen.getAllByTestId("where-wo")).toHaveLength(2);
    expect(screen.getByTestId("where-trail").textContent).toBe(
      "✓ Ham kontrol→● Fason (Akın Boya, 8 top, 3 gündür)→● Tambur (4 top)→○ Kalite",
    );
    expect(screen.getByText("Tambur: 4 top · 1250 m")).toBeInTheDocument();
    expect(screen.getByText("Fasonda – Akın Boya: 8 top · 1600 m · 3 gündür")).toBeInTheDocument();
    expect(screen.getByText("Sevke hazır: 6 top · 1800 m")).toBeInTheDocument();
    expect(screen.getByText(/^Son hareket: \d{2}\.\d{2}\.2026 \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText("Son hareket: kayıt yok")).toBeInTheDocument();
    expect(screen.getByText("Saten · 1234 Ekru · hedef 2400 m")).toBeInTheDocument();
    expect(screen.getByText("Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha")).toBeInTheDocument();
    expect(screen.queryByText(/Termin/)).toBeNull();
    expect(screen.getByText("Henüz gönderilmedi")).toBeInTheDocument();
  });

  it("kapalı panelde istek atılmaz", () => {
    renderWithProviders(<OrderWhereCard order={ORDER} open={false} />);
    expect(getWhere).not.toHaveBeenCalled();
  });

  it("üretim modülü kapalıyken istek atılmaz, kart çizilmez", async () => {
    flags.productionEnabled = false;
    const { container } = renderWithProviders(<OrderWhereCard order={ORDER} open />);
    await new Promise((r) => setTimeout(r, 0));
    expect(getWhere).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("sunucu hata dönerse kart çizilmez (sayfa kırılmaz)", async () => {
    getWhere.mockRejectedValue(new Error("Sunucu hatası"));
    const { container } = renderWithProviders(<OrderWhereCard order={ORDER} open />);
    await waitFor(() => expect(getWhere.mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
