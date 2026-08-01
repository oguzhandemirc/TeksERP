// =============================================================================
// pg havuzu zaman aşımı sınıflandırıcısı + errorHandler eşlemesi.
//
// NEDEN VAR: `error.middleware`'in 503 "Sunucu yoğun" yolu Prisma 7 + driver
// adapter kurulumunda ÖLÜ KODDU. pg-pool iki ÇIPLAK `Error` fırlatır; adapter'ın
// convertDriverError'ı onları ham geçirir, Prisma sarmalamaz → generic 500'e
// düşüyorlardı. Canlıda iki kez oldu (2026-07-23, 2026-07-28) ve operatör
// "Sunucu hatası oluştu." gördü. Bu test o eşlemeyi ve ÇEVRESİNDEKİ 4xx'leri
// kilitler.
//
// KRİTİK TASARIM: hata metinleri assertion'a HARDCODE EDİLMEZ. Test, kurulu
// pg-pool'dan GERÇEK iki hatayı ÜRETİR (küçük tavanlı geçici havuzlarla) ve
// sınıflandırıcının onları tanıdığını doğrular. Böylece bir `pg` yükseltmesi
// mesajı/şeklini değiştirirse `npm test` ADI OLAN bir testle düşer — runtime
// heuristic'ten kesinlikle daha güçlü. (Aynı felsefe: test_db_invariants.ts.)
//
// NEDEN sahte Client DEĞİL: pg-pool'un handshake zaman aşımı yolu (index.js:255)
// `client.connection.stream.destroy()` çağırıp connect callback'inin HATA ile
// dönmesini bekler. Yalnız gerçek bir pg client bu sözleşmeyi yerine getirir;
// no-op bir taklit callback'i hiç çağırmaz ve test asılır (denendi). Zaten tüm
// paket gerçek DB kullanıyor → saflık kaybı yok.
//
// Koşum: npx tsx scripts/test_pool_health.ts
// =============================================================================
import express, { Request, Response, NextFunction } from "express";
import { Pool, type PoolClient } from "pg";
import { AddressInfo } from "node:net";
import { ZodError, z } from "zod";
import dotenv from "dotenv";
import prisma, { pool } from "../src/lib/prisma";
import { classifyPoolTimeout, getPoolHealth } from "../src/lib/pool-health";
import { errorHandler } from "../src/middlewares/error.middleware";
import { AppError } from "../src/utils/app-error";

dotenv.config();
const CONN = process.env["DATABASE_URL"];

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** pg-pool kuyruk timer'ı unref()'li (pg-pool:229-231) → süreç erken çıkmasın. */
function keepAlive(): NodeJS.Timeout {
  return setInterval(() => {}, 50);
}

/**
 * ACQUIRE zaman aşımını GERÇEK pg-pool'dan üret: max=1, tek slot tutulur, ikinci
 * istek kuyruğa girip bütçeyi aşar. (Uygulamanın havuzuna DOKUNMAZ — ayrı, 1
 * bağlantılık geçici havuz.)
 */
async function provokeAcquireTimeout(): Promise<unknown> {
  const ka = keepAlive();
  const p = new Pool({ connectionString: CONN, max: 1, connectionTimeoutMillis: 250 });
  // NEDEN doğrudan `PoolClient`: `p.connect` AŞIRI YÜKLÜ (promise + callback
  // biçimleri) ve `ReturnType<>` son overload'ı (`void` dönen callback biçimi)
  // seçiyor → `held` `void`/`never` oluyor, `held?.release()` de derlenmiyordu.
  let held: PoolClient | null = null;
  try {
    held = await p.connect(); // tek slotu tut, BIRAKMA
    await p.connect(); // kuyruğa girer → 250ms sonra düşer
    return null;
  } catch (e) {
    return e;
  } finally {
    held?.release();
    await p.end().catch(() => {});
    clearInterval(ka);
  }
}

/**
 * HANDSHAKE zaman aşımını üret: bütçe 1ms → TCP+auth (ölçüldü: ~37ms localhost'ta)
 * kesinlikle yetişemez. pg-pool timer'ı stream'i destroy eder, gerçek pg client
 * connect callback'ini hata ile tamamlar ve pg-pool onu "Connection terminated
 * due to connection timeout" ile sarar (index.js:270-273).
 */
async function provokeHandshakeTimeout(): Promise<unknown> {
  const ka = keepAlive();
  const p = new Pool({ connectionString: CONN, max: 2, connectionTimeoutMillis: 1 });
  try {
    const c = await p.connect();
    c.release();
    return null; // beklenmedik: handshake 1ms'de bitti
  } catch (e) {
    return e;
  } finally {
    await p.end().catch(() => {});
    clearInterval(ka);
  }
}

