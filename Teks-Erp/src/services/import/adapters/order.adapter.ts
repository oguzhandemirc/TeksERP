// Sipariş (Order + OrderLine) içe aktarım adaptörü — GRUPLU ŞABLON (F4).
//
// Kullanım senaryosu: müşteri kendi Excel'inde sipariş gönderir; planlamacı onu
// tek tek girmek yerine yükler. Bir sipariş = N satır (her satır bir KALEM);
// satırlar "Sipariş Referansı" sütununa göre gruplanır.
//
// ⚠️ SİPARİŞ NUMARASI SUNUCU ÜRETİR (`SIP+GGAAYY+NNNN`). Dosyadaki referans
// MÜŞTERİNİN kendi numarasıdır — bizim sipariş numaramız DEĞİLDİR ve onunla
// eşleşmez. Bu yüzden bu adaptör YALNIZ OLUŞTURUR: aynı dosyayı ikinci kez
// yüklemek ikinci bir sipariş açar.
//   Neden güncelleme yok: sipariş bir İŞLEM kaydıdır — üzerine iş emri açılır,
//   sevkiyat bağlanır, `shippedQty` denormalize edilir. Bir Excel satırını
//   "kaynak doğru" sayıp mevcut siparişi ezmek, üretimi olmuş bir kaydı sessizce
//   değiştirmek olurdu. Yanlış giren sipariş PANELDEN düzeltilir/iptal edilir.
// ⚠️ Bu yüzden mükerrer koruması ÖNİZLEMEDEDİR: aynı müşteri + aynı referans
// son 90 günde zaten varsa satır UYARI alır (engellenmez — meşru tekrar olabilir).

import prisma from "../../../lib/prisma";
import { orderService } from "../../../routes/order.routes";
import { resolveReference, resolveReferenceList } from "../import-lookup";
import { splitList } from "../import-coerce";
import type {
  ImportAdapter,
  ImportColumn,
  ImportContext,
  ImportFixHint,
  PreparedRow,
} from "../import.types";
import { upperTr } from "../../../utils/tr-case";

const COLUMNS: ImportColumn[] = [
  // ── Başlık (grubun İLK satırından) ────────────────────────────────────────
  {
    key: "ref",
    label: "Sipariş Referansı",
    type: "text",
    required: true,
    maxLen: 64,
    help: "Müşterinin kendi sipariş numarası ya da serbest bir etiket. Aynı siparişin TÜM kalemleri aynı referansı taşımalı — satırlar buna göre gruplanır. Sistemin sipariş numarası (SIP…) ayrıca üretilir.",
    example: "MUS-2026-114",
  },
  {
    key: "customerCode",
    label: "Müşteri Kodu",
    type: "lookup",
    required: true,
    lookup: { entity: "customer", by: "code" },
    example: "MUS1908260001",
  },
  {
    key: "branchName",
    label: "Şube",
    type: "text",
    maxLen: 100,
    help: "Müşterinin şube ADI (boş = şubesiz). Şube o müşteriye ait olmalı.",
    example: "",
  },
  { key: "orderDate", label: "Sipariş Tarihi", type: "date", help: "GG.AA.YYYY. Boş = bugün.", example: "19.08.2026" },
  { key: "deadline", label: "Termin", type: "date", help: "GG.AA.YYYY. Boş = tanımlardaki varsayılan gün sayısı.", example: "" },
  {
    key: "currency",
    label: "Para Birimi",
    type: "enum",
    enumValues: [
      { value: "TRY", label: "TL" },
      { value: "USD", label: "USD" },
      { value: "EUR", label: "EUR" },
      { value: "GBP", label: "GBP" },
    ],
    help: "Boş = TL.",
    example: "TL",
  },

  // ── Kalem sütunları (HER satırdan) ────────────────────────────────────────
  {
    key: "itemCode",
    label: "Kumaş Kodu",
    type: "lookup",
    required: true,
    child: true,
    lookup: { entity: "item", by: "code" },
    example: "PATOS-01",
  },
  {
    key: "colorCode",
    label: "Renk Kodu",
    type: "lookup",
    child: true,
    lookup: { entity: "color", by: "code" },
    help: "Boş = ham talep (renksiz).",
    example: "",
  },
  // ⚠️ Başlık "Miktar (m)" KORUNDU: panel Excel başlığını ETİKETLE eşler
  // (`lib/import/parse.ts` byLabel) — yeniden adlandırmak indirilmiş şablonları
  // kırardı. Birim ayrı sütunda; boşsa kalem kartından kopyalanır.
  { key: "quantity", label: "Miktar (m)", type: "number", required: true, child: true, example: "1200",
    help: "Kalemin birimindeki miktar (Birim sütunu boşsa kalem kartının birimi; kumaşta tipik olarak metre)." },
  {
    key: "unit",
    label: "Birim",
    type: "enum",
    child: true,
    enumValues: [
      { value: "MT", label: "Metre" },
      { value: "KG", label: "Kilogram" },
      { value: "ADET", label: "Adet" },
    ],
    help: "Boş = kalem kartındaki birim. Kilogram/Adet satırda sevk karşılaması ÖLÇÜLMEZ (defter metre).",
    example: "",
  },
  { key: "width", label: "En (cm)", type: "number", child: true, example: "180" },
  { key: "unitPrice", label: "Birim Fiyat", type: "number", child: true, help: "Boş bırakılabilir.", example: "" },
  {
    key: "pieceLengthM",
    label: "Kesim Boyu (m)",
    type: "number",
    child: true,
    help: "Tambur eşit-parça önerisi. Boş = serbest kesim.",
    example: "",
  },
  { key: "cutNote", label: "Kesim Notu", type: "text", maxLen: 1000, child: true, example: "" },
  {
    key: "requiredPropertyCodes",
    label: "İstenen Özellikler",
    type: "lookup",
    child: true,
    lookup: { entity: "fabricProperty", by: "code", multiple: true },
    help: "Özellik KODLARI, noktalı virgülle.",
    example: "",
  },
  {
    key: "customerItemName",
    label: "Müşterideki Kumaş Adı",
    type: "text",
    maxLen: 200,
    child: true,
    help: "Boş bırakılırsa müşteri alias'ından (tanımlıysa) okunur.",
    example: "",
  },
  { key: "customerColorName", label: "Müşterideki Renk Adı", type: "text", maxLen: 200, child: true, example: "" },
];

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

