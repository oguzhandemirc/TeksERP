// =============================================================================
// Test: "sessizce yanlış davranan sistem" sözleşmesi (2026-08-09 denetimi)
// Çalıştır: npx tsx scripts/test_observability_contract.ts
// =============================================================================
// Üç denetim bulgusunun ortak teması: bir arıza oluyor ama HİÇBİR YERDE iz
// bırakmıyor. Üçü de küçük düzeltmelerle kapatıldı; bu bekçi geri gelmelerini
// engeller.
//
//   F-CORE-OPS-002 — tanınmayan Prisma kodu 400 + audit YOK. P2021 (tablo yok)
//     şema drift'iydi ve istemci hatası gibi görünüyordu; kardeşi P2022 (kolon
//     yok) ise gürültülü 500 veriyordu. Aynı kazanın iki ayağı, iki farklı
//     teşhis süresi. Artık iki KÜME var ve sınıflandırılmamış kod FAIL-LOUD.
//
//   F-CORE-OPS-003 — `express.json` morgan/latency'den ÖNCEYDİ: bozuk JSON (400)
//     ve 1MB aşımı (413) hata zincirine çıkıp sonraki normal middleware'ları
//     atlıyor, NE erişim log'una NE gecikme metriğine düşüyordu. Artık sonra
//     mount ediliyor ve route'a ulaşamadan reddedilen /api istekleri gerçek
//     uçlarına atfediliyor ("(statik/diğer)" kovasına değil).
//
//   F-CORE-OPS-004 — zamanlayıcı hataları yalnız `console.error`daydı; kalıcı
//     defterde iz yoktu ve havuz zaman aşımları `/health` sayacına düşmüyordu
//     (`recordPoolTimeout` TEK yerden, error.middleware'den çağrılıyordu).
//
// SAF kaynak + davranış karışımı: HTTP tarafı gerçek bir sunucuyla ölçülür,
// sözleşme tarafı kaynak okunarak. DB'ye yazmaz.
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import http from "http";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { latencySnapshot, resetLatencyStats } from "../src/services/latency-stats.service";

const SRC = join(__dirname, "../src");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Üst seviye `app.use(...)` middleware adlarını sırayla verir. */
function middlewareOrder(): string[] {
  type L = { name: string; route?: unknown };
  const stack = (app as unknown as { router: { stack: L[] } }).router.stack;
  return stack.filter((l) => !l.route).map((l) => l.name);
}

