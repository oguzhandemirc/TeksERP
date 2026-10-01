import { app } from "electron";
import { handleTrusted } from "../security/trusted-ipc.js";

export function registerAppInfoIpc(): void {
  handleTrusted("app:version", () => app.getVersion());
}
