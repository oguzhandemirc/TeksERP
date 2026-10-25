// Hata kodu YALNIZ `details.code`ten okunur (`body.code` her zaman undefined — kök kural).
import axios from "axios";

interface ErrBody { message?: string; details?: { code?: unknown; missing?: unknown } }

function body(error: unknown): ErrBody | undefined {
  return axios.isAxiosError(error) ? (error.response?.data as ErrBody | undefined) : undefined;
}

export function apiErrorCode(error: unknown): string | null {
  const c = body(error)?.details?.code;
  return typeof c === "string" ? c : null;
}

export function apiErrorStatus(error: unknown): number | null {
  return axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
}

/** Kapalı modül: 403 + `MODULE_DISABLED` — sayfa "kapalı" der, "yetkin yok" demez. */
export function isModuleDisabled(error: unknown): boolean {
  return apiErrorStatus(error) === 403 && apiErrorCode(error) === "MODULE_DISABLED";
}

/** 400 `COST_INPUT_MISSING` → `details.missing[]` (eksik kodları); başka hata → null. */
export function costMissingFromError(error: unknown): string[] | null {
  if (apiErrorCode(error) !== "COST_INPUT_MISSING") return null;
  const m = body(error)?.details?.missing;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : [];
}
