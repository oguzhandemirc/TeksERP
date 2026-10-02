// =============================================================================
// KURULUM GİRDİSİ — satıcı hesabının setup.exe sihirbazından BORUYLA gelen tek JSON'u (saf, DB'siz)
// =============================================================================
// `superadmin-olustur --kurulum-stdin` kipi bunu çağırır. Etkileşimli kipin TTY kapısı (readline boru
// girdisinde sessizce DONAR) bu kipte gerekmez: burada readline YOK — tek JSON nesnesi, bayt tavanı ve
// zaman aşımıyla okunur; eksik/fazla alan, tavan, zaman aşımı GÜRÜLTÜLÜ hatadır (donma yok).
// SIR HİJYENİ: parola ve PIN hata iletisine, günlüğe, çıktıya GİRMEZ — JSON ayrıştırma hatası bile
// genel iletiyle döner (Node'un SyntaxError'u girdiden kesit basar).
// =============================================================================
import type { Readable } from "node:stream";

/** Sihirbazın gönderdiği nesne — başka anahtar KABUL EDİLMEZ (KATI). */
export interface KurulumGirdisi {
  kullaniciAdi: string;
  parola: string;
  /** TAM 6 hane: kurulum kipinde PIN ÜRETİLMEZ (üretilen PIN bir sır olarak geri dönmek zorunda kalırdı). */
  pin: string;
}

export const KURULUM_GIRDI_TAVANI = 4096;
export const KURULUM_ZAMAN_ASIMI_MS = 30_000;

export type KurulumGirdiHataKodu = "GIRDI_BICIMSIZ" | "GIRDI_TAVAN" | "ZAMAN_ASIMI" | "GIRDI_YOK";

export class KurulumGirdiHatasi extends Error {
  constructor(
    readonly kod: KurulumGirdiHataKodu,
    mesaj: string,
  ) {
    super(mesaj);
  }
}

const ANAHTARLAR = ["kullaniciAdi", "parola", "pin"] as const;

/** Ham metni doğrular (sır içeren metin hiçbir iletiye kopyalanmaz). */
export function kurulumGirdisiCoz(ham: string): KurulumGirdisi {
  const metin = ham.replace(/^﻿/, "").trim();
  if (!metin) throw new KurulumGirdiHatasi("GIRDI_YOK", "standart girdi boş — sihirbaz JSON göndermedi");
  let v: unknown;
  try {
    v = JSON.parse(metin);
  } catch {
    throw new KurulumGirdiHatasi("GIRDI_BICIMSIZ", "standart girdi JSON değil");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new KurulumGirdiHatasi("GIRDI_BICIMSIZ", "standart girdi bir JSON nesnesi değil");
  const o = v as Record<string, unknown>;
  const fazla = Object.keys(o).filter((k) => !(ANAHTARLAR as readonly string[]).includes(k));
  if (fazla.length) throw new KurulumGirdiHatasi("GIRDI_BICIMSIZ", `tanınmayan alan: ${fazla.join(", ")}`);
  for (const k of ANAHTARLAR) {
    if (typeof o[k] !== "string") throw new KurulumGirdiHatasi("GIRDI_BICIMSIZ", `${k} metin olmalı`);
  }
  if (!/^\d{6}$/.test(o.pin as string)) throw new KurulumGirdiHatasi("GIRDI_BICIMSIZ", "pin TAM 6 haneli rakam olmalı (kurulum kipinde üretilmez)");
  return { kullaniciAdi: o.kullaniciAdi as string, parola: o.parola as string, pin: o.pin as string };
}

/** Akıştan TEK nesne okur: bayt tavanı + zaman aşımı; akış kapanınca (EOF) çözer. */
export function kurulumGirdisiOku(
  akis: Readable,
  tavan = KURULUM_GIRDI_TAVANI,
  zamanAsimiMs = KURULUM_ZAMAN_ASIMI_MS,
): Promise<KurulumGirdisi> {
  return new Promise((resolve, reject) => {
    const parcalar: Buffer[] = [];
    let boy = 0;
    let bitti = false;
    const bitir = (hata: Error | null, deger?: KurulumGirdisi): void => {
      if (bitti) return;
      bitti = true;
      clearTimeout(saat);
      akis.removeListener("data", veri);
      akis.removeListener("end", son);
      akis.removeListener("error", hataDinle);
      akis.pause();
      for (const p of parcalar) p.fill(0);
      if (hata) reject(hata);
      else resolve(deger!);
    };
    const veri = (c: Buffer | string): void => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8");
      boy += b.length;
      if (boy > tavan) bitir(new KurulumGirdiHatasi("GIRDI_TAVAN", `standart girdi ${tavan} bayt tavanını aşıyor`));
      else parcalar.push(Buffer.from(b));
    };
    const son = (): void => {
      try {
        bitir(null, kurulumGirdisiCoz(Buffer.concat(parcalar).toString("utf8")));
      } catch (e) {
        bitir(e instanceof Error ? e : new Error(String(e)));
      }
    };
    const hataDinle = (): void => bitir(new KurulumGirdiHatasi("GIRDI_BICIMSIZ", "standart girdi okunamadı"));
    const saat = setTimeout(() => bitir(new KurulumGirdiHatasi("ZAMAN_ASIMI", `standart girdi ${zamanAsimiMs} ms içinde kapanmadı`)), zamanAsimiMs);
    akis.on("data", veri);
    akis.on("end", son);
    akis.on("error", hataDinle);
    akis.resume();
  });
}
