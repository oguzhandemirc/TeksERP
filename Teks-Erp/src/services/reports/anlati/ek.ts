// =============================================================================
// Türkçe ek motoru — ünlü uyumu, sert ünsüz benzeşmesi, kaynaştırma; kesmeli tam yazım
// =============================================================================
// Kalıp harfleri: D → d/t (sert ünsüzden sonra t) · A → a/e · I → ı/i/u/ü · (y)/(n)/(s) yalnız
// ünlüden sonra. Emin olunamayan gövdede (kısaltma, yabancı ad, ünlüsüz) `null` döner ve
// çağıran EKSİZ yedek kalıba düşer — yanlış ek, eksiz cümleden kötüdür.
// Büyük/küçük harf yalnız `utils/tr-case` üzerinden (`toLocaleUpperCase("tr")` yasağı).

import { lowerTr, upperTr } from "../../../utils/tr-case";
import { sayiMetni } from "./sayi-bicim";
import { sonOkunanSozcuk, tamSayiOkunus } from "./sayi-okunus";

export type SuffixInput =
  | { tur: "sayi"; deger: number; ondalik?: number }
  | { tur: "yuzde"; deger: number }
  /**
   * `kesme` (varsayılan true): özel ad kesmeyle ek alır ("Kaya Tekstil'de"); cins ad
   * (`kesme:false`) bitişik yazılır ("renkten"). Cins adda p/ç/t/k + ünlü ek yumuşama
   * ister ve kestirilemez → `null`; yumuşamadığını bilen çağıran `yumusamaz:true` der.
   */
  | { tur: "ad"; metin: string; kesme?: boolean; yumusamaz?: boolean };

const UNLULER = "aeıioöuüâîû";
const KALIN = "aıouâû";
const SERT = "fstkçşhp";
const YUMUSAYAN = "pçtk";
/** Türk alfabesi (q, w, x yok) — dışındaki harf yabancı ad izidir. */
const TR_HARF = /^[abcçdefgğhıijklmnoöprsştuüvyzâîû]+$/;
/** Türkçede kelime sonunda bulunmayan ünsüz kümeleri ve yabancı yazım izleri. */
const YABANCI_SON = /(rd|nd|ld|dt|tz|ts|ng|gs|ds|ns|rg|nz|mb)$/;
const YABANCI_IZ = /(th|sch|ph|ck|gh|sh|ch)/;

interface Stem {
  yazim: string;
  /** Ekin uyacağı okunuş sözcüğü (küçük harf). */
  okunus: string;
  kesme: boolean;
  /** Cins ad yumuşamaya açık mı (p/ç/t/k ile biten, `yumusamaz` beyanı yok). */
  yumusar: boolean;
}

function adOkunusu(metin: string): string | null {
  const parcalar = metin.trim().split(/\s+/);
  const son = parcalar[parcalar.length - 1] ?? "";
  if (!son) return null;
  // Rakamla biten kod ("P07", "Tezgah 12"): sondaki sayının okunuşu.
  const rakam = /(\d+)$/.exec(son);
  if (rakam) {
    const okunus = tamSayiOkunus(Number(rakam[1].replace(/^0+(?=\d)/, "")));
    if (!okunus) return null;
    const s = okunus.split(" ");
    return s[s.length - 1];
  }
  if (!/^\p{L}+$/u.test(son)) return null;
  const kucuk = lowerTr(son);
  const buyukHarfli = son === upperTr(son);
  const unluVar = [...kucuk].some((h) => UNLULER.includes(h));
  // Büyük harf kısaltma harf harf okunur ("THY'ye") — kestirilemez.
  if (buyukHarfli && (son.length <= 3 || !unluVar)) return null;
  if (!TR_HARF.test(kucuk) || !unluVar) return null;
  if (YABANCI_IZ.test(kucuk) || YABANCI_SON.test(kucuk)) return null;
  // Son hecede yan yana iki ünlü ("Renault", "Bordeaux") ya da ünsüz+y sonu ("Sony"): okunuş belirsiz.
  if (/[aeıioöuüâîû]{2}[^aeıioöuüâîû]*$/.test(kucuk) || /[^aeıioöuüâîû]y$/.test(kucuk)) return null;
  return kucuk;
}

