// SY-3 L3: atkı iplik payı — sunucunun salt-okunur `sharePct`i yalnız ÇİZİLİR (istemci hesaplamaz).
// Pay bütün satırlara bağlıdır: satırlar kayıtlı karttan farklılaşınca hücre "—" olur (kaydedince sunucu yeniden verir).
import { formatNumber } from "@/lib/format";
import type { WeftSpecDetail } from "../types";

export interface WeftRowLike { yarnItemId: string; picks: string }

/** Sütun çizilir mi: esas belli ve en az bir satırda pay var (null'da sütun gizli). */
export function weftShareVisible(spec: WeftSpecDetail): boolean {
  return spec.shareBasis != null && spec.yarns.some((y) => y.sharePct != null);
}

/** Satırlar kayıtlı kartla aynı mı (iplik + adet, sıra kodu değişmemiş). */
export function weftRowsMatchSaved(spec: WeftSpecDetail, rows: readonly WeftRowLike[], seq: string): boolean {
  if ((spec.sequenceCode ?? "") !== seq.trim() || rows.length !== spec.yarns.length) return false;
  return rows.every((r, i) => r.yarnItemId === spec.yarns[i]!.yarnItemId && (seq.trim() !== "" || Number(r.picks) === spec.yarns[i]!.picksInRepeat));
}

/** Hücre metni: "%42,5" · bilinmiyor/düzenlenmiş → "—". */
export function weftShareCell(spec: WeftSpecDetail, i: number, matches: boolean): string {
  const v = matches ? spec.yarns[i]?.sharePct : null;
  return v == null ? "—" : `%${formatNumber(v, 2)}`;
}

/** Esas notu: atım sayısına göre ise açıkça söylenir; kütlece ise kısa açıklama. */
export function weftShareNote(spec: WeftSpecDetail): string | null {
  if (spec.shareBasis === "PICKS") return "Pay % atım sayısına göre: ipliklerden birinin denyesi girilmemiş, kütle payı hesaplanamadı.";
  if (spec.shareBasis === "MASS") return "Pay % kütlece: maliyet hesabındaki atkı formülüyle (denye × atım).";
  return null;
}
