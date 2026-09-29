// Gövde: HAM baytlar (imzalı gövde özeti ayrıştırmadan ÖNCEKİ baytlardan hesaplanır), sonra JSON.
import type { z } from "zod";
import { PROTOCOL_VERSION, isPlainObject } from "../lisans-protokol";
import { VendorError } from "../lib/errors";

export function rawBodyOf(body: unknown): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
}

/** JSON nesnesi + sürüm denetimi (bilinmeyen `v` şema hatasından AYRI kodlanır). */
export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) throw new VendorError(400, "GOVDE_GECERSIZ", "İstek gövdesi boş");
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new VendorError(400, "GOVDE_GECERSIZ", "İstek gövdesi JSON değil");
  }
  if (!isPlainObject(value)) throw new VendorError(400, "GOVDE_GECERSIZ", "İstek gövdesi bir JSON nesnesi olmalı");
  if ("v" in value && value.v !== PROTOCOL_VERSION) {
    throw new VendorError(400, "PROTOKOL_SURUMU", `Desteklenmeyen protokol sürümü: ${String(value.v)}`);
  }
  return value;
}

/** KATI gövde: tanınmayan anahtar ya da şema dışı değer 400 GOVDE_GECERSIZ. */
export function parseStrict<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
  throw new VendorError(400, "GOVDE_GECERSIZ", `İstek gövdesi sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
}
