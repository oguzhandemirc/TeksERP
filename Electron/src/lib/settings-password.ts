// =============================================================================
// AYAR ŞİFRESİ ARACISI — `withSettingsPassword`
// =============================================================================
// Backend (P3): BEŞ yazma yüzeyi (`PATCH /api/feature-flags`,
// `PUT /api/feature-flags/documents-logo`, `PUT /api/admin/settings/:key`,
// `PATCH /api/admin/backups/offsite`, `POST /api/admin/backups/offsite/authorize`)
// ⚠️ KAPSAMIN YÜKLEMİ EKRAN DEĞİL YAZMA: "bu uç `system_settings`e (ya da
// yedek hedefi gibi eşdeğer bir yapılandırmaya) yazıyor mu". Bu yüzden liste
// elle sayılmaz — backend'de `src/routes/**` üzerinde AST tripwire var
// (`test_settings_password §J`). Yeni bir yazıcı uç doğduğunda İSTEMCİ ayağı
// da bu sarmalayıcıdan geçmeli, yoksa kullanıcı 403 alır ve diyalog açılmaz.
// ayar şifresi tanımlıysa `X-Settings-Password` başlığı ister. Kapı bir YETKİ
// değil NİYET kapısıdır: açık kalmış bir admin oturumundan bayrak çevrilmesin.
//
// SÖZLEŞME — istek ÖNCE şifresiz gider:
//   ① `run({})` → 200 ise iş bitti (şifre TANIMLI DEĞİLSE hiç sorulmaz; sıfır
//      fark kuralının istemci ayağı — panel "gerekli mi" diye ayrıca yoklamaz,
//      sunucunun cevabına bakar).
//   ② 403 `SETTINGS_PASSWORD_REQUIRED` / `SETTINGS_PASSWORD_INVALID` →
//      diyalog açılır, alınan şifreyle AYNI istek TEKRARLANIR.
//   ③ Yanlış şifrede döngü sürer (diyalog "şifre hatalı" der); iptalde istek
//      TEKRARLANMAZ ve hata olarak düşer.
//   ④ 429 `SETTINGS_PASSWORD_LOCKED` → toast (kalan süre backend cümlesinde)
//      ve döngü BİTER: yeni deneme kilidi uzatmaktan başka bir şey yapmaz.
//
// ⚠️ ŞİFRE OTURUMDA HATIRLANMAZ (tasarım §7.2 literal: "her değişiklikte").
// Bir kez sorup saklamak, korumanın tam olarak engellemek istediği şeyi —
// başıboş kalmış açık oturumu — geri getirirdi. Bu yüzden burada cache YOK.
//
// ⚠️ ŞİFRE HİÇBİR YERE YAZILMAZ: state'te yalnız diyalog açıkken yaşar, log/
// toast/telemetriye girmez, `localStorage`a KONMAZ.
// =============================================================================

import axios from "axios";
import { toast } from "sonner";

/** Backend'in beklediği başlık (middleware: `x-settings-password`). */
export const SETTINGS_PASSWORD_HEADER = "X-Settings-Password";

/** Kapının üç hata kodu — tek kaynak (apiClient toast'ı da bunlara bakar). */
export const SETTINGS_PASSWORD_CODES = {
  REQUIRED: "SETTINGS_PASSWORD_REQUIRED",
  INVALID: "SETTINGS_PASSWORD_INVALID",
  LOCKED: "SETTINGS_PASSWORD_LOCKED",
} as const;

/** Yanıt gövdesindeki `details.code` (backend `AppError` sözleşmesi). */
export function settingsPasswordErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const body = error.response?.data as { details?: { code?: unknown } } | undefined;
  const code = body?.details?.code;
  return typeof code === "string" && code.startsWith("SETTINGS_PASSWORD") ? code : null;
}

/** Backend'in kendi cümlesi (kalan süre orada yazar) — yoksa yedek. */
function serverMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { message?: unknown } | undefined;
    if (typeof body?.message === "string" && body.message) return body.message;
  }
  return fallback;
}

