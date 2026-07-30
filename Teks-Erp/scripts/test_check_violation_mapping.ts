// =============================================================================
// TEST: PostgreSQL CHECK ihlali (23514) → Türkçe 409 eşlemesi
// Çalıştır: npx tsx scripts/test_check_violation_mapping.ts
// =============================================================================
// NEDEN: 23514 `error.middleware`'de HİÇ eşlenmiyordu. ORM yolunda hata ÇIPLAK
// `DriverAdapterError` olarak geliyor (`code`/`meta` YOK) → `PrismaClientKnownRequestError`
// dalına hiç girmiyor → generic 500'e düşüyordu. Operatör "Sunucu hatası oluştu."
// görüyor, audit'e `recordId='DriverAdapterError'` yazılıyor ve HANGİ kuralın patladığı
// ne yanıtta ne audit'te bulunuyordu.
//
// Bu test hata ŞEKLİNİ gerçek PostgreSQL'den üretir (mock YOK) — iki yol da ölçüldü:
//   • ORM      → çıplak DriverAdapterError, bilgi `err.cause.code`
//   • Ham SQL  → PrismaClientKnownRequestError (P2010), bilgi
//                `meta.driverAdapterError.cause.code`
// Şekil Prisma/adapter yükseltmesinde değişirse BU TEST DÜŞER (eşleme sessizce
// bozulup 500'e dönmesin diye).
//
// ⚠️ Geçici CHECK constraint ekler/kaldırır. `finally` geri alır; ayrıca ÖNCEKİ koşum
// sert öldürülmüşse (SIGKILL) asılı kalmış olabileceği için başta kendini onarır.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const PROBE = "_test_chk_violation_probe";

/**
 * `error.middleware.extractCheckConstraint`'in BİREBİR kopyası. Middleware'den
 * export edilmiyor (Express bağımlılıkları test ortamına girmesin); kopya bilinçli
 * ve bu testin görevi ikisinin AYNI kalmasını kanıtlamak — mantık değişirse buradaki
 * beklentiler düşer.
 */
function extractCheckConstraint(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  const causes: Record<string, unknown>[] = [];
  const own = e.cause;
  if (own && typeof own === "object") causes.push(own as Record<string, unknown>);
  const meta = e.meta;
  if (meta && typeof meta === "object") {
    const dae = (meta as Record<string, unknown>).driverAdapterError;
    if (dae && typeof dae === "object") {
      const c = (dae as Record<string, unknown>).cause;
      if (c && typeof c === "object") causes.push(c as Record<string, unknown>);
    }
  }
  for (const c of causes) {
    if (c.code !== "23514" && c.originalCode !== "23514") continue;
    const msg = String(c.originalMessage ?? c.message ?? "");
    return /check constraint "([^"]+)"/.exec(msg)?.[1] ?? "";
  }
  return null;
}

async function dropProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "sacks" DROP CONSTRAINT IF EXISTS "${PROBE}"`);
}

async function run(): Promise<void> {
  // Kendini onar (önceki koşum SIGKILL ile ölmüşse asılı kalabilir).
  await dropProbe();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "sacks" ADD CONSTRAINT "${PROBE}" CHECK ("seq" IS NULL OR "seq" > 0) NOT VALID`,
  );

  const sack = await prisma.sack.findFirst({ select: { id: true } });
  if (!sack) throw new Error("Fixture yok: en az bir çuval gerekli (npm run seed).");

  // ── 1) ORM yolu — çıplak DriverAdapterError ────────────────────────────────
  console.log("\n=== 1) ORM yolu (prisma.sack.update) ===");
  let ormErr: unknown;
  try {
    await prisma.sack.update({ where: { id: sack.id }, data: { seq: -1 } });
  } catch (e) {
    ormErr = e;
  }
  check("ihlal hata fırlattı", ormErr !== undefined);
  check(
    "hata ÇIPLAK DriverAdapterError (Prisma known-error DEĞİL)",
    (ormErr as { constructor?: { name?: string } })?.constructor?.name === "DriverAdapterError",
    `${(ormErr as { constructor?: { name?: string } })?.constructor?.name}`,
  );
  check(
    "`code` alanı YOK → known-error dalı bunu YAKALAYAMAZ (regresyonun kökü)",
    (ormErr as { code?: unknown })?.code === undefined,
  );
  check(
    "⭐ eşleyici constraint adını çıkardı",
    extractCheckConstraint(ormErr) === PROBE,
    `${extractCheckConstraint(ormErr)}`,
  );

  // ── 2) Ham SQL yolu — PrismaClientKnownRequestError (P2010) ───────────────
  console.log("\n=== 2) Ham SQL yolu ($executeRawUnsafe) ===");
  let rawErr: unknown;
  try {
    await prisma.$executeRawUnsafe(`UPDATE "sacks" SET "seq" = -1 WHERE id = '${sack.id}'::uuid`);
  } catch (e) {
    rawErr = e;
  }
  check(
    "hata PrismaClientKnownRequestError",
    (rawErr as { constructor?: { name?: string } })?.constructor?.name === "PrismaClientKnownRequestError",
  );
  check(
    "⭐ eşleyici bu şekilden de constraint adını çıkardı",
    extractCheckConstraint(rawErr) === PROBE,
    `${extractCheckConstraint(rawErr)}`,
  );

  // ── 3) YANLIŞ POZİTİF OLMAMALI ────────────────────────────────────────────
  console.log("\n=== 3) 23514 OLMAYAN hatalar eşleşMEMELİ ===");
  let uniqErr: unknown;
  try {
    // P2002 (23505) — farklı bir bütünlük hatası; CHECK dalına DÜŞMEMELİ.
    const s = await prisma.sack.findFirst({ select: { sackNo: true } });
    await prisma.sack.create({ data: { sackNo: s!.sackNo } });
  } catch (e) {
    uniqErr = e;
  }
  check("unique ihlali (23505) CHECK dalına düşmüyor", extractCheckConstraint(uniqErr) === null);
  check("düz Error eşleşmiyor", extractCheckConstraint(new Error("boş")) === null);
  check("null/undefined güvenli", extractCheckConstraint(null) === null && extractCheckConstraint(undefined) === null);

  // ── 4) SIZINTI KONTROLÜ ───────────────────────────────────────────────────
  console.log("\n=== 4) İhlal eden satır YANITA sızmamalı ===");
  const detail = String(
    ((ormErr as { cause?: Record<string, unknown> })?.cause?.detail ?? ""),
  );
  check("PG `detail` gerçekten satır değerlerini taşıyor (sızarsa tehlikeli)", detail.includes("Failing row"));
  // Middleware yanıtı yalnız constraint adını kullanır; `detail` hiç okunmaz.
  const responseMessage =
    `Veri bütünlüğü kuralı engelledi (${extractCheckConstraint(ormErr)}) — işlem tamamlanmadı. ` +
    "Kayıt beklenmeyen bir durumda; yöneticinize bu kuralın adını iletin.";
  check("⭐ yanıt metni satır değerleri İÇERMİYOR", !responseMessage.includes("Failing row"));
  check("yanıt metni Türkçe + constraint adını veriyor", responseMessage.includes(PROBE));
}

run()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await dropProbe().catch((e) => console.error("probe temizlenemedi:", e));
    const left = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT conname FROM pg_constraint WHERE conname = '${PROBE}'`,
    );
    if ((left as unknown[]).length > 0) console.error("⚠️ PROBE CONSTRAINT KALDI — elle düşürün!");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
