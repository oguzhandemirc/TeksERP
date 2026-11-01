import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TrustedDevicesCard } from "./TrustedDevicesCard";
import type { TrustedDeviceList, TrustedDeviceView } from "@/services/authService";

// Sonda (2026-11-01): DeviceList'te `d.state === "GECERLI"` koşulu kaldırılınca "iptal edilmiş cihazda
// kaldır düğmesi yok" kırmızı; onConfirm'de `one.mutate(target.id)` yerine `all.mutate()` → "tek iptal" kırmızı.

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const dev = (over: Partial<TrustedDeviceView>): TrustedDeviceView => ({
  id: "d1", label: "Chrome · Windows", firstIp: "10.0.0.5", createdAt: "2026-11-01T08:00:00Z",
  lastUsedAt: "2026-11-01T09:00:00Z", expiresAt: "2026-12-01T08:00:00Z", revokedAt: null, revokeReason: null,
  state: "GECERLI", ...over,
});
const list = (data: TrustedDeviceList) => () => Promise.resolve({ data });

describe("Hatırlanan cihazlar kartı", () => {
  it("liste: etiket + durum; yalnız geçerli cihazda kaldır düğmesi", async () => {
    wrap(
      <TrustedDevicesCard
        scopeKey="t1"
        load={list({ days: 30, devices: [dev({}), dev({ id: "d2", label: "Firefox · Linux", state: "IPTAL" })] })}
        revoke={vi.fn()}
        revokeAll={vi.fn()}
      />,
    );
    expect(await screen.findByText("Chrome · Windows")).toBeTruthy();
    expect(screen.getByText("Firefox · Linux")).toBeTruthy();
    expect(screen.getByLabelText("Chrome · Windows cihazını kaldır")).toBeTruthy();
    expect(screen.queryByLabelText("Firefox · Linux cihazını kaldır")).toBeNull();
    expect(screen.getByText(/Süre: 30 gün/)).toBeTruthy();
  });

  it("tek iptal: onayda revoke(cihaz id) çağrılır, revokeAll çağrılmaz", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const revokeAll = vi.fn().mockResolvedValue(undefined);
    wrap(<TrustedDevicesCard scopeKey="t2" load={list({ days: 30, devices: [dev({})] })} revoke={revoke} revokeAll={revokeAll} />);
    fireEvent.click(await screen.findByLabelText("Chrome · Windows cihazını kaldır"));
    fireEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("d1"));
    expect(revokeAll).not.toHaveBeenCalled();
  });

  it("hepsini kaldır: revokeAll çağrılır", async () => {
    const revokeAll = vi.fn().mockResolvedValue(undefined);
    wrap(<TrustedDevicesCard scopeKey="t3" load={list({ days: 30, devices: [dev({})] })} revoke={vi.fn()} revokeAll={revokeAll} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hepsini kaldır" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(revokeAll).toHaveBeenCalledTimes(1));
  });

  it("ayar kapalı + kayıt yok → kart çizilmez", async () => {
    const load = vi.fn(list({ days: 0, devices: [] }));
    const { container } = wrap(<TrustedDevicesCard scopeKey="t4" load={load} revoke={vi.fn()} revokeAll={vi.fn()} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="hatirlanan-cihazlar-karti"]')).toBeNull();
  });
});
