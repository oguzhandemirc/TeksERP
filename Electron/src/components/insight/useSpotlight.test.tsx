// Spot ışığı: süzmeden vurgular, kardeşleri soldurur, süre/Esc/tıklama/kaydırma söndürür, odak + duyuru.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SPOTLIGHT_CLASS, SpotlightGroup } from "./SpotlightGroup";
import { SPOTLIGHT_DEFAULT_MS, useSpotlight } from "./useSpotlight";

const scrollSpy = vi.fn();

function Harness() {
  const spot = useSpotlight();
  return (
    <SpotlightGroup controller={spot}>
      <button type="button" onClick={() => spot.spotlight("b", "B vurgulandı", "B listede yok")}>B'yi göster</button>
      <button type="button" onClick={() => spot.spotlight("z", "Z vurgulandı", "Z listede yok")}>Z'yi göster</button>
      <div {...spot.dimProps()} data-testid="kutu" className={SPOTLIGHT_CLASS}>kutu</div>
      {["a", "b"].map((k) => (
        <section key={k} aria-label={k} {...spot.regionProps(k)} className={SPOTLIGHT_CLASS}>
          <h3 data-spotlight-heading>{k} başlık</h3>
          <button type="button">{k} içi</button>
        </section>
      ))}
    </SpotlightGroup>
  );
}

const region = (k: string) => screen.getByRole("region", { name: k });

beforeEach(() => {
  vi.useFakeTimers();
  scrollSpy.mockReset();
  Element.prototype.scrollIntoView = scrollSpy;
});
afterEach(() => vi.useRealTimers());

describe("useSpotlight", () => {
  it("hedefi vurgular, kardeşleri soldurur, hiçbirini kaldırmaz; odak başlıkta, duyuru canlı", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("B'yi göster"));
    expect(region("b")).toHaveAttribute("data-spotlight", "lit");
    expect(region("a")).toHaveAttribute("data-spotlight", "dim");
    expect(screen.getByTestId("kutu")).toHaveAttribute("data-spotlight", "dim");
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(document.activeElement).toBe(screen.getByText("b başlık"));
    expect(screen.getByRole("status")).toHaveTextContent("B vurgulandı");
  });

  it("süre dolunca normale döner", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("B'yi göster"));
    act(() => {
      vi.advanceTimersByTime(SPOTLIGHT_DEFAULT_MS - 1);
    });
    expect(region("b")).toHaveAttribute("data-spotlight", "lit");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region("b")).not.toHaveAttribute("data-spotlight");
    expect(region("a")).not.toHaveAttribute("data-spotlight");
  });

  it("Esc, başka tıklama ve tekerlek ışığı söndürür; soluk alan tıklanabilir kalır", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("B'yi göster"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(region("b")).not.toHaveAttribute("data-spotlight");

    fireEvent.click(screen.getByText("B'yi göster"));
    const inner = vi.fn();
    const aButton = screen.getByText("a içi");
    aButton.addEventListener("click", inner);
    fireEvent.pointerDown(aButton);
    fireEvent.click(aButton);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(region("b")).not.toHaveAttribute("data-spotlight");

    fireEvent.click(screen.getByText("B'yi göster"));
    fireEvent.wheel(document);
    expect(region("b")).not.toHaveAttribute("data-spotlight");
  });

  it("Tab gibi kaydırmayan tuş ışığı söndürmez", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("B'yi göster"));
    fireEvent.keyDown(document, { key: "Tab" });
    expect(region("b")).toHaveAttribute("data-spotlight", "lit");
  });

  it("çizili olmayan bölüm: ışık yakılmaz, neden duyurulur", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Z'yi göster"));
    expect(region("a")).not.toHaveAttribute("data-spotlight");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Z listede yok");
  });

  it("hareket azaltılmışsa kaydırma animasyonsuz", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      render(<Harness />);
      fireEvent.click(screen.getByText("B'yi göster"));
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    } finally {
      window.matchMedia = mm;
    }
  });
});
