// Okut/ara alanı URL `search` yazar; bayat kopyayla araya giren yazımı (filtre kaydı geri yükleme) geri almaz.
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { RollScanBar } from "./RollScanBar";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, ready: true, setPreference: vi.fn() }),
}));

let setSp: ReturnType<typeof useSearchParams>[1] | null = null;
function Url() {
  const [sp, set] = useSearchParams();
  setSp = set;
  return <output data-testid="url">{decodeURIComponent(sp.toString())}</output>;
}

const tick = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

function setup(initial = "/") {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <RollScanBar openDetail={vi.fn()} scanPending={false} />
      <Url />
    </MemoryRouter>,
  );
  return () => screen.getByTestId("url").textContent ?? "";
}

describe("RollScanBar — URL yazımı", () => {
  it("⭐ açılışta geri yüklenen süzgeç debounce sonunda SİLİNMEZ (arama değişmedi → yazım yok)", async () => {
    const url = setup("/?search=PATOS");
    act(() => setSp!(new URLSearchParams("search=PATOS&filter[itemId]=i1"), { replace: true }));
    await tick(450);
    expect(url()).toBe("search=PATOS&filter[itemId]=i1");
  });

  it("yazınca arama güncellenir, URL'deki süzgeç korunur", async () => {
    const url = setup("/?filter[itemId]=i1");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "MAVI" } });
    act(() => setSp!(new URLSearchParams("filter[itemId]=i1&filter[colorId]=c1"), { replace: true }));
    await tick(450);
    expect(url()).toBe("filter[itemId]=i1&filter[colorId]=c1&search=MAVI");
  });
});
