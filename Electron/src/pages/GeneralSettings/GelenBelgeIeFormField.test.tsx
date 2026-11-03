// K30-B: "Tanıtılan belgeye güven" alanı — istemci gövde katmanı sessiz allowlist'tir; alan değişince
// Kaydet gövdesine `tanitimGuveni` girer, eski backend alanı göndermezse ne çizilir ne gövdeye girer.
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import { IeFormFields, useIeFormDraft } from "./GelenBelgeIeFormField";

const server = (extra: Record<string, unknown>) => extra as unknown as IncomingDocumentSettings;

describe("GelenBelgeIeFormField — tanitimGuveni", () => {
  it("SOR → SORMA seçilince gövdeye yalnız tanitimGuveni girer", () => {
    const { result } = renderHook(() => useIeFormDraft(server({ tanitimGuveni: "SOR", defaultTanitimGuveni: "SOR" })));
    expect(result.current.dirty).toBe(false);
    expect(result.current.body).toEqual({});
    act(() => result.current.setGuven("SORMA"));
    expect(result.current.dirty).toBe(true);
    expect(result.current.body).toEqual({ tanitimGuveni: "SORMA" });
    act(() => result.current.reset());
    expect(result.current.body).toEqual({});
  });

  it("eski backend alanı göndermez → alan çizilmez, gövdeye girmez", () => {
    const { result } = renderHook(() => useIeFormDraft(server({ desenRenkEslesme: "KAPALI" })));
    expect(result.current.serverGuven).toBeUndefined();
    act(() => result.current.setGuven("SORMA"));
    expect(result.current.body).toEqual({});
    render(<IeFormFields draft={result.current} />);
    expect(screen.queryByTestId("gb-tanitim-guveni")).toBeNull();
  });

  it("alan Türkçe etiketlerle çizilir ve seçim taslağa yazılır", () => {
    function Harness() {
      const d = useIeFormDraft(server({ tanitimGuveni: "SOR", defaultTanitimGuveni: "SOR" }));
      return <><IeFormFields draft={d} /><output data-testid="body">{JSON.stringify(d.body)}</output></>;
    }
    render(<Harness />);
    expect(screen.getByTestId("gb-tanitim-guveni")).toBeTruthy();
    expect(screen.getByText("Tanıtılan belgeye güven")).toBeTruthy();
    fireEvent.click(screen.getByText("Tanıtılan belgeyi sormadan doldur"));
    expect(screen.getByTestId("body").textContent).toBe(JSON.stringify({ tanitimGuveni: "SORMA" }));
  });
});