/** errorHandler'ı gerçek express üzerinde koştur; verilen hatayı next()'e ver. */
function buildApp(): express.Express {
  const app = express();
  app.get("/pool-acquire", (_q, _s, next) =>
    next(new Error("timeout exceeded when trying to connect"))
  );
  app.get("/pool-handshake", (_q, _s, next) =>
    next(new Error("Connection terminated due to connection timeout"))
  );
  app.get("/apperror", (_q, _s, next) => next(AppError.badRequest("kötü istek")));
  app.get("/notfound", (_q, _s, next) => next(AppError.notFound("yok")));
  app.get("/p2034", (_q, _s, next) => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2034";
      meta = {};
    }
    next(new PrismaClientKnownRequestError("write conflict"));
  });
  app.get("/p2028", (_q, _s, next) => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2028";
      meta = {};
    }
    next(new PrismaClientKnownRequestError("tx timeout"));
  });
  app.get("/zod", (_q, _s, next) => {
    try {
      z.object({ a: z.string() }).parse({});
    } catch (e) {
      next(e as ZodError);
    }
  });
  app.get("/generic", (_q, _s, next) => next(new Error("boom")));
  app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next)
  );
  return app;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const server = buildApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // --- 1) GERÇEK pg-pool hatalarını sınıflandırıcı tanıyor mu? -------------
    // (Metin sözleşmesinin kilidi: pg yükseltmesi bunu bozarsa burada düşer.)
    const acqErr = await provokeAcquireTimeout();
    check(
      "gerçek pg-pool acquire zaman aşımı → 'acquire'",
      classifyPoolTimeout(acqErr) === "acquire",
      `mesaj="${acqErr instanceof Error ? acqErr.message : String(acqErr)}"`
    );
    const hsErr = await provokeHandshakeTimeout();
    check(
      "gerçek pg-pool handshake zaman aşımı → 'handshake'",
      classifyPoolTimeout(hsErr) === "handshake",
      `mesaj="${hsErr instanceof Error ? hsErr.message : String(hsErr)}"`
    );

    // --- 2) Yanlış pozitif kapıları ------------------------------------------
    check("AppError havuz hatası SAYILMAZ", classifyPoolTimeout(AppError.badRequest("x")) === null);
    check(
      "kod taşıyan Error havuz hatası SAYILMAZ",
      classifyPoolTimeout(Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" })) === null
    );
    check("başka mesajlı çıplak Error SAYILMAZ", classifyPoolTimeout(new Error("boom")) === null);
    check("Error olmayan değer SAYILMAZ", classifyPoolTimeout("timeout exceeded when trying to connect") === null);
    check(
      "alt sınıf (constructor !== Error) SAYILMAZ — pg yükseltmesi sararsa kapalı devre",
      classifyPoolTimeout(new (class extends Error {})("timeout exceeded when trying to connect")) === null
    );

    // --- 3) errorHandler eşlemesi: havuz → 503 ------------------------------
    const before = getPoolHealth().poolAcquireTimeouts;
    const r1 = await fetch(`${base}/pool-acquire`);
    const b1 = (await r1.json()) as { message?: string };
    check("havuz acquire → HTTP 503", r1.status === 503, `status=${r1.status}`);
    check("503 gövdesi 'Sunucu şu anda yoğun' mesajı", (b1.message ?? "").startsWith("Sunucu şu anda yoğun"), b1.message);
    check("Retry-After header'ı set edildi", r1.headers.get("retry-after") === "3", String(r1.headers.get("retry-after")));
    const r2 = await fetch(`${base}/pool-handshake`);
    check("havuz handshake → HTTP 503", r2.status === 503, `status=${r2.status}`);
    check(
      "kümülatif sayaç iki olayı da saydı",
      getPoolHealth().poolAcquireTimeouts === before + 2,
      `önce=${before} sonra=${getPoolHealth().poolAcquireTimeouts}`
    );
    check("lastPoolTimeoutAt damgalandı", getPoolHealth().lastPoolTimeoutAt !== null);

    // --- 4) REGRESYON KİLİDİ: yeni dal 4xx'leri YUTMUYOR --------------------
    const cases: Array<[string, number, string]> = [
      ["/apperror", 400, "AppError → 400"],
      ["/notfound", 404, "AppError.notFound → 404"],
      ["/p2034", 409, "Prisma P2034 → 409"],
      ["/zod", 400, "ZodError → 400"],
      ["/p2028", 503, "Prisma P2028 → 503 (mevcut yol korundu)"],
      ["/generic", 500, "generic Error → 500 (havuz dalına düşmedi)"],
    ];
    for (const [path, want, label] of cases) {
      const r = await fetch(`${base}${path}`);
      check(label, r.status === want, `beklenen=${want} gelen=${r.status}`);
    }
    const rBusy = await fetch(`${base}/p2028`);
    const bBusy = (await rBusy.json()) as { message?: string };
    check(
      "P2028 ve havuz dalı AYNI 503 metnini döndürüyor (tek kaynak)",
      bBusy.message === b1.message,
      `p2028="${bBusy.message}"`
    );

    // --- 5) Havuz yapılandırma invariant'ı ----------------------------------
    // idleTimeoutMillis 30sn'den 10dk'ya çıkarıldı (soğuk-connect düzeltmesi).
    // Biri yanlışlıkla geri alırsa burada yakalanır.
    check(
      "havuz config: idleTimeoutMillis = 10dk (soğuk-connect düzeltmesi)",
      pool.options.idleTimeoutMillis === 600_000,
      `gelen=${pool.options.idleTimeoutMillis}`
    );
    check("havuz config: max = 30", pool.options.max === 30, `gelen=${pool.options.max}`);
    check(
      "havuz config: connectionTimeoutMillis = 5sn",
      pool.options.connectionTimeoutMillis === 5_000,
      `gelen=${pool.options.connectionTimeoutMillis}`
    );
  } finally {
    server.close();
    // errorHandler GERÇEK audit yazıyor (fire-and-forget) → yazımların oturması
    // için kısa bekleme, sonra ZAMAN DAMGASIYLA SINIRLI temizlik: gerçek bir
    // üretim olayı asla silinmesin.
    await new Promise((r) => setTimeout(r, 400));
    await prisma.systemLog
      .deleteMany({ where: { recordId: "POOL_TIMEOUT", createdAt: { gte: startedAt } } })
      .catch(() => {});
    await prisma.systemLog
      .deleteMany({ where: { recordId: { in: ["P2028", "P2034"] }, createdAt: { gte: startedAt } } })
      .catch(() => {});
    await prisma.systemLog
      .deleteMany({ where: { recordId: "Error", createdAt: { gte: startedAt } } })
      .catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