/**
 * Diyaloğun kaydettiği sorucu. `null` = kullanıcı vazgeçti.
 * App düzeyinde TEK bir diyalog mount edilir (`SettingsPasswordDialog`) —
 * her yazma yüzeyinin kendi diyaloğu olsaydı iki tanesi aynı anda açılabilirdi.
 */
export type SettingsPasswordAsker = (opts: { invalid: boolean }) => Promise<string | null>;

let asker: SettingsPasswordAsker | null = null;

/** Diyalog mount olurken kendini kaydeder; unmount'ta `null` geçer. */
export function registerSettingsPasswordAsker(fn: SettingsPasswordAsker | null): void {
  asker = fn;
}

/** İptal — çağıran "hata" olarak görür (sessiz başarı YALANI üretilmez). */
export class SettingsPasswordCancelled extends Error {
  constructor() {
    super("Ayar şifresi girilmedi — değişiklik kaydedilmedi.");
    this.name = "SettingsPasswordCancelled";
  }
}

/**
 * TEK KULLANICI EYLEMİNİN kapsamı — bir "Kaydet" birden çok kapılı istek atıyorsa şifre en fazla
 * BİR KEZ sorulur. Kapsam yalnız o eylemin kapanışında (bellekte) yaşar ve eylem bitince atılır;
 * oturuma, modüle ya da depolamaya YAZILMAZ (§7.2 "hatırlanmaz" kararı eylemler ARASINDA geçerli).
 */
export interface SettingsPasswordScope {
  password: string | null;
}
export const createSettingsPasswordScope = (): SettingsPasswordScope => ({ password: null });

/**
 * İsteği ayar şifresi kapısından geçirerek koştur.
 *
 * @param run Başlıkları alan ve isteği ATAN fonksiyon. ⚠️ Aynı yükle TEKRAR
 *   çağrılabilir olmalı — yükü içeride yeniden HESAPLAMA (form yeniden
 *   okunursa kullanıcı arada bir şey değiştirmişse başka veri yazılır).
 * @param scope Aynı eylemin önceki isteğinde kabul edilen şifre varsa ilk deneme onunla gider;
 *   sorulup KABUL EDİLEN şifre kapsama yazılır.
 */
export async function withSettingsPassword<T>(
  run: (headers: Record<string, string>) => Promise<T>,
  scope?: SettingsPasswordScope,
): Promise<T> {
  try {
    return await run(scope?.password ? { [SETTINGS_PASSWORD_HEADER]: scope.password } : {});
  } catch (error) {
    const code = settingsPasswordErrorCode(error);
    if (code === SETTINGS_PASSWORD_CODES.LOCKED) {
      toast.error(serverMessage(error, "Çok fazla hatalı ayar şifresi denemesi."));
      throw error;
    }
    if (code !== SETTINGS_PASSWORD_CODES.REQUIRED && code !== SETTINGS_PASSWORD_CODES.INVALID) {
      throw error;
    }

    let invalid = code === SETTINGS_PASSWORD_CODES.INVALID;
    // Sonsuz döngü değil: her tur ya kullanıcı girdisiyle ya iptalle ilerler.
    for (;;) {
      if (!asker) {
        // Diyalog mount edilmemişse (teorik) sessiz başarı yerine gürültülü hata.
        throw error;
      }
      const password = await asker({ invalid });
      if (password === null) {
        toast.error("Ayar şifresi girilmedi — değişiklik kaydedilmedi.");
        throw new SettingsPasswordCancelled();
      }
      try {
        const result = await run({ [SETTINGS_PASSWORD_HEADER]: password });
        if (scope) scope.password = password;
        return result;
      } catch (retryError) {
        const retryCode = settingsPasswordErrorCode(retryError);
        if (retryCode === SETTINGS_PASSWORD_CODES.INVALID) {
          invalid = true;
          continue;
        }
        if (retryCode === SETTINGS_PASSWORD_CODES.LOCKED) {
          toast.error(serverMessage(retryError, "Çok fazla hatalı ayar şifresi denemesi."));
        }
        throw retryError;
      }
    }
  }
}
