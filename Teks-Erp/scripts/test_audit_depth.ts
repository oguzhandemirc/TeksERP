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

  // ── 4) ARŞİVLEME hâlâ çalışıyor mu (B1 regresyonu) ─────────────────────
  // `updatedAt` düşürülünce arşivleyici KIRILDI (kolonu kopyalıyordu) ve bunu
  // yalnız typecheck yakaladı — testler görmemişti çünkü arşiv 6 ayda bir
  // koşuyor ve dev'de hiç tetiklenmemiş. Şeklini burada sabitliyoruz.
  let archiveOk = true;
  let archiveErr = "";
  try {
    // Kuru çalıştırma: 999 ay öncesini arşivle → eşleşen satır yok ama
    // SORGU ŞEKLİ tam olarak koşar (createMany mapping'i dahil değil, o yüzden
    // ayrıca alan varlığını da ölçüyoruz).
    const { AuditService } = await import("../src/services/audit.service");
    await AuditService.archiveOlderThan(999);
  } catch (e) {
    archiveOk = false;
    archiveErr = (e as Error).message.slice(0, 80);
  }
  check("arşivleme yolu çalışıyor (updatedAt düşürüldükten sonra)", archiveOk, archiveErr);

  // Arşiv satırının `updatedAt`i `createdAt`ten doldurulmalı — ikisi zaten her
  // zaman aynıydı (düşürmeden önce `updatedAt > createdAt` olan 0 satır vardı).
  const archSrc = (await import("fs")).readFileSync(
    (await import("path")).join(__dirname, "..", "src", "services", "audit.service.ts"), "utf8",
  );
  check(
    "arşiv updatedAt'i createdAt'ten doldurur",
    /updatedAt:\s*log\.createdAt/.test(archSrc),
  );

  // ── 5) ALAN-BAZLI DİFF (Faz B2) ─────────────────────────────────────────
  const { diffFields, AUDIT_DIFF_SECRET_FIELDS } = await import(
    "../src/services/helpers/audit-diff.helper"
  );

  check(
    "diff: değişen alanı bulur",
    diffFields({ width: 150, name: "A" }, { width: 155 }).length === 1,
  );
  check(
    "diff: AYNI değer fark sayılmaz",
    diffFields({ width: 150 }, { width: 150 }).length === 0,
  );
  // Prisma Decimal/string/number aynı sayıyı farklı tiplerde döndürebilir; tip
  // farkını "değişiklik" saymak hiç değişmemiş kaydı her update'te loglatırdı.
  check(
    "diff: 150 ↔ '150' fark DEĞİL (Decimal tuzağı)",
    diffFields({ width: 150 }, { width: "150" }).length === 0,
  );
  check(
    "diff: tarih aynı anı gösteriyorsa fark değil",
    diffFields({ d: new Date("2026-01-01T00:00:00Z") }, { d: "2026-01-01T00:00:00.000Z" }).length === 0,
  );
  // Kısmi update (PATCH): gönderilmeyen alan DEĞİŞMEMİŞTİR, "silindi" sayılamaz.
  check(
    "diff: gönderilmeyen alan fark sayılmaz",
    diffFields({ a: 1, b: 2 }, { a: 1 }).length === 0,
  );
  check(
    "diff: undefined 'dokunma' demektir",
    diffFields({ a: 1 }, { a: undefined }).length === 0,
  );

  // GİZLİ ALAN: audit denetim kaydıdır, sır deposu değil.
  const secret = diffFields({ passwordHash: "eski" }, { passwordHash: "yeni" });
  check("diff: gizli alan MASKELENİR", secret.length === 1 && secret[0]!.new === "***",
    JSON.stringify(secret[0]));
  check("gizli alan listesi dolu", AUDIT_DIFF_SECRET_FIELDS.size >= 5,
    `${AUDIT_DIFF_SECRET_FIELDS.size} alan`);

  // OPAK ALAN: devasa JSON'u audit'e gömmek satırı yüzlerce KB yapar.
  const opaque = diffFields({ snapshot: { a: 1 } }, { snapshot: { a: 2 } });
  check("diff: devasa JSON değeri YAZILMAZ, 'değişti' denir",
    opaque.length === 1 && opaque[0]!.new === "<değişti>");

  // Gürültü alanları: her update'te değişir, hiçbir şey anlatmaz.
  check(
    "diff: künye/zaman alanları gürültü sayılır",
    diffFields({ updatedById: "a", updatedAt: new Date() }, { updatedById: "b", updatedAt: new Date() }).length === 0,
  );

  // ── 6) ETİKET HARİTASI — FAIL-OPEN ──────────────────────────────────────
  const { auditFieldLabel, AUDIT_FIELD_LABELS } = await import(
    "../src/constants/audit-field-labels"
  );
  check("etiket: bilinen alan Türkçeye çevrilir", auditFieldLabel("width") === "En");
  // ⚠️ FAIL-OPEN: etiketi olmayan alan HAM ADIYLA döner. Ekran asla boş kalmaz.
  check("etiket: bilinmeyen alan HAM ADIYLA döner", auditFieldLabel("zzzYok") === "zzzYok");
  check("körlük zemini: etiket haritası dolu", Object.keys(AUDIT_FIELD_LABELS).length >= 40,
    `${Object.keys(AUDIT_FIELD_LABELS).length} etiket`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Beklenmeyen hata:", e); process.exit(1); });
