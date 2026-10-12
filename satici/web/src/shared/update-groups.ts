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

/** İlk kurulum arşivinin listedeki etiketi: test grubu yalnız deneme kurulumu, öteki gruplar terfiyle onaylı paket. */
export function buildGroupTag(grup: string | null): string {
  if (grup === "test") return "Test grubu · yalnız deneme kurulumu";
  if (grup !== null && UPDATE_GROUP_LABEL[grup] !== undefined) return `Onaylı · ${UPDATE_GROUP_LABEL[grup]} grubu`;
  return "Grubu belirsiz";
}

/** Müşteriye verilebilecek (terfiyle onaylanmış) paket mi: test dışı tanınan grup. */
export function isApprovedBuild(grup: string | null): boolean {
  return grup !== null && grup !== "test" && UPDATE_GROUP_LABEL[grup] !== undefined;
}
