// Müşteri şubesi (sevk noktası) içe-dışa aktarım adaptörü.
//
// =============================================================================
// ANAHTAR TASARIMI — neden "CARİ KODU|ŞUBE ADI"
// =============================================================================
// Şubenin kimliği TEK bir kolon değil, ÇİFTtir: (müşteri, şube adı). Motor ise
// satırları `keyColumns[0]` ile — yani tek bir sütunla — eşleştirir ve anahtarı
// `validateRow`'dan ÖNCE hesaplar; dolayısıyla anahtarı diğer hücrelerden
// türetmek mümkün değil. Üç aday vardı:
//   • `customerCode`  → YANLIŞ: bir müşterinin N şubesi var, ikinci satır
//                        "mükerrer anahtar" diye reddedilirdi.
//   • `code` (şube ihracat kodu) → YANLIŞ: opsiyonel ve şubelerin çoğunda boş;
//                        boş anahtar her satırı CREATE'e düşürür.
//   • ÇİFTİ TAŞIYAN TEK SÜTUN → seçilen. Kullanıcı `MUS1908260001|MERKEZ DEPO`
//                        yazar; adaptör `|`in İLKİNDEN böler.
//
// Bunun doğal sonucu: müşteri kodu ve şube adı ANAHTARIN İÇİNDEDİR, ayrıca
// doldurulan sütunlar DEĞİLDİR. `customerName`/`name` sütunları yalnız
// BİLGİ amaçlıdır (`readOnly`) — dışa aktarımda dosyayı insan-okunur yapar,
// içe aktarımda yok sayılır. Aynı bilgiyi iki yerden almak, ikisinin
// çelişmesi hâlinde "hangisi kazanır" sorusunu doğururdu; anahtar tek kaynaktır.
//
// ⚠️ ŞUBE ADI DEĞİŞTİRİLEMEZ (import'la): ad anahtarın parçası olduğu için
// dosyada adı düzeltmek "yeni şube" demektir. Ad düzeltmesi panelden yapılır.
// Bu sessiz bir kısıt değil: `notes` + sütun `help` metninde yazılıdır.

import prisma from "../../../lib/prisma";
import { CustomerBranchService, type CustomerBranchInput } from "../../customer-branch.service";
import { foldNameForCompare } from "../../helpers/name-normalize.helper";
import { resolveReference } from "../import-lookup";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { upperTr } from "../../../utils/tr-case";

// Servisin modül düzeyinde paylaşılan tekili yok (route dosyası kendi örneğini
// yerelde kuruyor ve dışa açmıyor) — burada kendi örneğimizi kuruyoruz. Servis
// durumsuzdur, örnek sayısı davranışı etkilemez.
const branchService = new CustomerBranchService();

/** Anahtardaki ayraç. Şube adında `|` geçerse İLK ayraç bölme noktasıdır. */
const KEY_SEP = "|";

interface BranchKeyParts {
  customerCode: string;
  branchName: string;
}

function parseBranchKey(raw: string): BranchKeyParts | null {
  const idx = raw.indexOf(KEY_SEP);
  if (idx < 0) return null;
  const customerCode = raw.slice(0, idx).trim();
  const branchName = raw.slice(idx + KEY_SEP.length).trim();
  if (!customerCode || !branchName) return null;
  return { customerCode, branchName };
}

const COLUMNS: ImportColumn[] = [
  {
    key: "externalKey",
    label: "Şube Anahtarı (Cari Kodu|Şube Adı)",
    type: "text",
    required: true,
    createOnly: true,
    maxLen: 160,
    help:
      "Dikey çizgi ile ayırın: CARİ KODU|ŞUBE ADI (örn. MUS1908260001|MERKEZ DEPO). " +
      "Şube adı bu anahtarın parçasıdır — adı değiştirmek YENİ şube oluşturur, ad düzeltmesi panelden yapılır.",
    example: "MUS1908260001|MERKEZ DEPO",
  },
  {
    key: "customerName",
    label: "Cari Ünvanı (bilgi)",
    type: "text",
    readOnly: true,
    help: "Yalnız bilgi amaçlıdır — dışa aktarımda dolar, içe aktarımda yok sayılır (müşteri anahtardan çözülür).",
    example: "",
  },
  {
    key: "name",
    label: "Şube Adı (bilgi)",
    type: "text",
    readOnly: true,
    help: "Yalnız bilgi amaçlıdır — gerçek değer anahtarın ikinci parçasıdır.",
    example: "",
  },
  {
    key: "code",
    label: "Şube İhracat Kodu",
    type: "text",
    maxLen: 50,
    help: "Opsiyonel. Doluysa sevk belgesinde şirketin ihracat kodunun yerine basılır. Aynı müşteride tekildir. Temizlemek için NULL yazın.",
    example: "",
  },
  { key: "address", label: "Adres", type: "text", maxLen: 1000, example: "" },
  { key: "city", label: "İl", type: "text", maxLen: 80, example: "BURSA" },
  { key: "district", label: "İlçe", type: "text", maxLen: 80, example: "" },
  { key: "contactName", label: "Yetkili", type: "text", maxLen: 120, example: "" },
  { key: "contactPhone", label: "Telefon", type: "text", maxLen: 40, example: "" },
  { key: "notes", label: "Not", type: "text", maxLen: 1000, example: "" },
  { key: "isActive", label: "Aktif", type: "bool", help: "Evet / Hayır.", example: "Evet" },
];

