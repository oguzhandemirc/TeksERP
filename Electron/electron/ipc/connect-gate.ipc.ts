import { handleTrusted } from "../security/trusted-ipc.js";
import { allowConnectOrigin } from "../security/connect-gate.js";

/** Renderer yapılandırdığı sunucu adresini bildirir (connect-src kümesi). */
export function registerConnectGateIpc(): void {
  handleTrusted("connectGate:allow", (_event, url: unknown) => allowConnectOrigin(url));
}
