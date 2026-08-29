// =============================================================================
// AUDIT REPRO — D-A-03: PostgreSQL deadlock (40P01) Prisma 7 + @prisma/adapter-pg
// altında HANGİ hata sınıfıyla yüzeye çıkıyor? (error.middleware P2034 dalı çalışır mı)
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): kaybeden tx `PrismaClientKnownRequestError` + code
//   "P2034" ile düşer → error.middleware :517 → 409 "İşlem şu anda başka bir işlemle
//   çakıştı. Lütfen tekrar deneyin." (retry sinyali)
// Gözlenen: çalıştırınca doldur — log audit/repro/D-A-03.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-A-03.ts
// =============================================================================
// NEDEN ÖNEMLİ: kod tabanında ABBA (ters kilit sırası) aileleri var
// (K3a §3.2 ABBA-1..4: attachRolls R→A22→W ↔ fason dispatch W→R→A22;
//  cancelOrderLine L(tek)→W→L(hepsi) ↔ performDispatchTx L(tam küme);
//  moveRollToSack S(from)→S(to) id-sırasız). Hiçbiri P2034 RETRY etmiyor
// (`withBarcodeRetry` YALNIZ P2002'yi retry eder, utils/barcode-retry.ts:32).
// Dolayısıyla deadlock kullanıcıya DOĞRUDAN yansır ve tek soru şudur:
// hangi HTTP kodu + hangi mesaj? 409 "tekrar deneyin" ile 500 "sunucu hatası"
// arasındaki fark, operatörün işi tekrar deneyip denemeyeceğidir.
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
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";

const STAMP = `AUDITREPRO-D-A-03-${Math.random().toString(36).slice(2, 8)}`;

