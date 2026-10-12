import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionSettingsReadOnly } from "./SessionSettingsReadOnly";
import { SHORT_CREDENTIAL_TOTP_DESC } from "./session-settings-text";

const base = {
  sessionMinutes: 480,
  idleMinutes: 0,
  autoLogout: true,
  policy: "kick" as const,
  workIdleMinutes: 0,
  mobileLock: true,
  mobileLockMinutes: 5,
  mobileLockBg: true,
  methods: { enabled: ["list" as const], primary: "list" as const },
  absoluteCapDays: 30,
  pinLockoutEnabled: true,
  pinLockoutAttempts: 5,
  pinLockoutPenaltySec: 60,
  pinLockoutEscalateAfter: 3,
  pinLockoutLongPenaltyMin: 15,
};

// Y-02: PIN/kart ikinci faktör ayarı salt-okunur özette görünür; süperadmin istisnası metinde.
describe("SessionSettingsReadOnly — PIN/kart doğrulama kodu", () => {
  it("kapalı (varsayılan; eski backend alanı göndermez)", () => {
    render(<SessionSettingsReadOnly {...base} />);
    expect(screen.getByText("Kapalı (süperadminde her zaman)")).toBeTruthy();
  });
  it("açık", () => {
    render(<SessionSettingsReadOnly {...base} shortCredentialTotpRequired />);
    expect(screen.getByText("Açık (2FA'lı hesaplarda)")).toBeTruthy();
  });
  it("açıklama süperadmin istisnasını ve eski tableti söyler", () => {
    expect(SHORT_CREDENTIAL_TOTP_DESC).toMatch(/Süperadmin/);
    expect(SHORT_CREDENTIAL_TOTP_DESC).toMatch(/Eski tablet/);
  });
});
