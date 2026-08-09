// =============================================================================
// Test: app.ts middleware SIRASI ve load-bearing ayarları (F-CORE-OPS-006)
// Çalıştır: npx tsx scripts/test_middleware_order.ts
// =============================================================================
// Sıra bu uygulamada bir tercih değil, DOĞRU ÇALIŞMANIN KOŞULU — ve gerekçeleri
// app.ts'in kendi yorumlarında yazılı:
//
//   • helmet'in CSP `upgradeInsecureRequests` direktifi null'a çekilmiş, çünkü
//     sunucu HTTP-only. Direktif geri gelirse tarayıcı TÜM alt-istekleri https'e
//     çevirir ve durum sayfası "Kontrol ediliyor..." ekranında DONAR (app.ts
//     80-84 bu olayın yaşandığını yazıyor).
//   • cors `exposedHeaders` listesi olmadan Electron renderer'ı `X-Label-*` ve
//     `Date` başlıklarını JS'e HİÇ göremez → native baskı guard'ı sessizce yanlış
//     dala düşer, sunucu saati offset'i kurulamaz.
//   • jsonParser morgan + latency'den SONRA olmalı: önce olursa bozuk JSON (400)
//     ve 1MB aşımı (413) hata zincirine çıkıp sonraki normal middleware'ları
//     ATLAR ve o istekler ne erişim log'una ne gecikme metriğine düşer
//     (F-CORE-OPS-003; düzeltilmeden önceki hal buydu).
//   • errorHandler ZİNCİRİN SONU olmalı — 404 catch-all'dan da sonra.
//
// Denetimde ölçüldü: `scripts/` altında helmet/cors/compression geçen TEK bir
// dosya yoktu, yani bu sıra bir refactor'da sessizce değişebilirdi.
//
// ⚠️ TEK KAYNAK: middleware SIRASI yalnız BURADA iddia edilir. Aynı invariant'ı
// ikinci bir dosyada tekrar etmek, iki muaf listesinin zamanla ayrışmasına ve
// "kırmızı bekçiyi görmezden gelme" alışkanlığına yol açar (kök CLAUDE.md,
// timestamptz bekçisi gerekçesi). `test_observability_contract` bu yüzden
// yalnızca DAVRANIŞI (400/413 gerçekten ölçülüyor mu) doğrular.
//
// SAF: DB'ye dokunmaz, HTTP isteği atmaz.
// =============================================================================
import app from "../src/app";

/** Göreli sıra sözleşmesi — TAM eşitlik DEĞİL: yeni bir middleware eklemek
 *  testi kırmasın, yalnız bu yedisinin birbirine göre yeri korunsun. */
const ORDER = [
  "helmetMiddleware",
  "corsMiddleware",
  "compression",
  "logger", // morgan
  "latencyMiddleware",
  "jsonParser", // express.json — morgan+latency'den SONRA (F-CORE-OPS-003)
  "serveStatic", // statik varlıklar
  "resolveDevice", // cihaz çözümü — statikten SONRA (F-CORE-VER-002)
] as const;

/** Körlük zemini: üst seviye middleware sayısı bunun altına düşerse tarayıcı boşa düşmüştür. */
const MIN_TOP_LEVEL = 5;

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

type Layer = { name: string; route?: unknown };

function main(): void {
  console.log("=== Middleware sırası sözleşmesi ===\n");
  const stack = (app as unknown as { router: { stack: Layer[] } }).router.stack;
  const names = stack.filter((l) => !l.route).map((l) => l.name);
  const top = names.filter((n) => n !== "router");
  console.log(`  (tarandı: ${stack.length} layer · ${top.length} üst seviye middleware)\n`);

  // ── KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────────
  check(
    `körlük zemini: en az ${MIN_TOP_LEVEL} üst seviye middleware bulundu`,
    top.length >= MIN_TOP_LEVEL,
    `bulunan: ${top.length}`,
  );

  // ── 1) Göreli sıra ────────────────────────────────────────────────────────
  const idx = (n: string) => names.indexOf(n);
  for (const n of ORDER) {
    check(`'${n}' zincirde bulundu`, idx(n) !== -1);
  }
  for (let i = 1; i < ORDER.length; i++) {
    const prev = ORDER[i - 1]!;
    const cur = ORDER[i]!;
    check(
      `sıra: ${prev} → ${cur}`,
      idx(prev) !== -1 && idx(cur) !== -1 && idx(prev) < idx(cur),
      `${prev}@${idx(prev)} ${cur}@${idx(cur)}`,
    );
  }

  // Cihaz çözümü statik varlıklardan SONRA olmalı: her statik dosya isteğine
  // bir `device` DB sorgusu bindirmenin karşılığı YOK — statik yol `req.device`ı
  // okuyamaz (F-CORE-VER-002). API route'ları zaten daha aşağıda.
  check(
    "resolveDevice statik varlıklardan SONRA (statik istek cihaz sorgusu ödemez)",
    idx("resolveDevice") > names.lastIndexOf("serveStatic"),
    `resolveDevice@${idx("resolveDevice")} sonServeStatic@${names.lastIndexOf("serveStatic")}`,
  );

  // ── 2) errorHandler ZİNCİRİN SONU ─────────────────────────────────────────
  check(
    "errorHandler zincirin SON halkası",
    names[names.length - 1] === "errorHandler",
    `son halka: ${names[names.length - 1]}`,
  );

  // ── 3) Load-bearing yapılandırma DEĞERLERİ ────────────────────────────────
  // Sıra doğru olsa bile bu iki değer düşerse sahada sessiz arıza doğar.
  const appSrc = require("fs").readFileSync(
    require("path").join(__dirname, "../src/app.ts"),
    "utf8",
  ) as string;
  check(
    "helmet CSP 'upgradeInsecureRequests' null'a çekili (HTTP-only sunucu)",
    /upgradeInsecureRequests:\s*null/.test(appSrc),
  );
  check("helmet HSTS kapalı (HTTPS yok)", /strictTransportSecurity:\s*false/.test(appSrc),);
  for (const h of ["X-Label-Language", "X-Label-Kind", "Date"]) {
    check(`cors exposedHeaders '${h}' içeriyor`, appSrc.includes(`"${h}"`));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
