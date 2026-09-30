import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { TWO_FACTOR_HINT } from "@/lib/totp-auth";

/**
 * 2FA sekmesi — isteğe bağlı 2FA sözleşmesini söyler (kullanıcı kararı 2026-09-30):
 * açan hesaba her parolalı girişte sorulur, kapalıya sorulmaz, PIN/kart etkilenmez.
 * Eski "bugün hiçbir girişte istenmez" metni artık YANLIŞTIR ve dönmemeli.
 */
const status = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/services/adminUserService", () => ({
  adminUserService: {
    getTotpStatus: vi.fn(async () => ({
      success: true,
      data: {
        enabled: status.enabled,
        enabledAt: status.enabled ? "2026-09-30T08:00:00.000Z" : null,
        remainingRecoveryCodes: status.enabled ? 10 : 0,
      },
    })),
    openTotpWindow: vi.fn(),
    resetTotp: vi.fn(),
  },
}));

import { TwoFactorTab } from "./TwoFactorTab";

describe("TwoFactorTab — isteğe bağlı 2FA metni", () => {
  it("sözleşme metni: açılırsa her parolalı girişte, kapalıyken sorulmaz, PIN/kart etkilenmez", () => {
    expect(TWO_FACTOR_HINT).toMatch(/isteğe bağlı/);
    expect(TWO_FACTOR_HINT).toMatch(/her parolalı girişinde/);
    expect(TWO_FACTOR_HINT).toMatch(/Kapalıyken sorulmaz/);
    expect(TWO_FACTOR_HINT).toMatch(/PIN ve kart/);
  });

  it("kapalı hesap: 'Kurulu değil' + sözleşme metni, eski metin YOK", async () => {
    status.enabled = false;
    renderWithProviders(<TwoFactorTab userId="u1" username="ayse" />);
    expect(await screen.findByText("Kurulu değil")).toBeTruthy();
    expect(screen.getByText(TWO_FACTOR_HINT)).toBeTruthy();
    expect(screen.queryByText(/hiçbir girişte istenmez/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Sıfırla/ })).toBeNull();
  });

  it("açık hesap: kapatma yolu (Sıfırla) görünür", async () => {
    status.enabled = true;
    renderWithProviders(<TwoFactorTab userId="u1" username="ayse" />);
    expect(await screen.findByRole("button", { name: /Sıfırla/ })).toBeTruthy();
    expect(screen.getByText(TWO_FACTOR_HINT)).toBeTruthy();
  });
});
