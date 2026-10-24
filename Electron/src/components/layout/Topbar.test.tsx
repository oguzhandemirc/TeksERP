import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";

// Topbar'ın kendi yoklama/IPC yapan çocukları burada ölçülmez — yalnız Etkinlik bağlantısı.
vi.mock("@/pages/Operations/LoomAlarms/LoomAlarmBell", () => ({
  LoomAlarmBell: () => <span data-testid="loom-alarm-bell" />,
}));
vi.mock("./GuncellemeDugmesi", () => ({ GuncellemeDugmesi: () => null }));
vi.mock("./PencereKontrolleri", () => ({ PencereKontrolleri: () => null }));
vi.mock("./ChannelBadge", () => ({ ChannelBadge: () => null }));
vi.mock("./SupportSessionBadge", () => ({ SupportSessionBadge: () => null }));
vi.mock("@/components/demo/DemoModeBadge", () => ({ DemoModeBadge: () => null }));
vi.mock("./AppearanceMenu", () => ({ AppearanceMenu: () => null }));

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive }),
}));

import { Topbar } from "./Topbar";

function setPerms(permissions: string[]) {
  useAuthStore.getState().setUser({ userId: "u1", username: "eda.planlama", permissions });
}

const renderTopbar = () => renderWithProviders(<Topbar onToggleSidebar={() => {}} onOpenCommand={() => {}} />);

/** Eski "Son Aktivite" zili kalktı; yerine sayaçsız Etkinlik bağlantısı (SYSTEM_ACTIVITY_ACCESS). */
describe("Topbar · Etkinlik bağlantısı", () => {
  beforeEach(() => {
    navigateActive.mockReset();
    useAuthStore.getState().setUser(null);
  });

  it("system:activity sahibine görünür ve /system/activity'ye götürür", () => {
    setPerms(["system:activity"]);
    renderTopbar();
    const link = screen.getByRole("button", { name: "Etkinlik" });
    fireEvent.click(link);
    expect(navigateActive).toHaveBeenCalledWith("/system/activity");
  });

  it("admin:settings sahibine görünür", () => {
    setPerms(["admin:settings"]);
    renderTopbar();
    expect(screen.getByRole("button", { name: "Etkinlik" })).toBeTruthy();
  });

  it("izinsiz kullanıcıya görünmez", () => {
    setPerms(["shipping:read"]);
    renderTopbar();
    expect(screen.queryByRole("button", { name: "Etkinlik" })).toBeNull();
  });

  it("sayaç/rozet yok; eski zil yok; tezgah alarm zili yerinde", () => {
    setPerms(["*"]);
    renderTopbar();
    const link = screen.getByRole("button", { name: "Etkinlik" });
    expect(link.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Bildirimler" })).toBeNull();
    expect(screen.getByTestId("loom-alarm-bell")).toBeTruthy();
  });
});
