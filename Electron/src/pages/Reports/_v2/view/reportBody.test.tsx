import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ flagsReady: true, flagsFailed: false, isReportOpen: () => true }),
}));

import { HIGHLIGHTS_TITLE, ReportBody } from "../ReportBody";
import { ruleLook } from "../NarrativeBox";
import type { AnaSayi, RaporSunumu } from "../sunum";

const fig = (olcu: string, deger: number | null, over: Partial<AnaSayi> = {}): AnaSayi => ({ olcu, ad: olcu, deger, birim: "m", ...over });
const presentation = (over: Partial<RaporSunumu> = {}): RaporSunumu => ({
  anahtar: "sales/siparis-talep",
  baslik: "Ne kadar iş aldık?",
  soru: "Ne kadar sipariş geldi?",
  donem: { from: "2026-10-01", to: "2026-10-24", etiket: "Ekim 2026" },
  kiyasDonemi: { from: "2026-09-01", to: "2026-09-30", etiket: "Eylül 2026" },
  anaSayi: fig("Alınan sipariş", 14700, { kiyas: { deger: 9800, fark: 4900, yuzde: 50, yon: "artti", durum: "iyi" } }),
  yanSayilar: [fig("Sipariş adedi", 8, { birim: "siparis" }), fig("Tutar", null, { birim: "TRY", olculemedi: "Fiyat yok" })],
  anlati: [
    { kural: "anaSayiKiyas", onem: 1, metin: "Önceki döneme göre arttı.", kanit: {} },
    { kural: "bilinmeyenKural", onem: 0.5, metin: "Başka bir şey.", kanit: {} },
  ],
  grafik: null,
  tablo: null,
  tanimlar: [],
  parametreler: [],
  uyarilar: ["Fiyatı girilmemiş satır var."],
  ...over,
});
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("v2 rapor gövdesi — sayı kartları + Öne çıkanlar", () => {
  it("⭐ ana sayı + yan sayılar ayrı kartlar; kıyas hapı sunucunun durumundan, metin PDF ile aynı", () => {
    wrap(<ReportBody presentation={presentation()} fetchedAt={0} />);
    expect(screen.getByTestId("headline-value")).toHaveTextContent("14700 m");
    const cmp = screen.getByTestId("headline-compare");
    expect(cmp).toHaveTextContent("▲ %50 (Eylül 2026: 9800 m)");
    expect(cmp.className).toContain("text-success");
    const sides = screen.getAllByTestId("side-figure");
    expect(sides).toHaveLength(2);
    expect(within(sides[1]!).getByText("Ölçülemedi")).toBeInTheDocument();
    expect(within(sides[1]!).getByText("Fiyat yok")).toBeInTheDocument();
  });

  it("Öne çıkanlar: cümleler aynen; simge metin eklemez; bilinmeyen kural ampul", () => {
    wrap(<ReportBody presentation={presentation()} fetchedAt={0} />);
    const box = within(screen.getByRole("region", { name: HIGHLIGHTS_TITLE }));
    expect(box.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Önceki döneme göre arttı.", "Başka bir şey."]);
    expect(ruleLook("bilinmeyenKural")[1]).toBe("amber");
    expect(ruleLook("esikAsimi")[1]).toBe("orange");
  });

  it("uyarı bandı tema belirteçleriyle (sabit amber yok)", () => {
    wrap(<ReportBody presentation={presentation()} fetchedAt={0} />);
    const item = screen.getByText("Fiyatı girilmemiş satır var.").closest("ul")!;
    expect(item.className).toContain("bg-warning-soft");
  });
});
