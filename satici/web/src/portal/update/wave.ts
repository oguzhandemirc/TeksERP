// GÜNCELLEME DALGASI (F1b) ekran adları ve sabitleri — satıcının `services/update-wave.service.ts` değerlerinin AYNASI
// (bekçi `src/test/mirrors.test.ts`). Aşamayı yalnız insan değiştirir (AK-2); uyarı ve ek onay gereği sunucunun hükmüdür.
import type { WaveMember } from "../../shared/types";

/** Dalga açılabilen gruplar (sunucu `WAVE_GROUPS`; öncü/test dalgasız). */
export const WAVE_GROUPS: readonly string[] = ["genel"];
/** Aşama → kurulum yüzdesi (sunucu `WAVE_STAGE_THRESHOLDS`): 0 durdu · 1 %10 · 2 %50 · 3 hepsi. */
export const WAVE_STAGE_THRESHOLDS: readonly number[] = [0, 10, 50, 100];
export const WAVE_MAX_STAGE = WAVE_STAGE_THRESHOLDS.length - 1;
/** Sonuç bildirme oranı bunun altındaysa ilerletme ek onay ister (sunucu `WAVE_REPORTED_MIN_PERCENT`). */
export const WAVE_REPORTED_MIN_PERCENT = 80;
/** Sunucunun "ek onay gerekli" hata kodu (400; engel değil, uyarı). */
export const SECOND_CONFIRMATION_CODE = "IKINCI_ONAY_GEREKLI";

/** Kurulum başına sonuç (sunucu `WAVE_RESULTS`). */
export const WAVE_RESULT_LABEL: Record<string, string> = {
  TAMAMLANDI: "Tamamlandı",
  GERI_DONDU: "Geri döndü",
  BASARISIZ: "Başarısız",
  BEKLIYOR: "Bekliyor",
};
export const WAVE_RESULT_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  TAMAMLANDI: "ok",
  GERI_DONDU: "warn",
  BASARISIZ: "danger",
  BEKLIYOR: "neutral",
};

/** Karar defteri olayları (sunucu `WAVE_EVENTS` değerleri). */
export const WAVE_EVENT_LABEL: Record<string, string> = {
  DALGA_ACILDI: "Dalga açıldı",
  ASAMA_ILERLETILDI: "Aşama ilerletildi",
  ASAMA_GERI_CEKILDI: "Aşama geri çekildi",
};

/** Sonucun kaynağı (sunucu `WaveMemberRow.kaynak`). */
export const WAVE_SOURCE_LABEL: Record<string, string> = { DEFTER: "Güncelleme sonucu", YOKLAMA: "Kurulu sürüm" };

export function stageText(stage: number): string {
  if (stage <= 0) return "0 · durdu";
  if (stage >= WAVE_MAX_STAGE) return `${WAVE_MAX_STAGE} · hepsi`;
  return `${stage} · %${WAVE_STAGE_THRESHOLDS[stage]}`;
}

/**
 * `from` aşamasından `to` aşamasına geçişte tavanı DEĞİŞEN üyeler. Üyelik aşamayla tekdüzedir (kurulum girdiği
 * aşamadan itibaren dalgadadır), bu yüzden sunucunun `girisAsamasi`ndan okunur; zil sayısı aynı kümeyi verir.
 */
export function membersCrossing(members: readonly WaveMember[], from: number, to: number): WaveMember[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return members.filter((m) => m.girisAsamasi > lo && m.girisAsamasi <= hi);
}
