// Ana süreçteki connect-src kümesi — renderer yapılandırdığı sunucu adresini `connectGate:allow` ile
// bildirir; ağ kapısı (`plain-http-guard.ts`) renderer isteklerini bu kümeye göre keser.
import { CONNECT_GATE_MAX_ORIGINS, connectAllowed, connectOrigin } from "../../shared/connect-gate.js";

const allowed = new Set<string>();

/** Kökeni izinli kümeye ekler; ağ adresi değilse false. Küme dolarsa en eski köken düşer. */
export function allowConnectOrigin(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const origin = connectOrigin(url);
  if (!origin) return false;
  allowed.delete(origin);
  allowed.add(origin);
  while (allowed.size > CONNECT_GATE_MAX_ORIGINS) allowed.delete(allowed.values().next().value as string);
  return true;
}

/** İstek renderer belgesinden mi (gezinme hariç) ve izinsiz kökene mi gidiyor. */
export function connectGateCancels(details: { url: string; webContentsId?: number; resourceType?: string }): boolean {
  if (details.webContentsId === undefined || details.resourceType === "mainFrame") return false;
  return !connectAllowed(details.url, allowed);
}

/** Yalnız test: kümeyi sıfırla. */
export function resetConnectGateForTest(): void {
  allowed.clear();
}
