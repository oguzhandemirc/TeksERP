// =============================================================================
// Anlatı gözlemleri — saf çıkarıcılar: veri → {kural, onem, kanit} ya da null
// =============================================================================
// Gözlem METİN ÜRETMEZ; metni `kurallar.ts` kanıttan kurar. Ayrım, eşik ve önem puanının
// cümle diline bağımlı olmadan bekçide ölçülebilmesi içindir. Önem = mutlak etki × güven,
// 0–1, 4 haneye yuvarlı (sıralama belirlenimli kalsın). Kanıt JSON-güvenlidir (Date yok).

import { factoryYmd } from "../../../constants/time";
import type { SuzgecEcho } from "../_filters";
import type { SuffixInput } from "./ek";
import type { AnaSayi } from "../sunum/sunum.types";
import {
  type AnalysisInput,
  type AnaSayiIfadesi,
  type ThresholdInput,
  type Gozlem,
  type ScopeNoteInput,
  type Kirilim,
  type BreakdownRow,
  type MusteriRitmi,
  type Seri,
  type SeriNoktasi,
} from "./gozlem.types";

export * from "./gozlem.types";

// --- Eşikler (plan §3.5) ------------------------------------------------------
export const YOGUNLASMA_ESIGI = 60;
export const DEGISIM_KATKI_ESIGI = 0.4;
export const EGILIM_EN_AZ_NOKTA = 6;
export const EGILIM_R2_ESIGI = 0.5;
export const AYKIRI_EN_AZ_NOKTA = 8;
export const SESSIZLIK_KATI = 2;

// --- Yardımcılar --------------------------------------------------------------
const puan = (n: number): number => Math.round(Math.max(0, Math.min(1, n)) * 1e4) / 1e4;
const yuvarla = (n: number, hane = 1): number => Math.round(n * 10 ** hane) / 10 ** hane;
const ortalama = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

function ceyrek(sirali: number[], q: number): number {
  const p = (sirali.length - 1) * q;
  const alt = Math.floor(p);
  const ust = Math.ceil(p);
  return sirali[alt] + (sirali[ust] - sirali[alt]) * (p - alt);
}

function measuredRows(k: Kirilim): { ad: string; deger: number; onceki: number | null | undefined }[] {
  return k.satirlar.filter((s): s is BreakdownRow & { deger: number } => s.deger !== null && Number.isFinite(s.deger))
    .map((s) => ({ ad: s.ad, deger: s.deger, onceki: s.onceki }));
}

/** Pay sırası: değer azalan, eşitlikte ad (belirlenimli). */
const payaGore = <T extends { ad: string; deger: number }>(a: T, b: T): number =>
  b.deger - a.deger || (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0);

// --- Çıkarıcılar --------------------------------------------------------------

/** `dusenSatir` sözleşmesi: boş sonuçta "veri yok" ile "süzgeç kesti" ayrılır. */
export function emptyResultState(g: { satirSayisi: number; suzgec?: SuzgecEcho }): Gozlem | null {
  if (g.satirSayisi > 0) return null;
  const dusen = g.suzgec?.dusenSatir;
  if (typeof dusen === "number" && dusen > 0) {
    return { kural: "suzgecKesti", onem: 1, kanit: { satirSayisi: g.satirSayisi, dusenSatir: dusen, suzgecsiz: g.satirSayisi + dusen } };
  }
  return { kural: "veriYok", onem: 1, kanit: { satirSayisi: 0 } };
}

export function olculemedi(anaSayi: AnaSayi): Gozlem | null {
  if (anaSayi.deger !== null) return null;
  const neden = (anaSayi.olculemedi ?? "").trim().replace(/\.+$/, "");
  return { kural: "olculemedi", onem: 0.95, kanit: { ad: anaSayi.ad, neden } };
}

