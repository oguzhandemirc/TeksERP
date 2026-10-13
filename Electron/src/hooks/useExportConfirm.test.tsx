import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useExportConfirm } from "./useExportConfirm";

// Büyük liste onayı ConfirmDialog ile (window.confirm YASAK): söz kullanıcının kararıyla çözülür.

function setup() {
  const hook = renderHook(() => useExportConfirm());
  const view = render(<>{hook.result.current.confirmDialog}</>);
  const rerender = () => view.rerender(<>{hook.result.current.confirmDialog}</>);
  return { hook, rerender };
}

describe("useExportConfirm", () => {
  it("⭐ 'İndir' → true; diyalog yaklaşık kayıt sayısını gösterir", async () => {
    const { hook, rerender } = setup();
    let p!: Promise<boolean>;
    act(() => {
      p = hook.result.current.confirmTotal(123456);
    });
    rerender();
    expect(screen.getByText(/123\.456 kayıt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "İndir" }));
    await expect(p).resolves.toBe(true);
  });

  it("⭐ 'Vazgeç' → false", async () => {
    const { hook, rerender } = setup();
    let p!: Promise<boolean>;
    act(() => {
      p = hook.result.current.confirmTotal(200000);
    });
    rerender();
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await expect(p).resolves.toBe(false);
  });
});
