// DİNLEYİCİ SOKETİ — isteğin hangi dinleyiciye geldiği yalnız soketten okunur (istemci seçemez, başlıkla etkileyemez).
// Okuyucular: ERİŞİM kapısı (access-app.ts `requireOwnListener`) ve iç API'nin varsayılan kaynak ağı (internal-app.ts).
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import { stripMapped } from "./client-address";

/** Geri döngü ağları — iç API'nin kaynak ağı verilmediğinde tek kabul edilen kaynak. */
export const LOOPBACK_NETWORKS = ["127.0.0.0/8", "::1/128"] as const;

/** İstek bu dinleyicinin SOKETİNE mi geldi; dinleyici henüz yoksa (null) ya da Unix soketiyse hayır. */
export function arrivedOn(req: Pick<Request, "socket">, bound: AddressInfo | string | null): boolean {
  return bound !== null && typeof bound === "object" && req.socket.localPort === bound.port && stripMapped(req.socket.localAddress) === stripMapped(bound.address);
}
