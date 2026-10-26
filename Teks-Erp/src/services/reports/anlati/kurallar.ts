// =============================================================================
// Kural şablonları — gözlem kanıtı → günlük dilde tek Türkçe cümle (plan §3.5 kataloğu)
// =============================================================================
// Ek kestirilemezse (`ek.ts` null) cümle DÜŞMEZ, eksiz yedek kalıba geçer. Cümle başındaki
// büyük harf çağıranın verdiği metindedir; motor harf dönüştürmez (`toLocaleUpperCase` yok).

import { ayrilma, bulunma, ile, iyelik3, durative, yonelme, type SuffixInput } from "./ek";
import type { Gozlem, KanitHaritasi } from "./gozlem";
import { formatValue, oranMetni, sayiMetni } from "./sayi-bicim";
import { tamSayiOkunus } from "./sayi-okunus";

const ONCEKI_DONEM: SuffixInput = { tur: "ad", metin: "önceki dönem", kesme: false };
const yuzdeEk = (pay: number): string => iyelik3({ tur: "yuzde", deger: pay }) ?? oranMetni(pay);

function anaSayiKiyasCumlesi(k: KanitHaritasi["anaSayiKiyas"]): string {
  const sayi = formatValue(k.deger, k.birim);
  // Yüklemsiz (özel rapor ölçüsü): cümle ölçünün sözlük adıyla açılır.
  const bas = !k.yuklem
    ? `${k.ad}: ${(k.donem && bulunma(k.donem)) ?? "bu dönemde"} ${sayi}`
    : k.ozne && k.birim === "yuzde"
      ? `${k.ozne} ${yuzdeEk(k.deger)} ${k.yuklem}`
      : `${(k.donem && bulunma(k.donem)) ?? "Bu dönemde"} ${sayi} ${k.yuklem}`;
  const kiyasAd = k.kiyasDonem ?? ONCEKI_DONEM;
  const { yon, fark, yuzde } = k.kiyas;
  if (yon === null || fark === null) return `${bas}; önceki dönem ölçülemediği için kıyas yok.`;
  if (yon === "degismedi") return `${bas}; ${ile(kiyasAd) ?? "önceki dönemle"} aynı düzeyde.`;
  const gore = `${yonelme(kiyasAd) ?? "önceki döneme"} göre`;
  const artti = yon === "artti";
  if (k.birim === "yuzde") return `${bas}; ${gore} ${sayiMetni(Math.abs(fark), 1)} puan ${artti ? "yüksek" : "düşük"}.`;
  const farkMetni = yuzde !== null ? oranMetni(Math.abs(yuzde)) : formatValue(Math.abs(fark), k.birim);
  return `${bas}; ${gore} ${farkMetni} ${artti ? "fazla" : "az"}.`;
}

function katkiSozu(katki: number): string {
  if (katki >= 0.95) return "neredeyse tamamı";
  if (katki >= 0.75) return "büyük kısmı";
  if (katki >= 0.45 && katki <= 0.55) return "yarısı";
  return yuzdeEk(Math.round(katki * 100));
}

/** Kalemin cümledeki adı: özel ad kesmeyle, cins ad boyutla bitişik ("lacivert renk"). */
function kalem(ad: string, adTuru: "ozel" | "cins", boyut: string): SuffixInput {
  return adTuru === "ozel" ? { tur: "ad", metin: ad } : { tur: "ad", metin: `${ad} ${boyut}`, kesme: false };
}

/** Her analiz cümlesinin sonundaki sabit not (plan §3.8). */
export const CAUSALITY_NOTE = "İlişki, nedeni göstermez.";

/** Kanıt dili: olasılık eşiği cümlede sayı olarak geçmez. */
export function evidenceWord(p: number): "güçlü kanıt" | "kanıt var" | null {
  return p < 0.01 ? "güçlü kanıt" : p < 0.05 ? "kanıt var" : null;
}

/** |r| → günlük dil (0,1 zayıf · 0,3 orta · 0,5 güçlü). */
export function strengthWord(r: number): string | null {
  const a = Math.abs(r);
  return a >= 0.5 ? "güçlü" : a >= 0.3 ? "orta düzeyde" : a >= 0.1 ? "zayıf" : null;
}

function analysisSentence(k: KanitHaritasi["korelasyon"]): string {
  const kanit = evidenceWord(k.p);
  const measured = `${sayiMetni(k.n, 0)} ${k.nesne} üzerinden ölçüldü`;
  if (k.yontem === "kiKare" && k.tur === "oran") {
    const kat =
      k.kat === null ? "" : k.kat >= 1.15 ? ` — yaklaşık ${sayiMetni(k.kat, 1)} katı` : k.kat <= 0.87 ? ` — yaklaşık ${oranMetni(Math.round((1 - k.kat) * 100))} daha az` : "";
    const head = `${k.yer} ${k.olcuAdi} ${k.birimSozu} ${sayiMetni(k.oran, 1)}; diğerlerinde ${sayiMetni(k.digerOran, 1)}${kat}.`;
    const tail = kanit ? `Bu fark tesadüf olmayacak kadar büyük (${kanit}; ${measured}).` : `Belirgin bir fark görünmüyor (${measured}).`;
    return `${head} ${tail} ${CAUSALITY_NOTE}`;
  }
  if (k.yontem === "kiKare") {
    const head = `${k.yer} ${k.ikinciAd} payı ${oranMetni(k.pay)}; genelde ${oranMetni(k.genelPay)}.`;
    const tail = kanit ? `Bu fark tesadüf olmayacak kadar büyük (${kanit}; ${measured}).` : `Belirgin bir ilişki görünmüyor (${measured}).`;
    return `${head} ${tail} ${CAUSALITY_NOTE}`;
  }
  const strength = strengthWord(k.r);
  const head = strength
    ? `${k.xAdi} arttıkça ${k.yAdi} ${k.r > 0 ? "artıyor" : "azalıyor"} (${strength} ilişki).`
    : `${k.xAdi} ile ${k.yAdi} birlikte değişmiyor.`;
  const tail = kanit && strength ? `Bu ilişki tesadüf olmayacak kadar belirgin (${kanit}; ${measured}).` : `Belirgin bir ilişki görünmüyor (${measured}).`;
  return `${head} ${tail} ${CAUSALITY_NOTE}`;
}