let fail = 0;
function ok(msg: string) { console.log(`✅ ${msg}`); }
function bad(msg: string) { console.log(`❌ ${msg}`); fail++; }
function info(msg: string) { console.log(`   ${msg}`); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Caught {
  ctor: string;
  code: string | null;
  message: string;
}

function describeErr(e: unknown): Caught {
  const ctor = (e as { constructor?: { name?: string } })?.constructor?.name ?? typeof e;
  const code =
    e instanceof Prisma.PrismaClientKnownRequestError
      ? e.code
      : ((e as { code?: string })?.code ?? null);
  const message = (e as { message?: string })?.message ?? String(e);
  return { ctor, code, message: message.replace(/\s+/g, " ").slice(0, 400) };
}

/**
 * error.middleware.ts'in bu hatayı NASIL sınıflayacağını taklit et
 * (src/middlewares/error.middleware.ts:517 P2034 → 409; tanınmayan kod → fail-loud 500).
 */
function classifyLikeMiddleware(c: Caught): string {
  if (c.ctor !== "PrismaClientKnownRequestError") {
    return `${c.ctor} → Prisma KNOWN dalına GİRMEZ → generic 500 (fail-loud)`;
  }
  if (c.code === "P2034") return "P2034 → 409 'İşlem şu anda başka bir işlemle çakıştı'";
  if (c.code === "P2024" || c.code === "P2028") return `${c.code} → 503 SERVER_BUSY`;
  return `${c.code} → CLIENT_DATA listesinde değilse 500 (fail-loud)`;
}

async function main(): Promise<void> {
  console.log(`\n=== ${STAMP} — deadlock (40P01) hata haritası ===\n`);

  // ── Fixture: iki bağımsız satır (system_settings — domain verisine dokunmaz) ──
  const keyA = `${STAMP}.A`;
  const keyB = `${STAMP}.B`;
  await prisma.systemSetting.create({ data: { key: keyA, value: { n: 0 } as never, description: STAMP } });
  await prisma.systemSetting.create({ data: { key: keyB, value: { n: 0 } as never, description: STAMP } });
  info(`fixture: 2 SystemSetting satırı (${keyA}, ${keyB})`);

  try {
    // ── ADIM 1: SATIR KİLİDİ ABBA (ABBA-2/-4 ailesinin saf hali) ──────────────
    // T1: A → B  ·  T2: B → A  → PG deadlock detector birini iptal eder (40P01).
    const caught: Caught[] = [];
    const runner = async (first: string, second: string, label: string) => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.systemSetting.update({ where: { key: first }, data: { description: `${STAMP}-${label}` } });
          await sleep(300); // iki tx'in ilk kilitlerini almasını garantile
          await tx.systemSetting.update({ where: { key: second }, data: { description: `${STAMP}-${label}` } });
        }, { timeout: 20_000, maxWait: 10_000 });
        return null;
      } catch (e) {
        const d = describeErr(e);
        caught.push(d);
        return d;
      }
    };

    const [r1, r2] = await Promise.all([
      runner(keyA, keyB, "T1"),
      runner(keyB, keyA, "T2"),
    ]);

    const losers = [r1, r2].filter((x): x is Caught => x !== null);
    if (losers.length === 0) {
      bad("DEADLOCK TETİKLENEMEDİ — iki tx de başarılı (zamanlama tutmadı; tekrar deneyin)");
    } else if (losers.length === 2) {
      bad("İKİ tx de düştü — beklenen 1 kazanan / 1 kaybeden");
      losers.forEach((l) => info(`  ${l.ctor} code=${l.code} :: ${l.message}`));
    } else {
      ok(`Deadlock tetiklendi — tam 1 tx düştü (PG deadlock detector çalıştı)`);
      const l = losers[0];
      info(`  hata sınıfı : ${l.ctor}`);
      info(`  Prisma kodu : ${l.code ?? "(yok)"}`);
      info(`  mesaj       : ${l.message}`);
      info(`  middleware  : ${classifyLikeMiddleware(l)}`);
      if (l.ctor === "PrismaClientKnownRequestError" && l.code === "P2034") {
        ok("P2034 → error.middleware :517 dalı çalışır → kullanıcı 409 + 'tekrar deneyin' görür");
      } else {
        bad(
          "P2034 DEĞİL → error.middleware'in deadlock dalı ÇALIŞMAZ; kullanıcı 409 yerine " +
          "500/başka bir kod görür (üstelik hiçbir yol P2034'ü retry etmiyor)",
        );
      }
    }

    // ── ADIM 2: ADVISORY ↔ SATIR KİLİDİ ABBA (8022 ↔ work_orders deseninin saf hali) ──
    // K3b §2.2-S2 / H-4: `attachRolls` 8022'yi ALIP WO satırını ister,
    // `splitBatch` WO satırını ALIP 8022'yi ister. Advisory kilitler PG'nin
    // deadlock detector'ına DAHİLDİR — burada bunu ölçüyoruz.
    const NS = 8022, KEY = 1;
    const caught2: Caught[] = [];
    const advRunner = async (advFirst: boolean, label: string) => {
      try {
        await prisma.$transaction(async (tx) => {
          if (advFirst) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS}::int, ${KEY}::int)`;
            await sleep(300);
            await tx.systemSetting.update({ where: { key: keyA }, data: { description: `${STAMP}-${label}` } });
          } else {
            await tx.systemSetting.update({ where: { key: keyA }, data: { description: `${STAMP}-${label}` } });
            await sleep(300);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NS}::int, ${KEY}::int)`;
          }
        }, { timeout: 20_000, maxWait: 10_000 });
        return null;
      } catch (e) {
        const d = describeErr(e);
        caught2.push(d);
        return d;
      }
    };

    const [a1, a2] = await Promise.all([advRunner(true, "ADV1"), advRunner(false, "ADV2")]);
    const advLosers = [a1, a2].filter((x): x is Caught => x !== null);
    if (advLosers.length === 1) {
      const l = advLosers[0];
      ok("Advisory(8022) ↔ satır kilidi ÇEVRİMİ deadlock üretti (PG detector advisory'yi de görüyor)");
      info(`  hata sınıfı : ${l.ctor}`);
      info(`  Prisma kodu : ${l.code ?? "(yok)"}`);
      info(`  mesaj       : ${l.message}`);
      info(`  middleware  : ${classifyLikeMiddleware(l)}`);
    } else if (advLosers.length === 0) {
      info("Advisory çevrimi bu koşumda tetiklenmedi (zamanlama) — ADIM 1 sonucu geçerli");
    } else {
      info(`Advisory çevriminde ${advLosers.length} tx düştü`);
      advLosers.forEach((l) => info(`  ${l.ctor} code=${l.code} :: ${l.message}`));
    }

    // ── ADIM 3: withBarcodeRetry deadlock'u retry ediyor mu? (kaynak kontrolü) ──
    const { withBarcodeRetry } = await import("../src/utils/barcode-retry");
    let attempts = 0;
    try {
      await withBarcodeRetry(async () => {
        attempts++;
        const e = new Prisma.PrismaClientKnownRequestError("deadlock detected", {
          code: "P2034",
          clientVersion: "test",
        });
        throw e;
      });
    } catch {
      /* beklenen */
    }
    if (attempts === 1) {
      ok("withBarcodeRetry P2034'ü RETRY ETMİYOR (1 deneme) — deadlock çağırana yansır (doğrulandı)");
    } else {
      bad(`withBarcodeRetry P2034'ü ${attempts} kez denedi — beklenmiyordu`);
    }
  } finally {
    // ── Temizlik: yalnız kendi damgamız ────────────────────────────────────
    await prisma.systemSetting.deleteMany({ where: { key: { startsWith: STAMP } } });
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }

  console.log(`\n=== SONUÇ: ${fail === 0 ? "değişmez korundu" : `${fail} kırmızı`} ===\n`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("REPRO ÇÖKTÜ:", e);
  process.exitCode = 1;
});
