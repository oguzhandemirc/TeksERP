// =============================================================================
// BEKÇİ: Kayıt künyesi — kim oluşturdu / kim son değiştirdi (2026-08-19)
// Çalıştır: npx tsx scripts/test_record_provenance.ts
// =============================================================================
// Tasarım: docs/design/KAYIT-KUNYESI-TASARIM.md
//
// KURAL: kaydın kimliğine ait KALICI gerçek KOLONDA durur, audit'ten OKUNMAZ —
// audit 6 ayda arşivlenir. (`record-info` ucu tam bu yüzden 6 aydan eski kayıtta
// sessizce boş dönüyordu; künye kolonu o kusurun yapısal cevabıdır.)
//
// ⚠️ İKİ YÖNLÜ: kolonu olan model `PROVENANCE_MODELS` listesinde OLMALI (yoksa
// yazılmaz, kolon boş kalır) — ve listede olan modelin kolonu OLMALI (yoksa
// Prisma çalışma-zamanında patlar). Tek yönlü kontrol iki arızayı da kaçırır.
// =============================================================================
import fs from "fs";
import path from "path";
import prisma, { pool } from "../src/lib/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

/** Şemada künye kolonu taşıyan modeller. */
function schemaModelsWithProvenance(): Set<string> {
  const src = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (/^\s+createdById\s/m.test(m[2]!) && /^\s+updatedById\s/m.test(m[2]!)) out.add(m[1]!);
  }
  return out;
}

/** BaseService'in yazdığı model listesi (kaynak koddan okunur, kopyalanmaz). */
function baseServiceModels(): Set<string> {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "base.service.ts"), "utf8");
  const m = /const PROVENANCE_MODELS = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return new Set();
  return new Set([...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
}

/** Prisma model adı → şema model adı (ilk harf büyük). */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

async function main(): Promise<void> {
  console.log("=== Kayıt künyesi bekçisi ===\n");

  const schemaModels = schemaModelsWithProvenance();
  const written = baseServiceModels();

  // ── Körlük zeminleri ────────────────────────────────────────────────────
  // Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile
  // çıkar. Zeminler bugünkü gerçeğin belirgin ALTINDA tutulur.
  check("körlük zemini: şemada künyeli model bulundu", schemaModels.size >= 15, `${schemaModels.size} model`);
  check("körlük zemini: BaseService listesi okundu", written.size >= 10, `${written.size} model`);

  // ── 1) Liste ⊆ şema (yazdığımız her modelin kolonu var mı) ──────────────
  const missingCols = [...written].filter((m) => !schemaModels.has(cap(m)));
  check(
    "BaseService'in yazdığı her modelin künye kolonu VAR",
    missingCols.length === 0,
    missingCols.join(", ") || `${written.size} model`,
  );

  // ── 2) DB'de kolonlar gerçekten var mı ──────────────────────────────────
  const cols = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('createdById','updatedById')`;
  check("DB'de künye kolonları mevcut", Number(cols[0]!.n) >= 34, `${cols[0]!.n} kolon`);

  // ── 3) Kolonlar NULLABLE olmalı ─────────────────────────────────────────
  // NOT NULL, geçmiş kayıtları olan canlı tabloda migration'ı imkânsız kılar
  // ve backfill eşleşmeyen kayıtları uydurmaya zorlar.
  const notNull = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('createdById','updatedById')
      AND is_nullable='NO'`;
  check("künye kolonlarının hepsi NULLABLE", notNull.length === 0,
    notNull.map((r) => `${r.table_name}.${r.column_name}`).join(", "));

  // ── 4) CANLI TUR: create künye yazıyor, update createdById'yi KORUYOR ───
  // En kolay kaybedilen kural bu: update'te `{...data}` yayılırken createdById
  // yanlışlıkla ezilirse kaydın kökeni sessizce kaybolur.
  const u1 = await prisma.user.findFirst({ select: { id: true } });
  const u2 = await prisma.user.findFirst({ where: { id: { not: u1!.id } }, select: { id: true } });
  const ts = Date.now();
  let colorId = "";
  try {
    const { ColorService } = await import("../src/services/color.service");
    const svc = new ColorService({
      model: prisma.color, modelName: "color", tableName: "COLOR",
      searchFields: ["code", "name"], duplicateNameField: "name", entityLabel: "renk",
    } as never);
    const created = (await svc.create(
      { code: `TEST-PRV-${ts}`, name: `TEST KUNYE BEKCI ${ts}` }, u1!.id,
    )) as unknown as { data: { id: string } };
    colorId = created.data.id;

    const afterCreate = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("create → createdById yazıldı", afterCreate?.createdById === u1!.id);
    check("create → updatedById DE yazıldı (boş alan gösterilmesin)", afterCreate?.updatedById === u1!.id);

    await svc.update(colorId, { name: `TEST KUNYE BEKCI ${ts} V2` }, u2!.id);
    const afterUpdate = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("update → createdById KORUNDU", afterUpdate?.createdById === u1!.id, String(afterUpdate?.createdById));
    check("update → updatedById değişti", afterUpdate?.updatedById === u2!.id);

    // userId YOKSA (dahili çağrı) künye EZİLMEMELİ — null yazmak, bilinen
    // kökeni bilinmeyene çevirirdi.
    await svc.update(colorId, { name: `TEST KUNYE BEKCI ${ts} V3` }, undefined);
    const afterAnon = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("userId yokken künye EZİLMEZ", afterAnon?.createdById === u1!.id && afterAnon?.updatedById === u2!.id);
  } finally {
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Beklenmeyen hata:", e); process.exit(1); });
