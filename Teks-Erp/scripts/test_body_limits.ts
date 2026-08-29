// =============================================================================
// BEKÇİ — GÖVDE LİMİTLERİ (2026-08-29 / BULGU-T1-045)
// Çalıştır: npx tsx scripts/test_body_limits.ts
// =============================================================================
// `app.ts` global `express.json({ limit: "1mb" })` katmanını TÜM router'lardan
// ÖNCE mount ediyordu → içe aktarım router'ının kendi 10 MB'lık katmanı HİÇ
// KOŞMUYORDU. 2 MB'lık (~6.000 satır) müşteri CSV'si global katmanda 413'e
// düşüyor, ekran "10.000 satır" vaat ederken operatör dosyayı deneyerek bölmek
// zorunda kalıyor ve doğru sebep hiçbir yerde yazmıyordu. Üstelik 413 mesajı
// sabit "1MB" diyerek YANLIŞ sınırı söylüyordu.
//
// Bu sınıf (HTTP seviyeli gövde limiti) bugüne dek BEKÇİSİZDİ.
//
// §1 GERÇEK HTTP — 1,5 MB gövde: /api/import geçer, /api/orders 413 alır
// §2 MESAJ       — 413 ETKİN sınırı söyler (yolun kendi limitini)
// §3 TEK KAYNAK  — 10 MB'lık kendi parser'ını taşıyan HER router'ın mount ön eki
//                  listede; listedeki her ön ek de gerçekten mount edilmiş
//                  (İKİ YÖNLÜ — ölü girdi gerçek bir açığı gizler)
// =============================================================================
import http from "http";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { BUYUK_GOVDE_YOLLARI, BUYUK_GOVDE_LIMITI, VARSAYILAN_GOVDE_LIMITI } from "../src/constants/body-limits";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Gerçek HTTP isteği — parser zincirini olduğu gibi koşturur. */
function istek(
  port: number,
  yol: string,
  govde: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: yol,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(govde),
        },
      },
      (res) => {
        let veri = "";
        res.on("data", (c) => (veri += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: veri }));
      },
    );
    req.on("error", reject);
    req.write(govde);
    req.end();
  });
}

async function main(): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  // ~1,5 MB gövde — eski 1 MB sınırını aşar, yeni 10 MB sınırının altında.
  const buyuk = JSON.stringify({ dolgu: "x".repeat(1_500_000) });
  check("gövde gerçekten 1 MB'ı aşıyor", Buffer.byteLength(buyuk) > 1_048_576, `${Math.round(Buffer.byteLength(buyuk) / 1024)} KB`);

  try {
    // ═══ §1 — büyük gövde yolları geçmeli, normal uçlar 413 almalı ═══
    console.log("\n=== §1: 1,5 MB gövde ===");
    const ice = await istek(port, "/api/import/customer/preview", buyuk);
    check(
      "§1: /api/import GÖVDE LİMİTİNE takılmıyor (413 DEĞİL)",
      ice.status !== 413,
      `HTTP ${ice.status}`,
    );
    const siparis = await istek(port, "/api/orders", buyuk);
    check("§1: /api/orders hâlâ 413 alıyor (global sınır duruyor)", siparis.status === 413, `HTTP ${siparis.status}`);

    // ═══ §2 — mesaj ETKİN sınırı söylüyor ═══
    console.log("\n=== §2: 413 mesajı ===");
    check(
      `§2: mesaj etkin sınırı (${VARSAYILAN_GOVDE_LIMITI}) yazıyor`,
      siparis.body.includes(VARSAYILAN_GOVDE_LIMITI),
      siparis.body.slice(0, 110),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // ═══ §3 — liste İKİ YÖNLÜ tutarlı ═══
  console.log("\n=== §3: tek kaynak (iki yönlü) ===");
  const routesDir = join(__dirname, "../src/routes");
  const dosyalar = readdirSync(routesDir).filter((f) => f.endsWith(".routes.ts"));
  check("§3: rota dosyaları tarandı (körlük zemini)", dosyalar.length > 20, `${dosyalar.length} dosya`);
  const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");

  // ① Kendi büyük parser'ını taşıyan her router'ın ön eki listede olmalı.
  const buyukParserli = dosyalar.filter((f) =>
    readFileSync(join(routesDir, f), "utf8").includes("BUYUK_GOVDE_LIMITI"),
  );
  check("§3: büyük parser taşıyan router bulundu (körlük zemini)", buyukParserli.length >= 2, buyukParserli.join(", "));
  const eksik: string[] = [];
  for (const f of buyukParserli) {
    const modul = f.replace(/\.ts$/, "");
    // app.ts'te bu router hangi ön ekle mount edilmiş?
    const m = appSrc.match(new RegExp(`app\\.use\\("([^"]+)",\\s*\\w+\\);?[^\\n]*`, "g")) ?? [];
    const isim = modul.replace(/\.routes$/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) + "Routes";
    const satir = m.find((x) => x.includes(`, ${isim})`));
    const onEk = satir?.match(/app\.use\("([^"]+)"/)?.[1];
    if (!onEk || !BUYUK_GOVDE_YOLLARI.includes(onEk as (typeof BUYUK_GOVDE_YOLLARI)[number])) {
      eksik.push(`${f} → ${onEk ?? "mount bulunamadı"}`);
    }
  }
  check(
    "§3a: büyük parser taşıyan HER router'ın ön eki listede",
    eksik.length === 0,
    eksik.join(" | ") || "hepsi listede",
  );

  // ② Listedeki her ön ek gerçekten mount edilmiş olmalı (ölü girdi yok).
  const oluGirdi = BUYUK_GOVDE_YOLLARI.filter((p) => !appSrc.includes(`app.use("${p}"`));
  check("§3b: listede ÖLÜ girdi yok (hepsi mount edilmiş)", oluGirdi.length === 0, oluGirdi.join(", ") || "ölü girdi yok");

  check(
    "§3: limitler sabitten okunuyor (metin kopyası yok)",
    !appSrc.includes('limit: "1mb"') && BUYUK_GOVDE_LIMITI === "10mb",
    appSrc.includes('limit: "1mb"') ? "app.ts hâlâ metin sabiti taşıyor" : "sabitten",
  );
}

main()
  .catch((err) => {
    console.error("Beklenmeyen hata:", err);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
