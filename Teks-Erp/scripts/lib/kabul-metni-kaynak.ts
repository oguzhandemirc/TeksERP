// İLK KURULUM KABUL METNİNİN KAYNAĞI: `docs/hukuk/KABUL-METNI.md` — "Metin kimliği" satırı + "## 2." başlığının
// altındaki alıntı bloğu (panelde aynen gösterilen metin). Üretici (`kabul-metni-uret.ts`) ve bekçi
// (`test_lisans_kabul.ts`) AYNI okuyucuyu kullanır; biçim tanınmazsa FIRLATIR (yanlış metin üretilmez).
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACCEPTANCE_TEXTS, AcceptanceTextIdSchema, acceptanceTextDigest, type AcceptanceTextEntry } from "../../src/lib/license/protocol";
import { acceptanceBoxes, parseAcceptanceBlocks } from "../../src/lib/license/acceptance-text";

export const KABUL_BELGESI = path.resolve(__dirname, "..", "..", "..", "docs", "hukuk", "KABUL-METNI.md");
export const KATALOG_DOSYASI = path.resolve(__dirname, "..", "..", "src", "lib", "license", "protocol", "kabul-katalogu.ts");
export const METIN_DOSYASI = path.resolve(__dirname, "..", "..", "src", "lib", "license", "acceptance-text.generated.ts");
export const PROTOKOL_DIZINI = path.dirname(KATALOG_DOSYASI);
export const PROTOKOL_AYNALARI = ["satici/sunucu/src/lisans-protokol", "patron/sunucu/src/lisans-protokol"].map((d) =>
  path.resolve(__dirname, "..", "..", "..", d),
);

export interface KabulKaynagi {
  readonly kimlik: string;
  /** Kanonik metin: alıntı işareti düşmüş, satır sonu boşlukları kırpılmış, NFC. */
  readonly metin: string;
  readonly ozet: string;
  readonly kutular: string[];
}

/** Belge metninden kaynak — saf (bekçinin negatif sondası mutasyonlu kopyayı buradan geçirir). */
export function kabulKaynaginiCoz(markdown: string): KabulKaynagi {
  const satirlar = markdown.replace(/\r\n?/g, "\n").split("\n");
  const kimlik = /Metin kimliği: `([^`]+)`/.exec(markdown)?.[1];
  if (!kimlik || !AcceptanceTextIdSchema.safeParse(kimlik).success) throw new Error(`Kabul metni: "Metin kimliği" satırı yok ya da biçimsiz (${kimlik ?? "—"})`);
  const baslik = satirlar.findIndex((s) => s.startsWith("## 2."));
  if (baslik < 0) throw new Error('Kabul metni: "## 2." (ekran metni) başlığı yok');
  let i = baslik + 1;
  while (i < satirlar.length && satirlar[i]!.trim() === "") i++;
  const blok: string[] = [];
  for (; i < satirlar.length && satirlar[i]!.startsWith(">"); i++) blok.push(satirlar[i]!.replace(/^> ?/, "").trimEnd());
  while (blok.length > 0 && blok[0] === "") blok.shift();
  while (blok.length > 0 && blok.at(-1) === "") blok.pop();
  if (blok.length === 0) throw new Error("Kabul metni: §2 alıntı bloğu boş");
  const metin = blok.join("\n").normalize("NFC");
  const kutular = acceptanceBoxes(parseAcceptanceBlocks(metin));
  if (kutular.length === 0) throw new Error("Kabul metni: §2'de onay kutusu (☐ **N.**) yok");
  return { kimlik, metin, ozet: acceptanceTextDigest(metin), kutular };
}

export function kabulKaynagiOku(dosya: string = KABUL_BELGESI): KabulKaynagi {
  return kabulKaynaginiCoz(readFileSync(dosya, "utf8"));
}

/**
 * Katalog kuralı: aynı metin → değişmez; yeni kimlik → sona eklenir; SON satırdaki TASLAK kimliğin metni değişirse
 * yerinde güncellenir; yayımlanmış (taslak olmayan) kimliğin metni değişemez ve eski kimliğe dönülemez (fırlatır).
 */
export function katalogGuncelle(katalog: readonly AcceptanceTextEntry[], k: KabulKaynagi): AcceptanceTextEntry[] {
  const giris: AcceptanceTextEntry = { kimlik: k.kimlik, ozet: k.ozet, kutular: k.kutular };
  const ayni = (a: AcceptanceTextEntry): boolean => a.ozet === giris.ozet && a.kutular.join(",") === giris.kutular.join(",");
  const at = katalog.findIndex((a) => a.kimlik === k.kimlik);
  if (at < 0) return [...katalog, giris];
  const son = at === katalog.length - 1;
  if (ayni(katalog[at]!)) {
    if (!son) throw new Error(`Kabul metni eski bir kimliğe (${k.kimlik}) döndü; yeni kimlik verin`);
    return [...katalog];
  }
  if (son && k.kimlik.endsWith("-taslak")) return [...katalog.slice(0, at), giris];
  throw new Error(`Yayımlanmış kabul metni (${k.kimlik}) değiştirilemez; belgedeki "Metin kimliği"ni artırın`);
}

export function katalogDosyasi(katalog: readonly AcceptanceTextEntry[]): string {
  const satirlar = katalog.map((a) => `  { kimlik: ${JSON.stringify(a.kimlik)}, ozet: ${JSON.stringify(a.ozet)}, kutular: ${JSON.stringify(a.kutular).replace(/,/g, ", ")} },`);
  return [
    "// OTOMATİK ÜRETİLİR — `npx tsx scripts/kabul-metni-uret.ts` (kaynak: docs/hukuk/KABUL-METNI.md §2). ELLE DÜZENLENMEZ.",
    "// Tanınan ilk kurulum kabul metinleri, yayım sırasıyla; SON satır fabrikanın gösterdiği güncel metindir.",
    'import type { AcceptanceTextEntry } from "./kabul";',
    "",
    "export const ACCEPTANCE_TEXTS: readonly AcceptanceTextEntry[] = [",
    ...satirlar,
    "];",
    "",
  ].join("\n");
}

export function metinDosyasi(k: KabulKaynagi): string {
  return [
    "// OTOMATİK ÜRETİLİR — `npx tsx scripts/kabul-metni-uret.ts` (kaynak: docs/hukuk/KABUL-METNI.md §2). ELLE DÜZENLENMEZ.",
    "export const CURRENT_ACCEPTANCE_TEXT = {",
    `  kimlik: ${JSON.stringify(k.kimlik)},`,
    `  metin: ${JSON.stringify(k.metin)},`,
    "} as const;",
    "",
  ].join("\n");
}

/** Bugünkü belgeden üretilecek iki dosyanın içeriği (bekçi ve üretici aynı yoldan). */
export function beklenenCiktilar(k: KabulKaynagi = kabulKaynagiOku()): { katalog: string; metin: string } {
  return { katalog: katalogDosyasi(katalogGuncelle(ACCEPTANCE_TEXTS, k)), metin: metinDosyasi(k) };
}
