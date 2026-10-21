// =============================================================================
// KUMAŞ ADI AYIKLAMA — SAF KURALLAR (DB'siz) · S5 veri uyumu
// =============================================================================
// Tüketici: `scripts/dokuma-urun-adi-ayikla.ts` (öneri tablosu) · bekçi
// `scripts/test_dokuma_urun_adi_ayikla.ts`. Plan: docs/design/DOKUMA-MANUEL-PLAN.md § S5.
//
// NEDEN KATLANMIŞ METİNDE EŞLEŞME: fabrika adları aynı sözcüğü iki yazımla taşıyor
// (ACTIVO/ACTİVO, ÇELIK/ÇELİK). Kalıplar `foldSearchText` ile KARAKTER KARAKTER
// katlanmış metinde koşar; katlama Türkçe harflerde uzunluğu korur, dolayısıyla
// eşleşmenin dizinleri ÖZGÜN addan dilim almak için kullanılır. Çıktı sözcükleri
// kanonik yazıma çevrilir (`KANONIK`). Ad DEĞİŞMEZ — yalnız öneri üretilir.
// =============================================================================
import { foldSearchText } from "../../src/utils/search-fold";

/** Sınıflar — veri.md §3 tablosu. Bileşik sınıflar parçalardan kurulur (EN+KOK+ATKI/SIM …). */
export type Sinif = string;

export interface Ayiklama {
  ad: string;
  sinif: Sinif;
  kok: string;
  cozguRengi: "" | "SİYAH" | "BEYAZ";
  atkiSim: string;
  varyant: string;
  en: string;
  oneriCozguKarti: "" | "ÇÖZGÜ SİYAH" | "ÇÖZGÜ BEYAZ";
  oneriAtkiKarti: "" | "ALTIN SİM" | "GÜMÜŞ SİM" | "SEDEF" | "ŞEFFAF" | "SADE";
  /** VARYANT / RENK-ADI: S5c bu satırlara KABUL yazılsa bile yazmaz. */
  dokunulmaz: boolean;
  /** İnsan için tek satır gerekçe (KARAR BEKLER sebebi, çoklu atkı işareti…). */
  not: string;
}

// ── Sözlük (katlanmış biçim → kanonik yazım) ─────────────────────────────────
const SIM_SOZCUKLERI = ["altin", "gumus", "sedef", "seffaf", "simli", "simsiz", "sim", "sade", "celik"];
const RENK_SOZCUKLERI = ["beyaz", "krem", "ekru", "siyah", "bej", "gri"];
const KANONIK: Readonly<Record<string, string>> = {
  altin: "ALTIN", gumus: "GÜMÜŞ", sedef: "SEDEF", seffaf: "ŞEFFAF", simli: "SİMLİ",
  simsiz: "SİMSİZ", sim: "SİM", sade: "SADE", celik: "ÇELİK",
  beyaz: "BEYAZ", krem: "KREM", ekru: "EKRU", siyah: "SİYAH", bej: "BEJ", gri: "GRİ",
};
/** Tüm kök eşitlemesi (katlanmış kök → kanonik kök). */
const KOK_KANONIK: Readonly<Record<string, string>> = {
  activo: "ACTİVO",
  celik: "ÇELİK",
  mikrocanvas: "MİKRO CANVAS",
};

const TOK = `(?:${[...SIM_SOZCUKLERI, ...RENK_SOZCUKLERI].join("|")})`;
const AYRAC = String.raw`(?:\s*-\s*|\s+)`;

