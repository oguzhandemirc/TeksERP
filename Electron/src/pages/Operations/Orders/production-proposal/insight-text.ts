// Üretime gönder önizlemesindeki karar özetlerinin (tezgâh · iplik · süre) günlük dilde tek satırları — SAF, test edilir.
// İstemci HESAP YAPMAZ: sayılar sunucudan (`production-proposal-insight.helper`); null özet = satır yok (0 ya da tahmin yazılmaz).
import { formatNumber } from "@/lib/format";
import type { LoomSummary, WeavingDurationEstimate, YarnSummary } from "./types";

export const formatKg = (n: number) => `${formatNumber(n, 1)} kg`;

/** Tezgâh satırı: en iyi adayın durumu. */
export function loomLine(s: LoomSummary | null | undefined): string | null {
  if (!s?.best) return null;
  const { best } = s;
  if (best.tier === "READY") return `${best.code} hazır`;
  if (best.tier === "BEAM_SHORT") {
    return best.weavableM == null ? `${best.code} tezgâhında levent yetmez` : `${best.code} tezgâhında levent yetmez, ${formatNumber(best.weavableM, 0)} m dokur`;
  }
  return `Çözgü değişimi gerekir (${best.code}${best.readyBeamNo ? `, hazır levent ${best.readyBeamNo}` : ""})`;
}

/** Tezgâh sayaçları: sıfır olan sınıf yazılmaz; hepsi sıfırsa null. */
export function loomCountsText(s: LoomSummary | null | undefined): string | null {
  const c = s?.counts;
  if (!c) return null;
  const parts = [
    c.READY > 0 ? `hazır ${c.READY}` : null,
    c.BEAM_SHORT > 0 ? `levent kısa ${c.BEAM_SHORT}` : null,
    c.WARP_CHANGE > 0 ? `değişim ${c.WARP_CHANGE}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** İplik satırı: eksik yoksa "yeterli"; varsa en büyük eksik (+ kalan sayısı ve toplam); stok bilinmiyorsa yalnız ihtiyaç. */
export function yarnLine(s: YarnSummary | null | undefined): string | null {
  const yarns = s?.yarns ?? [];
  if (!s || yarns.length === 0) return null;
  if (s.totalShortKg == null) return `İplik ihtiyacı ${formatKg(yarns.reduce((a, y) => a + y.needKg, 0))}`;
  const short = yarns.filter((y) => (y.shortKg ?? 0) > 0).sort((a, b) => (b.shortKg ?? 0) - (a.shortKg ?? 0));
  const top = short[0];
  if (!top || s.totalShortKg <= 0) return "İplik yeterli";
  const head = `${top.code || top.name}: ${formatKg(top.shortKg ?? 0)} eksik`;
  return short.length > 1 ? `${head} ve ${short.length - 1} iplik daha, toplam ${formatKg(s.totalShortKg)}` : head;
}

/** Süre satırı: yalnız dokuma süresi; termin karşılaştırması YUMUŞAK dille ("yetişir" hükmü verilmez). */
export function durationLine(d: WeavingDurationEstimate | null | undefined): string | null {
  if (!d) return null;
  const base = `Dokuma yaklaşık ${formatNumber(d.weavingDays, 1)} gün (${formatNumber(d.weavingHours, 0)} saat)`;
  if (d.weavingOnlyFitsDeadline === true) return `${base} — yalnız dokuma süresiyle termine sığıyor`;
  if (d.weavingOnlyFitsDeadline === false) return `${base} — yalnız dokuma süresi bile termini aşıyor`;
  return base;
}

/** Süre hesabının girdileri (ayrıntı bölümü). */
export function durationInputsText(d: WeavingDurationEstimate, machineCode: string | null): string {
  const loom = machineCode ? `${machineCode} · ` : "";
  return `${loom}devir ${formatNumber(d.planRpm, 0)}/dk · verim %${formatNumber(d.planEfficiencyPct, 1)} · atkı sıklığı ${formatNumber(d.picksPerCm, 2)} atkı/cm`;
}

/** Plan metresi ipucuna eklenecek fire notu; 0/yok → null. */
export function wasteNote(pct: number | null | undefined): string | null {
  return pct != null && pct > 0 ? `%${formatNumber(pct, 2)} dokuma firesi dahil` : null;
}

/** Çekme kaynağı (ürün yapısı / terbiye tarifesi); bilinmiyorsa null. */
export function shrinkSourceText(src: "YAPI" | "KART" | null | undefined): string | null {
  if (src === "YAPI") return "ürün yapısından";
  if (src === "KART") return "terbiye tarifesinden";
  return null;
}
