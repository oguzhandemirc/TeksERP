// Müşteriye özel ad eşlemeleri (kumaş adı + renk adı) — iki adaptör, tek dosya.
//
// =============================================================================
// ANAHTAR TASARIMI — neden "CARİ KODU|KUMAŞ KODU"
// =============================================================================
// Eşlemenin kimliği ÇİFTtir: (müşteri, kumaş) / (müşteri, renk) — şemada da
// `@@unique([customerId, itemId])` olarak duruyor. Motor ise satırları tek bir
// sütunla (`keyColumns[0]`) eşleştirir ve anahtarı `validateRow`'dan ÖNCE
// hesaplar, yani anahtarı diğer hücrelerden türetmek mümkün değil. Bu yüzden
// çift, TEK sütunda taşınır: `MUS1908260001|PATOS-01` (ilk `|` böler).
//
// Sonuç olarak müşteri ve kumaş/renk ANAHTARIN İÇİNDEDİR; ayrıca doldurulan
// sütunlar DEĞİLDİR. `customerName` / `itemName` / `colorName` yalnız BİLGİ
// sütunlarıdır (`readOnly`): dışa aktarımda dolar, içe aktarımda yok sayılır.
// Aynı referansı iki yerden almak "hangisi kazanır" sorusunu doğururdu.
//
// Yazılan TEK alan `alias`tır (müşterideki ad). Servis onu BÜYÜK harfe
// normalize eder (`normalizeDisplayName`) — bu yüzden önizlemedeki fark da
// normalize edilmiş hâliyle gösterilir, yoksa "aktos → AKTOS" gibi görünmeyen
// bir fark her koşumda UPDATE sayılırdı.
//
// ⚠️ RENK TARAFINDA `assigned` BİLEREK YOK: "renk bu müşteriye özel atandı mı"
// ayrı bir karardır (renk formundan yönetilir) ve yanlışlıkla açılıp kapanması
// rengi başka müşterilerin siparişlerinde serbest bırakır ya da kilitler. Bu
// şablon yalnız ADI yönetir.

