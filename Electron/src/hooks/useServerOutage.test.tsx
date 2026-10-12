import { afterEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

const summary = vi.fn();
vi.mock("@/services/serverUpdateService", () => ({ serverUpdateService: { summary: () => summary(), status: vi.fn() } }));

import { renderWithProviders } from "@/test/render";
import { useOutagePolling } from "./useServerOutage";
import { getOutageTarget, setOutageTarget } from "@/lib/sunucu-kesintisi";

// Oturumdaki her ekran `/ozet`ten planlı kesintiyi okur ve ortak hedefe yazar (şerit + bekletme onu okur).
function Probe({ enabled }: { enabled: boolean }) {
  useOutagePolling(enabled);
  return null;
}
const ozet = (kesinti: unknown) => ({ kuruluSurum: "2.15.5", donuk: false, guncelleyici: { durum: "CALISIYOR" }, bekleyen: null, karar: null, yerel: null, son: null, kesinti });

afterEach(() => act(() => setOutageTarget(null)));

describe("useOutagePolling", () => {
  it("/ozet'teki kalanSn yanıtın alındığı ana eklenir (yerel saat); kesinti yoksa ya da eski backend → hedef yok", async () => {
    summary.mockResolvedValueOnce(ozet({ planlanan: "2030-01-01T00:00:00.000Z", kalanSn: 240, suruyor: false }));
    const before = Date.now();
    const { unmount } = renderWithProviders(<Probe enabled />);
    await waitFor(() => expect(getOutageTarget()).not.toBeNull());
    const t = getOutageTarget()!;
    expect(t.ongoing).toBe(false);
    expect(t.atMs - 240_000).toBeGreaterThanOrEqual(before);
    expect(t.atMs - 240_000).toBeLessThanOrEqual(Date.now());
    unmount();
    summary.mockResolvedValueOnce(ozet(undefined));
    renderWithProviders(<Probe enabled />);
    await waitFor(() => expect(getOutageTarget()).toBeNull());
  });

  it("oturum yoksa (enabled=false) istek atılmaz, hedef temizlenir", async () => {
    act(() => setOutageTarget({ atMs: Date.now(), ongoing: true }));
    summary.mockClear();
    renderWithProviders(<Probe enabled={false} />);
    await waitFor(() => expect(getOutageTarget()).toBeNull());
    expect(summary).not.toHaveBeenCalled();
  });
});
