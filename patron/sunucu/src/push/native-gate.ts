// TELEFON PUSH KAPILARI — iki ayrı yüklem (kullanıcı kararı 2026-11-13 "önce ayır, sonra aç"):
//   · bulut kipi (`notification-scheduler.ts`, bulut hesaplı patron): `gercek` kip + `acik` + belirteç — bulut bildirim işine bağlı.
//   · push köprüsü (`services/push-bridge.ts`, ERP kipi): `acik` + belirteç, `BILDIRIM_KIPI`den BAĞIMSIZ; köprüyü açmak
//     bütün tesislerde bulut bildirim işini/web push'u açmaz. Bulut kapısı açıkken köprü kapısı da açıktır (alt küme).
import type { CloudConfig } from "../config";

type GateConfig = Pick<CloudConfig, "BILDIRIM_KIPI" | "BILDIRIM_NATIVE_PUSH" | "EXPO_ERISIM_BELIRTECI">;

/** Bulut kipi telefon push kapısı: istenmiş ∧ gerçek kip ∧ Expo erişim belirteci (enhanced push security) var. Eksikse
 *  fail-closed KAPALI + neden (sırrın kendisi değil, yalnız adı günlüğe). */
export function nativePushState(config: GateConfig): { acik: boolean; neden: string | null } {
  if (config.BILDIRIM_NATIVE_PUSH !== "acik") return { acik: false, neden: null };
  if (config.BILDIRIM_KIPI !== "gercek") return { acik: false, neden: "BILDIRIM_KIPI gercek degil" };
  if (!config.EXPO_ERISIM_BELIRTECI) return { acik: false, neden: "EXPO_ERISIM_BELIRTECI yok" };
  return { acik: true, neden: null };
}

/** `BILDIRIM_KIPI=kapali` + `acik` + belirteç: yalnız köprü gerçek gönderir; bulut bildirim işi ve web push kapalı kalır. */
export const BRIDGE_ONLY = "yalniz-kopru";

export interface BridgeGate {
  /** `sahte` = kayıtlı sahte gönderici (kip `sahte`; bekçi/duman) · `gercek` = Expo · `kapali` = gönderim yok. */
  readonly kip: "kapali" | "sahte" | "gercek";
  readonly neden: string | null;
  readonly birlesim: typeof BRIDGE_ONLY | null;
}

/** Push köprüsü kapısı: `sahte` kip → sahte (bugünkü davranış); aksi hâlde `acik` + belirteç → gerçek, eksikse kapalı. */
export function bridgeGateState(config: GateConfig): BridgeGate {
  if (config.BILDIRIM_KIPI === "sahte") return { kip: "sahte", neden: null, birlesim: null };
  if (config.BILDIRIM_NATIVE_PUSH !== "acik") return { kip: "kapali", neden: null, birlesim: null };
  if (!config.EXPO_ERISIM_BELIRTECI) return { kip: "kapali", neden: "EXPO_ERISIM_BELIRTECI yok", birlesim: null };
  return { kip: "gercek", neden: null, birlesim: config.BILDIRIM_KIPI === "kapali" ? BRIDGE_ONLY : null };
}

/** Açılış günlüğünün TEK köprü satırı (sır değeri yok; yalnız kip, birleşim adı ve eksik ayarın adı). */
export function bridgeGateSummary(config: GateConfig): string {
  const g = bridgeGateState(config);
  return `PATRON_KOPRU gonderim=${g.kip} kip=${config.BILDIRIM_KIPI}${g.birlesim ? ` birlesim=${g.birlesim}` : ""}${g.neden ? ` (${g.neden})` : ""}`;
}
