// Üretim rotası (Route + RouteStep) içe-dışa aktarım adaptörü — GRUPLU ŞABLON.
//
// Bir rota = N satır: aynı "Rota Anahtarı"nı taşıyan her satır bir ADIM'dır.
// Başlık bilgileri (ad, açıklama, müşteri…) grubun İLK satırından okunur.
// (Karar D7 — kompozit satır; alternatifi "adım başına ayrı şablon"du ve orada
// bir adımı SİLMEK imkânsız olurdu.)
//
// ⚠️ ADIM LİSTESİ REPLACE'tir: dosyadaki adımlar neyse rota o olur. Bu, panelin
// rota düzenleme davranışının aynısıdır (`steps: { deleteMany, create }`).
// ⚠️ KOD SUNUCU ÜRETİR (`autoCode: ROT`) — anahtar sütunu yalnız eşleşme içindir.
// ⚠️ `dispatchWithoutColor` BİLİNÇLİ OLARAK YOK: `RouteService.ALLOWED_STEP_KEYS`
// onu kabul etmiyor (F209 mass-assignment allowlist'i). Şablona koymak, sessizce
// düşen bir sütun olurdu.

import prisma from "../../../lib/prisma";
import { routeService } from "../../../routes/route.routes";
import { resolveReference, resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type {
  ImportAdapter,
  ImportColumn,
  ImportContext,
  ImportFixHint,
  PreparedRow,
} from "../import.types";
import { importKey } from "../import-key";

const COLUMNS: ImportColumn[] = [
  // ── Başlık sütunları (grubun İLK satırından okunur) ────────────────────────
  {
    key: "code",
    label: "Rota Kodu",
    type: "text",
    required: true,
    maxLen: 32,
    help: "Aynı rotanın TÜM satırlarında aynı olmalı — satırlar buna göre gruplanır. Mevcut bir rotayı güncellemek için o rotanın kodunu yazın; YENİ rota için kendi belirlediğiniz geçici bir anahtar yazın (sistem gerçek kodu ROT… olarak üretir).",
    example: "BKT-STD",
  },
  { key: "name", label: "Rota Adı", type: "text", required: true, maxLen: 100, example: "BOYA + KURŞUN + TAMBUR" },
  { key: "description", label: "Açıklama", type: "text", maxLen: 1000, example: "" },
  {
    key: "customerCode",
    label: "Müşteri Kodu",
    type: "lookup",
    lookup: { entity: "customer", by: "code" },
    help: "Bu rota yalnız o müşteride varsayılan olsun isteniyorsa. Boş = genel rota.",
    example: "",
  },
  { key: "isFavorite", label: "Sık Kullanılan", type: "bool", example: "Hayır" },
  { key: "isActive", label: "Aktif", type: "bool", example: "Evet" },

  // ── Adım sütunları (HER satırdan okunur) ──────────────────────────────────
  {
    key: "stepSequence",
    label: "Adım Sırası",
    type: "int",
    required: true,
    child: true,
    help: "1'den başlayan sıra. Aynı rotada tekrar edemez.",
    example: "1",
  },
  {
    key: "stationCode",
    label: "İstasyon Kodu",
    type: "lookup",
    required: true,
    child: true,
    lookup: { entity: "station", by: "code" },
    example: "IST1908260001",
  },
  { key: "stepNotes", label: "Adım Talimatı", type: "text", maxLen: 1000, child: true, example: "" },
  {
    key: "requiredCategoryCode",
    label: "Fason Kategorisi",
    type: "lookup",
    child: true,
    lookup: { entity: "subcontractorCategory", by: "code" },
    help: "Adım fason ise gereken kategori kodu.",
    example: "",
  },
  {
    key: "plannedSubcontractorCode",
    label: "Planlanan Fason Firma",
    type: "lookup",
    child: true,
    lookup: { entity: "subcontractor", by: "code" },
    example: "",
  },
  {
    key: "plannedColorCode",
    label: "Hedef Renk",
    type: "lookup",
    child: true,
    lookup: { entity: "color", by: "code" },
    help: "Bu adımın şablon hedefi — ÖNERİDİR, kilit değil. Renk yazılırsa rota o renge özel hâle gelir.",
    example: "",
  },
  {
    key: "plannedPropertyCodes",
    label: "Hedef Özellikler",
    type: "lookup",
    child: true,
    lookup: { entity: "fabricProperty", by: "code", multiple: true },
    help: "Özellik KODLARI, noktalı virgülle.",
    example: "",
  },
];

interface StepPayload {
  sequence: number;
  stationId: string;
  defaultNotes: string | null;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  plannedColorId: string | null;
  plannedPropertyIds: string[];
}

/**
 * Gruplu şablonda çocuk satırın hatasını grubun sonucuna yazar.
 * ⚠️ Mesajın önüne ÇOCUK satır numarası konur (kullanıcı dosyada onu arar) ve
 * varsa düzeltme ipucuna da o numara işlenir — panel "hangi satırı düzelteyim"
 * sorusunu grup başından değil GERÇEK satırdan cevaplasın.
 */
function childIssue(
  column: string,
  childRowNo: number,
  issue: { message: string; fix?: ImportFixHint },
): { column: string; message: string; fix?: ImportFixHint } {
  return {
    column,
    message: `${childRowNo}. satır: ${issue.message}`,
    ...(issue.fix ? { fix: { ...issue.fix, rowNo: childRowNo } } : {}),
  };
}

export const routeImportAdapter: ImportAdapter = {
  entity: "route",
  label: "Üretim Rotaları",
  tableName: "ROUTE",
  writePermission: "station:write",
  readPermission: "station:read",
  keyColumns: ["code"],
  columns: COLUMNS,
  // Ad çakışması ÖNİZLEMEDE yakalanır (servisteki guard'ın ikizi) —
  // yoksa önizleme 'Yeni' der, uygulama 409 ile patlardı.
  nameGuard: { model: "route", field: "name", label: "rota", codeField: "code" },
  grouped: true,
  notes: [
    "GRUPLU ŞABLON: bir rotanın her ADIMI ayrı bir satırdır; satırlar 'Rota Kodu' sütununa göre gruplanır.",
    "Başlık bilgileri (ad, açıklama, müşteri, aktiflik) grubun İLK satırından okunur; devam satırlarında farklı yazarsanız uyarı alırsınız.",
    "Adım listesi DEĞİŞTİRME (replace) mantığıyla yazılır: dosyada olmayan adım rotadan SİLİNİR.",
    "Rota kodunu sistem üretir (ROT…) — yeni rota için kendi geçici anahtarınızı yazabilirsiniz, kaydedilen kod farklı olacaktır.",
  ],

  async findExisting(keys) {
    const rows = await prisma.route.findMany({
      where: { code: { in: keys, mode: "insensitive" } },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isFavorite: true,
        isActive: true,
        customer: { select: { code: true } },
        steps: {
          orderBy: { sequence: "asc" },
          select: {
            sequence: true,
            defaultNotes: true,
            station: { select: { code: true } },
            requiredCategory: { select: { code: true } },
            plannedSubcontractor: { select: { code: true } },
            plannedColor: { select: { code: true } },
            plannedProperties: { select: { property: { select: { code: true } } } },
          },
        },
      },
    });
    const map = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      map.set(importKey(r.code ?? ""), {
        ...r,
        customerCode: r.customer?.code ?? null,
        // Motor çocuk diff'ini SÜTUN ANAHTARLARIYLA karşılaştırır — mevcut
        // adımları da aynı anahtarlarla sun, yoksa değişmemiş rota her
        // yüklemede "güncellenecek" görünür.
        __children: r.steps.map((s) => ({
          stepSequence: s.sequence,
          stationCode: s.station?.code ?? null,
          stepNotes: s.defaultNotes ?? null,
          requiredCategoryCode: s.requiredCategory?.code ?? null,
          plannedSubcontractorCode: s.plannedSubcontractor?.code ?? null,
          plannedColorCode: s.plannedColor?.code ?? null,
          plannedPropertyCodes: s.plannedProperties.map((pp) => pp.property.code),
        })),
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    // Başlık: müşteri referansı
    const cust = row.values.customerCode;
    if (cust !== undefined) {
      if (cust === null) {
        row.values.customerCode__id = null;
      } else {
        const out = await resolveReference("customer", String(cust), ctx);
        if (out.error) row.result.errors.push({ column: "customerCode", ...out.error });
        if (out.warning) row.result.warnings.push({ column: "customerCode", message: out.warning });
        row.values.customerCode__id = out.hit?.id ?? null;
      }
    }

    if (!row.children || row.children.length === 0) {
      row.result.errors.push({ message: "Rotanın en az bir adımı olmalı." });
      return;
    }

    // Adım sıraları benzersiz olmalı — aynı sıra iki adım, panelde de reddedilir.
    const seqSeen = new Map<number, number>();
    for (const child of row.children) {
      const seq = child.values.stepSequence;
      if (typeof seq === "number") {
        const prev = seqSeen.get(seq);
        if (prev !== undefined) {
          row.result.errors.push({
            column: "stepSequence",
            message: `Adım sırası ${seq} birden fazla satırda (${prev} ve ${child.rowNo}).`,
          });
        } else {
          seqSeen.set(seq, child.rowNo);
        }
      }
    }

    // Adım referansları
    for (const child of row.children) {
      for (const [key, entity] of [
        ["stationCode", "station"],
        ["requiredCategoryCode", "subcontractorCategory"],
        ["plannedSubcontractorCode", "subcontractor"],
        ["plannedColorCode", "color"],
      ] as const) {
        const raw = child.values[key];
        if (raw === undefined || raw === null) {
          child.values[`${key}__id`] = null;
          continue;
        }
        const out = await resolveReference(entity, String(raw), ctx);
        if (out.error) {
          row.result.errors.push(childIssue(key, child.rowNo, out.error));
        }
        if (out.warning) {
          row.result.warnings.push({ column: key, message: `${child.rowNo}. satır: ${out.warning}` });
        }
        child.values[`${key}__id`] = out.hit?.id ?? null;
      }

      const props = child.values.plannedPropertyCodes;
      if (props === undefined || props === null) {
        child.values.plannedPropertyCodes__ids = [];
      } else {
        const { ids, errors, warnings } = await resolveReferenceList(
          "fabricProperty",
          splitList(String(props)),
          ctx,
        );
        for (const m of errors) {
          row.result.errors.push(childIssue("plannedPropertyCodes", child.rowNo, m));
        }
        for (const m of warnings) {
          row.result.warnings.push({ column: "plannedPropertyCodes", message: `${child.rowNo}. satır: ${m}` });
        }
        child.values.plannedPropertyCodes__ids = ids;
      }
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const res = await routeService.create(
      { ...headerPayload(row), steps: { create: stepPayloads(row) } },
      ctx.userId,
    );
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    // Panelin rota düzenlemesiyle AYNI şekil: eski adımlar silinir, yenileri
    // yazılır. Adım kimliği taşımadığımız için (dosyada id yok) tek doğru
    // semantik budur.
    await routeService.update(
      id,
      { ...headerPayload(row), steps: { deleteMany: {}, create: stepPayloads(row) } },
      ctx.userId,
    );
    return { id };
  },

  async exportRows() {
    const routes = await prisma.route.findMany({
      orderBy: [{ code: "asc" }],
      select: {
        code: true,
        name: true,
        description: true,
        isFavorite: true,
        isActive: true,
        customer: { select: { code: true } },
        steps: {
          orderBy: { sequence: "asc" },
          select: {
            sequence: true,
            defaultNotes: true,
            station: { select: { code: true } },
            requiredCategory: { select: { code: true } },
            plannedSubcontractor: { select: { code: true } },
            plannedColor: { select: { code: true } },
            plannedProperties: { select: { property: { select: { code: true } } } },
          },
        },
      },
    });
    const out: Array<Record<string, string>> = [];
    for (const r of routes) {
      const header = {
        code: r.code ?? "",
        name: r.name,
        description: r.description ?? "",
        customerCode: r.customer?.code ?? "",
        isFavorite: r.isFavorite ? "Evet" : "Hayır",
        isActive: r.isActive ? "Evet" : "Hayır",
      };
      if (r.steps.length === 0) {
        // Adımsız rota da dosyada GÖRÜNMELİ — yoksa dışa aktarıp geri yükleyen
        // kullanıcı onu sessizce kaybeder.
        out.push({
          ...header,
          stepSequence: "",
          stationCode: "",
          stepNotes: "",
          requiredCategoryCode: "",
          plannedSubcontractorCode: "",
          plannedColorCode: "",
          plannedPropertyCodes: "",
        });
        continue;
      }
      for (const s of r.steps) {
        out.push({
          ...header,
          stepSequence: String(s.sequence),
          stationCode: s.station?.code ?? "",
          stepNotes: s.defaultNotes ?? "",
          requiredCategoryCode: s.requiredCategory?.code ?? "",
          plannedSubcontractorCode: s.plannedSubcontractor?.code ?? "",
          plannedColorCode: s.plannedColor?.code ?? "",
          plannedPropertyCodes: s.plannedProperties.map((pp) => pp.property.code).join(";"),
        });
      }
    }
    return out;
  },
};

function headerPayload(row: PreparedRow): Record<string, unknown> {
  const v = row.values;
  const out: Record<string, unknown> = {};
  for (const key of ["name", "description", "isFavorite", "isActive"]) {
    if (v[key] !== undefined) out[key] = v[key];
  }
  if (v.customerCode__id !== undefined) out.customerId = v.customerCode__id;
  // `code` GÖNDERİLMEZ: autoCode zaten düşürür, göndermek niyeti bulanıklaştırır.
  return out;
}

function stepPayloads(row: PreparedRow): StepPayload[] {
  return (row.children ?? [])
    .map((c) => ({
      sequence: Number(c.values.stepSequence),
      stationId: String(c.values.stationCode__id ?? ""),
      defaultNotes: (c.values.stepNotes as string | null | undefined) ?? null,
      requiredCategoryId: (c.values.requiredCategoryCode__id as string | null | undefined) ?? null,
      plannedSubcontractorId: (c.values.plannedSubcontractorCode__id as string | null | undefined) ?? null,
      plannedColorId: (c.values.plannedColorCode__id as string | null | undefined) ?? null,
      plannedPropertyIds: (c.values.plannedPropertyCodes__ids as string[] | undefined) ?? [],
    }))
    .sort((a, b) => a.sequence - b.sequence);
}
