// Sunucunun keşifte görünen adı. Docker'da makine adı konteyner kimliğidir ve her yeniden yaratılışta
// değişir; kurulumda verilen kalıcı ad (TEKSERP_SUNUCU_ADI) varsa o, yoksa bugünkü gibi makine adı.
// Yalnız GÖRÜNTÜ alanıdır: istemciler sunucuyu kurulum kimliğiyle (installationId) tanır.

import os from "os";

export const SERVER_NAME_ENV = "TEKSERP_SUNUCU_ADI";

/** mDNS TXT bütçesi ve DNS etiket sınırı. */
export const SERVER_NAME_MAX = 63;

const SERVER_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

/** Geçerli ad ya da null (boş, uzun, denetim karakterli ya da izinsiz işaretli değer). */
export function parseServerName(raw: string | undefined): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "" || v.length > SERVER_NAME_MAX || !SERVER_NAME_RE.test(v)) return null;
  return v;
}

export function resolveServerName(env: NodeJS.ProcessEnv = process.env, hostname: () => string = os.hostname): string {
  return parseServerName(env[SERVER_NAME_ENV]) ?? hostname();
}
