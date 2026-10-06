// Canlı lisans yanıtının istek bağı (6.3c): yanıttaki kira, yanıtın cevapladığı isteğin nonce'una ALT imzasıyla bağlanır.
// Yalnız CANLI uçlarda (etkinleştir · yokla · donanım · DR); zarfla gelen (çevrimdışı/QR) yanıt bağsız gider — onu
// bekleyen canlı istek yoktur ve QR yükü büyümez. Eski fabrika alanı yok sayar (yanıt şeması gevşek).
import { parseJws, signResponseBinding, type HardwareReportResponse, type LicenseResponse } from "../lisans-protokol";
import { VendorError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "./context";

function payloadText(token: unknown, field: string): string | null {
  const p = parseJws(token);
  const value = p.ok ? (p.value.payload as Record<string, unknown>)[field] : undefined;
  return typeof value === "string" ? value : null;
}

/** `header`: uçta DOĞRULANMIŞ imzalı istek (çağıran yalnız işleyici başarıyla döndükten sonra çağırır). */
export async function bindLiveResponse<T extends LicenseResponse>(ctx: VendorContext, response: T, header: unknown, nowMs: number): Promise<T> {
  const nonce = payloadText(header, "nonce");
  const kurulumId = payloadText(response.kira, "kurulumId");
  if (!nonce || !kurulumId) throw new VendorError(500, "SUNUCU_HATASI", "Yanıt bağı kurulamadı (istek nonce'u ya da kira kimliği yok)");
  const inst = await prisma.kurulum.findUnique({ where: { kurulumId }, select: { sinif: true } });
  const key = inst ? ctx.keys.leaseKeyFor(inst.sinif, nowMs) : null;
  if (!key) throw new VendorError(500, "SUNUCU_HATASI", "Yanıt bağını imzalayacak geçerli alt anahtar yok");
  const yanitBagi = signResponseBinding({ lease: response.kira, nonce, nowMs, key: { kid: key.kid, privateKey: key.privateKey, certificate: key.certificate } });
  return { ...response, yanitBagi };
}

/** Donanım bildirimi: lisans yalnız `ONAYLANDI`da doludur; doluysa aynı bağ. */
export async function bindLiveHardwareResponse(ctx: VendorContext, response: HardwareReportResponse, header: unknown, nowMs: number): Promise<HardwareReportResponse> {
  return response.lisans ? { ...response, lisans: await bindLiveResponse(ctx, response.lisans, header, nowMs) } : response;
}
