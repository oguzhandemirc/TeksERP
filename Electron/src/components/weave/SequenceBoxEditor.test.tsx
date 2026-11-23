// Kutu şeridi ↔ kod iki yönlü: kutuya tıklama harfi çevirip kodu yazar, harf düğmesi sona ekler, biçim korunur,
// okunamayan kod şeridi kapatır.
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SequenceBoxEditor } from "./SequenceBoxEditor";

function Harness({ initial, style = "letter-first" as const }: { initial: string; style?: "letter-first" | "digit-first" }) {
  const [code, setCode] = useState(initial);
  return (
    <>
      <output data-testid="code">{code}</output>
      <SequenceBoxEditor value={code} onChange={setCode} letterCount={3} defaultStyle={style} unit="atkı" label="Kutular" />
    </>
  );
}
const code = () => screen.getByTestId("code").textContent;

describe("SequenceBoxEditor", () => {
  it("kutuya tıklama ipliği sıradakine çevirir ve kodu yazar", () => {
    render(<Harness initial="A2 B1 C1" />);
    fireEvent.click(screen.getByRole("button", { name: /^2\. atkı: A/ }));
    expect(code()).toBe("A1 B2 C1");
  });
  it("seçim yokken harf düğmesi sona ekler", () => {
    render(<Harness initial="A1 B1 C1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sona A ekle" }));
    expect(code()).toBe("A1 B1 C1 A1");
  });
  it("seçili kutu silinir ve klavye harfiyle değişir; çözgü biçimi (2A 1B) korunur", () => {
    render(<Harness initial="2A 1B 1C" style="digit-first" />);
    const box = screen.getByRole("button", { name: /^1\. atkı: A/ });
    fireEvent.click(box); // A → B, seçili
    expect(code()).toBe("1B 1A 1B 1C");
    fireEvent.keyDown(screen.getByRole("button", { name: /^1\. atkı: B/ }), { key: "c" });
    expect(code()).toBe("1C 1A 1B 1C");
    fireEvent.click(screen.getByRole("button", { name: "1. atkı kutusunu sil" }));
    expect(code()).toBe("1A 1B 1C");
  });
  it("özet ve eksik harf uyarısı", () => {
    render(<Harness initial="A3 B1" />);
    expect(screen.getByTestId("seq-editor-summary").textContent).toContain("4 atkı/rapor");
    expect(screen.getByText(/C ipliği sırada hiç geçmiyor/)).toBeInTheDocument();
  });
  it("okunamayan kod şeridi kapatır, baştan başlatılabilir", () => {
    render(<Harness initial="2A B" />);
    expect(screen.getByTestId("seq-editor-unreadable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Şeridi baştan başlat" }));
    expect(code()).toBe("A1");
  });
});
