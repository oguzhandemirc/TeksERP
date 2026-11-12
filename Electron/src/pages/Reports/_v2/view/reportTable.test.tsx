import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReportTable } from "../ReportTable";
import type { TabloBlok } from "../sunum";
import { barColumnOf, barWidth, toggleHidden, visibleColumns } from "./table-view";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ musteri: `Müşteri ${i + 1}`, siparis: n - i, metre: (n - i) * 100 }));
const tablo = (n: number, over: Partial<TabloBlok> = {}): TabloBlok => ({
  kolonlar: [
    { anahtar: "musteri", baslik: "Müşteri" },
    { anahtar: "siparis", baslik: "Sipariş", birim: "siparis" },
    { anahtar: "metre", baslik: "Metre", birim: "m" },
  ],
  satirlar: rows(n),
  toplam: { musteri: "Toplam", siparis: 99, metre: 9900 },
  ...over,
});

describe("rapor tablosu — ekran görünüşü", () => {
  it("⭐ sayı kolonu sağa hizalı tabular; hücre tek satır (kırılmaz)", () => {
    render(<ReportTable table={tablo(3)} />);
    const cell = screen.getByText("300");
    expect(cell.closest("td")!.className).toMatch(/text-right.*tabular-nums|tabular-nums.*text-right/);
    expect(screen.getByText("Müşteri 1").className).toContain("whitespace-nowrap");
  });

  it("⭐ uzun tabloda toplam satırı başlığın altında (üstte, yapışkan thead içinde); kısa tabloda altta", () => {
    const { unmount } = render(<ReportTable table={tablo(12)} />);
    expect(screen.getByTestId("report-table-total").closest("thead")).not.toBeNull();
    unmount();
    render(<ReportTable table={tablo(3)} />);
    expect(screen.getByTestId("report-table-total").closest("tfoot")).not.toBeNull();
  });

  it("kolon gizlenince başlık ve hücreler kaybolur; seçim çağırana bildirilir", () => {
    const onHidden = vi.fn();
    const { rerender } = render(<ReportTable table={tablo(3)} hiddenColumns={[]} onHiddenColumns={onHidden} />);
    expect(screen.getByRole("columnheader", { name: "Sipariş (sipariş)" })).toBeInTheDocument();
    rerender(<ReportTable table={tablo(3)} hiddenColumns={["siparis"]} onHiddenColumns={onHidden} />);
    expect(screen.queryByRole("columnheader", { name: "Sipariş (sipariş)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Kolonlar" })).toHaveTextContent("1 gizli");
  });

  it("satır bağlantısı korunur (tık ve Enter)", () => {
    const open = vi.fn();
    render(<ReportTable table={tablo(2)} rowLink={{ target: (r) => `/x/${r.siparis}`, open, title: "aç" }} />);
    fireEvent.click(screen.getByText("Müşteri 1"));
    fireEvent.keyDown(screen.getAllByRole("link")[1]!, { key: "Enter" });
    expect(open.mock.calls).toEqual([["/x/2"], ["/x/1"]]);
  });

  it("görsel büyüklük çubuğu yalnız seçilen kolonda, METİN eklemez", () => {
    render(<ReportTable table={tablo(3)} barColumn="metre" />);
    expect(screen.getAllByTestId("share-bar")).toHaveLength(3);
    const firstMetre = screen.getAllByTestId("share-bar")[0]!.parentElement!;
    expect(firstMetre.textContent).toBe("300");
  });

  it("boş tablo metni; gömülü tablo başlık çizmez", () => {
    const { unmount } = render(<ReportTable table={tablo(0)} />);
    expect(screen.getByText("Tabloda gösterilecek satır yok.")).toBeInTheDocument();
    unmount();
    render(<ReportTable table={tablo(2)} embedded />);
    expect(within(screen.getByRole("region", { name: "Tablo" })).queryByRole("heading", { hidden: false })).toBeNull();
  });
});

describe("table-view kuralları", () => {
  it("son görünür kolon gizlenemez", () => {
    const t = tablo(1);
    expect(toggleHidden(t, ["musteri", "siparis"], "metre")).toEqual(["musteri", "siparis"]);
    expect(visibleColumns(t, ["musteri", "siparis", "metre"]).map((c) => c.anahtar)).toEqual(["musteri"]);
    expect(toggleHidden(t, ["siparis"], "siparis")).toEqual([]);
  });
  it("çubuk kolonu ana sayının biriminden; oran/süre ve eksi değerli kolona yok", () => {
    expect(barColumnOf(tablo(2), "m")).toBe("metre");
    expect(barColumnOf(tablo(2), "yuzde")).toBeNull();
    expect(barColumnOf(tablo(2, { satirlar: [{ musteri: "a", siparis: 1, metre: -5 }] }), "m")).toBeNull();
  });
  it("çubuk genişliği kolonun en büyüğüne oranla; sayı değilse yok", () => {
    expect(barWidth(50, 100)).toBe(50);
    expect(barWidth(null, 100)).toBeNull();
    expect(barWidth(0, 100)).toBe(2);
  });
});