import prisma from "../../../lib/prisma";
import { CustomerAliasService } from "../../customer-alias.service";
import { normalizeDisplayName } from "../../helpers/name-normalize.helper";
import { resolveReference } from "../import-lookup";
import type { ImportAdapter, ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { upperTr } from "../../../utils/tr-case";
import { importKey } from "../import-key";

// Servisin paylaşılan tekili yok (controller kendi private örneğini kuruyor);
// servis durumsuz olduğu için burada kendi örneğimizi kuruyoruz.
const aliasService = new CustomerAliasService();

/** Anahtardaki ayraç. Kod içinde `|` beklenmez; yine de İLK ayraç bölme noktasıdır. */
const KEY_SEP = "|";

interface AliasKeyParts {
  customerCode: string;
  targetCode: string;
}

function parseAliasKey(raw: string): AliasKeyParts | null {
  const idx = raw.indexOf(KEY_SEP);
  if (idx < 0) return null;
  const customerCode = raw.slice(0, idx).trim();
  const targetCode = raw.slice(idx + KEY_SEP.length).trim();
  if (!customerCode || !targetCode) return null;
  return { customerCode, targetCode };
}

/**
 * Sentetik anahtarın bedeli: aynı kayda iki farklı yazımla ulaşılabilir
 * ("MUS1|patos" ile "MUS1|PATOS" aynı eşlemeyi bulur). Motorun metin-bazlı
 * mükerrer kontrolü bunu göremez — id üzerinden bakıyoruz.
 */
function guardDuplicateTarget(row: PreparedRow, ctx: ImportContext, bucketKey: string): void {
  const targetId = row.result.targetId;
  if (!targetId) return;
  let bucket = ctx.cache.get(bucketKey);
  if (!bucket) {
    bucket = new Map();
    ctx.cache.set(bucketKey, bucket);
  }
  const prev = bucket.get(targetId);
  if (prev) {
    row.result.errors.push({
      column: "externalKey",
      message: `Bu eşleme dosyada ${prev.id}. satırda da eşleşti (anahtar farklı yazılmış ama aynı kayıt). Satırlardan birini silin.`,
    });
    return;
  }
  bucket.set(targetId, { id: String(row.input.rowNo), isActive: true });
}

/**
 * Servis adı BÜYÜK saklar. Farkı (diff) da normalize hâliyle göster: aksi hâlde
 * küçük harf yazılmış bir dosya HER koşumda "değişti" der ve hiçbir şey
 * değişmediği hâlde tüm satırlar UPDATE sayılır.
 */
function applyAliasNormalization(row: PreparedRow): void {
  const raw = row.values.alias;
  if (typeof raw !== "string") return;
  const norm = normalizeDisplayName(raw);
  if (norm === raw) return;
  row.values.alias = norm;
  const changes = row.result.changes;
  if (!changes?.alias) return;
  const current = (row.existing?.alias as string | null | undefined) ?? null;
  if (current === norm) {
    delete changes.alias;
    if (Object.keys(changes).length === 0 && row.result.action === "UPDATE") {
      row.result.action = "SKIP";
    }
  } else {
    changes.alias = { from: current, to: norm };
  }
}

function commonColumns(targetLabel: string, targetExample: string, targetNameKey: string): ImportColumn[] {
  return [
    {
      key: "externalKey",
      label: `Anahtar (Cari Kodu|${targetLabel} Kodu)`,
      type: "text",
      required: true,
      createOnly: true,
      maxLen: 160,
      help:
        `Dikey çizgi ile ayırın: CARİ KODU|${upperTr(targetLabel)} KODU ` +
        `(örn. MUS1908260001|${targetExample}). Kodlar sistemdeki kodlardır; bulunamazsa satır hata verir.`,
      example: `MUS1908260001${KEY_SEP}${targetExample}`,
    },
    {
      key: "customerName",
      label: "Cari Ünvanı (bilgi)",
      type: "text",
      readOnly: true,
      help: "Yalnız bilgi amaçlıdır — dışa aktarımda dolar, içe aktarımda yok sayılır.",
      example: "",
    },
    {
      key: targetNameKey,
      label: `${targetLabel} Adı — bizdeki (bilgi)`,
      type: "text",
      readOnly: true,
      help: "Yalnız bilgi amaçlıdır; karşılaştırma için dışa aktarımda doldurulur.",
      example: "",
    },
    {
      key: "alias",
      label: `${targetLabel} Adı — müşterideki`,
      type: "text",
      required: true,
      maxLen: 200,
      help: "Müşterinin bu kayda verdiği ad. BÜYÜK harfe çevrilerek saklanır. Boş bırakılırsa mevcut ada DOKUNULMAZ.",
      example: "",
    },
  ];
}

/** Anahtarların müşteri parçasını TEK sorguda çözer (N+1 yok). */
async function loadCustomers(
  parsed: Array<{ raw: string; parts: AliasKeyParts }>,
): Promise<Map<string, { id: string; code: string; name: string }>> {
  const codes = [...new Set(parsed.map((p) => p.parts.customerCode))];
  const rows = await prisma.customer.findMany({
    where: { code: { in: codes, mode: "insensitive" } },
    select: { id: true, code: true, name: true },
  });
  return new Map(rows.map((r) => [importKey(r.code), r]));
}

function parseKeys(keys: string[]): Array<{ raw: string; parts: AliasKeyParts }> {
  return keys
    .map((raw) => ({ raw, parts: parseAliasKey(raw) }))
    .filter((p): p is { raw: string; parts: AliasKeyParts } => p.parts !== null);
}

/**
 * İki adaptörün ORTAK satır doğrulaması: anahtar biçimi, mükerrer hedef, müşteri
 * + hedef referansının çözümü (id'ler `__customerId` / `__targetId`'de taşınır).
 */
async function validateAliasRow(
  row: PreparedRow,
  ctx: ImportContext,
  targetEntity: "item" | "color",
  bucketKey: string,
): Promise<void> {
  const key = row.result.key;
  if (!key) return; // anahtar boş — motor zaten "zorunlu" hatası verdi
  const parts = parseAliasKey(key);
  if (!parts) {
    row.result.errors.push({
      column: "externalKey",
      message: `Anahtar '${key}' okunamadı. Biçim: CARİ KODU|KOD (örn. MUS1908260001${KEY_SEP}PATOS-01).`,
    });
    return;
  }

  guardDuplicateTarget(row, ctx, bucketKey);

  if (row.values.alias === null) {
    row.result.errors.push({
      column: "alias",
      message: "Müşterideki ad NULL ile temizlenemez — eşlemeyi kaldırmak için panelden silin.",
    });
  }
  applyAliasNormalization(row);

  // Referansları ŞİMDİ çöz (pasif kayıt da hata verir — servis zaten reddeder).
  const customer = await resolveReference("customer", parts.customerCode, ctx);
  if (customer.error) row.result.errors.push({ column: "externalKey", ...customer.error });
  if (customer.warning) row.result.warnings.push({ column: "externalKey", message: customer.warning });
  if (customer.hit) row.values.__customerId = customer.hit.id;

  const target = await resolveReference(targetEntity, parts.targetCode, ctx);
  if (target.error) row.result.errors.push({ column: "externalKey", ...target.error });
  if (target.warning) row.result.warnings.push({ column: "externalKey", message: target.warning });
  if (target.hit) row.values.__targetId = target.hit.id;
}

const SHARED_NOTES = [
  "Bir satır = bir eşleme. Anahtar iki parçalıdır ve dikey çizgi ile ayrılır.",
  "Müşteri ve kumaş/renk ANAHTARDAN okunur; '(bilgi)' yazan sütunları doldurmanız gerekmez.",
  "Boş bırakılan ad hücresi mevcut adı DEĞİŞTİRMEZ; ad BÜYÜK harfe çevrilerek saklanır.",
  "Eşlemeyi kaldırmak bu şablonla YAPILMAZ (silme yok) — panelden kaldırın.",
];

// =============================================================================
// KUMAŞ ADI EŞLEMESİ
// =============================================================================

export const customerItemAliasImportAdapter: ImportAdapter = {
  entity: "customerItemAlias",
  label: "Müşteri Kumaş Adları",
  tableName: "CUSTOMER_ITEM_ALIAS",
  writePermission: "customer-alias:write",
  readPermission: "customer-alias:read",
  keyColumns: ["externalKey"],
  columns: commonColumns("Kumaş", "PATOS-01", "itemName"),
  notes: SHARED_NOTES,

  async findExisting(keys) {
    const map = new Map<string, Record<string, unknown>>();
    const parsed = parseKeys(keys);
    if (parsed.length === 0) return map;

    const customerByCode = await loadCustomers(parsed);
    if (customerByCode.size === 0) return map;

    const itemCodes = [...new Set(parsed.map((p) => p.parts.targetCode))];
    const items = await prisma.item.findMany({
      where: { code: { in: itemCodes, mode: "insensitive" } },
      select: { id: true, code: true, name: true },
    });
    const itemByCode = new Map(items.map((i) => [importKey(i.code), i]));
    if (items.length === 0) return map;

    const rows = await prisma.customerItemAlias.findMany({
      where: {
        customerId: { in: [...customerByCode.values()].map((c) => c.id) },
        itemId: { in: items.map((i) => i.id) },
      },
      select: { id: true, customerId: true, itemId: true, alias: true },
    });
    const byPair = new Map(rows.map((r) => [`${r.customerId}:${r.itemId}`, r]));

    for (const { raw, parts } of parsed) {
      const customer = customerByCode.get(importKey(parts.customerCode));
      const item = itemByCode.get(importKey(parts.targetCode));
      if (!customer || !item) continue;
      const hit = byPair.get(`${customer.id}:${item.id}`);
      if (!hit) continue;
      map.set(importKey(raw), {
        id: hit.id,
        // `name` sütun DEĞİL — motorun satır etiketi olarak kullandığı alan.
        name: `${customer.name} · ${item.name}`,
        externalKey: `${customer.code}${KEY_SEP}${item.code}`,
        customerName: customer.name,
        itemName: item.name,
        alias: hit.alias,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    await validateAliasRow(row, ctx, "item", "customerItemAlias:target");
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    return upsertItemAlias(row, ctx);
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    return upsertItemAlias(row, ctx);
  },

  async exportRows() {
    const rows = await prisma.customerItemAlias.findMany({
      orderBy: [{ customer: { code: "asc" } }, { item: { code: "asc" } }],
      select: {
        alias: true,
        customer: { select: { code: true, name: true } },
        item: { select: { code: true, name: true } },
      },
    });
    return rows.map((r) => ({
      externalKey: `${r.customer.code}${KEY_SEP}${r.item.code}`,
      customerName: r.customer.name,
      itemName: r.item.name,
      alias: r.alias,
    }));
  },
};

/** CREATE ve UPDATE aynı servis çağrısıdır (`upsert`) — ayrı yol yok. */
async function upsertItemAlias(row: PreparedRow, ctx: ImportContext): Promise<{ id: string }> {
  const res = await aliasService.upsertItemAlias(
    row.values.__customerId as string,
    row.values.__targetId as string,
    String(row.values.alias),
    ctx.userId,
  );
  return { id: res.data.id };
}

// =============================================================================
// RENK ADI EŞLEMESİ
// =============================================================================

export const customerColorAliasImportAdapter: ImportAdapter = {
  entity: "customerColorAlias",
  label: "Müşteri Renk Adları",
  tableName: "CUSTOMER_COLOR_ALIAS",
  writePermission: "customer-alias:write",
  readPermission: "customer-alias:read",
  keyColumns: ["externalKey"],
  columns: commonColumns("Renk", "RNK1908260001", "colorName"),
  notes: [
    ...SHARED_NOTES,
    "Rengin müşteriye ÖZEL atanması (özel renk) bu şablonun kapsamı dışındadır — o karar renk formundan yönetilir.",
    "Dışa aktarımda yalnız müşteri adı TANIMLI satırlar listelenir.",
  ],

  async findExisting(keys) {
    const map = new Map<string, Record<string, unknown>>();
    const parsed = parseKeys(keys);
    if (parsed.length === 0) return map;

    const customerByCode = await loadCustomers(parsed);
    if (customerByCode.size === 0) return map;

    const colorCodes = [...new Set(parsed.map((p) => p.parts.targetCode))];
    const colors = await prisma.color.findMany({
      where: { code: { in: colorCodes, mode: "insensitive" } },
      select: { id: true, code: true, name: true },
    });
    const colorByCode = new Map(colors.map((c) => [importKey(c.code), c]));
    if (colors.length === 0) return map;

    // `assigned=true, alias=null` satırları da EŞLEŞİR: kayıt fiziksel olarak
    // vardır ve servis onu `upsert` ile günceller. "Yok" saymak, önizlemenin
    // CREATE derken gerçekte UPDATE yapmasına yol açardı.
    const rows = await prisma.customerColorAlias.findMany({
      where: {
        customerId: { in: [...customerByCode.values()].map((c) => c.id) },
        colorId: { in: colors.map((c) => c.id) },
      },
      select: { id: true, customerId: true, colorId: true, alias: true },
    });
    const byPair = new Map(rows.map((r) => [`${r.customerId}:${r.colorId}`, r]));

    for (const { raw, parts } of parsed) {
      const customer = customerByCode.get(importKey(parts.customerCode));
      const color = colorByCode.get(importKey(parts.targetCode));
      if (!customer || !color) continue;
      const hit = byPair.get(`${customer.id}:${color.id}`);
      if (!hit) continue;
      map.set(importKey(raw), {
        id: hit.id,
        name: `${customer.name} · ${color.name}`,
        externalKey: `${customer.code}${KEY_SEP}${color.code}`,
        customerName: customer.name,
        colorName: color.name,
        alias: hit.alias,
      });
    }
    return map;
  },

  async validateRow(row: PreparedRow, ctx: ImportContext) {
    await validateAliasRow(row, ctx, "color", "customerColorAlias:target");
  },

  async createOne(row: PreparedRow, ctx: ImportContext) {
    return upsertColorAlias(row, ctx);
  },

  async updateOne(row: PreparedRow, ctx: ImportContext) {
    return upsertColorAlias(row, ctx);
  },

  async exportRows() {
    const rows = await prisma.customerColorAlias.findMany({
      // Adı olmayan (yalnız "özel renk" ataması taşıyan) satırlar bu şablonun
      // konusu değil — dışa aktarımda listelenmez.
      where: { alias: { not: null } },
      orderBy: [{ customer: { code: "asc" } }, { color: { code: "asc" } }],
      select: {
        alias: true,
        customer: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
      },
    });
    return rows.map((r) => ({
      externalKey: `${r.customer.code}${KEY_SEP}${r.color.code}`,
      customerName: r.customer.name,
      colorName: r.color.name,
      alias: r.alias ?? "",
    }));
  },
};

/** CREATE ve UPDATE aynı servis çağrısıdır (`upsert`) — ayrı yol yok. */
async function upsertColorAlias(row: PreparedRow, ctx: ImportContext): Promise<{ id: string }> {
  const res = await aliasService.upsertColorAlias(
    row.values.__customerId as string,
    row.values.__targetId as string,
    String(row.values.alias),
    ctx.userId,
  );
  return { id: res.data.id };
}
