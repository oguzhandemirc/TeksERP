// Fabrika çıkış IP'si beyanı (VDS denetimi Y3/O4): `RATE_LIMIT_FACTORY_IPS` (virgüllü; IPv6 /64'e indirilir) +
// `RATE_LIMIT_FACTORY_MULTIPLIER` (varsayılan 10). Beyanlı adres hız sınırında ve giriş kilidinin GENİŞ kovasında
// eşik × çarpan alır. Varsayılan boş = bugünkü davranış. Saf modül (ağır import yok — kilit ve sınır ortak kullanır).
import { clientIpBucket } from "../lib/client-ip-prefix";
import type { WarnFn } from "./web-hardening";

export type FactoryEgressConfig = {
  /** /64'e indirilmiş (IPv6) ya da tam (IPv4) fabrika çıkış adresleri. */
  ips: ReadonlySet<string>;
  /** Beyanlı adres için eşik çarpanı (giriş + yazma kovası, giriş kilidinin geniş kovası). */
  multiplier: number;
};

const FACTORY_MULTIPLIER_DEFAULT = 10;
const FACTORY_MULTIPLIER_MAX = 1000;

/** `RATE_LIMIT_FACTORY_IPS` (virgüllü) + `RATE_LIMIT_FACTORY_MULTIPLIER`. Bozuk adres uyarıyla atlanır. */
export function readFactoryEgressConfig(env: NodeJS.ProcessEnv, onWarn: WarnFn): FactoryEgressConfig {
  const ips = new Set<string>();
  for (const raw of (env.RATE_LIMIT_FACTORY_IPS ?? "").split(",")) {
    const v = raw.trim();
    if (!v) continue;
    if (!/^[0-9a-f:.]+$/i.test(v)) {
      onWarn(`[web-hardening] RATE_LIMIT_FACTORY_IPS içindeki "${v}" IP adresi değil — atlandı.`);
      continue;
    }
    ips.add(factoryIpKey(v));
  }
  const m = Number((env.RATE_LIMIT_FACTORY_MULTIPLIER ?? "").trim() || FACTORY_MULTIPLIER_DEFAULT);
  const multiplier = Number.isFinite(m) ? Math.min(FACTORY_MULTIPLIER_MAX, Math.max(1, Math.floor(m))) : FACTORY_MULTIPLIER_DEFAULT;
  return { ips, multiplier };
}

/** Beyanlı fabrika çıkış adresi mi (anahtar `resolveClientIp` çıktısıdır: IPv6 zaten /64). */
export function factoryMultiplierFor(ip: string | null, cfg: FactoryEgressConfig): number {
  if (!ip || cfg.ips.size === 0) return 1;
  return cfg.ips.has(factoryIpKey(ip)) ? cfg.multiplier : 1;
}

/** IPv4-eşlemli soket adresi (`::ffff:a.b.c.d`) beyandaki düz IPv4 ile eşleşsin; IPv6 /64. */
function factoryIpKey(ip: string): string {
  return clientIpBucket(ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "").toLowerCase());
}
