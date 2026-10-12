import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useServerDiscovery", () => ({ useServerDiscovery: () => ({ start: vi.fn() }) }));
vi.mock("@/components/settings/ApiEndpointDialog", () => ({ ApiEndpointDialog: () => null }));

import { ServerOutageStrip } from "./ServerOutageStrip";
import { ServerOfflineBanner } from "./ServerOfflineBanner";
import { useServerStatusStore } from "@/store/serverStatus";
import { setOutageTarget } from "@/lib/sunucu-kesintisi";

// B5 — panel şeridi: kurulumdan 5 dk önce "kaydedin" uyarısı, kesintide "yeniden bağlanıyor"; o sırada
// "Sunucuya ulaşılamıyor" (adres araması) şeridi susar, duyuru yokken eskisi gibi çıkar.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(() => {
  act(() => setOutageTarget(null));
  useServerStatusStore.setState({ status: "online" });
  vi.useRealTimers();
});

const announce = (inMs: number) => act(() => setOutageTarget({ atMs: Date.now() + inMs, ongoing: false }));

describe("ServerOutageStrip", () => {
  it("5 dk kala bütün ekranlarda uyarı; zaman ilerledikçe dakika iner", async () => {
    useServerStatusStore.setState({ status: "online" });
    render(<ServerOutageStrip />);
    expect(screen.queryByTestId("sunucu-kesinti-seridi")).toBeNull();
    announce(5 * 60_000);
    expect(screen.getByTestId("sunucu-kesinti-seridi").textContent).toBe("Sunucu 5 dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin");
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    expect(screen.getByTestId("sunucu-kesinti-seridi").textContent).toMatch(/^Sunucu 3 dk sonra/);
  });

  it("kesintide (sunucu yanıtsız) 'Sunucu güncelleniyor, yeniden bağlanıyor…'", () => {
    announce(30_000);
    act(() => useServerStatusStore.setState({ status: "offline" }));
    render(<ServerOutageStrip />);
    expect(screen.getByTestId("sunucu-kesinti-seridi").textContent).toBe("Sunucu güncelleniyor, yeniden bağlanıyor…");
  });

  it("duyuru 5 dk'dan uzaksa şerit yok", () => {
    announce(60 * 60_000);
    render(<ServerOutageStrip />);
    expect(screen.queryByTestId("sunucu-kesinti-seridi")).toBeNull();
  });
});

describe("ServerOfflineBanner — kesintide susar", () => {
  it("duyuru yokken 20 sn sonra 'Sunucuya ulaşılamıyor'", async () => {
    useServerStatusStore.setState({ status: "offline" });
    render(<ServerOfflineBanner />);
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    expect(screen.queryByText(/ulaşılamıyor/)).not.toBeNull();
  });

  it("duyurulu kesintide çevrimdışı şeridi çizilmez (kesinti şeridi anlatır)", async () => {
    announce(30_000);
    useServerStatusStore.setState({ status: "offline" });
    render(<ServerOfflineBanner />);
    await act(() => vi.advanceTimersByTimeAsync(21_000));
    expect(screen.queryByText(/ulaşılamıyor/)).toBeNull();
  });
});
