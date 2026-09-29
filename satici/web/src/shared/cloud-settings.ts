// Patron bulutu kurulum ayarları — sunucudaki `services/cloud-entitlement.ts` aynası (mirrors.test ölçer).
export const SYNC_MINUTES_MIN = 1;
export const SYNC_MINUTES_MAX = 60;
export const SYNC_MINUTES_DEFAULT = 5;
export const CLOUD_RETENTION_MONTHS = [3, 13, 25] as const;
export const CLOUD_RETENTION_DEFAULT = 13;

/** Seçim kutusu değeri: ay sayısı ya da "tum" (tüm geçmiş = null). */
export const RETENTION_ALL = "tum";
export const RETENTION_CHOICES: readonly (readonly [string, string])[] = [
  ...CLOUD_RETENTION_MONTHS.map((m) => [String(m), `${m} ay`] as const),
  [RETENTION_ALL, "Tüm geçmiş"],
];

export const retentionValue = (v: number | null): string => (v === null ? RETENTION_ALL : String(v));
export const retentionBody = (v: string): number | null => (v === RETENTION_ALL ? null : Number(v));
