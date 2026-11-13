// Web çerez kipi girişinin bot kapısı (V1c). TEK karar noktası: üç giriş ucu (parola · kart · PIN)
// route katmanında `turnstileLoginGate`ten geçer. Çerez almayan giriş (Electron/tablet/patron Bearer)
// kapsam dışı: onları hız sınırı + giriş kilidi + barındırılan cihaz kuralları korur.
import { AppError } from "../../utils/app-error";
import { cookieLoginApplies } from "../../lib/web-session-cookie";
import { readTurnstileConfig, readTurnstileSecret } from "./turnstile-config";
import { verifyTurnstileToken } from "./turnstile-verify";

const MAX_TOKEN_LENGTH = 2048;

export async function assertTurnstileForLogin(clientType: unknown, token: unknown, remoteIp: string | null): Promise<void> {
  if (!cookieLoginApplies(typeof clientType === "string" ? clientType : undefined)) return;
  const cfg = await readTurnstileConfig();
  if (!cfg.enabled) return;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw AppError.forbidden("Robot doğrulaması tamamlanmadı. Kutucuğu bekleyip yeniden deneyin.", { code: "TURNSTILE_FAILED" });
  }
  const secret = readTurnstileSecret();
  // FAIL-CLOSED: açık ama gizli anahtar ortamdan kalkmışsa ya da Cloudflare'e ulaşılamıyorsa giriş yok.
  const verdict = secret ? await verifyTurnstileToken({ secret, token, remoteIp }) : "UNAVAILABLE";
  if (verdict === "OK") return;
  if (verdict === "REJECTED") {
    throw AppError.forbidden("Robot doğrulaması geçmedi. Sayfayı yenileyip yeniden deneyin.", { code: "TURNSTILE_FAILED" });
  }
  throw new AppError("Robot doğrulaması şu an yapılamıyor. Biraz sonra yeniden deneyin.", 503, true, { code: "TURNSTILE_UNAVAILABLE" });
}
