// =============================================================================
// BEKÇİ — LOT KUTUSU: her harfte DEĞİL, uygulandığında süzer
// =============================================================================
// İki iddia: ① yazmak tek başına süzgeci değiştirmez (Enter ya da odak kaybı
// gerekir) — aksi halde 64 karakterlik bir lot no 64 rapor isteği demektir
// ② dışarıdan gelen değer (geri tuşu · paylaşılan bağlantı) kutuya yansır.
//
// Negatif sonda (bir kezlik, cp+sha256 ile geri alındı): `onBlur` kaldırıldı → ⭐① ❌.
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LotInput } from "./LotInput";

describe("LotInput", () => {
  it("⭐ yazarken süzgeç DEĞİŞMEZ; Enter uygular", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<LotInput id="t" value="" onChange={onChange} />);
    const box = screen.getByLabelText("İplik lotu");
    await u.type(box, "LOT-9");
    expect(onChange).not.toHaveBeenCalled();
    await u.type(box, "{Enter}");
    expect(onChange).toHaveBeenCalledWith("LOT-9");
  });

  it("odak kaybında da uygulanır; değişmemişse istek YOK", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <LotInput id="t" value="LOT-1" onChange={onChange} />
        <button type="button">dışarı</button>
      </>,
    );
    await u.click(screen.getByRole("button", { name: "dışarı" }));
    expect(onChange).not.toHaveBeenCalled();
    await u.clear(screen.getByLabelText("İplik lotu"));
    await u.click(screen.getByRole("button", { name: "dışarı" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("dışarıdan gelen değer kutuya yansır (geri tuşu · paylaşılan bağlantı)", () => {
    const { rerender } = render(<LotInput id="t" value="A" onChange={vi.fn()} />);
    rerender(<LotInput id="t" value="B" onChange={vi.fn()} />);
    expect(screen.getByLabelText("İplik lotu")).toHaveValue("B");
  });
});