async function main(): Promise<void> {
  console.log("=== Gözlemlenebilirlik sözleşmesi ===\n");

  // ── 1) F-CORE-OPS-002 — Prisma kod sınıflandırması ────────────────────────
  console.log("[1] Prisma kod sınıflandırması");
  const em = readFileSync(join(SRC, "middlewares/error.middleware.ts"), "utf8");
  const serverSet = /SERVER_FAULT_PRISMA_CODES = new Set<string>\(\[([\s\S]*?)\]\)/.exec(em)?.[1] ?? "";
  const clientSet = /CLIENT_DATA_PRISMA_CODES = new Set<string>\(\[([\s\S]*?)\]\)/.exec(em)?.[1] ?? "";
  check("iki sınıflandırma kümesi de tanımlı", Boolean(serverSet) && Boolean(clientSet));
  for (const code of ["P2021", "P2022", "P2010"]) {
    check(`${code} SUNUCU arızası kümesinde (500 + audit)`, serverSet.includes(code));
  }
  check("P2000 İSTEMCİ verisi kümesinde (400, audit yok)", clientSet.includes("P2000"));
  // Bir kod İKİ kümede birden olamaz — çelişkili sınıflandırma sessiz karışıklıktır.
  const both = ["P2021", "P2022", "P2010", "P2000", "P2011"].filter(
    (c) => serverSet.includes(c) && clientSet.includes(c),
  );
  check("hiçbir kod iki kümede birden değil", both.length === 0, both.join(","));
  // Sınıflandırılmamış kod FAIL-LOUD olmalı: 500 + audit (eski davranış: sessiz 400).
  // ⚠️ ARALIK SINIRLANIR. İlk yazımda slice dosyanın SONUNA kadar gidiyordu ve
  // aşağıdaki generic (Prisma olmayan) hata dalındaki `AuditService.logEvent` +
  // `res.status(500)` ifadelerini eşliyordu — yani fail-loud dalı tamamen
  // silinse bile iki kontrol YEŞİL kalıyordu (negatif sondayla ölçüldü: 3
  // kontrolden yalnız 1'i kırmızı verdi). Aralık, Prisma bloğunun bittiği
  // `PrismaClientValidationError` dalında kapatılır.
  const tailStart = em.indexOf("CLIENT_DATA_PRISMA_CODES.has");
  const tailEnd = em.indexOf("PrismaClientValidationError", tailStart);
  check("sınıflandırılmamış-kod dalının aralığı çözülebildi", tailStart !== -1 && tailEnd > tailStart);
  const tail = em.slice(tailStart, tailEnd > tailStart ? tailEnd : undefined);
  check("sınıflandırılmamış kod audit yazıyor", /AuditService\.logEvent/.test(tail));
  check("sınıflandırılmamış kod 500 dönüyor", /res\.status\(500\)/.test(tail));
  check("sınıflandırılmamış kod uyarı log'u basıyor", /SINIFLANDIRILMAMIŞ/.test(tail));

  // ── 2) F-CORE-OPS-003 — middleware sırası + gerçek ölçüm ──────────────────
  console.log("\n[2] Gövde ayrıştırıcı sırası ve 400/413 ölçümü");
  // ⚠️ SIRA İDDİASI BURADA DEĞİL: middleware sırasının TEK bekçisi
  // `scripts/test_middleware_order.ts`. Aynı invariant'ı iki dosyada iddia etmek,
  // iki listenin zamanla ayrışmasına ve birinin meşru sebeple kırmızıya dönüp
  // görmezden gelinmesine yol açar (kök CLAUDE.md, timestamptz bekçisi gerekçesi).
  // Burada yalnız DAVRANIŞ ölçülür: 400/413 gerçekten log'a ve metriğe düşüyor mu.
  const srv = http.createServer(app);
  await new Promise<void>((r) => srv.listen(0, () => r()));
  const port = (srv.address() as { port: number }).port;
  const post = (body: string) =>
    new Promise<number>((res) => {
      const r = http.request(
        {
          port,
          path: "/api/items",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        (x) => {
          x.resume();
          x.on("end", () => res(x.statusCode ?? 0));
        },
      );
      r.end(body);
    });

  resetLatencyStats();
  const bad = await post('{"bozuk');
  const big = await post(JSON.stringify({ x: "A".repeat(1_200_000) }));
  await new Promise((r) => setTimeout(r, 150));
  const snap = latencySnapshot();
  srv.close();

  check("bozuk JSON → 400", bad === 400, String(bad));
  check("1MB aşımı → 413", big === 413, String(big));
  check(
    "her iki istek de gecikme metriğine düştü",
    snap.totalCount >= 2,
    `totalCount=${snap.totalCount}`,
  );
  check(
    "route'a ulaşamayan /api isteği GERÇEK ucuna atfedildi ('(statik/diğer)' değil)",
    snap.routes.some((r) => r.route.includes("/api/items")),
    snap.routes.map((r) => r.route).join(" | "),
  );

  // ── 3) F-CORE-OPS-004 — zamanlayıcı hatasının kalıcı izi ──────────────────
  console.log("\n[3] Zamanlayıcı hatası kalıcı deftere düşüyor");
  const jf = readFileSync(join(SRC, "jobs/job-failure.ts"), "utf8");
  check("reportJobFailure SystemLog'a yazıyor", /AuditService\.logEvent/.test(jf));
  check("havuz zaman aşımını sınıflandırıyor", /classifyPoolTimeout/.test(jf));
  check("/health sayacını artırıyor", /recordPoolTimeout/.test(jf));
  for (const f of ["archive-scheduler", "backup-scheduler"]) {
    const src = readFileSync(join(SRC, `jobs/${f}.ts`), "utf8");
    check(`${f} catch bloğu reportJobFailure çağırıyor`, /reportJobFailure\(/.test(src));
    check(
      `${f} catch bloğu ÇIPLAK console.error ile yetinmiyor`,
      !/catch \(err\) \{\s*console\.error\([^)]*\);\s*\}/.test(src),
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
