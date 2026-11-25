// K4 — "1000 m kumaş için atkı ihtiyacı": formdaki (kaydedilmemiş) atkı sunucunun maliyet motorundan geçer.
// Panel hesap yapmaz; gövdeyi kurar, `POST /api/weft-specs/calc` (yazmaz) yanıtını çizer.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";

export type WeftLengthSource = "ELLE" | "YAPI" | "TARAK" | "EN";

export interface WeftCalcRow {
  letter: string; yarnItemId: string; code: string; name: string; denier: number | null; picksInRepeat: number | null;
  unit: "ADET" | "METRE" | null;
  netKg: number | null; grossKg: number | null; sharePct: number | null; wastePct: number | null; wasteSource: "IPLIK" | "KART" | null;
}

export interface WeftCalcResult {
  perMeters: number;
  picksPerCm: number | null;
  lengthCm: number | null;
  lengthSource: WeftLengthSource | null;
  wastePct: number | null;
  rows: WeftCalcRow[];
  totalNetKg: number | null;
  totalGrossKg: number | null;
  missing: Array<{ code: string; text: string }>;
}

export interface WeftCalcBody {
  itemId?: string;
  rawWidthCm?: number | null;
  weftLengthCm?: number | null;
  picksPerCm?: number | null;
  sequenceCode?: string | null;
  yarns: Array<{ yarnItemId: string; picksInRepeat?: number | null }>;
}

/** Ürün penceresinde kumaş bağlamı: boy/fire o kumaşın zincirinden gelir; ham en formdaki değerdir. */
export interface WeftCalcCtx { itemId?: string | null; rawWidthCm?: number | null }

const WEFT_CALC_DEBOUNCE_MS = 400;

/** "22,5" → 22.5; boş/geçersiz/≤0 → null. */
export function positiveOrNull(raw: string | null | undefined): number | null {
  const t = (raw ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Gövde yalnız her satırda iplik ve (sıra kodu ya da adet > 0) varken kurulur; yoksa null (istek yok). */
export function buildWeftCalcBody(c: WeftContent, ctx: WeftCalcCtx | undefined, weftLengthCm: string): WeftCalcBody | null {
  const seq = c.seq.trim();
  if (c.rows.length === 0) return null;
  if (!c.rows.every((r) => r.yarnItemId && (seq !== "" || Number(r.picks) > 0))) return null;
  const body: WeftCalcBody = {
    picksPerCm: positiveOrNull(c.picksPerCm),
    sequenceCode: seq === "" ? null : seq,
    weftLengthCm: positiveOrNull(weftLengthCm),
    yarns: c.rows.map((r) => (seq === "" ? { yarnItemId: r.yarnItemId, picksInRepeat: Number(r.picks) } : { yarnItemId: r.yarnItemId })),
  };
  if (ctx?.itemId) body.itemId = ctx.itemId;
  if (ctx?.rawWidthCm != null && ctx.rawWidthCm > 0) body.rawWidthCm = ctx.rawWidthCm;
  return body;
}

export function calculateWeft(body: WeftCalcBody): Promise<WeftCalcResult> {
  // Yazarken her durulmada istek gider: hata tostu yağmasın, panel "Hesaplanamadı." der.
  return apiClient.post<ApiResponse<WeftCalcResult>>("/api/weft-specs/calc", body, { suppressErrorToast: true }).then((r) => r.data.data);
}

export function useWeftCalc(body: WeftCalcBody | null) {
  const settled = useDebouncedValue(body ? JSON.stringify(body) : null, WEFT_CALC_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["weft-calc", settled],
    queryFn: () => calculateWeft(JSON.parse(settled!) as WeftCalcBody),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

/** ⓘ boy kaynağı — atkı boyu nereden geldi. */
export const LENGTH_SOURCE_TEXT: Record<WeftLengthSource, string> = {
  ELLE: "elle girdiniz",
  YAPI: "maliyet yapısındaki atkı boyu",
  TARAK: "çözgü kartının tarak eni",
  EN: "ham en + kenar payı",
};

export const LENGTH_CHAIN_INFO = "Atkı boyu şu sırayla bulunur: elle yazdığınız boy → kumaşın maliyet yapısındaki atkı boyu → "
  + "çözgü kartının tarak eni → ürünün ham eni + kenar payı. Atkı Kartları ekranında kumaş olmadığı için yalnız elle yazılan boy kullanılır.";