function buildStem(g: SuffixInput): Stem | null {
  if (g.tur === "sayi" || g.tur === "yuzde") {
    if (!Number.isFinite(g.deger)) return null;
    const metin = sayiMetni(g.deger, g.tur === "yuzde" ? 1 : (g.ondalik ?? 1));
    const okunus = sonOkunanSozcuk(metin);
    if (!okunus) return null;
    return { yazim: g.tur === "yuzde" ? `%${metin}` : metin, okunus, kesme: true, yumusar: false };
  }
  const okunus = adOkunusu(g.metin);
  if (!okunus) return null;
  const kesme = g.kesme ?? true;
  const yumusar = !kesme && !g.yumusamaz && YUMUSAYAN.includes(okunus[okunus.length - 1]);
  return { yazim: g.metin.trim(), okunus, kesme, yumusar };
}

function sonUnlu(s: string): string | null {
  for (let i = s.length - 1; i >= 0; i--) if (UNLULER.includes(s[i])) return s[i];
  return null;
}

function darUnlu(u: string): string {
  if ("aıâ".includes(u)) return "ı";
  if ("eiî".includes(u)) return "i";
  if ("ouû".includes(u)) return "u";
  return "ü";
}

/**
 * Genel ek kurucu. `kalip` harfleri: D, A, I büyük harfle; tampon ünsüz parantezde ("(y)A").
 * Dönüş kesmeli/bitişik tam yazım ya da `null` (gövde kestirilemedi).
 */
export function ekle(g: SuffixInput, kalip: string): string | null {
  const stem = buildStem(g);
  if (!stem) return null;
  const unlu = sonUnlu(stem.okunus);
  if (!unlu) return null;
  const sonHarf = stem.okunus[stem.okunus.length - 1];
  const unluyleBiter = UNLULER.includes(sonHarf);
  const sert = SERT.includes(sonHarf);
  let ek = "";
  for (let i = 0; i < kalip.length; i++) {
    const h = kalip[i];
    if (h === "(") {
      const tampon = kalip[i + 1];
      i += 2;
      if (unluyleBiter) ek += tampon;
      continue;
    }
    if (h === "D") ek += sert ? "t" : "d";
    else if (h === "A") ek += KALIN.includes(unlu) ? "a" : "e";
    else if (h === "I") ek += darUnlu(unlu);
    else ek += h;
  }
  if (stem.yumusar && UNLULER.includes(ek[0] ?? "")) return null;
  return stem.kesme ? `${stem.yazim}'${ek}` : `${stem.yazim}${ek}`;
}

/** -da/-de/-ta/-te: "3'te", "Kaya Tekstil'de". */
export const bulunma = (g: SuffixInput): string | null => ekle(g, "DA");
/** -dan/-den/-tan/-ten: "40'tan", "renkten". */
export const ayrilma = (g: SuffixInput): string | null => ekle(g, "DAn");
/** -a/-e/-ya/-ye: "6'ya", "eylüle". */
export const yonelme = (g: SuffixInput): string | null => ekle(g, "(y)A");
/** -ı/-i/-u/-ü/-yı/-yi…: "3'ü", "6'yı". */
export const belirtme = (g: SuffixInput): string | null => ekle(g, "(y)I");
/** -ın/-in/-nın/-nin…: "1.000'in", "6'nın". */
export const ilgi = (g: SuffixInput): string | null => ekle(g, "(n)In");
/** -ı/-i/-sı/-si…: "%12'si", "%64'ü". */
export const iyelik3 = (g: SuffixInput): string | null => ekle(g, "(s)I");
/** -lık/-lik/-luk/-lük: "%12'lik", "100'lük". */
export const lik = (g: SuffixInput): string | null => ekle(g, "lIk");
/** -la/-le/-yla/-yle (ile): "eylülle", "6'yla". */
export const ile = (g: SuffixInput): string | null => ekle(g, "(y)lA");
/** -dır/-dir/-tır…(süre): "aydır", "gündür". */
export const durative = (g: SuffixInput): string | null => ekle(g, "DIr");
