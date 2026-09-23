// BEKÇİ — eylem kapsamının kenar durumu (2026-09-23): kapsamdaki şifreyle giden İLK deneme 403 INVALID
// alırsa (şifre eylem ortasında değişmiş gibi) akış HATA FIRLATMAZ, "şifre hatalı" diye YENİDEN SORAR;
// yeni kabul edilen şifre kapsama yazılır. Kapsamsız davranış ayrıca ölçülür (ilk deneme başlıksız).
// Negatif sonda: kapsamlı ilk denemenin INVALID'i doğrudan fırlatıldı → ⭐ ×.
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { createSettingsPasswordScope, registerSettingsPasswordAsker, SETTINGS_PASSWORD_HEADER, withSettingsPassword } from "./settings-password";

function hata(code: string): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError("403", "ERR_BAD_REQUEST", { headers }, null, {
    status: 403, statusText: "Forbidden", headers: {}, config: { headers }, data: { success: false, message: code, details: { code } },
  });
}

describe("withSettingsPassword — eylem kapsamı", () => {
  it("⭐ kapsamdaki şifre INVALID → yeniden SORULUR ('hatalı' işaretiyle), yeni şifre kapsama yazılır", async () => {
    const sorucu = vi.fn(async () => "yeni");
    registerSettingsPasswordAsker(sorucu);
    const scope = createSettingsPasswordScope();
    scope.password = "eski";
    const giden: Array<string | undefined> = [];
    const sonuc = await withSettingsPassword(async (h) => {
      giden.push(h[SETTINGS_PASSWORD_HEADER]);
      if (h[SETTINGS_PASSWORD_HEADER] !== "yeni") throw hata("SETTINGS_PASSWORD_INVALID");
      return "ok";
    }, scope);
    expect(sonuc).toBe("ok");
    expect(giden).toEqual(["eski", "yeni"]);
    expect(sorucu).toHaveBeenCalledTimes(1);
    expect(sorucu).toHaveBeenCalledWith({ invalid: true });
    expect(scope.password).toBe("yeni");
  });
  it("kapsamsız çağrı ilk denemede başlık göndermez (bugünkü davranış)", async () => {
    registerSettingsPasswordAsker(vi.fn(async () => "x"));
    const giden: Array<Record<string, string>> = [];
    await withSettingsPassword(async (h) => { giden.push(h); return 1; });
    expect(giden).toEqual([{}]);
  });
});
