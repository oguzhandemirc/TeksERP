import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Package } from "lucide-react";
import { IconTile, toneForKey, ICON_TILE_TONES } from "../icon-tile";
import { StatCard } from "../stat-card";
import { SectionCard } from "../section-card";
import { Badge } from "../badge";

describe("IconTile", () => {
  it("ton sınıfını basar, varsayılan birincil", () => {
    const { container, rerender } = render(<IconTile icon={Package} />);
    expect(container.firstElementChild?.className).toContain("tile-primary");
    rerender(<IconTile icon={Package} tone="amber" size="sm" />);
    expect(container.firstElementChild?.className).toContain("tile-amber");
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("toneForKey belirlenimli ve paletten", () => {
    expect(toneForKey("/operations")).toBe(toneForKey("/operations"));
    expect(ICON_TILE_TONES).toContain(toneForKey("/x/y"));
  });
});

describe("StatCard", () => {
  it("etiket, değer ve artış satırı (yeşil)", () => {
    render(<StatCard label="Açık sipariş" value="1.243" icon={Package} tone="blue" delta="%10,3 geçen aya göre" trend="up" />);
    expect(screen.getByText("Açık sipariş")).toBeTruthy();
    expect(screen.getByText("1.243")).toBeTruthy();
    const delta = screen.getByText("%10,3 geçen aya göre").parentElement!;
    expect(delta.className).toContain("text-success");
  });

  it("invertTrend: artış kötüyse kırmızı; neutral gri", () => {
    const { rerender } = render(<StatCard label="Fire" value="3" delta="+2" trend="up" invertTrend />);
    expect(screen.getByText("+2").parentElement!.className).toContain("text-destructive");
    rerender(<StatCard label="Fire" value="3" delta="0" trend="neutral" />);
    expect(screen.getByText("0").parentElement!.className).toContain("text-muted-foreground");
  });

  it("onClick verilince düğmedir", () => {
    const onClick = vi.fn();
    render(<StatCard label="Toplam" value="5" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("StatCard compact", () => {
  it("simge solda, etiket/değer/değişim sağda; değişim rengi aynı kural", () => {
    const { container } = render(<StatCard layout="compact" label="Üretim" value="1.200 m" hint="30 top" icon={Package} delta="%12" trend="down" />);
    const card = container.querySelector('[data-layout="compact"]')!;
    expect(card.firstElementChild?.className).toContain("icon-tile");
    expect(card.className).toContain("py-[var(--kpi-py)]");
    expect(screen.getByText("30 top")).toBeTruthy();
    expect(screen.getByText("%12").parentElement!.className).toContain("text-destructive");
  });

  it("değişim verilmezse değişim satırı yok", () => {
    const { container } = render(<StatCard layout="compact" label="Kalan" value="5 m" />);
    expect(container.querySelector("[data-trend]")).toBeNull();
  });
});

describe("SectionCard", () => {
  it("başlık, eylem ve içerik", () => {
    render(
      <SectionCard title="Son hareketler" action={<button type="button">Bu ay</button>}>
        <p>içerik</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { name: "Son hareketler" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bu ay" })).toBeTruthy();
    expect(screen.getByText("içerik")).toBeTruthy();
  });
});

describe("Badge pastel haplar", () => {
  it("success varyantı pastel çifti kullanır", () => {
    render(<Badge variant="success">Ödendi</Badge>);
    const el = screen.getByText("Ödendi");
    expect(el.className).toContain("bg-success-soft");
    expect(el.className).toContain("rounded-badge"); // köşe tercihine bağlı tek belirteç (rozet-kose.test.ts)
  });
});
