// İÇ API ORTAK SIRRI (satıcı ↔ patron bulutu) — dosyadan okunur (docker secret); bellekte yalnız SHA-256
// özeti durur ve karşılaştırma sabit zamanlıdır (iki özet eşit uzunlukta → timingSafeEqual). Sır yoksa,
// okunamıyorsa, herkese açık izinliyse ya da biçimsizse iç API AÇILMAZ (fail-closed). Sırrın kendisi
// loga, denetime, hata iletisine GİRMEZ.
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** Görünür ASCII (boşluksuz), 32–512 karakter — patron tarafı `SATICI_IC_API_BELIRTECI` en az 32 ister. */
const SECRET_PATTERN = /^[\x21-\x7e]{32,512}$/;
const HEADER_PATTERN = /^Bearer ([\x21-\x7e]{1,512})$/;

function digestOf(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

export class InternalBearer {
  private constructor(private readonly digest: Buffer) {}

  static fromSecret(secret: string): InternalBearer {
    if (!SECRET_PATTERN.test(secret)) throw new Error("İç API sırrı biçimsiz (32–512 görünür ASCII, boşluksuz)");
    return new InternalBearer(digestOf(secret));
  }

  /** `Authorization` başlığı bu sırrı taşıyor mu? Eksik/biçimsiz başlık da AYNI işi yapar (zamanlama sızdırmaz). */
  matches(header: unknown): boolean {
    const presented = typeof header === "string" ? HEADER_PATTERN.exec(header)?.[1] : undefined;
    const equal = timingSafeEqual(digestOf(presented ?? ""), this.digest);
    return presented !== undefined && equal;
  }
}

export type BearerLoad = { readonly ok: true; readonly bearer: InternalBearer } | { readonly ok: false; readonly reason: string };

/** Sır dosyasını okur. Sonundaki satır sonu kırpılır; başka her sapma RED (neden sır İÇERMEZ). */
export function loadInternalBearer(file: string | undefined): BearerLoad {
  if (!file) return { ok: false, reason: "IC_API_BELIRTEC_DOSYASI verilmedi" };
  let text: string;
  try {
    if ((statSync(file).mode & 0o007) !== 0) return { ok: false, reason: "sır dosyası herkese açık izinli (en çok 0640 olmalı)" };
    text = readFileSync(file, "utf8").replace(/\r?\n$/, "");
  } catch (err) {
    return { ok: false, reason: `sır dosyası okunamadı (${(err as NodeJS.ErrnoException).code ?? "hata"})` };
  }
  if (!SECRET_PATTERN.test(text)) return { ok: false, reason: "sır biçimsiz (32–512 görünür ASCII, boşluksuz)" };
  return { ok: true, bearer: InternalBearer.fromSecret(text) };
}
