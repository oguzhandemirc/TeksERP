// Takip düğmesi (N4-PANEL §6.6): durum sunucudan · "Takip et" → "Takip ediliyor" → "Takibi bırak" geçişi ·
// bayrak kapalı / eski sunucu (404) → çizilmez · "Takipten çık" yalnız TAKIPCI/OLUSTURAN ve eşlenen konuda.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { unfollowTarget } from "@/lib/bildirim/takip";

const d = vi.hoisted(() => ({ bayrak: true }));
const svc = vi.hoisted(() => ({ takip: vi.fn(), takipEt: vi.fn(), takibiBirak: vi.fn() }));
vi.mock("@/services/bildirimService", () => ({ bildirimService: svc, httpStatusOf: () => null, notificationErrorCode: () => undefined }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: d.bayrak } }, isSuccess: true }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { FollowButton } from "./FollowButton";

const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
beforeEach(() => {
  vi.clearAllMocks();
  d.bayrak = true;
});

describe("FollowButton", () => {
  it("Takip et → Takip ediliyor → Takibi bırak", async () => {
    svc.takip.mockResolvedValue({ takip: false });
    svc.takipEt.mockResolvedValue({ takip: true });
    svc.takibiBirak.mockResolvedValue({ takip: false });
    renderWithProviders(<FollowButton type="siparis" id={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: /Takip et/ }));
    await waitFor(() => expect(svc.takipEt).toHaveBeenCalledWith("siparis", ID));
    const trigger = await screen.findByRole("button", { name: /Takip ediliyor/ });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Takibi bırak" }));
    await waitFor(() => expect(svc.takibiBirak).toHaveBeenCalledWith("siparis", ID));
    expect(await screen.findByRole("button", { name: /Takip et/ })).toBeTruthy();
  });

  it("bayrak kapalı → çizilmez, uç çağrılmaz", () => {
    d.bayrak = false;
    const { container } = renderWithProviders(<FollowButton type="is-emri" id={ID} />);
    expect(container.textContent).toBe("");
    expect(svc.takip).not.toHaveBeenCalled();
  });

  it("eski sunucu (404) → çizilmez, çökmez", async () => {
    svc.takip.mockRejectedValue(new Error("404"));
    const { container } = renderWithProviders(<FollowButton type="dokuma-isi" id={ID} />);
    await waitFor(() => expect(svc.takip).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("Takipten çık hedefi: yalnız TAKIPCI/OLUSTURAN + eşlenen konu", () => {
    expect(unfollowTarget({ neden: "TAKIPCI", konu: { tip: "isemri", id: ID } })).toEqual({ type: "is-emri", id: ID });
    expect(unfollowTarget({ neden: "OLUSTURAN", konu: { tip: "order", id: ID } })).toEqual({ type: "siparis", id: ID });
    expect(unfollowTarget({ neden: "IZIN", konu: { tip: "siparis", id: ID } })).toBeNull();
    expect(unfollowTarget({ neden: "TAKIPCI", konu: { tip: "sevkiyat", id: ID } })).toBeNull();
  });
});