export const orderImportAdapter: ImportAdapter = {
  entity: "order",
  label: "Siparişler",
  tableName: "ORDER",
  writePermission: "order:write",
  readPermission: "order:read",
  keyColumns: ["ref"],
  columns: COLUMNS,
  grouped: true,
  notes: [
    "GRUPLU ŞABLON: bir siparişin her KALEMİ ayrı bir satırdır; satırlar 'Sipariş Referansı' sütununa göre gruplanır.",
    "⚠️ Bu şablon YALNIZ YENİ SİPARİŞ OLUŞTURUR — mevcut siparişi güncellemez. Aynı dosyayı ikinci kez yüklerseniz ikinci bir sipariş açılır.",
    "Sipariş numarasını (SIP…) sistem üretir; dosyadaki referans müşterinin kendi numarasıdır ve not olarak kalmaz — yalnız gruplama içindir.",
    "Aynı müşteri + aynı referans son 90 günde varsa UYARI verilir (engellenmez).",
  ],

  // Sipariş referansı bizde SAKLANMAZ (kolonu yok) → eşleşme aranmaz, her grup
  // yeni kayıttır. Boş Map dönmek "hiçbiri mevcut değil" demektir.
  async findExisting() {
    return new Map<string, Record<string, unknown>>();
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    // — Müşteri
    const custRaw = row.values.customerCode;
    let customerId: string | null = null;
    if (custRaw !== undefined && custRaw !== null) {
      const out = await resolveReference("customer", String(custRaw), ctx);
      if (out.error) row.result.errors.push({ column: "customerCode", ...out.error });
      if (out.warning) row.result.warnings.push({ column: "customerCode", message: out.warning });
      customerId = out.hit?.id ?? null;
      row.values.customerCode__id = customerId;
    }

    // — Şube (müşteriye AİT olmalı; ada göre çözülür)
    const branchName = row.values.branchName;
    if (branchName !== undefined && branchName !== null && String(branchName).trim() && customerId) {
      const wanted = String(branchName).trim();
      const branches = await prisma.customerBranch.findMany({
        where: { customerId, isActive: true },
        select: { id: true, name: true },
      });
      const matches = branches.filter(
        (b) => upperTr(b.name) === upperTr(wanted),
      );
      if (matches.length === 0) {
        row.result.errors.push({
          column: "branchName",
          message: `'${wanted}' adında aktif bir şube bu müşteride yok.`,
        });
      } else if (matches.length > 1) {
        row.result.errors.push({
          column: "branchName",
          message: `'${wanted}' adında birden fazla şube var — panelden düzeltin.`,
        });
      } else {
        row.values.branchName__id = matches[0]!.id;
      }
    }

    // — Kalemler
    if (!row.children || row.children.length === 0) {
      row.result.errors.push({ message: "Siparişin en az bir kalemi olmalı." });
      return;
    }
    for (const child of row.children) {
      for (const [key, entity] of [
        ["itemCode", "item"],
        ["colorCode", "color"],
      ] as const) {
        const raw = child.values[key];
        if (raw === undefined || raw === null) {
          child.values[`${key}__id`] = null;
          continue;
        }
        const out = await resolveReference(entity, String(raw), ctx);
        if (out.error) row.result.errors.push(childIssue(key, child.rowNo, out.error));
        if (out.warning) row.result.warnings.push({ column: key, message: `${child.rowNo}. satır: ${out.warning}` });
        child.values[`${key}__id`] = out.hit?.id ?? null;
      }

      const props = child.values.requiredPropertyCodes;
      if (props === undefined || props === null) {
        child.values.requiredPropertyCodes__ids = [];
      } else {
        const { ids, errors, warnings } = await resolveReferenceList(
          "fabricProperty",
          splitList(String(props)),
          ctx,
        );
        for (const m of errors) {
          row.result.errors.push(childIssue("requiredPropertyCodes", child.rowNo, m));
        }
        for (const m of warnings) {
          row.result.warnings.push({ column: "requiredPropertyCodes", message: `${child.rowNo}. satır: ${m}` });
        }
        child.values.requiredPropertyCodes__ids = ids;
      }

      const qty = child.values.quantity;
      if (typeof qty === "number" && qty <= 0) {
        row.result.errors.push({
          column: "quantity",
          message: `${child.rowNo}. satır: miktar 0'dan büyük olmalı.`,
        });
      }
    }

    // — Mükerrer uyarısı (engelleme DEĞİL): aynı müşteriye son 90 günde aynı
    //   toplam metrajla açılmış sipariş var mı. Referansı saklamadığımız için
    //   kesin bir eşleşme kuramayız; bu yüzden UYARI, hata değil.
    if (customerId) {
      const total = (row.children ?? []).reduce(
        (s, c) => s + (typeof c.values.quantity === "number" ? c.values.quantity : 0),
        0,
      );
      if (total > 0) {
        const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const dup = await prisma.order.findFirst({
          where: {
            customerId,
            createdAt: { gte: since },
            status: { notIn: ["CANCELLED"] },
            lines: { some: {} },
          },
          select: { orderNumber: true, lines: { select: { quantity: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        });
        if (dup) {
          const dupTotal = dup.lines.reduce((s, l) => s + Number(l.quantity), 0);
          if (Math.abs(dupTotal - total) < 0.001) {
            row.result.warnings.push({
              message: `Bu müşteriye son 90 günde aynı toplam metrajlı bir sipariş var (${dup.orderNumber}) — mükerrer olabilir.`,
            });
          }
        }
      }
    }
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const v = row.values;
    const payload: Record<string, unknown> = {
      customerId: v.customerCode__id,
      lines: (row.children ?? []).map((c) => {
        const line: Record<string, unknown> = {
          itemId: c.values.itemCode__id,
          quantity: c.values.quantity,
        };
        if (c.values.colorCode__id) line.colorId = c.values.colorCode__id;
        // Birim: boşsa gönderilmez → servis kalem kartından kopyalar (sessiz MT yok).
        if (c.values.unit !== undefined && c.values.unit !== null && c.values.unit !== "") line.unit = c.values.unit;
        if (c.values.width !== undefined) line.width = c.values.width;
        if (c.values.unitPrice !== undefined) line.unitPrice = c.values.unitPrice;
        if (c.values.pieceLengthM !== undefined) line.pieceLengthM = c.values.pieceLengthM;
        if (c.values.cutNote !== undefined) line.cutNote = c.values.cutNote;
        if (c.values.customerItemName !== undefined) line.customerItemName = c.values.customerItemName;
        if (c.values.customerColorName !== undefined) line.customerColorName = c.values.customerColorName;
        const props = c.values.requiredPropertyCodes__ids as string[] | undefined;
        if (props && props.length > 0) line.requiredPropertyIds = props;
        return line;
      }),
    };
    if (v.branchName__id) payload.branchId = v.branchName__id;
    if (v.orderDate !== undefined) payload.orderDate = v.orderDate;
    if (v.deadline !== undefined) payload.deadline = v.deadline;
    if (v.currency !== undefined) payload.currency = v.currency;

    const res = await orderService.create(payload, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  updateOne(): Promise<{ id: string }> {
    // Buraya asla gelinmez: `findExisting` boş döndüğü için her grup CREATE'tir.
    // Yine de sessiz kalmıyoruz — sözleşme değişirse gürültülü patlasın.
    throw new Error("Sipariş içe aktarımı güncelleme yapmaz — mevcut sipariş panelden düzeltilir.");
  },

  async exportRows() {
    // Sipariş DIŞA aktarımı bu şablondan yapılmaz: dosya geri yüklenirse
    // siparişleri ÇOĞALTIR (adaptör yalnız oluşturur). Sipariş listesinin kendi
    // "İndir" düğmesi ekrandaki sütunları basar ve doğru yüzey odur.
    return [];
  },
};
