// Paylaşılan atkı kartı sorusu (B19): soru çıkar, cevap planı belirler, pencere açıkken hatırlanır (kopyadan sonra
// tekrar Kaydet ortak kartı değiştirmez — kart artık başka kumaşta görünmese de).
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useWeftShareQuestion } from "./WeftShareQuestion";
import type { WeftSavePlan } from "./useItemWeftDraft";

const PATCH: WeftSavePlan = { kind: "patch-card", weftSpecId: "w1", body: { sequenceCode: "A1" } };
const CARD = { code: "1205", name: "Ortak atkı" };

function Harness({ others }: { others: number }) {
  const q = useWeftShareQuestion(true);
  const [result, setResult] = useState<string>("");
  return (
    <>
      <button onClick={() => void q.resolvePlan(PATCH, others, CARD, "K-77").then((p) => setResult(p ? p.kind : "vazgeçti"))}>kaydet</button>
      <output data-testid="result">{result}</output>
      {q.element}
    </>
  );
}

describe("useWeftShareQuestion", () => {
  it("başka kumaş yoksa sormadan ortak kartı düzenler", async () => {
    render(<Harness others={0} />);
    fireEvent.click(screen.getByText("kaydet"));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("patch-card"));
    expect(screen.queryByTestId("weft-share-question")).toBeNull();
  });

  it("N kumaşta kullanılıyorsa sorar; 'yalnız bu kumaş' → kopya planı, cevap hatırlanır", async () => {
    render(<Harness others={2} />);
    fireEvent.click(screen.getByText("kaydet"));
    expect(await screen.findByText("Bu atkı kartı 2 kumaşta daha kullanılıyor")).toBeInTheDocument();
    expect(screen.getByText("1205-K-77")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yalnız bu kumaş için kopya" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("fork-patch"));
    fireEvent.click(screen.getByText("kaydet"));
    await waitFor(() => expect(screen.queryByTestId("weft-share-question")).toBeNull());
    expect(screen.getByTestId("result")).toHaveTextContent("fork-patch");
  });

  it("'hepsinde değişsin' ortak kartı düzenler; vazgeç kaydı durdurur", async () => {
    const { unmount } = render(<Harness others={1} />);
    fireEvent.click(screen.getByText("kaydet"));
    fireEvent.click(await screen.findByRole("button", { name: "Hepsinde değişsin" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("patch-card"));
    unmount();
    render(<Harness others={1} />);
    fireEvent.click(screen.getByText("kaydet"));
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("vazgeçti"));
  });
});