export function anaSayiKiyas(
  anaSayi: AnaSayi,
  ifade: AnaSayiIfadesi,
  sozler: { donem: SuffixInput | null; kiyas: SuffixInput | null },
): Gozlem | null {
  if (anaSayi.deger === null || !anaSayi.kiyas) return null;
  const y = anaSayi.kiyas.yuzde;
  // Ana sayı cümlesi her zaman öndedir; büyük değişim biraz daha yukarı iter.
  const onem = 0.6 + (y === null ? 0 : Math.min(0.3, Math.abs(y) / 100));
  return {
    kural: "anaSayiKiyas",
    onem: puan(onem),
    kanit: {
      ad: anaSayi.ad,
      deger: anaSayi.deger,
      birim: anaSayi.birim,
      yuklem: ifade.yuklem ?? null,
      ozne: ifade.ozne ?? null,
      donem: sozler.donem,
      kiyasDonem: sozler.kiyas,
      kiyas: anaSayi.kiyas,
    },
  };
}

export function enBuyukPay(k: Kirilim): Gozlem | null {
  const s = measuredRows(k);
  if (s.length < 2 || s.some((x) => x.deger < 0)) return null;
  const total = s.reduce((t, x) => t + x.deger, 0);
  if (total <= 0) return null;
  const ilk = [...s].sort(payaGore)[0];
  const pay = (ilk.deger / total) * 100;
  return {
    kural: "enBuyukPay",
    onem: puan((pay / 100) * 0.8),
    kanit: { ad: ilk.ad, adTuru: k.adTuru ?? "ozel", boyut: k.boyut, deger: ilk.deger, birim: k.birim, pay: yuvarla(pay, 0), toplam: total },
  };
}

/** İlk üç kalem toplamın ≥ %60'ı (en az 4 kalem; 3 kalemde "üçü" her zaman %100'dür). */
export function yogunlasma(k: Kirilim): Gozlem | null {
  const s = measuredRows(k);
  if (s.length < 4 || s.some((x) => x.deger < 0)) return null;
  const total = s.reduce((t, x) => t + x.deger, 0);
  if (total <= 0) return null;
  const ilkUc = [...s].sort(payaGore).slice(0, 3);
  const pay = (ilkUc.reduce((t, x) => t + x.deger, 0) / total) * 100;
  if (pay < YOGUNLASMA_ESIGI) return null;
  return {
    kural: "yogunlasma",
    onem: puan((pay / 100) * 0.9),
    kanit: { pay: yuvarla(pay, 0), ilkUc: ilkUc.map((x) => x.ad), boyut: k.boyut, ozneIlgi: k.ozneIlgi ?? "İşin", kalemSayisi: s.length },
  };
}

/** Toplam değişimin ≥ %40'ını tek kalem taşıyorsa. Önceki değeri ölçülemeyen kalem hesaba girmez. */
export function degisimKaynagi(k: Kirilim): Gozlem | null {
  const s = measuredRows(k).filter((x): x is typeof x & { onceki: number } => typeof x.onceki === "number");
  if (s.length < 2) return null;
  const farklar = s.map((x) => ({ ad: x.ad, deger: x.deger - x.onceki }));
  const totalDelta = farklar.reduce((t, x) => t + x.deger, 0);
  if (totalDelta === 0) return null;
  const yonlu = farklar.map((x) => ({ ad: x.ad, deger: Math.sign(totalDelta) * x.deger })).sort(payaGore);
  const en = yonlu[0];
  const katki = en.deger / Math.abs(totalDelta);
  if (katki < DEGISIM_KATKI_ESIGI) return null;
  return {
    kural: "degisimKaynagi",
    onem: puan(Math.min(1, katki) * 0.8),
    kanit: {
      ad: en.ad,
      adTuru: k.adTuru ?? "ozel",
      boyut: k.boyut,
      katki: yuvarla(katki, 2),
      yon: totalDelta > 0 ? "artis" : "dusus",
      toplamFark: totalDelta,
      kalemFark: Math.sign(totalDelta) * en.deger,
    },
  };
}

