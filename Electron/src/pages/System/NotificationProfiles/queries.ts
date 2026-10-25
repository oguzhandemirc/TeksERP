// Sorgu anahtarları — tek kök: her yazım listeyi + fabrika varsayılanını tazeler.
export const PROFILES_QUERY_ROOT = ["bildirim-profilleri"] as const;
export const profilesKey = (arsiv: boolean) => [...PROFILES_QUERY_ROOT, "liste", arsiv] as const;
export const factoryKey = [...PROFILES_QUERY_ROOT, "fabrika"] as const;
export const candidatesKey = [...PROFILES_QUERY_ROOT, "adaylar"] as const;
