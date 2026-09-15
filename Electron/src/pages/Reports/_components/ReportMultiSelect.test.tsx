// =============================================================================
// BEKÇİ — EKSEN SEÇİCİLERİ (R5b-c): "Tümü" = seçimin YOKLUĞU
// =============================================================================
// Üç iddia ölçülür: ① seçenek yokken şerit SESSİZCE boş görünmez, pasif ve
// SEBEBİNİ söyler ② seçim yapmak listeyi DARALTMAZ (kaynak süzgeçten bağımsız)
// ③ niteleyici ETİKETTE yaşar — "İhracat" yazan seçicinin müşteri VARSAYILANINI
// süzdüğü ekranda okunur; yoksa tutarlı görünen bir tablo yanlış okunur.
//
// Negatif sonda (bir kezlik, cp+sha256 ile geri alındı): tetikten
// `disabled={list.length === 0}` kaldırıldı → ⭐① ❌.
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReportAxisOption } from "../_services/types";
import { DestinationSelect } from "./DestinationSelect";
import { ReportMultiSelect } from "./ReportMultiSelect";

const MUSTERILER: ReportAxisOption[] = [
  { id: "c1", ad: "Acme" },
  { id: "c2", ad: "Beta Tekstil" },
];
const SEBEPLER: ReportAxisOption[] = [{ code: "STOK_YOK", ad: "Stok yok" }];

function mount(props: Partial<React.ComponentProps<typeof ReportMultiSelect>> = {}) {
  const onChange = vi.fn();
  render(
    <ReportMultiSelect
      id="t"
      label="Müşteri"
      options={MUSTERILER}
      value={[]}
      onChange={onChange}
      emptyHint="Pencerede müşteri yok"
      {...props}
    />,
  );
  // Erişilebilir ad ETİKETTEN gelir (`htmlFor`) — özet metni içerikte yaşar.
  const trigger = (label = "Müşteri") => screen.getByRole("button", { name: label });
  return { onChange, trigger };
}

describe("ReportMultiSelect", () => {
  it("⭐ seçenek yokken pasiftir ve SEBEBİNİ yazar (boş 'Tümü' göstermez)", () => {
    const { trigger } = mount({ options: [] });
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveTextContent("Pencerede müşteri yok");
  });

  it("seçim yokken 'Tümü'; temizleme düğmesi de yoktur", () => {
    const { trigger } = mount();
    expect(trigger()).toHaveTextContent("Tümü");
    expect(screen.queryByTitle("Süzgeci temizle")).toBeNull();
  });

  it("seçenek tıklanınca ANAHTARI ile geri döner (id yoksa kod)", async () => {
    const u = userEvent.setup();
    const { onChange, trigger } = mount({ options: SEBEPLER, label: "Sebep" });
    await u.click(trigger("Sebep"));
    await u.click(await screen.findByText("Stok yok"));
    expect(onChange).toHaveBeenCalledWith(["STOK_YOK"]);
  });

  it("⭐ seçim yapmak listeyi DARALTMAZ; ikinci seçenek eklenir", async () => {
    const u = userEvent.setup();
    const { onChange, trigger } = mount({ value: ["c1"] });
    expect(trigger()).toHaveTextContent("Acme");
    await u.click(trigger());
    expect(await screen.findByText("Beta Tekstil")).toBeInTheDocument();
    await u.click(screen.getByText("Beta Tekstil"));
    expect(onChange).toHaveBeenCalledWith(["c1", "c2"]);
  });

  it("seçiliyken temizleme düğmesi çıkar ve BOŞ listeye döner ('Tümü')", async () => {
    const u = userEvent.setup();
    const { onChange, trigger } = mount({ value: ["c1", "c2"] });
    expect(trigger()).toHaveTextContent("2 seçili");
    await u.click(screen.getByTitle("Süzgeci temizle"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("DestinationSelect", () => {
  it("⭐ niteleyici ETİKETTE: 'müşteri varsayılanı' hem başlıkta hem seçeneklerde", async () => {
    const u = userEvent.setup();
    render(<DestinationSelect id="d" value="" onChange={vi.fn()} />);
    expect(screen.getByText("Müşteri varsayılanı")).toBeInTheDocument();
    await u.click(screen.getByRole("combobox"));
    expect(await screen.findByText("İhracat (müşteri varsayılanı)")).toBeInTheDocument();
    expect(screen.getByText("Yurtiçi (müşteri varsayılanı)")).toBeInTheDocument();
  });
});
