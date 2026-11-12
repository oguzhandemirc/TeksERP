// Belge detayı "Tanıma" kartı: sunucunun `tanima` bloğunu üç bölümle çizer (türetmez); tanınmamış belgede eşleme yok;
// eski sunucu (blok yok) → kart yok. Negatif sonda: MappingGroups grup süzgeci kaldırılınca (tek liste) "gruplar ayrı" kırmızı.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TanimaKarti, recognitionText } from "../TanimaKarti";
import type { Tanima } from "../tanimaTypes";

const tanima = (o: Partial<Tanima> = {}): Tanima => ({
  template: { code: "u-komurhan", name: "Kömürhan Çeki Listesi", version: 3, score: 0.94 },
  durum: "TANITILDI",
  mapping: [
    { field: "musteri", label: "Müşteri", value: "KÖMÜRHAN", woTarget: "ownerCustomerId", woLabel: "Müşteri", group: "KIMLIK" },
    { field: "toplamMetre", label: "T.Metre", value: "241", woTarget: "kursunMeters", woLabel: "Gelen metre", group: "GELEN" },
    { field: "toplamKg", label: "T.Kg", value: null, woTarget: "incomingKg", woLabel: "Gelen kg", group: "GELEN" },
    { field: "desen", label: "Desen", value: "D-12", woTarget: "targetItemId", woLabel: "Desen", group: "URUN" },
  ],
  rules: [
    { key: "multiParty", value: "PER_PARTY", source: "TEMPLATE", text: "3 parti → 3 iş emri", sourceText: "şablon kuralı" },
    { key: "totalsRow", value: "T.Adet", source: "TEMPLATE", text: "Toplam satırı: T.Adet", sourceText: "şablon kuralı" },
  ],
  ...o,
});

describe("Tanıma kartı", () => {
  it("⭐ üç bölüm: tip + sürüm + güven, gruplar ayrı çerçevede, kurallar kaynağıyla", () => {
    render(<TanimaKarti tanima={tanima()} />);
    expect(screen.getByTestId("tanima-durum")).toHaveTextContent("Tanındı: Kömürhan Çeki Listesi · sürüm 3 · %94");
    const gelen = within(screen.getByTestId("tanima-group-GELEN"));
    expect(gelen.getByText("Gelen metre")).toBeInTheDocument();
    expect(gelen.getByText("241")).toBeInTheDocument();
    expect(gelen.getByText("—")).toBeInTheDocument();
    expect(within(screen.getByTestId("tanima-group-KIMLIK")).queryByText("Gelen metre")).toBeNull();
    expect(screen.queryByTestId("tanima-group-HEDEF")).toBeNull();
    expect(screen.getByTestId("tanima-kurallar")).toHaveTextContent("3 parti → 3 iş emri (şablon kuralı)");
  });

  it("tanınmamış belge: uyarı metni, eşleme yok, fabrika kuralı görünür", () => {
    render(<TanimaKarti tanima={tanima({ durum: "TANITILMAMIS", template: null, mapping: [], rules: [{ key: "multiParty", value: "SINGLE", source: "FACTORY", text: "Birden çok parti gelirse: tek iş emri", sourceText: "fabrika ayarı" }] })} />);
    expect(screen.getByTestId("tanima-durum")).toHaveTextContent("Tanınmadı");
    expect(screen.queryByTestId("tanima-group-KIMLIK")).toBeNull();
    expect(screen.getByTestId("tanima-kurallar")).toHaveTextContent("(fabrika ayarı)");
  });

  it("eski sunucu: blok yok → kart yok; hazır şablon metni", () => {
    const { container } = render(<TanimaKarti tanima={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(recognitionText(tanima({ durum: "SISTEM", template: { code: "x", name: "Genel", version: 1, score: null } }))).toBe("Hazır şablon: Genel · sürüm 1");
  });
});
