import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarpEndsStrip } from "./WarpEndsStrip";
import { ReedPlan } from "./ReedPlan";

const yarns = [{ label: "PES 150", endsCount: 2334 }, { label: "PES 75", endsCount: 1166 }];
const seq = { repeat: [1, 1, 2], repeatCount: 1166, remainder: 2, totalEnds: 3500, matchesYarnEnds: true };

describe("WarpEndsStrip", () => {
  it("sunucu açılımı: rapor şeridi + 'rapor × tekrar = toplam', uyarı yok", () => {
    render(<WarpEndsStrip yarns={yarns} endsSequence={seq} cardEnds={3500} />);
    const sum = screen.getByTestId("warp-ends-summary").textContent ?? "";
    expect(sum).toContain("Çözgü raporu 3 tel");
    expect(sum).toMatch(/1\.?166 tekrar/);
    expect(sum).toContain("+ 2 tel");
    expect(sum).toMatch(/= 3\.?500 tel/);
    expect(screen.getByRole("img", { name: /3 tellik rapor/ })).toBeTruthy();
    expect(screen.queryByTestId("warp-ends-warning")).toBeNull();
    expect(screen.queryByTestId("warp-ends-proportional")).toBeNull();
  });

  it("uyuşmazlık: iplik satırı ve kart toplamı ayrı ayrı uyarılır", () => {
    render(<WarpEndsStrip yarns={[{ label: "A", endsCount: 3000 }, { label: "B", endsCount: 500 }]}
      endsSequence={{ ...seq, matchesYarnEnds: false }} cardEnds={3600} />);
    const w = screen.getByTestId("warp-ends-warning").textContent ?? "";
    expect(w).toMatch(/A raporda 2\.?334 \/ kartta 3\.?000/);
    expect(w).toMatch(/toplam teli 3\.?600/);
  });

  it("ortak palet: satırlar verilen yuvaların harfini taşır (döner kartın 1. satırı = B)", () => {
    render(<WarpEndsStrip yarns={[{ label: "Simli", endsCount: 3000 }, { label: "Naylon", endsCount: 500 }]}
      endsSequence={{ ...seq, matchesYarnEnds: false }} cardEnds={3500} slots={[2, 3]} />);
    const w = screen.getByTestId("warp-ends-warning").textContent ?? "";
    expect(w).toMatch(/B raporda 2\.?334 \/ kartta 3\.?000/);
    expect(w).toMatch(/C raporda/);
    const legend = screen.getByRole("list", { name: "Renk açıklaması" }).textContent ?? "";
    expect(legend).toMatch(/BSimli/);
    expect(legend).toMatch(/CNaylon/);
  });

  it("tek iplik + not yok: 'girilmemiş' değil 'Çözgü raporu A · 6.000 tel' der", () => {
    const { rerender } = render(<WarpEndsStrip yarns={[{ label: "PES 150", endsCount: 6000 }]} endsSequence={null} />);
    expect(screen.getByTestId("warp-ends-single").textContent).toMatch(/Çözgü raporu A · 6\.?000 tel/);
    expect(screen.queryByTestId("warp-ends-fallback")).toBeNull();
    rerender(<WarpEndsStrip yarns={[{ label: "PES 150", endsCount: 6000 }]} endsSequence={null} sequenceNote="2A 1Q" />);
    expect(screen.queryByTestId("warp-ends-single")).toBeNull();
    expect(screen.getByTestId("warp-ends-fallback").textContent).toContain("okunamadı");
  });

  it("açılım yok: oransal blok; not girilmemiş / okunamadı / düzenleniyor ayrı yazılır", () => {
    const { rerender } = render(<WarpEndsStrip yarns={yarns} endsSequence={null} />);
    expect(screen.getByTestId("warp-ends-proportional")).toBeTruthy();
    expect(screen.getByTestId("warp-ends-fallback").textContent).toContain("girilmemiş");
    rerender(<WarpEndsStrip yarns={yarns} endsSequence={null} sequenceNote="karışık" />);
    expect(screen.getByTestId("warp-ends-fallback").textContent).toContain("okunamadı");
    rerender(<WarpEndsStrip yarns={yarns} endsSequence={seq} pending />);
    expect(screen.getByTestId("warp-ends-fallback").textContent).toContain("Kaydedince");
    expect(screen.queryByTestId("warp-ends-summary")).toBeNull();
  });

  it("compact: lejant ve not çizilmez", () => {
    render(<WarpEndsStrip yarns={yarns} endsSequence={null} compact />);
    expect(screen.queryByTestId("warp-ends-fallback")).toBeNull();
    expect(screen.queryByLabelText("Renk açıklaması")).toBeNull();
  });
});

describe("ReedPlan", () => {
  it("diş özeti ve kenar teli lejantı", () => {
    render(<ReedPlan endsPerDent={2} reedNo={80} totalEnds={3548} selvedgeEnds={48} endsSequence={seq} />);
    const s = screen.getByTestId("reed-plan-summary").textContent ?? "";
    expect(s).toContain("Dişe 2 tel");
    expect(s).toContain("tarak no 80 diş/10 cm");
    expect(s).toContain("kenar her yanda 24 tel (12 diş)");
    expect(s).toMatch(/1\.?774 diş/);
    expect(screen.getByText(/Kenar teli/)).toBeTruthy();
  });

  it("diş/cm biriminde saklı değer ÷10 gösterilir (K9)", () => {
    render(<ReedPlan endsPerDent={2} reedNo={80} reedUnit="DENTS_PER_CM" totalEnds={3548} />);
    expect(screen.getByTestId("reed-plan-summary").textContent ?? "").toContain("tarak no 8 diş/cm");
  });

  it("dişe tel yoksa yönlendirme metni", () => {
    render(<ReedPlan endsPerDent={null} totalEnds={100} />);
    expect(screen.getByTestId("reed-plan-empty")).toBeTruthy();
  });
});
