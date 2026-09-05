// =============================================================================
// AUDIT REPRO — KYY-1-03: Ana veri KOD tekilliği (harf-duyarsız) yarışı.
// `lockCodeScopeTx` (8029) YALNIZ `item.service.ts:237`te alınıyor; diğer üç
// `decideCodeUniqueness` çağıranı (`subcontractor-management.service.ts:202`
// kategori, `:512` firma, `base.service.ts:1052` generic) KİLİTSİZ ve katlanmış
// kod için DB'de karşılık gelen bir UNIQUE YOK → iki eşzamanlı `sefa`/`SEFA`
// isteği guard'ı ikisi de geçer, yeni bir kimlik ikizi SESSİZCE doğar.
// (Helper'ın kendi docstring'i bu yarışı adıyla tarif ediyor: code-unique.helper.ts:63-69.)
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): iki eşzamanlı istekten TAM 1'i başarılı, diğeri
//   409; DB'de aynı katlanmış kodu taşıyan TEK satır.
// Gözlenen: log audit/repro/KYY-1-03.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-1-03.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorCategoryService } from "../src/services/subcontractor-management.service";
import { ItemService } from "../src/services/item.service";
import { BaseService } from "../src/services/base.service";

const STAMP = `ARK103${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const ROUNDS = 6;
const catSvc = new SubcontractorCategoryService();
const itemSvc = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  duplicateNameField: "name",
  entityLabel: "ürün",
});
// BaseService.create — `decideCodeUniqueness`in ÜÇÜNCÜ kilitsiz çağıranı
// (base.service.ts:1052; yorumu kilidin bilerek olmadığını söylüyor).
const gradeSvc = new BaseService({
  modelName: "qualityGrade",
  tableName: "QUALITY_GRADE",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "kalite sınıfı",
});

const createdCatIds: string[] = [];
const createdItemIds: string[] = [];
const createdGradeIds: string[] = [];

function outcome(rs: PromiseSettledResult<unknown>[]): string {
  return rs
    .map((r) =>
      r.status === "fulfilled"
        ? "OK"
        : `ERR(${(r.reason as { statusCode?: number })?.statusCode ?? "?"})`,
    )
    .join("+");
}

async function main(): Promise<void> {
  console.log(`REPRO KYY-1-03 · damga=${STAMP} · tur=${ROUNDS}`);
  let catTwins = 0;
  let itemCodeTwins = 0;
  let gradeTwins = 0;

  try {
    // ── A) SubcontractorCategory — KİLİTSİZ yol (kontrol grubu değil, asıl vaka)
    console.log("\n── A) SubcontractorCategory.create — 8029 kilidi YOK ──");
    for (let i = 1; i <= ROUNDS; i++) {
      const lower = `${STAMP}k${i}`.toLowerCase().slice(0, 30);
      const upper = lower.toUpperCase();
      const rs = await Promise.allSettled([
        catSvc.create({ code: lower, name: `${STAMP} Kategori A${i}` }),
        catSvc.create({ code: upper, name: `${STAMP} Kategori B${i}` }),
      ]);
      for (const r of rs) {
        if (r.status === "fulfilled") {
          const id = ((r.value as { data?: { id?: string } }).data?.id) ?? "";
          if (id) createdCatIds.push(id);
        }
      }
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM subcontractor_categories WHERE upper(code) = ${upper}
      `;
      const n = Number(rows[0]?.n ?? 0);
      if (n > 1) {
        catTwins++;
        console.log(`❌ tur ${i}: '${lower}' + '${upper}' → DB'de ${n} satır (kimlik ikizi) | ${outcome(rs)}`);
      } else {
        console.log(`✅ tur ${i}: DB'de ${n} satır | ${outcome(rs)}`);
      }
    }

    // ── B) Item — 8029 kilidi VAR (kontrol grubu: doğru desen ölçülüyor)
    console.log("\n── B) ItemService.create — 8029 kilidi VAR (kontrol grubu) ──");
    for (let i = 1; i <= ROUNDS; i++) {
      const lower = `${STAMP}i${i}`.toLowerCase().slice(0, 30);
      const upper = lower.toUpperCase();
      const rs = await Promise.allSettled([
        itemSvc.create({ code: lower, name: `${STAMP} Kumas A${i}`, itemType: "FABRIC" }),
        itemSvc.create({ code: upper, name: `${STAMP} Kumas B${i}`, itemType: "FABRIC" }),
      ]);
      for (const r of rs) {
        if (r.status === "fulfilled") {
          const id = ((r.value as { data?: { id?: string } }).data?.id) ?? "";
          if (id) createdItemIds.push(id);
        }
      }
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM items WHERE upper(code) = ${upper}
      `;
      const n = Number(rows[0]?.n ?? 0);
      if (n > 1) {
        itemCodeTwins++;
        console.log(`❌ tur ${i}: '${lower}' + '${upper}' → DB'de ${n} satır | ${outcome(rs)}`);
      } else {
        console.log(`✅ tur ${i}: DB'de ${n} satır (kilit çalışıyor) | ${outcome(rs)}`);
      }
    }

    // ── C) BaseService (QualityGrade) — 8029 kilidi YOK
    console.log("\n── C) BaseService.create (QualityGrade) — 8029 kilidi YOK ──");
    for (let i = 1; i <= ROUNDS; i++) {
      const lower = `${STAMP}g${i}`.toLowerCase().slice(0, 30);
      const upper = lower.toUpperCase();
      const rs = await Promise.allSettled([
        gradeSvc.create({ code: lower, name: `${STAMP} Kalite A${i}` }),
        gradeSvc.create({ code: upper, name: `${STAMP} Kalite B${i}` }),
      ]);
      for (const r of rs) {
        if (r.status === "fulfilled") {
          const id = ((r.value as { data?: { id?: string } }).data?.id) ?? "";
          if (id) createdGradeIds.push(id);
        }
      }
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM quality_grades WHERE upper(code) = ${upper}
      `;
      const n = Number(rows[0]?.n ?? 0);
      if (n > 1) {
        gradeTwins++;
        console.log(`❌ tur ${i}: '${lower}' + '${upper}' → DB'de ${n} satır (kimlik ikizi) | ${outcome(rs)}`);
      } else {
        console.log(`✅ tur ${i}: DB'de ${n} satır | ${outcome(rs)}`);
      }
    }

    console.log("\n──────── ÖZET ────────");
    console.log(`tur (her grup)                       : ${ROUNDS}`);
    console.log(`A) kategori kimlik ikizi doğan tur   : ${catTwins}`);
    console.log(`B) ürün (kilitli) ikiz doğan tur     : ${itemCodeTwins}`);
    console.log(`C) kalite sınıfı ikizi doğan tur     : ${gradeTwins}`);
    if (catTwins > 0 || gradeTwins > 0) {
      console.log(
        "\n❌ KYY-1-03 DOĞRULANDI: kilitli yol (Item) yarışı kapatırken kilitsiz yol\n" +
          "   (SubcontractorCategory / Subcontractor / BaseService) aynı katlanmış kodu\n" +
          "   taşıyan ikinci satırı SESSİZCE yaratıyor — kod bu sistemde KİMLİKTİR.",
      );
    }
    process.exitCode = catTwins > 0 || gradeTwins > 0 ? 1 : 0;
  } finally {
    try {
      await prisma.subcontractorToCategory.deleteMany({
        where: { categoryId: { in: createdCatIds } },
      });
      await prisma.systemLog.deleteMany({
        where: { recordId: { in: [...createdCatIds, ...createdItemIds, ...createdGradeIds] } },
      });
      await prisma.subcontractorCategory.deleteMany({ where: { id: { in: createdCatIds } } });
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: createdItemIds } } });
      await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: createdItemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
      // Damgayla kalan artık varsa da süpür (kısmi başarıda id yakalanmamış olabilir).
      await prisma.subcontractorCategory.deleteMany({ where: { code: { startsWith: STAMP } } });
      await prisma.subcontractorCategory.deleteMany({
        where: { code: { startsWith: STAMP.toLowerCase() } },
      });
      await prisma.item.deleteMany({ where: { code: { startsWith: STAMP } } });
      await prisma.item.deleteMany({ where: { code: { startsWith: STAMP.toLowerCase() } } });
      await prisma.qualityGrade.deleteMany({ where: { id: { in: createdGradeIds } } });
      await prisma.qualityGrade.deleteMany({ where: { code: { startsWith: STAMP } } });
      await prisma.qualityGrade.deleteMany({ where: { code: { startsWith: STAMP.toLowerCase() } } });
    } catch (e) {
      console.log(`⚠️ temizlik uyarısı: ${(e as Error).message}`);
    }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

void main();
