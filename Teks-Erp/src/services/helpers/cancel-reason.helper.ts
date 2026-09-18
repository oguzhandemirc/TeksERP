// =============================================================================
// İPTALDE SEBEP ZORUNLULUĞU — tek kapı (`production.cancelReasonRequired`, kullanıcı kararı 2026-09-18)
// =============================================================================
// ÖLÇÜM (2026-09-18): üretim iptal uçlarında sebep alanı BUGÜN şöyle: top iptali (`DELETE /rolls/:id`,
// query `reason`/`reasonCode`) OPSİYONEL; iş emri iptali (min 3) · dokuma işi iptali (min 1) · levent sarım
// iptali / durum-olay iptali / tüketim iptali (min 3) · fason dokuma sevk/makbuz iptali (min 3) ZATEN ZORUNLU
// (Zod); sevkiyat iptali · çuval çıkarma · PLANNED levent silme sebep alanı TAŞIMAZ. Dolayısıyla bayrağın
// değiştirdiği tek yol top iptalidir; öteki uçların önizlemesi `reasonRequired: true` sabitini döner
// (sebep her zaman şart) — istemci hepsini aynı alandan okur, bayrağı tahmin etmez.
// Varsayılan KAPALI = bugünkü davranış (sebep opsiyonel; 2026-08-06 kuralı: eldivenli operatörü rastgele
// kategori seçmeye itmek cevapsızlıktan kötüdür — fabrika bunu kendisi açar).
// =============================================================================
import type prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolveCancelReasonRequired } from "../system-setting.service";

export const CANCEL_REASON_REQUIRED_CODE = "CANCEL_REASON_REQUIRED";

/** Sebep VAR sayılır: metin (trim, ≥1) YA DA katalog kodu. */
export function hasCancelReason(input: { reason?: string | null; reasonCode?: string | null }): boolean {
  return Boolean(input.reason?.trim()) || Boolean(input.reasonCode?.trim());
}

/** Bayrak etkinse (üretim ∧ bayrak) ve sebep yoksa 400 — yazımdan ÖNCE, yalnız burada; elle kopya YOK. */
export async function assertCancelReasonTx(
  db: Pick<typeof prisma, "systemSetting">,
  input: { reason?: string | null; reasonCode?: string | null },
  belge: string,
): Promise<void> {
  if (hasCancelReason(input)) return;
  if (!(await resolveCancelReasonRequired(db))) return;
  throw AppError.badRequest(`${belge} için sebep zorunlu (ayar: iptalde sebep zorunlu) — katalogdan seçin ya da yazın.`, { code: CANCEL_REASON_REQUIRED_CODE });
}
