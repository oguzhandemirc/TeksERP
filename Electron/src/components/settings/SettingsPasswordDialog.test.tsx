// =============================================================================
// BEKÇİ — AYAR ŞİFRESİ ARACISI + DİYALOG (403 → sor → başlıkla TEKRARLA)
// =============================================================================
// NEDEN VAR: kapı sunucudadır ama KULLANILABİLİRLİĞİ istemcidedir. Aracı
// bozulursa panel 403 yer ve kullanıcı "yetkim yok" sanır (üstelik apiClient'ın
// genel 403 toast'ı tam da bu YANLIŞ cümleyi basardı). Ölçülenler:
//   §1 Şifre tanımlı DEĞİLSE (istek 200) diyalog HİÇ açılmaz — sıfır fark.
//   §2 403 REQUIRED → diyalog açılır, girilen şifre `X-Settings-Password`
//      başlığıyla AYNI yükte tekrarlanır ve sonuç çağırana döner.
//   §3 Yanlış şifre (403 INVALID) → diyalog "hatalı" der ve TEKRAR sorar;
//      ikinci deneme geçer (döngü çalışıyor).
//   §4 Vazgeç → istek TEKRARLANMAZ ve çağıran HATA alır (sessiz başarı yalanı
//      yok — kullanıcı kaydettiğini sanmamalı).
//   §5 429 LOCKED → hiç sorulmaz (yeni deneme kilidi uzatmaktan başka işe
//      yaramaz), hata çağırana düşer.
//   §6 Yük TEKRAR HESAPLANMAZ: `run` iki kez de aynı gövdeyi alır.
//
// NEGATİF SONDA (ölçüldü, sonra geri alındı):
//   ① `withSettingsPassword`ta INVALID kodu döngüden çıkarıldı → §3 kırmızı.
//   ② İptalde hata yerine `undefined` dönüldü → §4 kırmızı.
//   ③ Başlık adı `X-Settings-Pass` yapıldı → §2 kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import {
  withSettingsPassword,
  SettingsPasswordCancelled,
  SETTINGS_PASSWORD_HEADER,
} from "@/lib/settings-password";
import { SettingsPasswordDialog } from "./SettingsPasswordDialog";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Backend `AppError` yanıtının axios kılığı (`details.code` sözleşmesi). */
function gateError(status: number, code: string) {
  return {
    isAxiosError: true,
    message: "hata",
    response: { status, data: { message: "…", details: { code } } },
  };
}

async function girVeOnayla(password: string) {
  const input = await screen.findByLabelText("Şifre");
  fireEvent.change(input, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Onayla" }));
}

beforeEach(() => {
  renderWithProviders(<SettingsPasswordDialog />);
});

describe("withSettingsPassword", () => {
  it("§1 şifre tanımlı değilse diyalog açılmaz (sıfır fark)", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withSettingsPassword(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Şifre")).toBeNull();
  });

  it("§2/§6 403 REQUIRED → diyalog → başlıkla TEKRAR (yük aynı)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(gateError(403, "SETTINGS_PASSWORD_REQUIRED"))
      .mockResolvedValueOnce("kaydedildi");

    const promise = withSettingsPassword(run);
    await girVeOnayla("gizli-sifre");

    await expect(promise).resolves.toBe("kaydedildi");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]?.[0]).toEqual({});
    expect(run.mock.calls[1]?.[0]).toEqual({ [SETTINGS_PASSWORD_HEADER]: "gizli-sifre" });
  });

  it("§3 yanlış şifre → 'hatalı' der ve TEKRAR sorar", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(gateError(403, "SETTINGS_PASSWORD_REQUIRED"))
      .mockRejectedValueOnce(gateError(403, "SETTINGS_PASSWORD_INVALID"))
      .mockResolvedValueOnce("kaydedildi");

    const promise = withSettingsPassword(run);
    await girVeOnayla("yanlis");
    await waitFor(() => expect(screen.getByText(/Ayar şifresi hatalı/i)).toBeTruthy());
    await girVeOnayla("dogru");

    await expect(promise).resolves.toBe("kaydedildi");
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2]?.[0]).toEqual({ [SETTINGS_PASSWORD_HEADER]: "dogru" });
  });

  it("§4 vazgeç → istek TEKRARLANMAZ, çağıran hata alır", async () => {
    const run = vi.fn().mockRejectedValue(gateError(403, "SETTINGS_PASSWORD_REQUIRED"));

    const promise = withSettingsPassword(run);
    await screen.findByLabelText("Şifre");
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));

    await expect(promise).rejects.toBeInstanceOf(SettingsPasswordCancelled);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("§5 429 LOCKED → hiç sorulmaz, hata çağırana düşer", async () => {
    const err = gateError(429, "SETTINGS_PASSWORD_LOCKED");
    const run = vi.fn().mockRejectedValue(err);

    await expect(withSettingsPassword(run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Şifre")).toBeNull();
  });

  it("§5b kapıyla ilgisi olmayan hata olduğu gibi düşer (kapsam DAR)", async () => {
    const err = gateError(403, "MODULE_FLAG_SUPERADMIN_ONLY");
    const run = vi.fn().mockRejectedValue(err);

    await expect(withSettingsPassword(run)).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Şifre")).toBeNull();
  });
});
