// Fason firma içe-dışa aktarım adaptörü.
//
// ⚠️ KOD İSTEMCİDEN GELİR ve ZORUNLUDUR (`validateCode(..., required: true)`);
// sunucu üretmez. Kod aynı zamanda EŞLEŞME ANAHTARIDIR → `createOnly`.
//
// ⚠️ PASİF FİRMA DA EŞLEŞİR: `findExisting` `isActive` süzmez. Süzseydi satır
// CREATE'e düşer, servis `decideCodeUniqueness` ile pasif kaydı DİRİLTİR ve
// kategorilerini SİLİP yeniden yazardı — önizleme "yeni" derken gerçekte
// mevcut kayıt ezilirdi.
//
// ⚠️ KATEGORİ BAĞI: `create`/`update` ID bekler (`categoryIds`), kod değil.
// Dosyada KOD yazılır, `resolveReferenceList` ile id'ye çevrilir ve
// `<sütun>__ids` ara alanında taşınır (item adaptörü emsali). Liste
// DEĞİŞTİRME (replace) mantığıyla yazılır: dosyada ne varsa o kalır.
//
// ⚠️ Vergi no / telefon / adres biçim kuralları servis içinde HATA fırlatır.
// Aynı kuralları önizlemede de koşuyoruz — yazma anında patlayan bir satır
// paketi durdurur (`stoppedAtRowNo`), önizlemede yakalanan satır sadece
// düzeltilir.

import prisma from "../../../lib/prisma";
import { SubcontractorManagementService } from "../../subcontractor-management.service";
import { resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";

// Servisin paylaşılan tekili yok (controller kendi private örneğini kuruyor);
// servis durumsuz olduğu için burada kendi örneğimizi kuruyoruz.
const subService = new SubcontractorManagementService();

// Servisteki kuralların birebir ikizi (`subcontractor-management.service.ts`).
// ⚠️ Orada değişirse burası da değişmeli — bunlar önizleme kopyasıdır, TEK
// otorite hâlâ servistir (yazma yolu her hâlükârda oradan geçer).
const TAX_REGEX = /^\d{10,15}$/;
const PHONE_REGEX = /^[+0-9 ()/-]{7,20}$/;
const ADDRESS_MIN_LENGTH = 5;

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Fason Kodu",
    type: "text",
    required: true,
    createOnly: true,
    maxLen: 32,
    help: "ZORUNLU — siz belirlersiniz (sistem üretmez). Mevcut firmayı güncellemek için aynı kodu yazın. Kod sonradan değiştirilemez.",
    example: "BOYER",
  },
  { key: "name", label: "Firma Adı", type: "text", required: true, maxLen: 100, example: "ÖRNEK BOYA SAN. LTD. ŞTİ." },
  {
    key: "categoryCodes",
    label: "Kategoriler",
    type: "lookup",
    lookup: { entity: "subcontractorCategory", by: "code", multiple: true },
    help:
      "Fason kategorisi KODLARI, noktalı virgülle: DYE_HOUSE;SANDING. Dosyadaki liste mevcut kategorilerin YERİNE geçer. " +
      "Boş bırakılan yeni firma hiçbir fason adımında seçilemez.",
    example: "DYE_HOUSE",
  },
  {
    key: "taxNumber",
    label: "Vergi No",
    type: "text",
    maxLen: 20,
    help: "10-15 hane SAYI (VKN 10, TCKN 11). Sistemde tekildir — aynı numara ikinci firmada kullanılamaz.",
    example: "1234567890",
  },
  {
    key: "phone",
    label: "Telefon",
    type: "text",
    maxLen: 20,
    help: "7-20 karakter: rakam, +, boşluk, parantez, tire, eğik çizgi.",
    example: "0224 000 00 00",
  },
  { key: "address", label: "Adres", type: "text", maxLen: 1000, help: "En az 5 karakter.", example: "" },
  {
    key: "isFavorite",
    label: "Favori",
    type: "bool",
    help: "Evet ise iş emri fason adımında firma seçicide öne çıkar.",
    example: "Hayır",
  },
  { key: "isActive", label: "Aktif", type: "bool", help: "Evet / Hayır.", example: "Evet" },
];

function boolVal(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** `undefined` → dokunma · `null` → temizle · dolu → metin. */
function textVal(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v);
}

