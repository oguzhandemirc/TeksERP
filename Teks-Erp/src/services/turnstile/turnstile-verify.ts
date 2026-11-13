// Cloudflare Turnstile belirteci doğrulaması (V1c). Dış istek ortak `http-egress` boğazından (kurumsal
// proxy tek yerden; yeni paket yok). Üç sonuç: OK · REJECTED (belirteç geçersiz) · UNAVAILABLE (ulaşılamadı).
// Bekçiler ağa çıkmaz: `setTurnstileVerifierForTests` sahte doğrulayıcı enjekte eder.
import { egressRequest } from "../../lib/http-egress";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileVerdict = "OK" | "REJECTED" | "UNAVAILABLE";
export type TurnstileVerifier = (input: { secret: string; token: string; remoteIp: string | null }) => Promise<TurnstileVerdict>;

const cloudflareVerifier: TurnstileVerifier = async ({ secret, token, remoteIp }) => {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  try {
    const res = await egressRequest(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      timeoutMs: VERIFY_TIMEOUT_MS,
      maxBytes: 64 * 1024,
    });
    if (res.status >= 500 || res.status === 429) return "UNAVAILABLE";
    const body = JSON.parse(res.body.toString("utf8")) as { success?: unknown };
    return body.success === true ? "OK" : "REJECTED";
  } catch {
    // Ağ / zaman aşımı / bozuk yanıt: belirteç hakkında bilgi yok → çağıran FAIL-CLOSED reddeder.
    return "UNAVAILABLE";
  }
};

let verifier: TurnstileVerifier = cloudflareVerifier;

export function verifyTurnstileToken(input: { secret: string; token: string; remoteIp: string | null }): Promise<TurnstileVerdict> {
  return verifier(input);
}

/** Yalnız bekçiler: null → gerçek Cloudflare doğrulayıcısına dön. */
export function setTurnstileVerifierForTests(fake: TurnstileVerifier | null): void {
  verifier = fake ?? cloudflareVerifier;
}
