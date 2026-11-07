// =============================================================================
// PG_POOL_MAX — Prisma havuz tavanının ortam ayarı (saf; DB'siz bekçi ölçer)
// =============================================================================
// Varsayılan 30 = bugünkü davranış (kök kural: yeni ayarın varsayılanı bugünkü
// davranış). 2 çekirdekli VDS'te düşürülebilsin diye ayarlanabilir; sınır 2..100.
// Geçersiz değer sunucuyu DURDURMAZ: varsayılana döner ve tek satır uyarı üretir.
// Bekçi: scripts/test_pg_pool_max.ts

export const PG_POOL_MAX_DEFAULT = 30;
export const PG_POOL_MAX_MIN = 2;
export const PG_POOL_MAX_MAX = 100;

export interface PoolMaxResolution {
  max: number;
  /** Değer verilmiş ama kullanılamıyorsa tek satırlık uyarı; aksi halde undefined. */
  warning?: string;
}

export function resolvePgPoolMax(raw: string | undefined): PoolMaxResolution {
  const text = raw?.trim() ?? "";
  if (text === "") return { max: PG_POOL_MAX_DEFAULT };
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < PG_POOL_MAX_MIN || n > PG_POOL_MAX_MAX) {
    return {
      max: PG_POOL_MAX_DEFAULT,
      warning:
        `PG_POOL_MAX geçersiz (${JSON.stringify(text)}; ${PG_POOL_MAX_MIN}..${PG_POOL_MAX_MAX} tam sayı olmalı)` +
        ` — varsayılan ${PG_POOL_MAX_DEFAULT} kullanılıyor`,
    };
  }
  return { max: n };
}
