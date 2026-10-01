// =============================================================================
// YEREL SAĞLIK — güncelleyicinin sondası `GET /health/yerel` (Dağıtım v2, docs/design/GUNCELLEYICI.md §8.7)
// =============================================================================
// Güncelleyici yeni sürümü doğrularken lisansın KÖTÜLEŞMEDİĞİNİ ölçer (`lisans{kip,butunluk,cekirdek}`). Public
// `/health`in alan kümesi DONMUŞTUR (F-CORE-GUV-002 · `test_discovery_identity` §4): lisans kademesi, bütünlük ve
// çekirdek kaynağı kimliksiz bir LAN istemcisine söylenmez. Bu uç yalnız DÖNGÜ ADRESİNDEN DOĞRUDAN gelen isteğe
// cevap verir; vekil başlığı taşıyan istek yerel sayılmaz (aynı makinedeki bir ters vekil LAN isteğini döngü
// adresinden iletir). Dışarıya 404 — uç varlığı da söylenmez.
// =============================================================================
import type { IncomingHttpHeaders } from "node:http";
import { getLicenseSnapshot } from "./license/runtime";
import { getLicenseEngineStatus } from "./license/license-signals";
import { integrityStatusForState } from "./license/integrity-state";
import { getLicenseCoreStatus } from "./license/native";

/** İsteğin bir vekilden geçtiğini söyleyen başlıklar (+ kurulumun beyan ettiği `CLIENT_IP_HEADER`). */
const FORWARDING_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "via"] as const;

/** Soket döngü adresinden mi (127.0.0.0/8 · ::1 · IPv4-eşlemeli) ve vekil başlığı YOK mu. */
export function isDirectLoopback(remoteAddress: string | undefined, headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (remoteAddress ?? "").toLowerCase();
  const addr = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  const loopback = addr === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
  if (!loopback) return false;
  const declared = (env.CLIENT_IP_HEADER ?? "").trim().toLowerCase();
  const names: readonly string[] = declared ? [...FORWARDING_HEADERS, declared] : FORWARDING_HEADERS;
  return names.every((h) => headers[h] === undefined);
}

export interface LocalLicenseHealth {
  /** Uygulanan kademe (`STATE_TIERS`: NORMAL · UYARI · EK_SURE · KISITLI · DURDURULMUS). */
  readonly kip: string;
  /** Paket bütünlüğü: GECERLI · GECERSIZ · OLCULEMEDI · KAPSAM_DISI. */
  readonly butunluk: string;
  /** Lisans çekirdeği kaynağı: native · ts · yok. */
  readonly cekirdek: string;
}

/**
 * Lisans motoru YEREL ölçümünü bitirmeden (kimlik → DB olguları → parmak izi → bütünlük) null — alan yoksa
 * güncelleyici beklemeye devam eder; yarım ölçüm ("bütünlük ölçülemedi") kötüleşme sanılıp geri döndürmez.
 */
export function localLicenseHealth(): LocalLicenseHealth | null {
  if (getLicenseEngineStatus().durum !== "CALISIYOR") return null;
  try {
    return {
      kip: getLicenseSnapshot().state.uygulananKademe,
      butunluk: integrityStatusForState(),
      cekirdek: getLicenseCoreStatus().kaynak,
    };
  } catch {
    return null;
  }
}
