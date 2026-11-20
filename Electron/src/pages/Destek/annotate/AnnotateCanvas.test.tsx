import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotateCanvas } from "./AnnotateCanvas";
import { exportPng } from "./render";
import { useAnnotator, type Annotator } from "./useAnnotator";

/**
 * METİN ARACI BEKÇİSİ (2026-11-16 görsel tur hatası): tuvale tıklamanın varsayılan eylemi odağı gövdeye
 * taşıyordu → yeni açılan etiket kutusu aynı tıklamada blur olup boş değerle kapanıyor, etiket çizime
 * hiç girmiyordu. Burada tıklama → yazma → Enter zincirinin şekli geçmişe ve PNG çıktısına soktuğu ölçülür.
 */
// jsdom'da PointerEvent yok: fireEvent düz Event kurar ve `button` düşer. MouseEvent tabanlı yerine koyma.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim;
}
// jsdom tuval çizmez; çizim efekti bağlam yoksa erken döner.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];

const image = { naturalWidth: 800, naturalHeight: 600 } as HTMLImageElement;
const SIZE = { width: 800, height: 600 };

function Harness({ onReady }: { onReady: (a: Annotator) => void }) {
  const a = useAnnotator(SIZE);
  onReady(a);
  return <AnnotateCanvas image={image} annotator={a} />;
}

function mount() {
  let latest!: Annotator;
  render(<Harness onReady={(a) => (latest = a)} />);
  act(() => latest.setTool("text"));
  const canvas = screen.getByLabelText("Ekran görüntüsü çizim alanı");
  return { canvas, get: () => latest };
}

function clickCanvas(canvas: HTMLElement): { pointerDefault: boolean; mouseDefault: boolean } {
  let pointerDefault = true;
  let mouseDefault = true;
  act(() => {
    pointerDefault = fireEvent.pointerDown(canvas, { button: 0, clientX: 120, clientY: 80, pointerId: 1 });
  });
  act(() => {
    mouseDefault = fireEvent.mouseDown(canvas, { button: 0, clientX: 120, clientY: 80 });
  });
  return { pointerDefault, mouseDefault };
}

describe("çizim editörü — metin etiketi", () => {
  it("tıklama odağı çalmaz: etiket kutusu açık kalır", () => {
    const { canvas } = mount();
    const r = clickCanvas(canvas);
    expect(r.pointerDefault, "pointerdown varsayılanı engellenmeli").toBe(false);
    expect(r.mouseDefault, "mousedown varsayılanı (odak taşıma) engellenmeli").toBe(false);
    expect(screen.getByLabelText("Etiket metni")).toBeInTheDocument();
  });

  it("yaz + Enter → metin şekli geçmişe ve PNG çıktısına girer (tek kez)", () => {
    const { canvas, get } = mount();
    clickCanvas(canvas);
    const input = screen.getByLabelText("Etiket metni");
    fireEvent.change(input, { target: { value: "Burada boş" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Enter sonrası kutu kalkarken gelen blur ikinci kez işlememeli.
    act(() => get().commitText());
    const shapes = get().snapshot.shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ kind: "text", text: "Burada boş" });
    expect(screen.queryByLabelText("Etiket metni")).toBeNull();

    const fillText = vi.fn();
    const ctx = new Proxy({ fillText } as Record<string, unknown>, {
      get: (t, p: string) => (p in t ? t[p] : () => undefined),
      set: (t, p: string, v) => ((t[p] = v), true),
    });
    const out = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64,UE5H" };
    const doc = { createElement: () => out } as unknown as Document;
    expect(exportPng({ image, width: 800, height: 600, snapshot: get().snapshot }, doc)?.base64).toBe("UE5H");
    expect(fillText).toHaveBeenCalledWith("Burada boş", expect.any(Number), expect.any(Number));
  });

  it("boş etiket iz bırakmaz; Esc vazgeçer", () => {
    const { canvas, get } = mount();
    clickCanvas(canvas);
    fireEvent.keyDown(screen.getByLabelText("Etiket metni"), { key: "Escape" });
    clickCanvas(canvas);
    fireEvent.blur(screen.getByLabelText("Etiket metni"));
    expect(get().snapshot.shapes).toHaveLength(0);
  });
});
