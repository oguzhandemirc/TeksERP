import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⭐ WEB AÇILIŞ YOKLAMASI: webde JWT çözülmez, oturum `GET /api/auth/me` ile sorulur.
 * 401/ağ hatası · kısıtlı (zorunlu parola değişimi) oturum · masaüstü izinsiz hesap → giriş ekranı.
 */
const getMe = vi.hoisted(() => vi.fn());
vi.mock("@/services/authService", () => ({ authService: { getMe } }));

import { probeWebSession } from "./web-session";

const me = (p: Record<string, unknown> = {}) => ({
  data: { userId: "u1", username: "ayse", permissions: ["*"], isSystemAccount: false, systemAccountExists: true, ...p },
});

beforeEach(() => getMe.mockReset());

describe("probeWebSession", () => {
  it("⭐ geçerli çerez oturumu → kullanıcı /me'den kurulur", async () => {
    getMe.mockResolvedValueOnce(me());
    const s = await probeWebSession();
    expect(s?.user).toEqual({ userId: "u1", username: "ayse", permissions: ["*"] });
  });

  it("401 / ağ hatası → oturum yok (giriş ekranı)", async () => {
    getMe.mockRejectedValueOnce({ response: { status: 401 } });
    expect(await probeWebSession()).toBeNull();
  });

  it("kısıtlı oturum (mustChangePassword) uygulamaya girmez", async () => {
    getMe.mockResolvedValueOnce(me({ mustChangePassword: true }));
    expect(await probeWebSession()).toBeNull();
  });

  it("masaüstü izni olmayan hesap girmez (canEnterApp aynası)", async () => {
    getMe.mockResolvedValueOnce(me({ permissions: [] }));
    expect(await probeWebSession()).toBeNull();
  });
});
