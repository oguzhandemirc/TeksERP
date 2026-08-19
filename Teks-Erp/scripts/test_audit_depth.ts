// =============================================================================
// BEKÇİ: Audit derinliği — kayıt-bazlı sorgu + değiştirilemezlik (Faz B1/B2)
// Çalıştır: npx tsx scripts/test_audit_depth.ts
// =============================================================================
// Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
//
// Ölçülen boşluklar (2026-08-19, fabrika verisi):
//   · "bu iş emrini kim değiştirmiş" API'den SORULAMIYORDU (recordId filtresi
//     yoktu) — oysa `@@index([tableName, recordId])` zaten vardı
//   · audit satırı `updatedAt` taşıyordu → "değiştirilebilir" izlenimi
//   · saklama 6 ay KALDI (kullanıcı kararı) → her okuma yolu ARŞİVİ DE taramalı
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { SystemLogService } from "../src/services/system-log.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function main(): Promise<void> {
  console.log("=== Audit derinliği bekçisi ===\n");

  // ── 1) recordId filtresi ÇALIŞIYOR mu ───────────────────────────────────
  const sample = await prisma.systemLog.findFirst({
    where: { category: "DOMAIN" },
    select: { tableName: true, recordId: true },
    orderBy: { createdAt: "desc" },
  });
  check("körlük zemini: örnek audit satırı bulundu", Boolean(sample));
  if (sample) {
    const res = await SystemLogService.list({
      tableName: sample.tableName, recordId: sample.recordId, limit: 50,
    });
    const rows = (res as { data?: unknown[] }).data ?? [];
    check("recordId filtresi sonuç döndürüyor", rows.length > 0, `${rows.length} satır`);
    // Süzgeç GERÇEKTEN daraltıyor mu — aynı tabloda recordId'siz sorgu daha çok
    // satır döndürmeli. Yoksa filtre sessizce yok sayılıyor demektir (Prisma
    // `undefined` koşulu ATAR — bu projede daha önce yaşanmış bir sınıf hata).
    const broad = await SystemLogService.list({ tableName: sample.tableName, limit: 50 });
    const broadRows = (broad as { data?: unknown[] }).data ?? [];
    check(
      "recordId filtresi GERÇEKTEN daraltıyor",
      rows.length <= broadRows.length,
      `${rows.length} ≤ ${broadRows.length}`,
    );
    const allMatch = (rows as { recordId: string }[]).every((r) => r.recordId === sample.recordId);
    check("dönen her satır AYNI kayda ait", allMatch);
  }

  // ── 2) Sorgu INDEX kullanıyor mu ────────────────────────────────────────
  // Seq scan, audit tablosu büyüdükçe (bugün ~100 bin, 6 ayda ~540 bin satır)
  // bu ucu kullanılamaz yapar.
  const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
    `EXPLAIN SELECT * FROM system_logs WHERE "tableName"='WORK_ORDER' AND "recordId"='x'
     ORDER BY "createdAt" DESC LIMIT 50`,
  );
  const planText = plan.map((r) => r["QUERY PLAN"]).join(" ");
  check(
    "kayıt-bazlı sorgu INDEX kullanıyor",
    /Index Scan/i.test(planText) && !/Seq Scan on system_logs/i.test(planText),
    planText.slice(0, 70),
  );

  // ── 3) Audit satırı DEĞİŞTİRİLEMEZ ──────────────────────────────────────
  const hasUpdatedAt = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_name='system_logs' AND column_name='updatedAt'`;
  check("system_logs'ta updatedAt YOK (değiştirilemezlik)", Number(hasUpdatedAt[0]!.n) === 0);

  // Arşivde DURMALI — taşınmış tarihsel veri, şeması değiştirilmez.
  const archiveHas = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_name='system_log_archives' AND column_name='updatedAt'`;
  check("arşivde updatedAt DURUYOR (tarihsel veri korunur)", Number(archiveHas[0]!.n) === 1);

  // Kod tarafında audit satırını güncelleyen yol OLMAMALI.
  const fs = await import("fs");
  const path = await import("path");
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".ts")) files.push(fp);
    }
  })(path.join(__dirname, "..", "src"));
  check("körlük zemini: kaynak tarandı", files.length >= 100, `${files.length} dosya`);
  const mutations: string[] = [];
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8");
    for (const m of t.matchAll(/\b(?:prisma|tx)\.systemLog\.(update|updateMany|upsert)\s*\(/g)) {
      mutations.push(`${path.basename(f)} → ${m[1]}`);
    }
  }
  check("audit satırını GÜNCELLEYEN kod yolu yok", mutations.length === 0, mutations.join(" · "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Beklenmeyen hata:", e); process.exit(1); });
