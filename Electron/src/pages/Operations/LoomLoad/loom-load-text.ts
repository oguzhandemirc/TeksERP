// Tezgâh yük çizelgesi — SAF metin yardımcıları. İstemci süre HESAPLAMAZ: saat ve boşalma sunucudan; burada yalnız
// biçim ve "neden bilinmiyor" ipucu (sunucunun null kuralının aynası: devir · randıman · atkı sıklığı · kalan · çok tezgâh).
import { formatNumber } from "@/lib/format";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { LoomLoadJob, LoomLoadJobBase, LoomLoadResponse, LoomLoadRow } from "./types";

export const DASH = "—";

/** Varsayım cümlesi — sunucunun `assumption` alanından; tanınmayan değer ham yazılır (sessiz yorum yok). */
export function assumptionText(a: LoomLoadResponse["assumption"] | string): string {
  if (a === "CONTINUOUS_24H_FROM_NOW") {
    return "Boşalma zamanı bir tahmindir: tezgâh şu andan başlayıp hiç durmadan, günde 24 saat çalışırsa. Vardiya, duruş ve bakım hesaba katılmaz.";
  }
  return `Boşalma varsayımı: ${a}`;
}

/** "12,5 sa" — 24 saati aşınca gün karşılığı da ("52 sa · ≈2,2 gün"). */
export function hoursText(h: number | null): string {
  if (h == null) return DASH;
  const base = `${formatNumber(h, 1)} sa`;
  return h >= 24 ? `${base} · ≈${formatNumber(h / 24, 1)} gün` : base;
}

export function metersText(m: number | null): string {
  return m == null ? DASH : `${formatNumber(m, 0)} m`;
}

/** İşin süresi neden yok — kısa, günlük dil; süre varsa null. */
export function jobHoursHint(job: LoomLoadJob, loom: Pick<LoomLoadRow, "planRpm" | "planEfficiencyPct">): string | null {
  if (job.estimatedHours != null) return null;
  if (job.sharedAcrossLooms) return "Bu iş birden çok tezgâhta açık; kalan metrenin tezgâhlara bölüşümü bilinmiyor.";
  const why: string[] = [];
  if (job.remainingM == null) why.push("işin plan metresi yok");
  if (loom.planRpm == null) why.push("tezgâhın plan devri girilmemiş");
  if (loom.planEfficiencyPct == null) why.push("tezgâhın plan randımanı girilmemiş");
  if (job.picksPerCm == null) why.push("atkı sıklığı bilinmiyor (işte ve üründe atkı kartı yok)");
  return why.length ? `Süre hesaplanamadı: ${why.join(", ")}.` : "Süre hesaplanamadı.";
}

export function remainingHint(job: LoomLoadJobBase): string | null {
  return job.remainingM == null ? "İşin plan metresi yok (açık uçlu iş); kalan bilinmiyor." : null;
}

/** Tezgâhın boşalma hücresi: işsiz → "Boş"; toplam bilinmiyor → "—" + neden; yoksa fabrika saatiyle. */
export function freeAtCell(row: LoomLoadRow): { text: string; hint: string | null } {
  if (row.jobs.length === 0) return { text: "Boş", hint: null };
  if (row.estimatedFreeAtIfContinuous == null) {
    return { text: DASH, hint: "En az bir işin süresi hesaplanamadığı için boşalma zamanı bilinmiyor." };
  }
  return { text: fmtFactoryDateTime(row.estimatedFreeAtIfContinuous), hint: null };
}

export function assignmentText(a: LoomLoadJob["assignment"]): string {
  return a === "OPEN_RUN" ? "Dokunuyor" : "Leventi takılı, koşum açılmadı";
}

/** Üst şerit: kaç tezgâh dolu, kaç boş, kaç iş tezgâhsız. */
export function summaryText(d: Pick<LoomLoadResponse, "looms" | "unassigned">): string {
  const busy = d.looms.filter((l) => l.jobs.length > 0).length;
  const parts = [`${d.looms.length} tezgâh`, `${busy} dolu`, `${d.looms.length - busy} boş`];
  if (d.unassigned.length) parts.push(`${d.unassigned.length} iş tezgâh bekliyor`);
  return parts.join(" · ");
}