/** `undefined` → dokunma · `null` → temizle · dolu → metin. */
function textVal(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return String(v);
}

function boolVal(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export const customerBranchImportAdapter: ImportAdapter = {
  entity: "customerBranch",
  label: "Müşteri Şubeleri (Sevk Noktaları)",
  tableName: "CUSTOMER_BRANCH",
  writePermission: "customer:write",
  readPermission: "customer:read",
  keyColumns: ["externalKey"],
  columns: COLUMNS,
  notes: [
    "Bir satır = bir şube. Anahtar iki parçalıdır: CARİ KODU|ŞUBE ADI (örn. MUS1908260001|MERKEZ DEPO).",
    "Müşteri ve şube adı ANAHTARDAN okunur; 'Cari Ünvanı' ve 'Şube Adı' sütunları yalnız bilgi amaçlıdır, doldurmanız gerekmez.",
    "Şube adı anahtarın parçası olduğu için import ile DEĞİŞTİRİLEMEZ — ad düzeltmesi panelden yapılır (dosyada adı değiştirmek yeni şube açar).",
    "Aynı müşteride aynı adlı ikinci şube açılamaz; pasif bir şube varsa yenisini eklemek yerine Aktif sütununu Evet yapın.",
  ],

  async findExisting(keys) {
    const map = new Map<string, Record<string, unknown>>();
    const parsed = keys
      .map((raw) => ({ raw, parts: parseBranchKey(raw) }))
      .filter((p): p is { raw: string; parts: BranchKeyParts } => p.parts !== null);
    if (parsed.length === 0) return map;

    // 1) Müşterileri TEK sorguda çöz (N+1 yok).
    const customerCodes = [...new Set(parsed.map((p) => p.parts.customerCode))];
    const customers = await prisma.customer.findMany({
      where: { code: { in: customerCodes, mode: "insensitive" } },
      select: { id: true, code: true, name: true },
    });
    const customerByCode = new Map(customers.map((c) => [upperTr(c.code), c]));
    if (customers.length === 0) return map;

    // 2) O müşterilerin TÜM şubeleri (pasifler dahil — pasif şube "yok" değildir,
    //    yenisini açmak yerine aktifleştirilmelidir).
    //    Ad eşleşmesi JS'te katlanarak yapılır; `nameFold` gölge kolonuyla
    //    süzmek daha hızlı olurdu ama katlama iki tarafta ayrışırsa satır
    //    "bulunamadı" sayılıp yanlışlıkla CREATE'e düşerdi.
    const branches = await prisma.customerBranch.findMany({
      where: { customerId: { in: customers.map((c) => c.id) } },
      select: {
        id: true, customerId: true, code: true, name: true, address: true, city: true,
        district: true, contactName: true, contactPhone: true, notes: true, isActive: true,
        customer: { select: { code: true, name: true } },
      },
    });
    const branchIndex = new Map<string, (typeof branches)[number]>();
    for (const b of branches) {
      branchIndex.set(`${b.customerId}:${foldNameForCompare(b.name)}`, b);
    }

    for (const { raw, parts } of parsed) {
      const customer = customerByCode.get(upperTr(parts.customerCode));
      if (!customer) continue;
      const hit = branchIndex.get(`${customer.id}:${foldNameForCompare(parts.branchName)}`);
      if (!hit) continue;
      map.set(upperTr(raw), {
        id: hit.id,
        customerId: hit.customerId,
        externalKey: `${hit.customer.code}${KEY_SEP}${hit.name}`,
        customerName: hit.customer.name,
        name: hit.name,
        code: hit.code,
        address: hit.address,
        city: hit.city,
        district: hit.district,
        contactName: hit.contactName,
        contactPhone: hit.contactPhone,
        notes: hit.notes,
        isActive: hit.isActive,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    const key = row.result.key;
    if (!key) return; // anahtar boş — motor zaten "zorunlu" hatası verdi
    const parts = parseBranchKey(key);
    if (!parts) {
      row.result.errors.push({
        column: "externalKey",
        message: `Anahtar '${key}' okunamadı. Biçim: CARİ KODU|ŞUBE ADI (örn. MUS1908260001|MERKEZ DEPO).`,
      });
      return;
    }

    // Sentetik anahtarın bedeli: aynı kayda İKİ FARKLI yazımla ulaşılabilir
    // ("MUS1|MERKEZ DEPO" ile "MUS1|merkez  depo" aynı şubeyi bulur). Motorun
    // metin-bazlı mükerrer kontrolü bunu göremez; burada id üzerinden bakıyoruz.
    const targetId = row.result.targetId;
    if (targetId) {
      const bucketKey = "customerBranch:target";
      let bucket = ctx.cache.get(bucketKey);
      if (!bucket) {
        bucket = new Map();
        ctx.cache.set(bucketKey, bucket);
      }
      const prev = bucket.get(targetId);
      if (prev) {
        row.result.errors.push({
          column: "externalKey",
          message: `Bu şube dosyada ${prev.id}. satırda da eşleşti (anahtar farklı yazılmış ama aynı kayıt). Satırlardan birini silin.`,
        });
      } else {
        bucket.set(targetId, { id: String(row.input.rowNo), isActive: true });
      }
    }

    // Müşteriyi ŞİMDİ çöz: "cari yok / pasif" hatası önizlemede görünsün.
    // (UPDATE'te de çözüyoruz — servis `update(customerId, id, …)` istiyor ve
    // müşterinin bu arada pasife alınmış olması yazma anında patlamamalı.)
    if (row.existing) {
      row.values.__customerId = row.existing.customerId;
    } else {
      const out = await resolveReference("customer", parts.customerCode, ctx);
      if (out.error) {
        row.result.errors.push({ column: "externalKey", ...out.error });
        return;
      }
      if (out.warning) row.result.warnings.push({ column: "externalKey", message: out.warning });
      if (out.hit) row.values.__customerId = out.hit.id;
    }
    row.values.__branchName = parts.branchName;
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    const customerId = row.values.__customerId as string;
    const v = row.values;
    const data: CustomerBranchInput = {
      name: row.values.__branchName as string,
      code: textVal(v.code),
      address: textVal(v.address),
      city: textVal(v.city),
      district: textVal(v.district),
      contactName: textVal(v.contactName),
      contactPhone: textVal(v.contactPhone),
      notes: textVal(v.notes),
      isActive: boolVal(v.isActive),
    };
    const res = await branchService.create(customerId, data, ctx.userId);
    return { id: (res.data as { id: string }).id };
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    const id = row.result.targetId as string;
    const customerId = row.values.__customerId as string;
    const v = row.values;
    // `name` BİLEREK gönderilmiyor: ad anahtarın parçasıdır (bkz. dosya başlığı).
    const data: Partial<CustomerBranchInput> = {
      code: textVal(v.code),
      address: textVal(v.address),
      city: textVal(v.city),
      district: textVal(v.district),
      contactName: textVal(v.contactName),
      contactPhone: textVal(v.contactPhone),
      notes: textVal(v.notes),
      isActive: boolVal(v.isActive),
    };
    await branchService.update(customerId, id, data, ctx.userId);
    return { id };
  },

  async exportRows() {
    const rows = await prisma.customerBranch.findMany({
      orderBy: [{ customer: { code: "asc" } }, { name: "asc" }],
      select: {
        code: true, name: true, address: true, city: true, district: true,
        contactName: true, contactPhone: true, notes: true, isActive: true,
        customer: { select: { code: true, name: true } },
      },
    });
    return rows.map((r) => ({
      externalKey: `${r.customer.code}${KEY_SEP}${r.name}`,
      customerName: r.customer.name,
      name: r.name,
      code: r.code ?? "",
      address: r.address ?? "",
      city: r.city ?? "",
      district: r.district ?? "",
      contactName: r.contactName ?? "",
      contactPhone: r.contactPhone ?? "",
      notes: r.notes ?? "",
      isActive: r.isActive ? "Evet" : "Hayır",
    }));
  },
};
