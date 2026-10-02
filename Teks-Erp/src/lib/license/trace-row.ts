// Lisans İZİ (G12 §3.1, "DB izi"): imzalı durum kaydının (`durum.json`) fabrika DB'sindeki KOPYASI — ayrılmış sistem
// ayarı `license.trace`, panel ve ayar ucu yazamaz. Satırın kendisi imzasızdır; içindeki kayıt kurulum anahtarıyla
// imzalı JWS'tir (kurcalanan kayıt doğrulamada düşer) ve lisans kimliğiyle anahtarlıdır (DB kopyası başka kuruluma
// taşınırsa yok sayılır). Silinemez değildir, savunma derinliğidir. Bu modül G/Ç yapmaz: satırı servis okur/yazar
// (`license-trail.service`), motor buradan senkron okur.
import { z } from "zod";
import { JwsTextSchema, PublicKeyXSchema, UuidSchema } from "./protocol";
import { bumpLicenseSnapshotVersion } from "./license-signals";

export const TraceRowSchema = z.object({
  v: z.literal(1),
  /** Lisans kimliği (LICENSE_DIR) — DB kopyası başka kuruluma taşınırsa eşleşmez. */
  kurulumId: UuidSchema,
  /** Kurulum anahtarının AÇIK yarısı: anahtar dosyası okunamazsa kaydı doğrulamaya yeter (imza durur, kararlar sürer). */
  anahtar: PublicKeyXSchema,
  /** Durum kaydının imzalı JWS'i (`tekserp-durum`). */
  durum: JwsTextSchema,
});
export type TraceRow = z.infer<typeof TraceRowSchema>;

/** BILINMIYOR: henüz okunmadı ya da DB okunamadı — kayıp SAYILMAZ (yalnız okunup YOK bulunan iz kayıptır). */
export type TraceRowState = { readonly durum: "BILINMIYOR" } | { readonly durum: "YOK" } | { readonly durum: "VAR"; readonly row: TraceRow };

let state: TraceRowState = { durum: "BILINMIYOR" };

/** DB'den okunan satır değeri (`null` = satır yok); biçimsiz değer YOK sayılır (bozuk iz, kayıp kuralına girer). */
export function setLicenseTraceRow(value: unknown): void {
  const parsed = value === null ? null : TraceRowSchema.safeParse(value);
  const next: TraceRowState = parsed?.success ? { durum: "VAR", row: parsed.data } : { durum: "YOK" };
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  bumpLicenseSnapshotVersion();
}

/** Okuma başarısız (DB yok/izin): durum bilinmiyor. */
export function markLicenseTraceUnknown(): void {
  if (state.durum === "BILINMIYOR") return;
  state = { durum: "BILINMIYOR" };
  bumpLicenseSnapshotVersion();
}

export function getLicenseTraceRow(): TraceRowState {
  return state;
}

/** Bu lisans kimliğine ait satır (yoksa null). */
export function traceRowFor(licenseId: string | null): TraceRow | null {
  return state.durum === "VAR" && licenseId !== null && state.row.kurulumId === licenseId ? state.row : null;
}

/** Test-only. */
export function __resetLicenseTraceRowForTests(): void {
  state = { durum: "BILINMIYOR" };
}
