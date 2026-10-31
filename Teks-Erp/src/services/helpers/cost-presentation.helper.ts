// =============================================================================
// MALİYET SUNUM DÖVİZİ (SY-J1; tasarım §11 J) — motor TL'de, sunum sunucuda
// =============================================================================
// Ayar `maliyet.sunumDovizi` TRY iken HİÇBİR alan yazılmaz (yanıt bayt-aynı). USD/EUR'da TL tutar
// sunucuda kura bölünür (istemci bölmez): kayıtlı sürümde kur sürümün DONMUŞ `fxRates`inden,
// önizlemede günün kuru ("ONIZLEME"). Kur yoksa döviz alanı null + `FX_MISSING` (1 VARSAYILMAZ).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import type { CostPresentationCurrency } from "../system-setting.service";

type Dec = Prisma.Decimal;
export type PresentationRateSource = "SURUM" | "ONIZLEME";

export interface CostPresentation {
  currency: Exclude<CostPresentationCurrency, "TRY">;
  rate: Dec | null;
  source: PresentationRateSource;
}

/** Ayar + kur → sunum; TRY'de null (çağıran hiçbir alan yazmaz). */
export function costPresentation(setting: CostPresentationCurrency, rate: Dec | null | undefined, source: PresentationRateSource): CostPresentation | null {
  if (setting === "TRY") return null;
  return { currency: setting, rate: rate && rate.gt(0) ? rate : null, source };
}

/** Donmuş kur fotoğrafından (`fxRates.kurlar`) sunum kuru — sürüm yanıtının TEK kur kaynağı. */
export function frozenRate(fxRates: unknown, currency: Currency): Dec | null {
  const kurlar = (fxRates as { kurlar?: Record<string, unknown> } | null)?.kurlar;
  const v = kurlar?.[currency];
  return typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? new Prisma.Decimal(v) : null;
}

/** TL/m → döviz/m, 4 hane; kur yoksa null. */
export function toPresentationAmount(amountTry: Dec | string, p: CostPresentation): string | null {
  if (!p.rate) return null;
  return new Prisma.Decimal(amountTry).div(p.rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Yanıt başlık alanları: döviz, kur, kur kaynağı, eksik kur uyarısı + standart döviz/m. */
export function presentationHeader(p: CostPresentation, standardTry: Dec | string) {
  return {
    sunumDovizi: p.currency,
    sunumKuru: p.rate ? p.rate.toString() : null,
    sunumKuruKaynagi: p.source,
    sunumUyarisi: p.rate ? null : ("FX_MISSING" as const),
    standartDovizM: toPresentationAmount(standardTry, p),
  };
}

/** Sunuma döviz alanlarını ekler; `p` null (ayar TRY) iken nesneyi AYNEN döndürür. */
export function withPresentation<T extends { standartTlM: string; satirlar?: { tutarTlM: string }[] }>(view: T, p: CostPresentation | null): T {
  if (!p) return view;
  return {
    ...view,
    ...presentationHeader(p, view.standartTlM),
    ...(view.satirlar ? { satirlar: view.satirlar.map((l) => ({ ...l, tutarDoviz: toPresentationAmount(l.tutarTlM, p) })) } : {}),
  };
}
