// TV kipinden çıkış görünür olmalı: ilk açılışta düğme + ipucu, boşta söner, fare oynayınca
// geri gelir; Esc ve düğme çıkar; tarayıcı Esc'i tam ekrana harcarsa düğme yeniden belirir.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TV_EXIT_IDLE_MS, TV_EXIT_INTRO_MS, TvExitControl } from "./TvExit";

const box = () => screen.getByTestId("tv-exit");

describe("TvExitControl", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("⭐ ilk açılışta düğme ve ipucu görünür, süre dolunca söner; fare oynayınca geri gelir", () => {
    render(<TvExitControl onExit={() => undefined} label="TV kipinden çık" />);
    expect(box().dataset.visible).toBe("1");
    expect(screen.getByRole("button").textContent).toContain("TV kipinden çık");
    expect(screen.getByRole("status").textContent).toContain("Esc");
    act(() => void vi.advanceTimersByTime(TV_EXIT_INTRO_MS));
    expect(box().dataset.visible).toBe("0");
    expect(screen.queryByRole("status")).toBeNull();
    act(() => void fireEvent.pointerMove(window));
    expect(box().dataset.visible).toBe("1");
    act(() => void vi.advanceTimersByTime(TV_EXIT_IDLE_MS));
    expect(box().dataset.visible).toBe("0");
  });

  it("⭐ Esc ve düğme çıkar", () => {
    const onExit = vi.fn();
    render(<TvExitControl onExit={onExit} label="TV kipinden çık" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button"));
    expect(onExit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("tam ekrandan çıkılınca (tarayıcı Esc'i yuttu) düğme ipucuyla yeniden görünür", () => {
    render(<TvExitControl onExit={() => undefined} label="TV kipinden çık" />);
    act(() => void vi.advanceTimersByTime(TV_EXIT_INTRO_MS));
    expect(box().dataset.visible).toBe("0");
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(box().dataset.visible).toBe("1");
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("ayrı pencere: 'Tam ekran' düğmesi ve sürükleme ipucu; çıkış 'Pencereyi kapat'", () => {
    const toggle = vi.fn();
    const onExit = vi.fn();
    render(<TvExitControl onExit={onExit} label="Pencereyi kapat" onToggleFullscreen={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Tam ekran/ }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("sürükleyin");
    fireEvent.click(screen.getByRole("button", { name: /Pencereyi kapat/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
