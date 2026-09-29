import { ipcMain, net } from "electron";
import {
  LICENSE_RELAY_MAX_RESPONSE_BYTES,
  LICENSE_RELAY_TIMEOUT_MS,
  validateRelayBody,
  validateRelayTarget,
  type LicenseRelayResult,
} from "@shared/license-relay";

// Panel aktarması: backend dışarı çıkamıyorsa imzalı isteği satıcıya taşır.
// net.fetch Chromium ağ yığınıdır — kurumsal proxy/PAC ve sistem sertifikaları
// tarayıcıdaki gibi çözülür; CORS yoktur. Girdi main'de YENİDEN doğrulanır.

async function readLimited(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > LICENSE_RELAY_MAX_RESPONSE_BYTES) return null;
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LICENSE_RELAY_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function relayLicenseRequest(target: unknown, body: unknown): Promise<LicenseRelayResult> {
  const url = validateRelayTarget(target);
  if (!url) return { ok: false, kod: "HEDEF_GECERSIZ" };
  const payload = validateRelayBody(body);
  if (!payload) return { ok: false, kod: "GOVDE_GECERSIZ" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LICENSE_RELAY_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // Satıcı yönlendirmesi başka bir hedefe taşımasın.
      redirect: "error",
    });
    const text = await readLimited(res);
    if (text === null) return { ok: false, kod: "YANIT_BUYUK", status: res.status };
    try {
      return { ok: true, status: res.status, yanit: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, kod: "YANIT_JSON_DEGIL", status: res.status };
    }
  } catch {
    return { ok: false, kod: controller.signal.aborted ? "ZAMAN_ASIMI" : "AG_HATASI" };
  } finally {
    clearTimeout(timer);
  }
}

export function registerLicenseIpc(): void {
  ipcMain.handle("license:relay", (_e, req: { hedefUrl?: unknown; istekGovdesi?: unknown } | undefined) =>
    relayLicenseRequest(req?.hedefUrl, req?.istekGovdesi),
  );
}