// ── Kalıplar (veri.md §2, sıra yukarıdan aşağı; KATLANMIŞ metne uygulanır) ────
export const KALIPLAR = {
  cozguParantez: /\(\s*(siyah|beyaz)\s+cozgu\s*\)/,
  cozguKokSonrasi: /^(activo)\s+(siyah|beyaz)\s*-\s*\(?\s*(.+?)\s*\)?$/d,
  enGenis: /^genis\s+/,
  varyant: /\s+v-(\d+|altin)$/,
  simOnek: /^simli\s+/,
  renkAdi: new RegExp(`^(?:${RENK_SOZCUKLERI.join("|")})\\s+(?:${SIM_SOZCUKLERI.join("|")})$`),
  yalnizKodSayi: /^\d+$/,
  yalnizKodHarf: /^(?:(?:mc|bs|bgr|dnr|mrt|asc)\s?-?\s?\d{2,5}|v-\d{3,5}|quality\s+\d+)$/,
  kokKod: /^(alp|paris)-(\d{3,5})$/,
  // Atkı/sim eki: ayraçla başlar, sondaki TÜM sözcükler sözlükten olmalı.
  atkiEki: new RegExp(`${AYRAC}(${TOK}(?:${AYRAC}${TOK})*)$`),
  kokNormal: /^([a-z]{2,})[\s-]?(\d+)$/,
} as const;

/**
 * Elle karar isteyen adlar (veri.md §6.6) — kalıpla ayırt edilemez: BAYRO FLAM'a
 * FLAM birleştirilmiş (ek mi kök mü?), diğerleri tanınmayan ek taşıyor.
 */
const KARAR_BEKLER_ADLARI: ReadonlyMap<string, string> = new Map([
  ["bayro flam", "FLAM ayrı kalemken buna birleştirilmiş — ek mi kök mü elle karar"],
  ["300txtr negatif", "tanınmayan ek (NEGATİF)"],
  ["elisado-nope", "tanınmayan ek (NOPE)"],
  ["in cu matase", "tanınmayan biçim"],
]);
/** Ürün olmayan kayıtlar: numune ve sayısal çöp (veri.md §3 OZEL). */
const OZEL_ADLAR: ReadonlyMap<string, string> = new Map([
  ["numune", "numune kaydı — ürün değil"],
  ["1231231", "sayısal deneme kaydı"],
]);

/** Karakter karakter katlama — uzunluğu KORUR (dizinler özgün metne uygulanabilsin). */
export function katla(s: string): string {
  let out = "";
  for (const ch of s) {
    const k = foldSearchText(ch);
    // Çok karaktere inen (Æ) ya da boşluğa inen karakter olduğu gibi kalır.
    out += k.length === ch.length ? k : ch;
  }
  return out;
}

