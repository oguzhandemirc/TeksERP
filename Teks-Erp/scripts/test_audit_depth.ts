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
import { Prisma } from "@prisma/client";
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

  // ── 7) NEREDEN — cihaz/IP damgası (Faz B3) ──────────────────────────────
  // ISO 27001 A.8.15 "nerede/nasıl" bileşeni. Ölçüldü: 96.026 DOMAIN kaydının
  // hiçbirinde yoktu. 251 çağrı noktası DEĞİŞMEDEN, istek bağlamından okunur.
  const { runWithRequestContext } = await import("../src/lib/request-context");
  const { AuditService } = await import("../src/services/audit.service");
  const actor = await prisma.user.findFirst({ select: { id: true } });
  const rid = `bekci-b3-${Date.now()}`;

  await new Promise<void>((resolve) => {
    const fakeReq = {
      ip: "10.9.9.9",
      device: { id: "d", deviceId: "BEKCI-TABLET", name: "x", machineId: "m", kind: "TABLET" },
      user: { userId: actor!.id },
    } as never;
    runWithRequestContext(fakeReq, () => {
      void AuditService.log({
        userId: actor!.id, action: "UPDATE", tableName: "BEKCI_B3", recordId: rid,
      }).then(() => resolve());
    });
  });
  const stamped = await prisma.systemLog.findFirst({
    where: { recordId: rid }, select: { deviceId: true, ipAddress: true },
  });
  check("bağlam içinde CİHAZ damgası düşer", stamped?.deviceId === "BEKCI-TABLET", String(stamped?.deviceId));
  check("bağlam içinde IP damgası düşer", stamped?.ipAddress === "10.9.9.9", String(stamped?.ipAddress));

  // ⚠️ BAĞLAM YOKKEN (job/script/cron) kayıt YİNE YAZILMALI. Cihaz bilgisi
  // eksik diye izi düşürmek, elimizdeki denetim kaydını kaybetmek olurdu.
  const rid2 = `bekci-b3b-${Date.now()}`;
  await AuditService.log({ userId: actor!.id, action: "UPDATE", tableName: "BEKCI_B3", recordId: rid2 });
  const noCtx = await prisma.systemLog.findFirst({ where: { recordId: rid2 }, select: { deviceId: true } });
  check("bağlam YOKKEN kayıt yine yazılır (job/script)", noCtx !== null && noCtx.deviceId === null);

  await prisma.systemLog.deleteMany({ where: { tableName: "BEKCI_B3" } });

  // ── 8) KAYIT-BAZLI GEÇMİŞ `changes` DÖNDÜRÜYOR mu (Faz C) ───────────────
  // Genel liste bunu SEÇMEZ (perf kuralı: listede JSON çekme); yalnız
  // `recordId` verildiğinde döner. İki yönü de ölç — yanlış yön "N+1 istek" ya
  // da "şişmiş liste payload'ı" demektir ve ikisi de sessizdir.
  // ⚠️ FIXTURE'I KENDİ ÜRETİR — ortamdaki veriye bağlanmak yasak (CLAUDE.md):
  // dev DB dolu olduğu için yerelde geçer, TEMİZ CI DB'sinde sessizce atlanırdı.
  const { ColorService } = await import("../src/services/color.service");
  const svc = new ColorService({
    model: prisma.color, modelName: "color", tableName: "COLOR",
    searchFields: ["code", "name"], duplicateNameField: "name", entityLabel: "renk",
  } as never);
  const stamp = Date.now();
  let fixtureId = "";
  try {
    const created = (await svc.create(
      { code: `TEST-AD-${stamp}`, name: `TEST AUDIT DEPTH ${stamp}` }, actor!.id,
    )) as unknown as { data: { id: string } };
    fixtureId = created.data.id;
    await svc.update(fixtureId, { name: `TEST AUDIT DEPTH ${stamp} V2` }, actor!.id);

    const scoped = await SystemLogService.list({
      tableName: "COLOR", recordId: fixtureId, limit: 10,
    });
    const scopedRows = ((scoped as { data?: unknown[] }).data ?? []) as Array<{ changes?: unknown }>;
    check(
      "kayıt-bazlı geçmiş `changes` döndürür",
      scopedRows.some((r) => r.changes != null),
      `${scopedRows.length} satır`,
    );

    const general = await SystemLogService.list({ tableName: "COLOR", limit: 5 });
    const generalRows = ((general as { data?: unknown[] }).data ?? []) as Array<{ changes?: unknown }>;
    check(
      "genel liste `changes` DÖNDÜRMEZ (payload şişmesin)",
      generalRows.every((r) => r.changes === undefined),
    );
  } finally {
    if (fixtureId) {
      await prisma.systemLog.deleteMany({ where: { tableName: "COLOR", recordId: fixtureId } }).catch(() => {});
      await prisma.color.deleteMany({ where: { id: fixtureId } }).catch(() => {});
    }
  }


  // ── 9) OKUNABİLİRLİK — "ne değişti" insan diline çevriliyor mu? ─────────
  // Saha bulgusu (19.08.2026): iş emrinin rengi değiştirildi, denetim ekranı
  // "targetColorId: 91cd4281-… → bb826d50-…" bastı. İki ayrı eksik vardı:
  // (a) diff 213 çağrı noktasının 2'sinde hesaplanıyordu, (b) hesaplansa bile
  // değer ham UUID kalıyordu.
  const { diffCommonFields } = await import("../src/services/helpers/audit-diff.helper");
  const {
    resolveChangeValues, attachLabels, AUDIT_FIELD_SOURCES,
  } = await import("../src/services/helpers/audit-value-resolver");

  // (a) Elle yazılmış yükte ANLATI alanları diff'e girmemeli. `diffFields`
  // burada kullanılsaydı "event / colorName / reason / warnings" satırları
  // gerçek değişikliği gömerdi — ayrı fonksiyonun VARLIK SEBEBİ bu.
  const narrated = diffCommonFields(
    { targetColorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    {
      event: "TARGET_COLOR_CHANGED",
      targetColorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      colorName: "X", reason: "test", warnings: [],
    },
  );
  check("diff(ortak): yalnız gerçek alan kalır, anlatı elenir",
    narrated.length === 1 && narrated[0]!.field === "targetColorId",
    JSON.stringify(narrated.map((c) => c.field)));
  check("diff(ortak): before'da olmayan alan uydurulmaz",
    diffCommonFields({}, { event: "X" }).length === 0);

  // (b) Değer ada çözülüyor mu — GERÇEK kayıtla (fixture kendi üretir).
  const twoColors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true, name: true } });
  if (twoColors.length === 2) {
    const ch = [{ field: "targetColorId", old: twoColors[0]!.id, new: twoColors[1]!.id }];
    const labels = await resolveChangeValues([ch]);
    const resolved = attachLabels(ch, labels)!;
    check("değer: UUID renk ADINA çözülür",
      resolved[0]!.oldLabel === twoColors[0]!.name && resolved[0]!.newLabel === twoColors[1]!.name,
      `${resolved[0]!.oldLabel} → ${resolved[0]!.newLabel}`);
  }
  // FAIL-OPEN: çözülemeyen değerde alan HİÇ doğmaz, istemci ham değere düşer.
  const ghost = [{ field: "targetColorId", old: "00000000-0000-4000-8000-000000000000", new: null }];
  const ghostOut = attachLabels(ghost, await resolveChangeValues([ghost]))!;
  check("değer: çözülemeyen UUID'de etiket alanı doğmaz",
    ghostOut[0]!.oldLabel === undefined);
  check("değer: bilinmeyen alan lookup denemez", (await resolveChangeValues([
    [{ field: "zzzBilinmeyen", old: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", new: null }],
  ])).size === 0);

  // (c) HARİTA BAYAT MI — tablo/kolon gerçekten var mı? Yeniden adlandırılmış
  // bir tablo lookup'ı sessizce fail-open'a düşürür: ekran ham UUID basmaya
  // döner ve kimse fark etmez.
  const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
  const known = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  const stale = Object.entries(AUDIT_FIELD_SOURCES)
    .filter(([, s]) => !known.has(`${s.table}.${s.label}`))
    .map(([f, s]) => `${f}→${s.table}.${s.label}`);
  check("çözümleme haritası bayat değil (tablo+kolon var)", stale.length === 0, stale.join(", "));
  check("körlük zemini: çözümleme haritası dolu",
    Object.keys(AUDIT_FIELD_SOURCES).length >= 25,
    `${Object.keys(AUDIT_FIELD_SOURCES).length} alan`);

  // (d) İKİ HARİTA ÖRTÜŞÜR: değeri çözülen alanın ADI da Türkçe olmalı, yoksa
  // satır yarı okunur kalır ("workOrderId: İE1908260014").
  const unlabeled = Object.keys(AUDIT_FIELD_SOURCES).filter((f) => auditFieldLabel(f) === f);
  check("çözümlenen her alanın Türkçe etiketi var", unlabeled.length === 0, unlabeled.join(", "));

  // (e) ARŞİV kaybetmiyor: `changes`/`deviceId` 6 ay sonra da duruyor mu?
  const archCols = new Set(cols.filter((c) => c.table_name === "system_log_archives").map((c) => c.column_name));
  check("arşiv `changes` kolonu taşıyor", archCols.has("changes"));
  check("arşiv `deviceId` kolonu taşıyor", archCols.has("deviceId"));
  const archiverSrc = archSrc; // yukarıda okundu — ikinci kez açmaya gerek yok
  check("arşivleyici iki kolonu KOPYALIYOR",
    /changes: log\.changes/.test(archiverSrc) && /deviceId: log\.deviceId/.test(archiverSrc));
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Beklenmeyen hata:", e); process.exit(1); });
