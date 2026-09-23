// =============================================================================
// BEKÇİ — YAPILANDIRMA PAKETİ İÇE AKTARIMI AYAR ŞİFRESİ KAPISINDAN GEÇER
// =============================================================================
// NEDEN VAR (ölçüldü 2026-09-23, D6): `/api/config-bundle/apply` numara serisi
// taşıyan pakette ayar şifresi istemeye başladı. Panel servisi sarmalayıcıyı
// KULLANMIYORDU ve sonuç sessiz bir düşüştü — `apiClient`, `SETTINGS_PASSWORD*`
// kodlarında genel 403 toast'ını BİLEREK bastırıyor ("diyalog zaten açılacak"
// varsayımıyla), ama diyalog hiç açılmıyordu. Ne toast, ne pencere, ne açıklama.
//
// ⚠️ SARMALAYICININ KENDİSİ AYRI BİR BEKÇİDE ölçülüyor
// (`SettingsPasswordDialog.test.tsx` §1–§6: sor · tekrarla · yanlış şifre ·
// iptal · kilit · yükü yeniden hesaplama). BURADA ölçülen tek şey BAĞLANTIDIR:
// bu uç o sarmalayıcıdan GEÇİYOR MU. İki soru ayrı; biri ötekinin yerine geçmez.
//
// NEGATİF SONDA: `apply`den `withSettingsPassword` kaldırıldı → §2 kırmızı
// (ikinci istek hiç yapılmıyor, çağıran 403 ile düşüyor).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SettingsPasswordDialog } from "@/components/settings/SettingsPasswordDialog";
import { SETTINGS_PASSWORD_HEADER } from "@/lib/settings-password";
import { configBundleService, type BundleEnvelope } from "./configBundleService";
import apiClient from "./apiClient";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./apiClient", () => ({ default: { post: vi.fn(), get: vi.fn() } }));

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;

/** Backend `AppError` yanıtının axios kılığı (`details.code` sözleşmesi). */
function gateError(status: number, code: string) {
  return {
    isAxiosError: true,
    message: "hata",
    response: { status, data: { message: "…", details: { code } } },
  };
}

const ZARF: BundleEnvelope = {
  schemaVersion: 1,
  app: "TeksERP",
  exportedAt: "2026-09-23T00:00:00.000Z",
  items: [{ kind: "NUMBER_SERIES", key: "sack", payload: { prefix: "CV" } }],
};

beforeEach(() => {
  post.mockReset();
  renderWithProviders(<SettingsPasswordDialog />);
});

describe("configBundleService.apply — ayar şifresi bağlantısı", () => {
  it("§1 şifre istenmiyorsa diyalog AÇILMAZ ve tek istek gider (sıfır fark)", async () => {
    post.mockResolvedValue({ data: { success: true, data: { rows: [] } } });
    await configBundleService.apply(ZARF, "overwrite");
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Şifre")).toBeNull();
  });

  it("§2 ⭐ 403 REQUIRED → diyalog açılır ve AYNI yük başlıkla TEKRARLANIR", async () => {
    post
      .mockRejectedValueOnce(gateError(403, "SETTINGS_PASSWORD_REQUIRED"))
      .mockResolvedValueOnce({ data: { success: true, data: { rows: [], applied: 1 } } });

    const sonuc = configBundleService.apply(ZARF, "overwrite");

    const input = await screen.findByLabelText("Şifre");
    fireEvent.change(input, { target: { value: "gizli" } });
    fireEvent.click(screen.getByRole("button", { name: "Onayla" }));

    await expect(sonuc).resolves.toMatchObject({ data: { applied: 1 } });
    expect(post).toHaveBeenCalledTimes(2);
    // ⚠️ YÜK YENİDEN HESAPLANMAZ: ikinci istek birinciyle AYNI gövdeyi taşır.
    expect(post.mock.calls[1]?.[1]).toEqual(post.mock.calls[0]?.[1]);
    expect(post.mock.calls[1]?.[2]?.headers?.[SETTINGS_PASSWORD_HEADER]).toBe("gizli");
  });
});
