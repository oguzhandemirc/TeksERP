// Anlık ve rapor içeriklerinin kararlı özeti — aynı içerik ikinci kez gönderilmez.
// Anahtar sırası kurucunun yazdığı sıradır (sabit); `JSON.stringify` bu sırayı korur.
import { createHash } from "node:crypto";
import type { WireValue } from "./wire";

export function snapshotDigest(data: WireValue): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
