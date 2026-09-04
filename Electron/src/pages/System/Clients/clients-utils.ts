/**
 * Bağlı İstemciler ekranının saf yardımcıları (React'ten bağımsız, birim test
 * edilir). Ekranın metinleri buradan üretilir ki "ne ölçtüğü" ile "ne yazdığı"
 * ayrışmasın.
 */
import { compareVersions } from "@/lib/version-compare";

export const KIND_LABELS: Record<string, string> = {
  electron: "Masaüstü panel",
  mobil: "Tablet",
  web: "Tarayıcı",
};

/** Tanınmayan/bildirilmeyen tür — uydurulmaz, olduğu gibi söylenir. */
export function kindLabel(kind: string | null): string {
  if (!kind) return "Bilinmiyor";
  return KIND_LABELS[kind] ?? kind;
}

/**
 * Eşik cümlesi — TEK KAYNAK SUNUCU (`activeWindowMs`). Ekran kendi sayısını
 * yazmaz; ölçtüğünden farklı bir eşik iddia eden bir rozet, olmayan bir
 * rozetten kötüdür.
 */
export function activeWindowLabel(ms: number): string {
  const dk = Math.round(ms / 60_000);
  if (dk >= 1) return `${dk} dakika`;
  return `${Math.max(1, Math.round(ms / 1000))} saniye`;
}

/**
 * "Güncel değil" işareti — YALNIZ ikisi de bilinirken ve sürüm GERİDEYKEN.
 *
 * ⚠️ İleride olan sürüm (test makinesi, henüz yayınlanmamış paket) "geride"
 * DEĞİLDİR; onu kırmızı basmak fabrikada anlamsız bir alarm üretirdi.
 */
export function isOutdated(
  version: string | null,
  expected: string | null,
): boolean {
  if (!version || !expected) return false;
  return compareVersions(version, expected) < 0;
}

/** "3 dk önce" / "2 sa 5 dk önce" — sunucu saatine göre (istemci saati sapabilir). */
export function agoLabel(lastSeenIso: string, nowIso: string): string {
  const diff = new Date(nowIso).getTime() - new Date(lastSeenIso).getTime();
  if (!Number.isFinite(diff)) return "—";
  if (diff < 60_000) return "az önce";
  const dk = Math.floor(diff / 60_000);
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.floor(dk / 60);
  const kalan = dk % 60;
  if (sa < 24) return kalan === 0 ? `${sa} sa önce` : `${sa} sa ${kalan} dk önce`;
  return `${Math.floor(sa / 24)} gün önce`;
}

/**
 * Satır başlığı: yöneticinin verdiği cihaz adı > kısa kurulum kimliği.
 *
 * ⚠️ Ad İSTEMCİDEN GELMEZ (`Device.name`den çözülür) — künye başlığı
 * uydurulabilir bir metindir ve onu bir yönetim ekranına basmak listeye
 * istemci-kontrollü bir gösterim alanı açardı.
 */
export function clientTitle(deviceName: string | null, instanceId: string): string {
  if (deviceName) return deviceName;
  return `Tanımsız (${instanceId.slice(0, 8)})`;
}