function bosluklariTekle(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Atkı/sim parçasını kanonik yazıma çevirir: `ALTIN -BEJ` → `ALTIN-BEJ`, `ÇELIK` → `ÇELİK`. */
export function atkiKanonik(parca: string): string {
  const p = bosluklariTekle(parca).replace(/\s*-\s*/g, "-");
  const k = katla(p);
  let out = "";
  let i = 0;
  for (const m of k.matchAll(/[a-z]+/g)) {
    const bas = m.index;
    out += p.slice(i, bas) + (KANONIK[m[0]] ?? p.slice(bas, bas + m[0].length));
    i = bas + m[0].length;
  }
  return (out + p.slice(i)).replace(/^[\s-]+|[\s-]+$/g, "");
}

/** Kök normalizasyonu: `BGR150`/`ASC-01` → `BGR 150`/`ASC 01`; ACTIVO → ACTİVO … */
export function kokNormal(kok: string): string {
  const s = kok.replace(/^[\s-]+|[\s-]+$/g, "");
  const k = katla(s);
  const sabit = KOK_KANONIK[k];
  if (sabit) return sabit;
  const m = KALIPLAR.kokNormal.exec(k);
  if (m) return `${s.slice(0, m[1].length)} ${m[2]}`;
  return s;
}

/** Atkı/sim metninden tek atkı kartı önerisi; birden çok kart işaretliyse boş + not. */
export function atkiKartiOner(atkiSim: string): { kart: Ayiklama["oneriAtkiKarti"]; not: string } {
  const sozler = new Set(katla(atkiSim).match(/[a-z]+/g) ?? []);
  const kartlar = new Set<Exclude<Ayiklama["oneriAtkiKarti"], "">>();
  if (sozler.has("altin")) kartlar.add("ALTIN SİM");
  if (sozler.has("gumus")) kartlar.add("GÜMÜŞ SİM");
  if (sozler.has("sedef")) kartlar.add("SEDEF");
  if (sozler.has("seffaf")) kartlar.add("ŞEFFAF");
  if (sozler.has("sade") || sozler.has("simsiz")) kartlar.add("SADE");
  if (kartlar.size === 1) return { kart: [...kartlar][0], not: "" };
  if (kartlar.size > 1) return { kart: "", not: `çoklu atkı işareti (${[...kartlar].join(" + ")}) — elle seç` };
  return { kart: "", not: "" };
}

/** Kalem adından kök / çözgü / atkı-sim / varyant / en ayıklar. Saf; ad değişmez. */
export function ayikla(ad: string): Ayiklama {
  const n = bosluklariTekle(ad);
  let s = n;
  let kok = "";
  let cozgu: Ayiklama["cozguRengi"] = "";
  let atki = "";
  let varyant = "";
  let en = "";
  let sinif = "";
  const notlar: string[] = [];
  const renk = (k: string): Ayiklama["cozguRengi"] => (k === "siyah" ? "SİYAH" : "BEYAZ");

  // 1) Çözgü, parantezli: `1015-GÜMÜŞ SİMLİ (SİYAH ÇÖZGÜ)`.
  let m = KALIPLAR.cozguParantez.exec(katla(s));
  if (m) {
    cozgu = renk(m[1]);
    s = bosluklariTekle(s.slice(0, m.index) + s.slice(m.index + m[0].length));
  }
  // 2) Çözgü, kökten sonra: `ACTİVO SİYAH-(BEYAZ GÜMÜŞ)` (3. grup atkı).
  m = KALIPLAR.cozguKokSonrasi.exec(katla(s));
  if (m) {
    kok = "ACTİVO";
    cozgu = renk(m[2]);
    const [bas, son] = m.indices?.[3] ?? [0, 0];
    atki = atkiKanonik(s.slice(bas, son));
    s = "";
  }
  if (s) {
    // 3) En: `GENİŞ …`.
    m = KALIPLAR.enGenis.exec(katla(s));
    if (m) {
      en = "GENİŞ";
      s = s.slice(m[0].length);
    }
    // 4) Varyant: `… V-06` / `… V-ALTIN`.
    m = KALIPLAR.varyant.exec(katla(s));
    if (m) {
      varyant = `V-${m[1] === "altin" ? "ALTIN" : m[1]}`;
      s = s.slice(0, m.index);
    }
    // 5) Sim öneki: `SİMLİ NEPS VUAL`.
    m = KALIPLAR.simOnek.exec(katla(s));
    if (m) {
      atki = "SİMLİ";
      s = s.slice(m[0].length);
    }
  }
  const ks = (): string => katla(s);
  // 6) Ürün olmayan kayıt.
  if (s && OZEL_ADLAR.has(katla(n))) {
    kok = s;
    sinif = "OZEL";
    notlar.push(OZEL_ADLAR.get(katla(n)) ?? "");
    s = "";
  }
  // 7) Yalnız renk+sim adı (ürün değil): `BEYAZ GÜMÜŞ`.
  if (s && !en && !varyant && !atki && KALIPLAR.renkAdi.test(ks())) {
    sinif = "RENK-ADI";
    atki = atkiKanonik(s);
    s = "";
  }
  // 8) Yalnız kod: `20011`, `MC-158`, `BGR150`, `QUALİTY 07`.
  if (s && !en && !varyant && !atki && !cozgu && (KALIPLAR.yalnizKodSayi.test(ks()) || KALIPLAR.yalnizKodHarf.test(ks()))) {
    kok = kokNormal(s);
    sinif = "YALNIZ-KOD";
    s = "";
  }
  // 9) Kök + kod: `ALP-6150`.
  if (s && !atki && KALIPLAR.kokKod.test(ks())) {
    kok = s;
    sinif = "KOK+KOD";
    s = "";
  }
  // 10) Atkı/sim eki: `HERA -GÜMÜŞ`, `KRİSTAL ALTIN -BEJ`, `ALP SİMLİ ŞEFFAF SİM ALTIN`.
  //     `BGR 150 KREM` (veri.md §2 özel satırı) da buradan düşer: KREM sözlükte.
  if (s) {
    m = KALIPLAR.atkiEki.exec(ks());
    if (m && m.index > 0) {
      const bas = m.index + m[0].length - m[1].length;
      const ek = atkiKanonik(s.slice(bas));
      atki = atki ? `${atki} ${ek}` : ek;
      s = s.slice(0, m.index);
    }
  }
  if (s) {
    kok = kokNormal(s);
    s = "";
  }

  if (!sinif) {
    const parcalar = ["KOK"];
    if (en) parcalar.unshift("EN");
    if (cozgu) parcalar.push("COZGU");
    if (atki) parcalar.push("ATKI/SIM");
    if (varyant) parcalar.push("VARYANT");
    sinif = parcalar.join("+");
  }
  const kararSebebi = KARAR_BEKLER_ADLARI.get(katla(n));
  if (kararSebebi) {
    sinif = "?";
    notlar.push(kararSebebi);
  } else if (!kok && sinif !== "RENK-ADI") {
    sinif = "?";
    notlar.push("kök çıkarılamadı");
  } else if (/[()]/.test(kok)) {
    sinif = "?";
    notlar.push("kökte parantez kaldı — tanınmayan yazım");
  }

  const dokunulmaz = sinif === "RENK-ADI" || varyant !== "";
  let oneriAtkiKarti: Ayiklama["oneriAtkiKarti"] = "";
  let oneriCozguKarti: Ayiklama["oneriCozguKarti"] = "";
  if (!dokunulmaz && sinif !== "?" && sinif !== "OZEL") {
    const o = atkiKartiOner(atki);
    oneriAtkiKarti = o.kart;
    if (o.not) notlar.push(o.not);
    if (cozgu) oneriCozguKarti = cozgu === "SİYAH" ? "ÇÖZGÜ SİYAH" : "ÇÖZGÜ BEYAZ";
  }
  if (dokunulmaz) notlar.push(varyant ? "varyant renk kataloğuna taşınmış" : "renk adı, ürün değil");

  return {
    ad: n, sinif, kok, cozguRengi: cozgu, atkiSim: atki, varyant, en,
    oneriCozguKarti, oneriAtkiKarti, dokunulmaz, not: notlar.filter(Boolean).join("; "),
  };
}

// ── Öneri tablosu (CSV) ───────────────────────────────────────────────────────
export const CSV_SUTUNLARI = [
  "itemId", "code", "name", "isActive", "lifecycleStatus", "topSayisi", "renkSayisi",
  "sinif", "kok", "cozguRengi", "atkiSim", "varyant", "en",
  "oneriCozguKarti", "oneriAtkiKarti", "KARAR",
] as const;

export interface KalemSatiri {
  itemId: string;
  code: string;
  name: string;
  isActive: boolean;
  lifecycleStatus: string;
  topSayisi: number;
  renkSayisi: number;
}

export interface OneriSatiri extends KalemSatiri {
  ayiklama: Ayiklama;
}

function csvAlan(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvYaz(satirlar: readonly OneriSatiri[]): string {
  const govde = satirlar.map((r) => {
    const a = r.ayiklama;
    return [
      r.itemId, r.code, r.name, String(r.isActive), r.lifecycleStatus, String(r.topSayisi), String(r.renkSayisi),
      a.sinif, a.kok, a.cozguRengi, a.atkiSim, a.varyant, a.en, a.oneriCozguKarti, a.oneriAtkiKarti, "",
    ].map(csvAlan).join(",");
  });
  return [CSV_SUTUNLARI.join(","), ...govde].join("\n") + "\n";
}

/** RFC 4180 ayrıştırıcı (tırnak, gömülü virgül/satır sonu). Başlık satırı → nesne. */
export function csvOku(metin: string): Record<string, string>[] {
  const satirlar: string[][] = [];
  let alan = "";
  let satir: string[] = [];
  let tirnak = false;
  const t = metin.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (tirnak) {
      if (c === '"' && t[i + 1] === '"') { alan += '"'; i++; }
      else if (c === '"') tirnak = false;
      else alan += c;
    } else if (c === '"') tirnak = true;
    else if (c === "," || c === ";") { satir.push(alan); alan = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      satir.push(alan); alan = "";
      if (satir.some((x) => x !== "")) satirlar.push(satir);
      satir = [];
    } else alan += c;
  }
  satir.push(alan);
  if (satir.some((x) => x !== "")) satirlar.push(satir);
  const [baslik, ...govde] = satirlar;
  if (!baslik) return [];
  return govde.map((r) => Object.fromEntries(baslik.map((b, i) => [b.trim(), (r[i] ?? "").trim()])));
}

/** `--kabul` CSV'sinden KARAR=KABUL satırlarının itemId kümesi; zorunlu sütun yoksa hata. */
export function kabulKimlikleri(metin: string): Set<string> {
  const satirlar = csvOku(metin);
  if (satirlar.length > 0 && (!("itemId" in satirlar[0]) || !("KARAR" in satirlar[0]))) {
    throw new Error("kabul CSV'sinde `itemId` ve `KARAR` sütunları zorunlu");
  }
  return new Set(
    satirlar.filter((r) => katla(r.KARAR ?? "") === "kabul" && r.itemId).map((r) => r.itemId),
  );
}

export interface PlanKalemi {
  satir: OneriSatiri;
  /** S2 alanı `weftSpecId` için atkı kartı adı. */
  atkiKarti: string;
}
export interface UygulamaPlani {
  yazilacak: PlanKalemi[];
  atlanan: { satir: OneriSatiri; sebep: string }[];
  bulunamayan: string[];
}

/**
 * S5c yazım planı — KABUL edilen satırlardan neyin YAZILACAĞINI ve neyin ATLANACAĞINI
 * belirler. Çözgü kartı üretilmez: `WarpSpec.yarnItemId` NOT NULL ve fabrikada YARN
 * kalemi yok (iplik kalemi kararı kullanıcıda) → satır "iplik kalemi yok" diye listelenir.
 */
export function uygulamaPlani(satirlar: readonly OneriSatiri[], kabul: ReadonlySet<string>): UygulamaPlani {
  const plan: UygulamaPlani = { yazilacak: [], atlanan: [], bulunamayan: [] };
  const byId = new Map(satirlar.map((r) => [r.itemId, r]));
  for (const id of kabul) if (!byId.has(id)) plan.bulunamayan.push(id);
  for (const r of satirlar) {
    if (!kabul.has(r.itemId)) continue;
    const a = r.ayiklama;
    if (a.dokunulmaz) { plan.atlanan.push({ satir: r, sebep: "DOKUNULMAZ (varyant / renk adı)" }); continue; }
    if (a.sinif === "?" || a.sinif === "OZEL") { plan.atlanan.push({ satir: r, sebep: `sınıf ${a.sinif} — öneri yok` }); continue; }
    if (a.oneriCozguKarti) plan.atlanan.push({ satir: r, sebep: `${a.oneriCozguKarti}: iplik kalemi yok (WarpSpec.yarnItemId)` });
    if (a.oneriAtkiKarti) plan.yazilacak.push({ satir: r, atkiKarti: a.oneriAtkiKarti });
    else if (!a.oneriCozguKarti) plan.atlanan.push({ satir: r, sebep: "atkı kartı önerisi yok" });
  }
  return plan;
}
