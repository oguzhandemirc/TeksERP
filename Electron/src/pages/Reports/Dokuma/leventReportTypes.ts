// =============================================================================
// LEVENT SONUCU · KAPASİTE KULLANIMI · LEVENT BİTİŞ TAHMİNİ — yanıt tipleri (S1c sözleşmesi)
// =============================================================================
// Backend `services/reports/{levent-sonucu,kapasite-kullanimi,levent-bitis-tahmini}.report.service.ts`
// aynası. `null` = ÖLÇÜLEMEDİ (0 değil); gerekçe metni sunucudan, istemci uydurmaz.
// =============================================================================
import { formatQty } from "@/lib/format";

/** Sunucu süzgeç seçeneği (`_secenekler.ts`) — süzgeçten ÖNCEKİ kümeden, seçimle daralmaz. */
export interface Secenek { id: string; ad: string; kod?: string | null }

/** Gerçek kumaş metresinin kaynağı — top doğuşundan otomatik / elle tüketim. Tek yüzdeye çökertilmez. */
export interface KumasKaynak { otomatik: number; elle: number }

export interface BeamResultRow {
  beamId: string; beamNo: string; physicalBeamNo: string | null;
  warpSpec: { id: string; code: string; name: string; takeUpPct: number | null };
  /** SY-B2: yalnız bağlı işin ürününde ek çözgü katmanı varken (zemin / döner / ek); etiket sunucudan. */
  katman?: { rol: "GROUND" | "LENO" | "SECONDARY"; beamMode: string | null; etiket: string };
  sarilanM: number; sarilanKg: number | null; kgKaynak: "WEIGHED" | "THEORETICAL" | "KARMA" | null;
  beklenenKumasM: number | null; gercekKumasM: number; gercekKaynak: KumasKaynak;
  kalanM: number; fireM: number | null; firePct: number | null;
  status: string; kapanisAt: string | null; tezgahlar: string[];
  /** Yalnız açık leventte. */
  kullanimPct?: number | null;
}
/** Çözgü hücresi (tablo + Excel/PDF aynı metin): "KOD · Ad", katmanlı işte "— <katman etiketi>". */
export const warpSpecCellText = (r: Pick<BeamResultRow, "warpSpec" | "katman">): string =>
  `${r.warpSpec.code} · ${r.warpSpec.name}${r.katman ? ` — ${r.katman.etiket}` : ""}`;

export interface BeamResultReport {
  kapananlar: BeamResultRow[];
  acikLeventler: BeamResultRow[];
  ozet: {
    leventSayisi: number; sarilanM: number; beklenenM: number; gercekM: number; gercekKaynak: KumasKaynak;
    fireM: number; firePct: number | null; olculemedi: number; acikLeventSayisi: number;
  };
  meta: {
    ufuk: string; ufukOncesiSatir: number;
    /** Top metresi tüketim anından sonra düzeltilmiş top sayısı. */
    duzeltilmisTop: number;
    kumasiOlculmeyenTuketim: number;
    secenekler: { warpSpecId: Secenek[]; machineId: Secenek[] };
  };
}

export interface CapacityRow {
  machineId: string; code: string; name: string; hafta: string; haftaBaslangic: string;
  nominalUnitsPerMin: number | null; unitsPerCm: number | null; teorikMSaat: number | null;
  takvimSaat: number; potansiyelM: number | null; gercekM: number; kullanimPct: number | null;
  hesaplanamadi: string | null;
}
export interface CapacityReport {
  satirlar: CapacityRow[];
  ozet: { satirSayisi: number; potansiyelM: number; gercekM: number; kullanimPct: number | null; hesaplanamadi: number; hesaplanamayanGercekM: number; toplamGercekM: number };
  meta: { ufuk: string; ufukOncesiSatir: number; secenekler: { machineId: Secenek[] } };
}

export interface FinishForecastRow {
  beamId: string; beamNo: string; machine: { id: string; code: string; name: string }; position: number | null;
  kalanM: number; gunlukOrtM: number | null; kaynak: KumasKaynak;
  tahminiBitisGun: string | null; kalanGun: number | null; hesaplanamadi: string | null;
  /** S1 (devere zamanlaması) — eski sunucu bu alanları göndermez; hepsi opsiyonel. */
  warpSpec?: { id: string; code: string; name: string };
  /** Aynı kartın yedeği: hazır (READY) levent adedi/metresi + açık devere siparişi kalanı. */
  spare?: { count: number; m: number; yoldaM: number; yoldaSiparis: number };
  leadDays?: number | null;
  lead?: { kaynak: "OLCUM" | "AYAR" | null; ornek: number; devereci: string | null };
  /** Devereye en geç verilecek fabrika günü; hesaplanamazsa null + gerekçe. */
  orderByDay?: string | null;
  orderByGerekce?: string | null;
  devereAcil?: boolean;
}
export interface FinishForecastReport {
  satirlar: FinishForecastRow[];
  ozet: { leventSayisi: number; tahminli: number; hesaplanamadi: number; devereAcil?: number };
  meta: { ufuk: string; ufukOncesiSatir: number; pencereBaslangic: string; pencereGun: number; secenekler: { machineId: Secenek[] } };
}

/** Sunucu seçeneği → seçici satırı ("KOD · Ad"). */
export function secenekOptions(list: readonly Secenek[] | undefined): Array<{ id: string; label: string }> {
  return (list ?? []).map((s) => ({ id: s.id, label: s.kod ? `${s.kod} · ${s.ad}` : s.ad }));
}

/** "Yedek" hücresi (tablo + Excel aynı metin): hazır levent ve yoldaki devere; ikisi de yoksa "Yok". */
export function spareText(s: FinishForecastRow["spare"], fmtM: (m: number) => string): string {
  if (!s) return "—";
  const parts: string[] = [];
  if (s.count > 0) parts.push(`${s.count} hazır · ${fmtM(s.m)}`);
  if (s.yoldaM > 0) parts.push(`yolda ${fmtM(s.yoldaM)}${s.yoldaSiparis > 0 ? ` (${s.yoldaSiparis} sipariş)` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "Yok";
}

/** Teslim süresi açıklaması: ölçüm (ortanca, N sipariş, devereci) ya da ayar yedeği. */
export function leadText(r: Pick<FinishForecastRow, "leadDays" | "lead">): string | null {
  if (r.leadDays == null || !r.lead) return null;
  const gun = `${formatQty(r.leadDays)} gün`;
  if (r.lead.kaynak === "AYAR") return `${gun} (ayardaki varsayılan)`;
  return `${gun} (${r.lead.devereci ?? "devereci"}, son ${r.lead.ornek} siparişin ortancası)`;
}

/** En yakın tahmini bitiş (YYYY-MM-DD sözlük sırası = takvim sırası); hiç tahmin yoksa null. */
export function enYakinBitis(rows: readonly FinishForecastRow[]): string | null {
  const gunler = rows.map((r) => r.tahminiBitisGun).filter((g): g is string => g !== null).sort();
  return gunler[0] ?? null;
}
