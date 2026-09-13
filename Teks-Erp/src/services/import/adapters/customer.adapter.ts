// Müşteri (cari) içe-dışa aktarım adaptörü.
//
// ⚠️ KOD SUNUCU ÜRETİR (`MUS+GGAAYY+NNNN`, `CustomerService.create` istemci
// kodunu YOK SAYAR). Dosyadaki kod yalnız EŞLEŞME içindir; dolu ama eşleşmeyen
// kod HATA verir (sessizce başka bir kodla kayıt açmak round-trip'i bozar).
// ⚠️ Vergi no tekilliği `assertTaxNumberAvailable` ile servis içinde korunur —
// buradan atlanmaz.
//
// ŞUBELER bu adaptörde YOKTUR: bir satır = bir müşteri. Şubeler kendi
// adaptöründedir (`customerBranch`, anahtar: müşteri kodu + şube adı) çünkü
// motorun sözleşmesi "bir satır = bir kayıt"tır; aynı kodu tekrar eden satırlar
// mükerrer anahtar olarak reddedilirdi.

import prisma from "../../../lib/prisma";
import { customerService } from "../../../routes/customer.routes";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { upperTr } from "../../../utils/tr-case";

const COLUMNS: ImportColumn[] = [
  {
    key: "code",
    label: "Cari Kodu",
    type: "text",
    maxLen: 32,
    createOnly: true,
    help: "BOŞ BIRAKIN — sistem üretir (MUS…). Mevcut cariyi güncellemek için kodunu yazın.",
    example: "",
  },
  { key: "name", label: "Cari Ünvanı", type: "text", required: true, maxLen: 100, example: "ÖRNEK TEKSTİL A.Ş." },
  {
    key: "type",
    label: "Tür",
    type: "enum",
    enumValues: [
      { value: "CUSTOMER", label: "Müşteri" },
      { value: "SUPPLIER", label: "Tedarikçi" },
    ],
    help: "Boş bırakılırsa Müşteri.",
    example: "Müşteri",
  },
  { key: "taxNumber", label: "Vergi No", type: "text", maxLen: 20, help: "Sistemde tekildir — aynı vergi no ikinci bir caride kullanılamaz.", example: "1234567890" },
  { key: "exportCode", label: "İhracat Kodu", type: "text", maxLen: 50, example: "" },
  { key: "address", label: "Adres", type: "text", maxLen: 1000, example: "" },
  { key: "city", label: "İl", type: "text", maxLen: 80, example: "BURSA" },
  { key: "district", label: "İlçe", type: "text", maxLen: 80, example: "" },
  { key: "country", label: "Ülke", type: "text", maxLen: 80, example: "TÜRKİYE" },
  {
    key: "defaultDestination",
    label: "Sevk Varsayılanı",
    type: "enum",
    enumValues: [
      { value: "DOMESTIC", label: "Yurtiçi" },
      { value: "EXPORT", label: "Yurtdışı" },
    ],
    help: "Sevkiyat formu bu değerle AÇILIR, operatör değiştirebilir (kilit değil). Boş = varsayılan yok; tanınmayan değer satırı reddeder.",
    example: "",
  },
  { key: "contactName", label: "Yetkili", type: "text", maxLen: 120, example: "" },
  { key: "contactPhone", label: "Telefon", type: "text", maxLen: 40, example: "" },
  { key: "email", label: "E-posta", type: "text", maxLen: 200, example: "" },
  { key: "notes", label: "Not", type: "text", maxLen: 1000, example: "" },
  { key: "isActive", label: "Aktif", type: "bool", help: "Evet / Hayır.", example: "Evet" },
];

export const customerImportAdapter: ImportAdapter = {
  entity: "customer",
  label: "Cariler (Müşteri / Tedarikçi)",
  tableName: "CUSTOMER",
  writePermission: "customer:write",
  readPermission: "customer:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "customer", field: "name", label: "müşteri", codeField: "code" },
  notes: [
    "Cari kodunu sistem üretir — YENİ cari eklerken kod sütununu BOŞ bırakın.",
    "Vergi no sistemde tekildir; aynı numarayı taşıyan ikinci satır reddedilir.",
    "Şubeler ayrı bir şablonla aktarılır (Şubeler).",
  ],

  async findExisting(keys) {
    const rows = await prisma.customer.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true, code: true, name: true, type: true, taxNumber: true, exportCode: true,
        address: true, city: true, district: true, country: true, defaultDestination: true, contactName: true,
        contactPhone: true, email: true, notes: true, isActive: true,
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) map.set(upperTr(r.code), r as Record<string, unknown>);
    return map;
  },

  async validateRow(row: PreparedRow) {
    const code = row.values.code;
    if (typeof code === "string" && code.trim() && !row.existing) {
      row.result.errors.push({
        column: "code",
        message: `'${code.trim()}' kodlu cari bulunamadı. Cari kodunu sistem üretir — YENİ cari için bu hücreyi BOŞ bırakın.`,
      });
    }
    const tax = row.values.taxNumber;
    if (typeof tax === "string" && tax.trim()) {
      const digits = tax.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11) {
        row.result.warnings.push({
          column: "taxNumber",
          message: "Vergi no 10 (kurum) ya da 11 (TCKN) hane olmalı — kontrol edin.",
        });
      }
    }
    const email = row.values.email;
    if (typeof email === "string" && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      row.result.errors.push({ column: "email", message: "E-posta biçimi geçersiz." });
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const { code: _ignored, ...data } = row.values;
    void _ignored; // kod sunucuda üretilir
    const res = await customerService.create(data, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const { code: _ignored, ...data } = row.values;
    void _ignored;
    await customerService.update(id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.customer.findMany({
      orderBy: { code: "asc" },
      select: {
        code: true, name: true, type: true, taxNumber: true, exportCode: true,
        address: true, city: true, district: true, country: true, defaultDestination: true, contactName: true,
        contactPhone: true, email: true, notes: true, isActive: true,
      },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      type: r.type,
      taxNumber: r.taxNumber ?? "",
      exportCode: r.exportCode ?? "",
      address: r.address ?? "",
      city: r.city ?? "",
      district: r.district ?? "",
      country: r.country ?? "",
      defaultDestination: r.defaultDestination ?? "",
      contactName: r.contactName ?? "",
      contactPhone: r.contactPhone ?? "",
      email: r.email ?? "",
      notes: r.notes ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
