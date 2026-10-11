// =============================================================================
// SALON TV PENCERESİ — sözleşme (ana süreç + renderer ortak, saf)
// =============================================================================
// Ayrı pencere YALNIZ uygulamanın kendi belgesini TV yolunda açar: adres renderer'dan
// GELMEZ, güvenilen giriş adresinden + sabit hash'ten kurulur. İstek tek alan taşır
// (ekran kimliği); başka her şekil reddedilir — kanal keyfi URL açmanın kapısı olmasın.
// =============================================================================

/** TV yolu (hash) — renderer `tv-entry` bunu yeniden ihraç eder; tek kaynak. */
export const TEZGAH_TV_HASH_PATH = "/tezgah-tv";
/** Ayrı pencerenin işareti: çıkış = pencereyi kapat. */
export const TV_WINDOW_QUERY = "pencere=ayri";

export interface TvDisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface TvWindowOpenRequest {
  /** null = ana süreç seçer (ikinci ekran varsa o). */
  displayId: number | null;
}

export type TvWindowOpenResult = { ok: true; reused: boolean; displayId: number } | { ok: false; reason: string };

/** Yalnız `{ displayId: tamsayı | null }` geçer; dize, URL, ek alan → null (RED). */
export function parseTvWindowRequest(raw: unknown): TvWindowOpenRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.some((k) => k !== "displayId")) return null;
  const id = (raw as { displayId?: unknown }).displayId ?? null;
  if (id !== null && !(typeof id === "number" && Number.isSafeInteger(id))) return null;
  return { displayId: id };
}

/** Güvenilen giriş adresinden TV penceresi adresi: mevcut hash atılır, sabit TV hash'i eklenir. */
export function tvWindowUrl(entryUrl: string): string {
  const base = entryUrl.split("#")[0] ?? entryUrl;
  return `${base}#${TEZGAH_TV_HASH_PATH}?${TV_WINDOW_QUERY}`;
}

/** Hash bu pencerenin ayrı TV penceresi olduğunu söylüyor mu (çıkış davranışı için). */
export function isTvWindowHash(hash: string): boolean {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query = ""] = raw.split("?");
  return path === TEZGAH_TV_HASH_PATH && query.split("&").includes(TV_WINDOW_QUERY);
}

/** İstenen ekran varsa o; yoksa birincil OLMAYAN ilk ekran (TV genelde ikinci ekrandır); yoksa birincil. */
export function pickTvDisplay<D extends { id: number }>(displays: readonly D[], primaryId: number, requestedId: number | null): D | null {
  if (requestedId !== null) {
    const asked = displays.find((d) => d.id === requestedId);
    if (asked) return asked;
  }
  return displays.find((d) => d.id !== primaryId) ?? displays.find((d) => d.id === primaryId) ?? displays[0] ?? null;
}
