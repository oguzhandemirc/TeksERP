import { fmtFactoryDate } from "@/lib/factory-time";
import { licenseService } from "@/services/licenseService";
import type { LicenseDetail } from "@/types/license";

/** Lisansın etkin bitişi: v2 ödenmiş tarih (null = süresiz); yoksa kiranın vadesi, o da yoksa kira bitişi. */
export function licenseEnd(d: LicenseDetail | null): { text: string; ms: number | null } | null {
  if (!d) return null;
  const paid = d.durum.odenmisTarih;
  if (paid) return paid.tarih === null ? { text: "süresiz", ms: null } : { text: fmtFactoryDate(paid.tarih), ms: Date.parse(paid.tarih) };
  const iso = d.kira?.gecerlilikBitis ?? d.kira?.bitis ?? null;
  return iso ? { text: fmtFactoryDate(iso), ms: Date.parse(iso) } : null;
}

function changedFields(before: LicenseDetail, after: LicenseDetail): string[] {
  const out: string[] = [];
  const a = after.hak;
  const b = before.hak;
  if (a?.bakimBitis !== b?.bakimBitis && a) out.push(`bakım bitişi ${fmtFactoryDate(a.bakimBitis)}`);
  const added = (a?.moduller ?? []).filter((m) => !(b?.moduller ?? []).includes(m));
  const removed = (b?.moduller ?? []).filter((m) => !(a?.moduller ?? []).includes(m));
  if (added.length > 0) out.push(`eklenen modül: ${added.join(", ")}`);
  if (removed.length > 0) out.push(`çıkan modül: ${removed.join(", ")}`);
  if ((after.kira?.yaptirim.kademe ?? null) !== (before.kira?.yaptirim.kademe ?? null)) out.push("satıcı kararı");
  return out;
}

/**
 * Eşitleme sonrası cümle: yalnız eşitleme olduğunu, bitişin değişip değişmediğini ve değişen alanları söyler
 * ("Lisans yenilendi" bitişi uzatılmış gibi okunuyordu). Önceki bilgi yoksa karşılaştırma yapılmaz.
 */
export function summarizeRefresh(before: LicenseDetail | null, after: LicenseDetail | null): string {
  const end = licenseEnd(after);
  const head = "Lisans bilgisi güncellendi";
  if (!end) return `${head}.`;
  const prev = licenseEnd(before);
  let verdict = "";
  if (prev) {
    // Süresiz = sonsuz bitiş: tarihliden süresize geçiş uzama, tersi kısalmadır.
    const rank = (x: { ms: number | null }): number => x.ms ?? Number.POSITIVE_INFINITY;
    if (prev.text === end.text) verdict = " (değişmedi)";
    else verdict = ` (${rank(end) > rank(prev) ? "uzadı" : "kısaldı"}, eski: ${prev.text})`;
  }
  const changes = before && after ? changedFields(before, after) : [];
  const tail = changes.length > 0 ? ` Değişen: ${changes.join("; ")}.` : before ? " Başka değişiklik yok." : "";
  return `${head} — bitiş: ${end.text}${verdict}.${tail}`;
}

const safeDetail = (): Promise<LicenseDetail | null> => licenseService.detail().catch(() => null);

/** `run` eşitlemeyi yapar (sonuç ayrıntısı verirse onu kullanır); öncesi/sonrası ayrıntıdan cümle döner. */
export async function refreshSummary(run: () => Promise<LicenseDetail | null | void>): Promise<string> {
  const before = await safeDetail();
  const ran = await run();
  const after = ran ?? (await safeDetail());
  return summarizeRefresh(before, after);
}
