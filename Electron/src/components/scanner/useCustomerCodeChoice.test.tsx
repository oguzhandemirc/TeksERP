// D4-F1c — ortak aday modalı + sarmalayıcı: 409 → modal → seçim iç barkodla; Vazgeç → işlem yok;
// tekil kodda modal açılmaz; işaretli istekte genel toast basılmaz.
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, fireEvent, within } from "@testing-library/react";
import { useCustomerCodeChoice } from "./useCustomerCodeChoice";
import { isChoiceHandledConflict, readAmbiguousCustomerCode } from "@/lib/customer-code-choice";
import { CANDIDATES, SHARED_CODE, ambiguousError, ambiguousThen } from "@/test/helpers/musteri-kodu-aday-fikstur";

function setup() {
  const hook = renderHook(() => useCustomerCodeChoice());
  const view = render(<>{hook.result.current.dialog}</>);
  const rerender = () => view.rerender(<>{hook.result.current.dialog}</>);
  return { hook, rerender };
}

describe("useCustomerCodeChoice", () => {
  it("409 → modal (müşteri · top no · metre · durum) → seçilen topun İÇ barkoduyla aynı işlem", async () => {
    const run = vi.fn(ambiguousThen((c) => `OK:${c}`));
    const { hook, rerender } = setup();
    let pending!: Promise<string | null>;
    act(() => { pending = hook.result.current.resolveScan(SHARED_CODE, run); });
    await act(async () => { await Promise.resolve(); });
    rerender();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ALFA PERDE")).toBeTruthy();
    expect(within(dialog).getByText("BETA TEKSTİL")).toBeTruthy();
    expect(within(dialog).getByText("T-IC-B")).toBeTruthy();
    expect(within(dialog).getByText(/41,5 m/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("customer-code-candidate-r-b"));
    await expect(pending).resolves.toBe("OK:T-IC-B");
    expect(run.mock.calls.map((c) => c[0])).toEqual([SHARED_CODE, "T-IC-B"]);
  });

  it("Vazgeç → null, ikinci çağrı yok", async () => {
    const run = vi.fn(ambiguousThen((c) => `OK:${c}`));
    const { hook, rerender } = setup();
    let pending!: Promise<string | null>;
    act(() => { pending = hook.result.current.resolveScan(SHARED_CODE, run); });
    await act(async () => { await Promise.resolve(); });
    rerender();
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await expect(pending).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tekil kod → modal açılmaz, sonuç doğrudan döner; başka hata aynen fırlar", async () => {
    const { hook, rerender } = setup();
    await expect(hook.result.current.resolveScan("T-IC-A", async (c) => `OK:${c}`)).resolves.toBe("OK:T-IC-A");
    rerender();
    expect(screen.queryByRole("dialog")).toBeNull();
    const boom = new Error("ağ");
    await expect(hook.result.current.resolveScan("X", async () => { throw boom; })).rejects.toBe(boom);
  });
});

describe("customer-code-choice", () => {
  it("adayları okur; işaretli istekte genel toast kapısı kapanır, işaretsizde açık kalır", () => {
    const err = ambiguousError();
    expect(readAmbiguousCustomerCode(err)?.candidates).toEqual(CANDIDATES);
    const body = err.response?.data;
    expect(isChoiceHandledConflict(409, body, true)).toBe(true);
    expect(isChoiceHandledConflict(409, body, undefined)).toBe(false);
    expect(isChoiceHandledConflict(409, { details: { code: "OTHER" } }, true)).toBe(false);
  });
});
