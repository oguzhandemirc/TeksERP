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
import { extractCheckConstraint } from "../src/middlewares/error.middleware";

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
/** Testin kendi yarattığı çuval — `finally`'de silinir. */
let probeSackId: string | null = null;

// ⚠️ GERÇEK FONKSİYON İÇE AKTARILIYOR (2026-08-30). Burada eskiden BİREBİR bir
// KOPYA vardı ve notu "bu testin görevi ikisinin AYNI kalmasını kanıtlamak"
// diyordu — ama hiçbir şey ikisini karşılaştırmıyordu. Ölçüldü: middleware'deki
// fonksiyon körleştirildiğinde bu test YEŞİL kaldı, yani ürünü değil kendi
// kopyasını ölçüyordu. Kopya silindi; middleware fonksiyonu dışa açıldı
// (modül düzeyinde yan etkisi yok, içe aktarmak güvenli).

async function dropProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(`ALTER TABLE "sacks" DROP CONSTRAINT IF EXISTS "${PROBE}"`);
}

async function run(): Promise<void> {
  // Kendini onar (önceki koşum SIGKILL ile ölmüşse asılı kalabilir).
  await dropProbe();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "sacks" ADD CONSTRAINT "${PROBE}" CHECK ("seq" IS NULL OR "seq" > 0) NOT VALID`,
  );

  // ⚠️ KENDİ fixture'ını kurar — ortamda hazır çuval OLDUĞUNU VARSAYMAZ. İlk sürüm
  // `sack.findFirst` ile mevcut bir çuval arıyordu; yerelde çalışıyordu (dev DB dolu)
  // ama TEMİZ CI veritabanında hiç çuval olmadığı için düşüyordu. Repo kuralı: test
  // ürettiğini kendisi yaratır ve `finally`'de siler.
  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-CHK-${Date.now().toString().slice(-9)}` },
    select: { id: true },
  });
  probeSackId = sack.id;

  // ── 1) ORM yolu — çıplak DriverAdapterError ────────────────────────────────
  console.log("\n=== 1) ORM yolu (prisma.sack.update) ===");
  let ormErr: unknown;
  try {
    await prisma.sack.update({ where: { id: sack.id }, data: { seq: -1 } });
  } catch (e) {
    ormErr = e;
  }
  check("ihlal hata fırlattı", ormErr !== undefined);
  // ⚠️ ŞEKİL SÜRÜME BAĞLI — İDDİA ONA ÇAKILMAZ (2026-08-30 düzeltmesi).
  // Bu iki kontrol eskiden "hata ÇIPLAK DriverAdapterError'dır" ve "`code` alanı
  // YOKTUR" diyordu. Prisma 7.9 artık hatayı SARMALIYOR (`PrismaClientKnownRequestError`,
  // `code: "P2039"`) — yani kod İYİLEŞTİ ve bekçi, iyileşmeyi regresyon sanıp
  // kırmızı veriyordu. Sürüme çakılı bir iddia, yükseltmeyi cezalandırır.
  //
  // Ölçülmesi gereken şey şekil değil, ŞU: eşleyici hâlâ GEREKLİ mi? Yani hata,
  // middleware'in ÖZEL dallarından birine (P2002/P2003/P2025…) düşüp orada
  // anlamlı bir mesaj almıyor; düşseydi bu eşleyiciye gerek kalmazdı.
  const ormCtor = (ormErr as { constructor?: { name?: string } })?.constructor?.name;
  const ormCode = (ormErr as { code?: unknown })?.code;
  check(
    "ORM yolunun şekli BİLİNEN ikisinden biri (sürüm değişimini görünür kılar)",
    ormCtor === "DriverAdapterError" || ormCtor === "PrismaClientKnownRequestError",
    `${ormCtor} · code=${String(ormCode)}`,
  );
  check(
    "eşleyici HÂLÂ GEREKLİ — hata middleware'in özel dallarına düşmüyor",
    !["P2002", "P2003", "P2025", "P2011"].includes(String(ormCode)),
    `code=${String(ormCode)}`,
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
    // KENDİ çuvalımızın kodunu tekrar kullanıyoruz (ortamdaki rastgele bir çuvalı
    // değil): deterministik ve temiz DB'de de çalışır.
    const mine = await prisma.sack.findUnique({ where: { id: sack.id }, select: { sackNo: true } });
    await prisma.sack.create({ data: { sackNo: mine!.sackNo } });
  } catch (e) {
    uniqErr = e;
  }
  check("unique ihlali (23505) CHECK dalına düşmüyor", extractCheckConstraint(uniqErr) === null);
  check("düz Error eşleşmiyor", extractCheckConstraint(new Error("boş")) === null);
  check("null/undefined güvenli", extractCheckConstraint(null) === null && extractCheckConstraint(undefined) === null);

  // ── 4) SIZINTI KONTROLÜ ───────────────────────────────────────────────────
  console.log("\n=== 4) İhlal eden satır YANITA sızmamalı ===");
  // ⚠️ `detail` İKİ YERDE OLABİLİR ve TEK yere bakmak bu kontrolü KÖRELTİR
  // (2026-08-30'da ölçüldü: Prisma 7.9'da satır değerleri artık
  // `meta.driverAdapterError.cause.detail`te; eski `cause.detail` boş dönüyordu,
  // yani "sızmıyor" iddiası hiçbir şey kanıtlamıyordu — zemin çökmüştü).
  const ormAny = ormErr as {
    cause?: Record<string, unknown>;
    meta?: { driverAdapterError?: { cause?: Record<string, unknown> } };
  };
  const detail = String(
    ormAny?.cause?.detail ?? ormAny?.meta?.driverAdapterError?.cause?.detail ?? "",
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
    if (probeSackId) {
      await prisma.sack.deleteMany({ where: { id: probeSackId } }).catch((e) =>
        console.error("probe çuvalı silinemedi:", e),
      );
    }
    const left = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT conname FROM pg_constraint WHERE conname = '${PROBE}'`,
    );
    if ((left as unknown[]).length > 0) console.error("⚠️ PROBE CONSTRAINT KALDI — elle düşürün!");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
