// Paylaşılan atkı kartı kaydı (kullanıcı 2026-11-25): "Hepsinde değişsin" YOK; seçenekler kopya ya da Atkı Kartları ekranı.
// Kopya cevabı pencere açıkken hatırlanır (kopyadan sonra tekrar Kaydet ortak kartı değiştirmez).
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useWeftShareQuestion } from "./WeftShareQuestion";
import type { WeftSavePlan } from "./useItemWeftDraft";

const openTab = vi.hoisted(() => vi.fn());
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));

const SHARED: WeftSavePlan = { kind: "shared-card", weftSpecId: "w1", body: { sequenceCode: "A1" } };
const CARD = { code: "1205", name: "Ortak atkı" };

function Harness({ others, forking = false, plan = SHARED }: { others: number | null; forking?: boolean; plan?: WeftSavePlan }) {
  const q = useWeftShareQuestion(true);
  const [result, setResult] = useState<string>("");
  return (
    <>
      <button onClick={() => void q.resolvePlan(plan, { forking, others, card: CARD }, "K-77").then((p) => setResult(p ? p.kind : "vazgeçti"))}>kaydet</button>
      <output data-testid="result">{result}</output>
      {q.element}
    </>
  );
}

describe("useWeftShareQuestion", () => {
  it("yalnız bu kumaşa ait kartın düzeltmesi (patch-card) soru sormadan geçer", async () => {
    render(<Harness others={0} plan={{ kind: "patch-card", weftSpecId: "w1", body: {} }} />);
    fireEvent.click(screen.getByText("kaydet"));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("patch-card"));
    expect(screen.queryByTestId("weft-share-question")).toBeNull();
  });

  it("'kopya' önceden seçildiyse sormadan fork-patch", async () => {
    render(<Harness others={2} forking />);
    fireEvent.click(screen.getByText("kaydet"));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("fork-patch"));
    expect(screen.queryByTestId("weft-share-question")).toBeNull();
  });

  it("(a) ⭐ soru 'Hepsinde değişsin' sunmaz; 'yalnız bu kumaş' → kopya planı, cevap hatırlanır", async () => {
    render(<Harness others={2} />);
    fireEvent.click(screen.getByText("kaydet"));
    expect(await screen.findByText("Bu atkı kartı 2 kumaşta daha kullanılıyor")).toBeInTheDocument();
    expect(screen.queryByText(/Hepsinde değişsin/)).toBeNull();
    expect(screen.getByText("1205-K-77")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yalnız bu kumaş için kopya" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("fork-patch"));
    fireEvent.click(screen.getByText("kaydet"));
    await waitFor(() => expect(screen.queryByTestId("weft-share-question")).toBeNull());
    expect(screen.getByTestId("result")).toHaveTextContent("fork-patch");
  });

  it("'Atkı Kartları ekranında aç' kaydı durdurur ve kartı yeni sekmede süzülü açar; vazgeç de durdurur", async () => {
    const { unmount } = render(<Harness others={null} />);
    fireEvent.click(screen.getByText("kaydet"));
    fireEvent.click(await screen.findByRole("button", { name: /Atkı Kartları ekranında aç/ }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("vazgeçti"));
    await waitFor(() => expect(openTab).toHaveBeenCalledWith("/definitions/weft-specs?search=1205", { forceNew: true }));
    unmount();
    render(<Harness others={1} />);
    fireEvent.click(screen.getByText("kaydet"));
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.getByTestId("result")).toHaveTextContent("vazgeçti"));
  });
});
