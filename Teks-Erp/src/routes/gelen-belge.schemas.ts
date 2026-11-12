// Gelen belge uç gövde/sorgu şemaları (Zod) — gelen-belge.routes.ts'ten bölündü (dosya boyu tavanı); iş mantığı yok.
import { DeliveryNoteStatus } from "@prisma/client";
import { z } from "zod";
import { PageBarcodesSchema } from "../lib/gelen-belge/barkod";
import { BATCH_NO_KEY_RE, MANUAL_BATCH_NO_KEY } from "../services/gelen-belge-sablon.service";

export const Id = z.uuid("Geçersiz kimlik");
export const optText = (max: number) => z.string().trim().max(max, `En çok ${max} karakter`).nullable().optional();
export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
// Süzgeç günü takvimde VAR olmalı (2026-02-31 sessizce 3 Mart'a kaymaz → 400).
export const RangeDay = Day.refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Tarih takvimde yok");
export const Money = (label: string) => z.coerce.number().positive(`${label} sıfırdan büyük olmalı`).max(999_999, `${label} çok büyük`);

export const ScanBody = z.strictObject({
  contentBase64: z.string().min(1, "Dosya içeriği boş"), noteId: Id.nullable().optional(),
  pageNo: z.coerce.number().int().min(1).max(99).nullable().optional(), regionNo: z.coerce.number().int().min(1).max(9).nullable().optional(),
  barcodeText: optText(120),
  // D7: tablet özeti kendisi hesaplar; uyuşmazlık 400 DOCUMENT_SCAN_HASH_MISMATCH (eski istemci göndermez).
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "Özet 64 onaltılık karakter olmalı").nullable().optional(),
  barcodes: PageBarcodesSchema.optional(), // fotoğraftaki barkodlar (tablet ML Kit); eski istemci göndermez → bugünkü okuma
  clientOcr: z.unknown().optional(), // S16c: katı şema serviste (`parseClientOcr`) — ihlal 400 CLIENT_OCR_INVALID (tablet clientOcr'sız tekrarlar)
});
export const Header = {
  ownerCustomerId: Id.nullable().optional(),
  senderCustomerId: Id.nullable().optional(),
  senderText: optText(160),
  senderDocNo: optText(64),
  senderDocDate: Day.nullable().optional(),
  customerBatchNo: optText(64),
  // Müşterinin basılı "Sipariş No"su (S2b); sınır kolonun VarChar(64)'ü.
  customerOrderNo: optText(64),
  processText: optText(120),
  pageCount: z.coerce.number().int().min(1).max(99).nullable().optional(),
  declaredTopCount: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  totalsDeclared: z.record(z.string(), z.unknown()).nullable().optional(),
};
export const LineBody = z.strictObject({
  lineKind: z.enum(["TOP", "ARABA"], "Satır türü TOP ya da ARABA olmalı").optional(),
  blockNo: z.coerce.number().int().min(1).max(99).optional(),
  senderRollNo: optText(64),
  meters: Money("Metraj"),
  weightKg: Money("Kilo").nullable().optional(),
  widthCm: Money("En").nullable().optional(),
  itemText: optText(160),
  itemId: Id.nullable().optional(),
  colorText: optText(120),
  colorId: Id.nullable().optional(),
  processText: optText(120),
  needsReview: z.boolean().optional(),
});
export const CreateBody = z.strictObject({
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  sourceKind: z.enum(["MANUAL", "IMPORT"], "Kaynak MANUAL ya da IMPORT olmalı"),
  scanIds: z.array(Id).max(20).optional(),
  lines: z.array(LineBody).max(500, "Tek seferde en çok 500 satır").optional(),
  ...Header,
});
// Parti no aday anahtarı (şablon alan anahtarı) — biçim tek kaynaktan; `MANUAL` yalnız sunucunun yazdığı işarettir.
export const BatchNoKey = z.string().regex(BATCH_NO_KEY_RE, "Geçersiz parti no anahtarı").refine((v) => v !== MANUAL_BATCH_NO_KEY, "MANUAL anahtarı seçilemez (elle yazılan parti no anahtarsız gönderilir)");
// Gülkesim B: parti no + kurşun metresi yalnız başlık PATCH'inde (yaratma gövdesi değişmez; okuma katmanı doldurur).
export const UpdateBody = z.strictObject({
  ...Header,
  ourBatchNo: optText(64),
  ourBatchNoKey: BatchNoKey.nullable().optional(),
  kursunMeters: Money("Kurşun metresi").nullable().optional(),
  kursunMetersReviewed: z.literal(true, "Gözden geçirme işareti yalnız true olabilir").optional(),
});
// Onaylı belgede künye düzeltmesi: YALNIZ fiş no + fiş tarihi; başka anahtar katı şemada 400 (başlığın geri kalanı donuk).
export const IdentityFixBody = z.strictObject({
  senderDocNo: optText(64),
  senderDocDate: Day.nullable().optional(),
  confirmDuplicateDocNo: z.boolean().optional(),
}).refine((b) => b.senderDocNo !== undefined || b.senderDocDate !== undefined, "Fiş no ya da fiş tarihi verilmeli");
export const LinesBody = z.strictObject({
  // Parti kimliği: zaman aşımı tekrarı aynı token'la gelir, satırlar ikilenmez (`lineBatchReplay`).
  clientToken: z.uuid("İşlem kimliği geçersiz").nullable().optional(),
  lines: z.array(LineBody).min(1, "En az bir satır gerekli").max(500, "Tek seferde en çok 500 satır"),
});
// `skip` yalnız PARTIAL belgedeki topsuz FAILED satır içindir (girilmeyecek kalem → SKIPPED; belge kapanabilsin).
export const LinePatch = LineBody.partial().extend({ skip: z.literal(true).optional() });
// processChoices (H9; D4-D1 her çeşit değeri): kabul edilen/düzeltilen işlem önerisi → yalnız PROCESS sözlüğü; lineId null = başlık.
export const ApproveBody = z.strictObject({
  varianceReason: optText(500),
  // K27: WARN kipinde işi süren aynı belge no'lu eş varken operatörün "yine de onayla" kararı (BLOCK'ta yok sayılmaz → 409).
  confirmDuplicateDocNo: z.boolean("Onay bayrağı evet/hayır olmalı").optional(),
  // Aynı sahip + müşteri parti no (WARN kipi) işi süren eşe rağmen onay; BLOCK'ta yok sayılır.
  confirmDuplicateBatchNo: z.boolean("Onay bayrağı evet/hayır olmalı").optional(),
  processChoices: z.array(z.strictObject({ lineId: Id.nullable(), valueId: Id }), "Geçersiz işlem seçimi").max(500, "En çok 500 işlem seçimi").optional(),
  // P3 "Belge okut": onaydan sonra iş emri bu rotayla (öneri zinciri ve `autoWorkOrder` ayarı yerine); onay servisine gitmez.
  routeTemplateId: Id.optional(),
});
export const ListQuery = z.object({
  status: z.enum(DeliveryNoteStatus, "Tanınmayan durum süzgeci").optional(),
  sourceKind: z.enum(["OCR", "MANUAL", "IMPORT"], "Tanınmayan kaynak süzgeci").optional(),
  ownerCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  senderCustomerId: z.union([z.string(), z.array(z.string())]).optional(),
  q: z.string().max(64).optional(),
  // createdAt aralığı; gün-yalnız değer FABRİKA gününün başı/sonu (`resolveRangeStart/End`, src/constants/time.ts).
  from: RangeDay.optional(),
  to: RangeDay.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "Başlangıç tarihi bitişten sonra olamaz", path: ["from"] });