/** En küçük kareler: ≥6 ölçülü nokta, R² ≥ 0,5, eğim ≠ 0. `ardisik` = sondaki aynı yönlü adım sayısı. */
export function egilim(seri: Seri): Gozlem | null {
  const n = seri.noktalar
    .map((p, i) => ({ x: i, y: p.deger }))
    .filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y));
  if (n.length < EGILIM_EN_AZ_NOKTA) return null;
  const mx = ortalama(n.map((p) => p.x));
  const my = ortalama(n.map((p) => p.y));
  const sxy = n.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0);
  const sxx = n.reduce((t, p) => t + (p.x - mx) ** 2, 0);
  const syy = n.reduce((t, p) => t + (p.y - my) ** 2, 0);
  if (sxx === 0 || syy === 0 || sxy === 0) return null;
  const egim = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  if (r2 < EGILIM_R2_ESIGI) return null;
  const asagi = egim < 0;
  let ardisik = 0;
  for (let i = n.length - 1; i > 0; i--) {
    const adim = n[i].y - n[i - 1].y;
    if (asagi ? adim < 0 : adim > 0) ardisik++;
    else break;
  }
  const goreli = Math.abs(egim * (n[n.length - 1].x - n[0].x)) / Math.max(Math.abs(my), 1e-9);
  return {
    kural: "egilim",
    onem: puan(r2 * Math.min(1, 5 * goreli)),
    kanit: {
      olcuAdi: seri.olcuAdi,
      yon: asagi ? "dusuyor" : "artiyor",
      nokta: n.length,
      egim: yuvarla(egim, 4),
      r2: yuvarla(r2, 3),
      ardisik,
      zamanBirimi: seri.zamanBirimi,
    },
  };
}

/** IQR 1,5× dışı ya da |z| > 3; en az 8 nokta. En uç nokta seçilir; "normal" = diğerlerinin ortanca değeri. */
export function aykiri(seri: Seri): Gozlem | null {
  const n = seri.noktalar.filter((p): p is SeriNoktasi & { deger: number } => p.deger !== null && Number.isFinite(p.deger));
  if (n.length < AYKIRI_EN_AZ_NOKTA) return null;
  const sirali = n.map((p) => p.deger).sort((a, b) => a - b);
  const q1 = ceyrek(sirali, 0.25);
  const q3 = ceyrek(sirali, 0.75);
  const iqr = q3 - q1;
  const orta = ceyrek(sirali, 0.5);
  const ort = ortalama(sirali);
  const sd = Math.sqrt(sirali.reduce((t, x) => t + (x - ort) ** 2, 0) / (sirali.length - 1));
  let secilen: { p: SeriNoktasi & { deger: number }; uzaklik: number; z: boolean } | null = null;
  for (const p of n) {
    const iqrDisi = p.deger < q1 - 1.5 * iqr || p.deger > q3 + 1.5 * iqr;
    const zDisi = sd > 0 && Math.abs((p.deger - ort) / sd) > 3;
    if (!iqrDisi && !zDisi) continue;
    const uzaklik = Math.abs(p.deger - orta);
    if (!secilen || uzaklik > secilen.uzaklik) secilen = { p, uzaklik, z: zDisi };
  }
  if (!secilen) return null;
  const sec = secilen;
  const digerleri = n.filter((p) => p !== sec.p).map((p) => p.deger).sort((a, b) => a - b);
  const normal = ceyrek(digerleri, 0.5);
  const sapma = Math.abs(sec.p.deger - normal) / Math.max(Math.abs(normal), 1);
  return {
    kural: "aykiri",
    onem: puan((sec.z ? 0.9 : 0.7) * Math.min(1, sapma / 2)),
    kanit: {
      etiket: sec.p.etiket,
      olcuAdi: seri.olcuAdiCumleIci ?? seri.olcuAdi,
      deger: sec.p.deger,
      normal: yuvarla(normal, 1),
      birim: seri.birim,
      yon: sec.p.deger > normal ? "yuksek" : "dusuk",
      yontem: sec.z ? "z" : "iqr",
    },
  };
}