export const subcontractorImportAdapter: ImportAdapter = {
  entity: "subcontractor",
  label: "Fason Firmalar",
  tableName: "SUBCONTRACTOR",
  writePermission: "subcontractor:write",
  readPermission: "subcontractor:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "subcontractor", field: "name", label: "fason firma", codeField: "code" },
  notes: [
    "Fason kodunu SİZ belirlersiniz ve zorunludur; kod eşleşme anahtarıdır ve sonradan değiştirilemez.",
    "Kategoriler KOD ile yazılır (DYE_HOUSE;SANDING) ve dosyadaki liste mevcut kategorilerin YERİNE geçer.",
    "Kategorisiz firma hiçbir fason adımında seçilemez — yeni firma eklerken kategori yazın.",
    "Vergi no sistemde tekildir; aynı numarayı taşıyan ikinci firma reddedilir (pasif firmalar da sayılır).",
  ],

  async findExisting(keys) {
    // Pasifler dahil — gerekçe dosya başlığında.
    const rows = await prisma.subcontractor.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true, code: true, name: true, taxNumber: true, phone: true, address: true,
        isFavorite: true, isActive: true,
        categories: { select: { category: { select: { code: true } } } },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(r.code.toLocaleUpperCase("tr-TR"), {
        ...r,
        // Diff sütun anahtarlarıyla yapılır — mevcut hâli de aynı anahtarla sun.
        categoryCodes: r.categories.map((c) => c.category.code),
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;

    if (v.name === null) {
      row.result.errors.push({ column: "name", message: "Firma adı temizlenemez (zorunlu alan)." });
    }
    if (typeof v.taxNumber === "string" && v.taxNumber.trim() && !TAX_REGEX.test(v.taxNumber.trim())) {
      row.result.errors.push({
        column: "taxNumber",
        message: "Vergi numarası 10-15 hane SAYI olmalı (VKN: 10, TCKN: 11). Boşluk/tire kullanmayın.",
      });
    }
    if (typeof v.phone === "string" && v.phone.trim() && !PHONE_REGEX.test(v.phone.trim())) {
      row.result.errors.push({
        column: "phone",
        message: "Telefon 7-20 karakter olmalı (rakam, +, boşluk, parantez, tire, eğik çizgi).",
      });
    }
    if (typeof v.address === "string" && v.address.trim() && v.address.trim().length < ADDRESS_MIN_LENGTH) {
      row.result.errors.push({
        column: "address",
        message: `Adres en az ${ADDRESS_MIN_LENGTH} karakter olmalı (ya da tamamen boş bırakın).`,
      });
    }

    // Kategorileri ŞİMDİ çöz: "kategori yok / pasif" önizlemede görünsün.
    const raw = v.categoryCodes;
    if (raw === null) {
      row.values.categoryCodes__ids = [];
    } else if (raw !== undefined) {
      const { ids, errors, warnings } = await resolveReferenceList(
        "subcontractorCategory",
        splitList(String(raw)),
        ctx,
      );
      for (const m of errors) row.result.errors.push({ column: "categoryCodes", message: m });
      for (const m of warnings) row.result.warnings.push({ column: "categoryCodes", message: m });
      row.values.categoryCodes__ids = ids;
    }

    // Kategorisiz YENİ firma: engellemiyoruz (panel formu da izin veriyor —
    // import panelden daha katı olmamalı) ama sonucu söylüyoruz.
    if (!row.existing && row.values.categoryCodes__ids === undefined) {
      row.result.warnings.push({
        column: "categoryCodes",
        message: "Kategori yazılmadı — bu firma hiçbir fason adımında seçilemez. Sonradan panelden ekleyebilirsiniz.",
      });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    const res = await subService.create(
      {
        code: String(v.code),
        name: String(v.name),
        taxNumber: textVal(v.taxNumber),
        phone: textVal(v.phone),
        address: textVal(v.address),
        ...(boolVal(v.isFavorite) !== undefined ? { isFavorite: boolVal(v.isFavorite) } : {}),
        categoryIds: (v.categoryCodes__ids as string[] | undefined) ?? [],
      },
      ctx.userId,
    );
    const id = (res.data as { id: string }).id;
    // `create` imzası `isActive` ALMAZ (yeni firma aktif doğar). Pasif isteniyorsa
    // servisin kendi update'iyle kapatıyoruz — payload'a kaçak alan iliştirmek yerine.
    if (boolVal(v.isActive) === false) {
      await subService.update(id, { isActive: false }, ctx.userId);
    }
    return { id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const v = row.values;
    const data: {
      name?: string;
      taxNumber?: string | null;
      phone?: string | null;
      address?: string | null;
      isActive?: boolean;
      isFavorite?: boolean;
      categoryIds?: string[];
    } = {};
    if (typeof v.name === "string") data.name = v.name;
    if (v.taxNumber !== undefined) data.taxNumber = textVal(v.taxNumber) ?? null;
    if (v.phone !== undefined) data.phone = textVal(v.phone) ?? null;
    if (v.address !== undefined) data.address = textVal(v.address) ?? null;
    if (boolVal(v.isFavorite) !== undefined) data.isFavorite = boolVal(v.isFavorite);
    if (boolVal(v.isActive) !== undefined) data.isActive = boolVal(v.isActive);
    // Liste verilmemişse DOKUNMA (undefined) — servis mevcut bağları korur.
    if (v.categoryCodes__ids !== undefined) data.categoryIds = v.categoryCodes__ids as string[];
    // `code` BİLEREK gönderilmiyor: anahtar sütunudur (createOnly).
    await subService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.subcontractor.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true, name: true, taxNumber: true, phone: true, address: true,
        isFavorite: true, isActive: true,
        categories: { select: { category: { select: { code: true } } } },
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      categoryCodes: r.categories.map((c) => c.category.code).join(";"),
      taxNumber: r.taxNumber ?? "",
      phone: r.phone ?? "",
      address: r.address ?? "",
      isFavorite: r.isFavorite ? "Evet" : "Hayır",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