function sampleSentence(k: KanitHaritasi["orneklemUyarisi"]): string {
  if (k.n < k.gereken) return `Yalnız ${sayiMetni(k.n, 0)} ${k.nesne} var; karar vermek için en az ${k.gereken} gerekir. ${CAUSALITY_NOTE}`;
  return `Bazı gruplarda kayıt çok az; karar vermek için daha uzun bir dönem seçin. ${CAUSALITY_NOTE}`;
}

/** Gözlemi cümleye çevirir. */
export function cumleKur(g: Gozlem): string | null {
  switch (g.kural) {
    case "veriYok":
      return "Bu dönemde kayıt yok.";
    case "suzgecKesti":
      return `Seçtiğiniz süzgeçle kayıt kalmadı (süzgeçsiz ${sayiMetni(g.kanit.suzgecsiz, 0)} kayıt var).`;
    case "olculemedi":
      return g.kanit.neden ? `${g.kanit.ad} ölçülemedi: ${g.kanit.neden}.` : `${g.kanit.ad} ölçülemedi.`;
    case "anaSayiKiyas":
      return anaSayiKiyasCumlesi(g.kanit);
    case "enBuyukPay": {
      const k = g.kanit;
      const yer = bulunma(kalem(k.ad, k.adTuru, k.boyut));
      const body = `${formatValue(k.deger, k.birim)} (toplamın ${yuzdeEk(k.pay)})`;
      return yer ? `En büyük pay ${yer}: ${body}.` : `En büyük pay — ${k.ad}: ${body}.`;
    }
    case "yogunlasma": {
      const k = g.kanit;
      const source = ayrilma({ tur: "ad", metin: `üç ${k.boyut}`, kesme: false });
      return source
        ? `${k.ozneIlgi} ${yuzdeEk(k.pay)} ${source} geliyor.`
        : `${k.ozneIlgi} ${yuzdeEk(k.pay)} ilk üç kalemde: ${k.ilkUc.join(", ")}.`;
    }
    case "degisimKaynagi": {
      const k = g.kanit;
      const bas = `${k.yon === "artis" ? "Artışın" : "Düşüşün"} ${katkiSozu(k.katki)}`;
      const source = ayrilma(kalem(k.ad, k.adTuru, k.boyut));
      return source ? `${bas} ${source} geliyor.` : `${bas} tek kalemden geliyor: ${k.ad}.`;
    }
    case "egilim": {
      const k = g.kanit;
      const birim: SuffixInput = { tur: "ad", metin: k.zamanBirimi, kesme: false };
      const since = k.ardisik >= 2 ? durative(birim) : null;
      if (since) return `${k.olcuAdi} ${tamSayiOkunus(k.ardisik)} ${since} ${k.yon === "dusuyor" ? "düşüyor" : "artıyor"}.`;
      const inUnit = bulunma(birim) ?? `${k.zamanBirimi} içinde`;
      return `${k.olcuAdi} son ${k.nokta} ${inUnit} ${k.yon === "dusuyor" ? "düşüş" : "artış"} eğiliminde.`;
    }
    case "aykiri": {
      const k = g.kanit;
      const sifat = k.yon === "yuksek" ? "yüksek" : "düşük";
      const body = `${formatValue(k.deger, k.birim)} (normalde ${formatValue(k.normal, k.birim)})`;
      const yer = bulunma({ tur: "ad", metin: k.etiket });
      return yer ? `${yer} ${k.olcuAdi} olağandışı ${sifat}: ${body}.` : `Olağandışı ${sifat} ${k.olcuAdi} — ${k.etiket}: ${body}.`;
    }
    case "esikAsimi": {
      const k = g.kanit;
      const yer = bulunma({ tur: "ad", metin: k.yer, kesme: false });
      const esikten = ayrilma({ tur: "ad", metin: k.esikBirimi, kesme: false });
      const miktar = `${formatValue(k.deger, k.birim)} ${k.nesne}`;
      if (yer && esikten) return `${yer} ${sayiMetni(k.esik, 1)} ${esikten} ${k.sifat} ${miktar} var.`;
      return `${k.yer}: eşiği (${sayiMetni(k.esik, 1)} ${k.esikBirimi}) aşan ${miktar} var.`;
    }
    case "sessizlesen": {
      const k = g.kanit;
      const ek = k.digerSessiz > 0 ? ` Ritmini kaçıran ${k.digerSessiz} müşteri daha var.` : "";
      return `${k.ad} ${sayiMetni(k.sessizGun, 0)} gündür sipariş vermiyor; normalde ${sayiMetni(k.ortalamaAralik, 0)} günde bir veriyordu.${ek}`;
    }
    case "kapsamNotu": {
      const k = g.kanit;
      return `${k.neden} ${sayiMetni(k.sayi, 0)} ${k.nesne} ${k.sonuc}.`;
    }
    case "korelasyon":
      return analysisSentence(g.kanit);
    case "orneklemUyarisi":
      return sampleSentence(g.kanit);
  }
}
