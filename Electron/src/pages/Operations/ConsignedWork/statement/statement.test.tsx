// Emanet ekstresi (P1): tek model → ekran + Excel + PDF. Ölçülenler:
//  §1 Excel sayfa başlıkları ↔ PDF tablo başlıkları ↔ EKRAN tablo başlıkları aynı (tek kurucudan)
//  §2 DSK kolonu yalnız top bölümünde; bölüm dışı kalma (`omitted`) cümlesi dosyada ve ekranda
//  §3 storno satırı kendi satırıdır, negatif katkısıyla basılır; toplam satırı sunucunun rakamı
//  §4 görünüm uca müşteri + dönemle gider; müşteri seçilmeden istek atılmaz
// Negatif sonda (2026-11-08): ekran tablosu "Belge" kolonunu elle atlayınca §1b kırmızı (1/5), geri alınınca 5/5.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import { buildReportHtml, toSheets } from "@/pages/Reports/_components/reportExport";
import type { ConsignedStatement, StatementSection } from "./types";
import { buildConsignedStatementExport, lineColumns, subjectColumns } from "./statementExport";
import { StatementSectionView } from "./StatementSectionView";
import { ConsignedStatementView } from "./ConsignedStatementView";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/apiClient", () => ({ default: { get: mocks.get } }));

const rollSection: StatementSection = {
  kind: "ROLL",
  unit: "m",
  scope: "İçerideki emanet top (depo + üretim + fasonda)",
  columnLabels: { IN: "Giren", OUT: "Sevk (BRÜT)", DSK: "Fasondan doğrudan sevk", SCRAP: "Fire / düzeltme" },
  totals: { opening: 100, in: 250, out: 120, dsk: 30, scrap: 5, closing: 195 },
  subjects: [
    { id: "r1", label: "T-0001", itemName: "Ham Tül", opening: 100, in: 0, out: 120, dsk: 0, scrap: -20, closing: 0 },
    { id: "r2", label: "T-0002", itemName: "Ham Tül", opening: 0, in: 250, out: 0, dsk: 30, scrap: 25, closing: 195 },
  ],
  lines: [
    { at: "2026-11-02T07:00:00.000Z", day: "2026-11-02", subjectId: "r1", subjectLabel: "T-0001", column: "OUT", qty: 120, effect: -120, reversal: false, code: "SHIPMENT", document: { type: "SHIPMENT", id: "s1", no: "SV-1" } },
    { at: "2026-11-03T07:00:00.000Z", day: "2026-11-03", subjectId: "r1", subjectLabel: "T-0001", column: "SCRAP", qty: -20, effect: 20, reversal: true, code: "SCRAP_CANCEL", document: null },
  ],
};
const yarnSection: StatementSection = {
  kind: "YARN_LOT",
  unit: "kg",
  scope: "Depodaki emanet iplik (lot bakiyesi)",
  columnLabels: { IN: "Giren", OUT: "Çözgüye / fasona çıkış", DSK: "—", SCRAP: "Sayım / düzeltme" },
  totals: { opening: 0, in: 10.5, out: 0, dsk: 0, scrap: 0, closing: 10.5 },
  subjects: [{ id: "y1", label: "LOT-9", itemName: "Ne 30", opening: 0, in: 10.5, out: 0, dsk: 0, scrap: 0, closing: 10.5 }],
  lines: [],
};
const statement: ConsignedStatement = {
  customer: { id: "c1", name: "Kaya Tekstil", code: "KAYA" },
  period: { from: "2026-11-01", to: "2026-11-30", fromAt: "", toAt: "" },
  rolls: rollSection,
  yarnLots: yarnSection,
  warpBeams: null,
  omitted: [{ kind: "WARP_BEAM", reason: "MODULE_DISABLED" }],
  reconciliation: { rolls: { liveQty: 195, diffQty: 0 } },
};

const thTexts = (root: HTMLElement) => within(root).getAllByRole("columnheader").map((th) => th.textContent?.trim());

beforeEach(() => mocks.get.mockReset());

describe("emanet ekstresi — tek model", () => {
  it("§1 Excel = PDF = ekran başlıkları", () => {
    const spec = buildConsignedStatementExport(statement);
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);
    for (const t of spec.tables) {
      const sheet = sheets.find((s) => s.name.startsWith(t.name.slice(0, 20)));
      expect(sheet, t.name).toBeTruthy();
      for (const c of t.columns) expect(html).toContain(c.header);
    }
    renderWithProviders(<StatementSectionView section={rollSection} />);
    expect(thTexts(screen.getByTestId("statement-subjects-ROLL"))).toEqual(subjectColumns(rollSection).map((c) => c.header));
  });

  it("§1b hareket tablosu başlıkları spec'le aynı", async () => {
    renderWithProviders(<StatementSectionView section={rollSection} />);
    fireEvent.click(screen.getByRole("button", { name: /Hareketleri göster \(2\)/ }));
    const t = await screen.findByTestId("statement-lines-ROLL");
    expect(thTexts(t)).toEqual(lineColumns(rollSection).map((c) => c.header));
    expect(t.textContent).toContain("Sevkiyat SV-1");
    expect(t.textContent).toContain("Fire / düzeltme — storno");
    expect(t.textContent).toContain("-20,0");
  });

  it("§2 DSK yalnız top bölümünde; omitted cümlesi dosyada", () => {
    expect(subjectColumns(rollSection).some((c) => c.key === "dsk")).toBe(true);
    expect(subjectColumns(yarnSection).some((c) => c.key === "dsk")).toBe(false);
    const spec = buildConsignedStatementExport(statement, ["uyarı A"]);
    expect(spec.meta?.join("\n")).toMatch(/Levent bölümü gösterilmiyor: ilgili modül/);
    expect(spec.meta).toContain("uyarı A");
    expect(spec.meta?.join("\n")).toMatch(/tutuyor/);
    expect(spec.tables.map((t) => t.name)).toEqual(["Top Özeti", "Top Hareketleri", "İplik lotu Özeti", "İplik lotu Hareketleri"]);
  });

  it("§3 toplam satırı sunucu toplamı; kg iki hane, grupsuz", () => {
    const spec = buildConsignedStatementExport(statement);
    expect(spec.tables[0]!.totalRow).toMatchObject({ opening: 100, in: 250, out: 120, dsk: 30, scrap: 5, closing: 195 });
    expect(spec.tables[2]!.columns.find((c) => c.key === "closing")?.numFmt).toBe("0.00");
  });
});

describe("emanet ekstresi — görünüm", () => {
  it("§4 müşteri seçilmeden istek yok; seçilince müşteri + dönemle uca gider", async () => {
    
    const { unmount } = renderWithProviders(<ConsignedStatementView />);
    expect(screen.getByText(/Ekstresini görmek istediğiniz müşteriyi seçin/)).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
    unmount();
    mocks.get.mockResolvedValue({ data: { success: true, data: statement } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/?musteri=c1&from=2026-11-01&to=2026-11-30"]}>
          <ConsignedStatementView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("consigned-statement")).toBeTruthy());
    expect(mocks.get).toHaveBeenCalledWith("/api/consigned-work/c1/statement", { params: { from: "2026-11-01", to: "2026-11-30" } });
    expect(screen.getByText(/Levent bölümü gösterilmiyor/)).toBeTruthy();
  });
});
