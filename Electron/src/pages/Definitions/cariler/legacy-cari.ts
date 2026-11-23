// T1/T9: eski "Müşteriler" ve "Fason Firmalar" adresleri tek Cariler ekranına rol süzgeciyle yönlenir
// (kimlik tek, rol bayrak). Derin bağlantı/favori/arama "Tümünü aç" kırılmasın diye `?search=` taşınır.

export const CARILER_PATH = "/definitions/cariler";

/** Eski ekran → Cariler'deki karşılığı. Müşteriler ekranı müşteri + tedarikçi kartlarını gösterirdi → süzgeçsiz. */
export type LegacyCariScreen = "customers" | "subcontractors";

/** Yönlendirme hedefi: Cariler + (fason için) `filter[subcontractor]=YES` + varsa arama terimi. */
export function legacyCariTarget(screen: LegacyCariScreen, params: URLSearchParams): string {
  const next = new URLSearchParams();
  if (screen === "subcontractors") next.set("filter[subcontractor]", "YES");
  const search = params.get("search")?.trim();
  if (search) next.set("search", search);
  const qs = next.toString();
  return qs ? `${CARILER_PATH}?${qs}` : CARILER_PATH;
}

/** Cariler listesinde arama terimiyle aç (palet "Tümünü aç" · eski derin bağlantı). */
export function cariSearchPath(term: string, screen: LegacyCariScreen = "customers"): string {
  return legacyCariTarget(screen, new URLSearchParams({ search: term }));
}
