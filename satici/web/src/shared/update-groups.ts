// Güncelleme grubu = satıcının `kanal` satırı (test · oncu · genel). Sunucu `services/channel.service.ts`
// `UPDATE_GROUPS` ve `defaultGroupFor` aynası; karar sunucuda, ayna bekçisi `src/test/mirrors.test.ts`.
import type { Channel } from "./types";

/** Terfi sırasıyla grupların ekran adları (anahtar sırası = sunucu UPDATE_GROUPS sırası). */
export const UPDATE_GROUP_LABEL: Record<string, string> = { test: "Test", oncu: "Öncü", genel: "Genel" };

/** Grup verilmeden açılan kurulumun grubu (K-3): TEST sınıfı → test, diğerleri → genel. */
export function defaultGroupFor(licenseClass: string): string {
  return licenseClass === "TEST" ? "test" : "genel";
}

export function groupName(code: string): string {
  return UPDATE_GROUP_LABEL[code] ? `${UPDATE_GROUP_LABEL[code]} (${code})` : code;
}

/** Kurulumun seçebileceği gruplar: aktif güncelleme grubu satırları (sunucu sırasıyla). */
export function selectableGroups(channels: readonly Channel[]): string[] {
  return channels.filter((c) => c.aktif && UPDATE_GROUP_LABEL[c.kod] !== undefined).map((c) => c.kod);
}
