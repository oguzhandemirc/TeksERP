// Döküm sunucunun sayısını gösterir: satırların toplamı standart maliyete EŞİT OLMASA da ekrandaki toplam
// sunucunun `standartTlM` alanıdır (istemci toplamaz). Eksik kırmızı (alert), uyarı Türkçe.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostBreakdown } from "./CostBreakdown";
import type { CostResultOut } from "./cost-types";

const line = (sira: number, tutarTlM: string) => ({
  sira, bilesen: "WARP_YARN", etiket: `Kalem ${sira}`, iplikId: null, miktar: "0.1", birim: "kg/m", birimFiyatTl: "100", tutarTlM,
});
const sonuc: CostResultOut = {
  // 10 + 20 = 30; sunucunun standardı 77.0395 → ekranda 77,04 (toplama yapılsaydı 30 görünürdü).
  satirlar: [line(1, "10.0000"), line(2, "20.0000")],
  cozguKgM: "0.123456", atkiKgM: "0.0654321", tezgahMSaat: "6.5",
  hamTlM: "60.1000", mamulTlM: "70.2000", saglamTlM: "72.3000", genelGiderTlM: "4.7395", standartTlM: "77.0395",
};

describe("CostBreakdown", () => {
  it("toplam = sunucunun standartTlM alanı (satırlar toplanmaz)", () => {
    render(<CostBreakdown sonuc={sonuc} eksikler={[]} uyarilar={[]} />);
    expect(screen.getByTestId("cost-total")).toHaveTextContent("77,04 TL/m");
    expect(screen.queryByText("30,00")).toBeNull();
    expect(screen.getByText("Mamul (terbiye + çekme)")).toBeInTheDocument();
  });
  it("kayıtlı sürümde null zincir adımları çizilmez", () => {
    render(<CostBreakdown sonuc={{ ...sonuc, saglamTlM: null, genelGiderTlM: null }} eksikler={[]} uyarilar={[]} />);
    expect(screen.queryByText("Sağlam (kalite firesi)")).toBeNull();
    expect(screen.getByTestId("cost-total")).toHaveTextContent("77,04 TL/m");
  });
  it("eksik → kırmızı uyarı, sonuç tahminle doldurulmaz; uyarı Türkçe", () => {
    render(<CostBreakdown sonuc={null} eksikler={["FX_RATE_MISSING"]} uyarilar={["PRICE_STALE"]} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-code", "FX_RATE_MISSING");
    expect(alert).toHaveTextContent("Kur 1 varsayılmaz");
    expect(screen.getByText(/90 günden eski/)).toBeInTheDocument();
    expect(screen.queryByTestId("cost-total")).toBeNull();
    expect(screen.getByText(/tahminle doldurulmaz/)).toBeInTheDocument();
  });
});
