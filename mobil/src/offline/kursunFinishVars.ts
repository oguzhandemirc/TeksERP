// Açık kumaş bitirme (KURSUN_FINISH) kuyruk değişkeni — D4-E2b.
// Eski kuyruk kaydı düz `rollId` string'idir ve gövdesi `{}`; en girildiyse nesne biçimi taşır.
// Kuyruk AsyncStorage'da kalıcıdır: yeni APK eski kaydı da çözebilmeli.

export type KursunFinishVars = string | { rollId: string; measuredWidthCm?: number };

export function kursunFinishRollId(vars: KursunFinishVars): string {
  return typeof vars === 'string' ? vars : vars.rollId;
}

/** Kuyruk değişkeni → (rollId, istek gövdesi). Ensiz gövde `{}` (bugünkü bayt-aynı). */
export function kursunFinishRequest(vars: KursunFinishVars): { rollId: string; body: { measuredWidthCm?: number } } {
  if (typeof vars === 'string' || vars.measuredWidthCm == null) return { rollId: kursunFinishRollId(vars), body: {} };
  return { rollId: vars.rollId, body: { measuredWidthCm: vars.measuredWidthCm } };
}