/** Parametre eşiğini aşan miktar (> 0). Toplam verilirse önem payla ölçeklenir. */
export function esikAsimi(g: ThresholdInput): Gozlem | null {
  if (!(g.deger > 0)) return null;
  const etki = g.toplam && g.toplam > 0 ? Math.min(1, g.deger / g.toplam) : 0.5;
  const { toplam: _t, ...kanit } = g;
  return { kural: "esikAsimi", onem: puan(etki), kanit };
}

const gunNo = (at: Date): number => {
  const [y, m, d] = factoryYmd(at).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * Müşteri kendi ritminin 2 katından uzun süredir sipariş vermiyor. Ritim = ardışık sipariş
 * GÜNLERİ (fabrika günü) arasının ortalaması; en az 3 sipariş günü gerekir. En sessiz tek müşteri.
 */
export function sessizlesen(musteriler: MusteriRitmi[], bugun: Date): Gozlem | null {
  const bugunNo = gunNo(bugun);
  const adaylar: { ad: string; sessiz: number; ort: number; gun: number; oran: number }[] = [];
  for (const m of musteriler) {
    const gunler = [...new Set(m.siparisTarihleri.map(gunNo))].filter((g) => g <= bugunNo).sort((a, b) => a - b);
    if (gunler.length < 3) continue;
    const araliklar = gunler.slice(1).map((g, i) => g - gunler[i]);
    const ort = ortalama(araliklar);
    const sessiz = bugunNo - gunler[gunler.length - 1];
    if (ort <= 0 || sessiz <= SESSIZLIK_KATI * ort) continue;
    adaylar.push({ ad: m.ad, sessiz, ort, gun: gunler.length, oran: sessiz / ort });
  }
  if (adaylar.length === 0) return null;
  adaylar.sort((a, b) => b.oran - a.oran || (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0));
  const en = adaylar[0];
  return {
    kural: "sessizlesen",
    onem: puan(Math.min(1, (en.gun - 1) / 5) * Math.min(1, 0.4 + (en.oran - SESSIZLIK_KATI) / 4)),
    kanit: { ad: en.ad, sessizGun: en.sessiz, ortalamaAralik: Math.max(1, Math.round(en.ort)), siparisGunu: en.gun, digerSessiz: adaylar.length - 1 },
  };
}

/** Hesaptan dışlanan küme (> 0) her zaman söylenir. */
export function scopeNote(g: ScopeNoteInput): Gozlem | null {
  if (!(g.sayi > 0)) return null;
  const etki = g.toplam && g.toplam > 0 ? Math.min(1, 0.3 + g.sayi / g.toplam) : 0.3;
  return { kural: "kapsamNotu", onem: puan(etki), kanit: { sayi: g.sayi, nesne: g.nesne, neden: g.neden, sonuc: g.sonuc } };
}

/** Analiz kanıtı (R3): güçlü kanıt öne çıkar; örneklem uyarısı varken hiç üretilmez. */
export function correlationObservation(g: AnalysisInput): Gozlem | null {
  if (g.orneklem || !g.korelasyon || !Number.isFinite(g.korelasyon.p)) return null;
  const k = g.korelasyon;
  const strength = k.p < 0.01 ? 0.9 : k.p < 0.05 ? 0.75 : 0.45;
  return { kural: "korelasyon", onem: puan(strength), kanit: k };
}

/** Küçük örneklem uyarısı her zaman söylenir (kanıt cümlesinin yerine). */
export function sampleWarningObservation(g: AnalysisInput): Gozlem | null {
  return g.orneklem ? { kural: "orneklemUyarisi", onem: puan(0.95), kanit: g.orneklem } : null;
}
