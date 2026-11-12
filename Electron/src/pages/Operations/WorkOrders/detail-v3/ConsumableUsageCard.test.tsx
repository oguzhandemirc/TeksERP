// İE "Sarfiyat" kartı: izinli (maliyet sütunu + toplam + müşteri farkı), izinsiz (yalnız miktar), bilinmeyen maliyet, kapalı stok.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ConsumableUsageView } from "./ConsumableUsageCard";
import type { ConsumableUsage } from "./consumableUsage";

vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { ticaretEnabled: true } } }) }));

const poset = { itemId: "p", code: "PST", name: "POŞET", unit: "ADET", qty: "12.000", kursunKg: null };
const ip = { itemId: "i", code: "KIP50", name: "KURŞUN İP 50 GR", unit: "MT", qty: "241.000", kursunKg: "12.05" };

describe("ConsumableUsageView", () => {
  it("izinli: maliyet sütunu, ≈ kg, toplam ve müşteri farkı", () => {
    const data: ConsumableUsage = {
      enabled: true,
      rows: [{ ...ip, costTry: "964.00", unitCostTry: "4.0000" }, { ...poset, costTry: "18.00", unitCostTry: "1.5000" }],
      totalCostTry: "982.00",
      customer: { amountTry: "1205.00", diffTry: "241.00" },
    };
    renderWithProviders(<ConsumableUsageView data={data} />);
    expect(screen.getByText("Maliyet")).toBeInTheDocument();
    expect(screen.getByText(/≈ 12,05 kg/)).toBeInTheDocument();
    expect(screen.getByText("12 adet")).toBeInTheDocument();
    expect(screen.getByTestId("wo-consumables-total")).toHaveTextContent("982,00 ₺");
    expect(screen.getByTestId("wo-consumables-customer")).toHaveTextContent("Fark: 241,00 ₺");
  });
  it("izinsiz: maliyet alanı yanıtta yok → sütun ve toplam çizilmez, miktar görünür", () => {
    renderWithProviders(<ConsumableUsageView data={{ enabled: true, rows: [poset] }} />);
    expect(screen.getByText("12 adet")).toBeInTheDocument();
    expect(screen.queryByText("Maliyet")).toBeNull();
    expect(screen.queryByTestId("wo-consumables-total")).toBeNull();
    expect(screen.queryByTestId("wo-consumables-customer")).toBeNull();
  });
  it("alış fiyatı yok: maliyet 0 değil 'bilinmiyor'", () => {
    renderWithProviders(<ConsumableUsageView data={{ enabled: true, rows: [{ ...poset, costTry: null, unitCostTry: null }], totalCostTry: null }} />);
    expect(screen.getAllByText("bilinmiyor")).toHaveLength(2);
    expect(screen.queryByText(/0,00 ₺/)).toBeNull();
  });
  it("sarf stoğu kapalı: ayar yolu satırı, 'henüz düşüm yok' cümlesi yok", () => {
    renderWithProviders(<ConsumableUsageView data={{ enabled: false, rows: [] }} />);
    expect(screen.getByTestId("wo-consumables-off")).toHaveTextContent("Sarf stoğu kapalı");
    expect(screen.queryByText(/henüz sarf düşümü yok/)).toBeNull();
  });
});
