// =============================================================================
// TON GRUBU — "Ton ata" servisi + saf yardımcılar (2026-11-23)
// =============================================================================
// Uç `POST /api/rolls/shade` (yol TAM: apiClient.baseURL `/api` içermez). Biçim ve kilit otoritesi sunucu
// (`normalizeShadeCode`, 400 / 409 barkod listesiyle); burada yalnız düğmeyi kapatan ayna.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { labelTextsLockReason } from "./labelTextsService";

export const SHADE_QUICK_OPTIONS = ["A", "B", "C", "D", "E", "F"] as const;

/** Sunucu `SHADE_CODE_RE` aynası: trim + ASCII büyük harf; boş → null; geçersiz → undefined. */
export function normalizeShadeInput(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const up = t.replace(/[a-z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 32));
  return /^[A-Z0-9]{1,4}$/.test(up) ? up : undefined;
}

/** Tonu değiştirilemeyen top (sevk/dışarıda/ölü) — etiket kilidiyle aynı küme. */
export function shadeLockReason(status: string): string | null {
  return labelTextsLockReason(status);
}

export interface RollShadeResult {
  shadeCode: string | null;
  updated: number;
  unchanged: number;
}

export const shadeService = {
  async setShade(rollIds: string[], shadeCode: string | null, reason?: string): Promise<ApiResponse<RollShadeResult>> {
    const { data } = await apiClient.post<ApiResponse<RollShadeResult>>("/api/rolls/shade", {
      rollIds,
      shadeCode,
      ...(reason ? { reason } : {}),
    });
    return data;
  },
};
