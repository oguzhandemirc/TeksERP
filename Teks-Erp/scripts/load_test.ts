// =============================================================================
// HTTP yük / throughput testi — Express app GERÇEKTEN ayağa kaldırılır (fetch).
// Çalıştır: npm run test:load   (veya: npx tsx scripts/load_test.ts)
// =============================================================================
// DİKKAT: Dosya adı KASTEN "test_" prefix'i TAŞIMAZ → run-all-tests.ts
// auto-discovery'si (`^test_.*\.ts$`) bunu YAKALAMAZ. Yük testi normal regresyon
// suite'inde her koşumda çalışmamalı (yavaş + paylaşımlı runner'da gürültülü);
// ayrı npm script'iyle / ayrı CI job'ında koşar.
//
// NE ÖLÇER: birkaç ucuz READ ucuna (GET /api/items, /api/customers, /api/colors,
// /api/shipping/shipments) sabit sayıda istek, sınırlı eşzamanlılıkla (worker
// havuzu) atılır; toplam süre, throughput (req/s), p50/p95/p99 latency ve hata
// (2xx olmayan) sayısı raporlanır.
//
// NEDEN MİKRO-BENCHMARK DEĞİL: amaç mutlak performans rakamı değil; (a) gerçek
// throughput/p95 ÖLÇÜMÜNÜ görünür kılmak, (b) ciddi bir regresyona (ör. N+1,
// kilitlenme, hata patlaması) karşı GEVŞEK bir guard koymak. Eşikler CI'daki
// paylaşımlı runner'da flaky olmasın diye bilinçli olarak çok gevşek.
//
// jest/vitest KULLANMAZ (CLAUDE.md "backend jest/vitest YOK"). Sözleşme:
// ✅/❌ check() sayaçları + "=== Sonuç: N geçti, M başarısız ===" + process.exit.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "../src/app";
import prisma from "../src/lib/prisma";

// ---- Konfig (gevşek; ölçüm + regresyon guard'ı amaçlı) ----
const TOTAL_REQUESTS = 300; // toplam istek
const CONCURRENCY = 20; // eşzamanlı worker (havuz)
const P95_MAX_MS = 3000; // GEVŞEK: paylaşımlı CI runner'da flaky olmasın
const MIN_THROUGHPUT = 3; // req/s — çok düşük taban (yalnız tamamen çökerse düşer)

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  // "nearest-rank": p. yüzdelik = ceil(p/100 * N). (1-indexli)
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

async function main() {
  // Efemeral port (0) → çalışan dev/CI sunucusuyla çakışmaz.
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const r = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await r.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: r.status, body };
  };

  try {
    // ---- 1) Login (admin) → token ----
    const login = await call("POST", "/api/auth/login", {
      body: { username: "admin", password: "123123" },
    });
    const token = ((login.body.data ?? {}) as Record<string, unknown>).token as string | undefined;
    check("login admin/123123 → 200 + token", login.status === 200 && typeof token === "string", `status=${login.status}`);
    if (!token) {
      // Token yoksa yük testinin anlamı yok — erken çık.
      throw new Error("admin token alınamadı; yük testi koşulamaz");
    }

    // ---- 2) Ucuz READ uçları (auto-discovery'siz, var olduğu doğrulanmış) ----
    const endpoints = [
      "/api/items",
      "/api/customers",
      "/api/colors",
      "/api/shipping/shipments",
    ];

    // ---- 3) Worker havuzu: CONCURRENCY worker, ortak sayaçtan sırayla iş çeker ----
    let next = 0;
    const latencies: number[] = [];
    const statusCounts = new Map<number, number>();
    let errors = 0;

    const recordStatus = (status: number) => {
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
      if (status < 200 || status >= 300) errors++;
    };

    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= TOTAL_REQUESTS) return;
        const path = endpoints[i % endpoints.length];
        const t0 = performance.now();
        try {
          const res = await call("GET", path, { token });
          latencies.push(performance.now() - t0);
          recordStatus(res.status);
        } catch {
          // Ağ/transport hatası = istek başarısız (status 0 olarak iz tut).
          latencies.push(performance.now() - t0);
          recordStatus(0);
        }
      }
    };

    const wallStart = performance.now();
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const wallMs = performance.now() - wallStart;

    // ---- 4) İstatistik ----
    const completed = latencies.length;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const throughput = completed / (wallMs / 1000);

    console.log("\n--- Yük testi ölçümü ---");
    console.log(`İstek         : ${completed}/${TOTAL_REQUESTS} (eşzamanlılık=${CONCURRENCY})`);
    console.log(`Toplam süre   : ${(wallMs / 1000).toFixed(2)} s`);
    console.log(`Throughput    : ${throughput.toFixed(1)} req/s`);
    console.log(`Latency p50   : ${p50.toFixed(0)} ms`);
    console.log(`Latency p95   : ${p95.toFixed(0)} ms`);
    console.log(`Latency p99   : ${p99.toFixed(0)} ms`);
    console.log(`Hata (2xx dışı): ${errors}`);
    console.log(
      `Status dağılımı: ${[...statusCounts.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(", ")}`,
    );
    console.log("------------------------\n");

    // ---- 5) check() — gevşek eşikler ----
    check("tüm istekler tamamlandı", completed === TOTAL_REQUESTS, `${completed}/${TOTAL_REQUESTS}`);
    check("hata sayısı = 0 (hepsi 2xx)", errors === 0, `errors=${errors}`);
    check(`p95 < ${P95_MAX_MS}ms (gevşek)`, p95 < P95_MAX_MS, `p95=${p95.toFixed(0)}ms`);
    check(`throughput > ${MIN_THROUGHPUT} req/s (taban)`, throughput > MIN_THROUGHPUT, `tput=${throughput.toFixed(1)} req/s`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
