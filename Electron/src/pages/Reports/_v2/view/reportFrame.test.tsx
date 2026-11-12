import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { REPORT_BY_KEY } from "@/lib/report-catalog";

vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ flagsReady: true, flagsFailed: false, isReportOpen: () => true }),
}));
// Başlık kabuğu (sekme/geçmiş bağlamı) bu testin konusu değil: soru ⓘ'ye `description` ile gider.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, description, actions }: { title: React.ReactNode; description?: string; actions?: React.ReactNode }) => (
    <header data-testid="page-header" data-description={description}>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

import { INLINE_CHIP_LIMIT, inlineLimitFor, splitChips } from "../ParamChips";
import type { ParametreBeyani, RaporSunumu } from "../sunum";
import { ReportV2Frame, type ReportFrameQuery } from "./ReportV2Frame";

const entry = REPORT_BY_KEY.get("sales/siparis-talep")!;
const sel = (ad: string, etiket: string): ParametreBeyani => ({
  ad,
  etiket,
  tur: "cokluSecim",
  deger: null,
  secenekler: [{ deger: "a", etiket: "A" }],
});
const PARAMS: ParametreBeyani[] = [
  { ad: "kiyas", etiket: "Kıyas", tur: "secim", deger: "onceki", secenekler: [{ deger: "onceki", etiket: "Önceki dönem" }] },
  sel("customerId", "Müşteri"),
  sel("itemId", "Kumaş"),
  sel("colorId", "Renk"),
  sel("destination", "Yön"),
];
const sunum = (over: Partial<RaporSunumu> = {}): RaporSunumu => ({
  anahtar: entry.key,
  baslik: "Ne kadar iş aldık?",
  soru: "Bu dönemde kaç metre sipariş aldık?",
  donem: { from: "2026-10-01", to: "2026-10-24", etiket: "Ekim 2026" },
  anaSayi: { olcu: "m", ad: "Alınan sipariş", deger: 14700, birim: "m" },
  yanSayilar: [],
  anlati: [],
  grafik: null,
  tablo: null,
  tanimlar: [],
  parametreler: PARAMS,
  uyarilar: [],
  ...over,
});
const q = (data?: RaporSunumu): ReportFrameQuery => ({ data, isFetching: false, isError: false, error: null, dataUpdatedAt: 0, refetch: () => undefined });
const wrap = (ui: React.ReactNode, search = "") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/reports/sales/siparis-talep?${search}`]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("v2 rapor çerçevesi — üst bölüm", () => {
  it("⭐ soru cümlesi SABİT bant değil: kaydırıcının içinde soluk alt başlık + başlık ⓘ ipucunda", () => {
    wrap(<ReportV2Frame entry={entry} query={q(sunum())} parent={{ label: "Rapor Merkezi", to: "/reports" }} />);
    const question = screen.getByTestId("report-question");
    expect(question).toHaveTextContent("Bu dönemde kaç metre sipariş aldık?");
    expect(screen.getByTestId("report-scroll").contains(question)).toBe(true);
    expect(question.className).toContain("text-muted-foreground");
    expect(screen.getByTestId("page-header").dataset.description).toBe("Bu dönemde kaç metre sipariş aldık?");
  });

  it("⭐ yalnız süzgeç bandı yapışkan; kaydırıcının içinde, tema bant belirteçleriyle", () => {
    wrap(<ReportV2Frame entry={entry} query={q(sunum())} parent={{ label: "Rapor Merkezi", to: "/reports" }} />);
    const band = screen.getByTestId("report-filter-band");
    expect(band.className).toMatch(/\bsticky\b/);
    expect(band.className).toContain("bg-band");
    expect(band.className).toContain("border-chrome-border");
    expect(screen.getByTestId("report-scroll").contains(band)).toBe(true);
  });

  it("⭐ çok çipte fazlası 'Süzgeçler (n)' paneline katlanır; panelden çip açılır", () => {
    wrap(<ReportV2Frame entry={entry} query={q(sunum())} parent={{ label: "Rapor Merkezi", to: "/reports" }} />);
    const band = within(screen.getByTestId("report-filter-band"));
    expect(band.getByRole("button", { name: /Kıyas:/ })).toBeInTheDocument();
    expect(band.queryByRole("button", { name: /Renk:/ })).toBeNull();
    fireEvent.click(band.getByRole("button", { name: /Süzgeçler \(3\)/ }));
    const panel = within(screen.getByTestId("folded-filters"));
    fireEvent.click(panel.getByRole("button", { name: /Renk:/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("eylemler başlıkta: Yenile + bitişik Excel/PDF/Yazdır grubu", () => {
    wrap(<ReportV2Frame entry={entry} query={q(sunum())} parent={{ label: "Rapor Merkezi", to: "/reports" }} />);
    const header = within(screen.getByTestId("page-header"));
    expect(header.getByRole("button", { name: "Yenile" })).toBeInTheDocument();
    const group = header.getByRole("group", { name: "Dışa aktar" });
    expect(within(group).getByRole("button", { name: "Excel" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Yazdır" })).toBeInTheDocument();
  });

  it("modül kapalı açıklaması gövdenin yerine çizilir, Yenile pasif", () => {
    wrap(<ReportV2Frame entry={entry} query={q()} parent={{ label: "x", to: "/x" }} blockedNote="Dokuma kapalı." />);
    expect(screen.getByText("Dokuma kapalı.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yenile" })).toBeDisabled();
  });
});

describe("splitChips — satır içi / katlanan", () => {
  const c = (key: string, selected: string[] = []) => ({ key, selected });
  it("sınır içinde katlama yok", () => {
    expect(splitChips([c("kiyas"), c("a")], 2).folded).toEqual([]);
  });
  it("kıyas ve seçimi olan çip satırda kalır, sıra korunur", () => {
    const { inline, folded } = splitChips([c("kiyas"), c("a"), c("b", ["x"]), c("d")], 2);
    expect(inline.map((x) => x.key)).toEqual(["kiyas", "b"]);
    expect(folded.map((x) => x.key)).toEqual(["a", "d"]);
  });
  it("dar bant (1280 ekran) tek çip tutar, daha darı hepsini katlar; ölçüsüz bant bugünkü sınırı korur", () => {
    expect(inlineLimitFor(1200)).toBe(INLINE_CHIP_LIMIT);
    expect(inlineLimitFor(1040)).toBe(1);
    expect(inlineLimitFor(600)).toBe(0);
    expect(inlineLimitFor(Number.POSITIVE_INFINITY)).toBe(INLINE_CHIP_LIMIT);
    expect(splitChips([c("kiyas"), c("a")], 0).inline).toEqual([]);
  });
});
