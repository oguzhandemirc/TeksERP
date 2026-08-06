// =============================================================================
// Test: CONTROLLER HANDLER'LARI ROUTE'A ÇIPLAK GEÇİLİYORSA BAĞLI OLMALI (bind)
// =============================================================================
// VAKA (2026-08-06, saha bildirimi "kart çıkıyor ama sunucu hatası yazıyor"):
// `TravelerCardController` on handler taşıyor, dokuzu constructor'da
// `bind(this)` ile bağlanmış — `recordPrintEvent` UNUTULMUŞ. Route onu ÇIPLAK
// referansla geçiyor (`controller.recordPrintEvent`), Express de düz fonksiyon
// olarak çağırıyor → `this` undefined → `this.service` okunurken TypeError →
// **her çağrıda 500**. Uç 2026-08-05'te eklendi ve o günden beri HİÇ çalışmadı.
//
// Neden aylarca sessiz kaldı — üç katman birden yuttu:
//   • Baskı istemci tarafında yapılıyor (kâğıt çıkıyor), bu uç yalnız "basıldı"
//     bildirimi; istemci onu best-effort yutuyordu.
//   • Refakat kartı bekçileri (`test_traveler_card_stale`, `test_traveler_template`)
//     `TravelerCardService`'i DOĞRUDAN çağırıyor → controller'ı hiç geçmiyorlar.
//   • TypeScript bu hatayı GÖREMEZ: `controller.method` geçerli bir referanstır,
//     `this` bağlamının kaybı tip sisteminde yoktur.
// Görünen tek iz: `contentDirty` hiç temizlenmedi ve otomatik revizyonun
// `version++`'ı hiç yazılmadı — yani sessiz veri kaybı.
//
// Bu bekçi kuralı mekanikleştirir: bir controller sınıfı bind desenini
// KULLANIYORSA (yani en az bir `this.x = this.x.bind(this)` satırı varsa),
// route'larda çıplak referansla geçilen HER handler'ı bağlamak ZORUNDADIR.
//
// ⚠️ KÖRLÜK ZEMİNİ: tarama regex tabanlıdır (controller'ları import etmek
// yan etki doğurur). Desenler değişirse "ihlal yok" ile "hiçbir şeye bakılmadı"
// aynı yeşile çıkar — bu yüzden aşağıda taranan sınıf/handler/bind sayıları
// alt sınırlarla kontrol edilir.
//
// Çalıştır: npx tsx scripts/test_controller_binds.ts
// =============================================================================

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const CONTROLLERS_DIR = join(__dirname, "..", "src", "controllers");
const ROUTES_DIR = join(__dirname, "..", "src", "routes");

// Taramanın gerçekten bir şeye baktığının kanıtı (körlük zemini).
const MIN_CLASSES_WITH_BIND = 10;
const MIN_HANDLERS = 100;
const MIN_ROUTE_REFS = 100;

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function readAll(dir: string): { file: string; src: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, src: readFileSync(join(dir, f), "utf8") }));
}

function main(): void {
  console.log("=== Controller bind sözleşmesi ===\n");

  const routeSrc = readAll(ROUTES_DIR)
    .map((r) => r.src)
    .join("\n");

  // Route'larda çıplak geçilen handler adları: `controller.foo`, `ctrl.foo` …
  const routeRefs = new Set(
    [...routeSrc.matchAll(/\b(?:controller|ctrl|c)\.(\w+)\b/g)].map((m) => m[1]),
  );

  let classesWithBind = 0;
  let handlerCount = 0;
  const violations: string[] = [];

  for (const { file, src } of readAll(CONTROLLERS_DIR)) {
    const binds = new Set(
      [...src.matchAll(/this\.(\w+)\s*=\s*this\.\1\.bind\(this\)/g)].map((m) => m[1]),
    );
    if (binds.size === 0) continue; // sınıf bind desenini kullanmıyor — kapsam dışı
    classesWithBind++;

    // Sınıf gövdesindeki Express handler'ları: `  async foo(req: …` / `  foo(req: …`
    const handlers = [...src.matchAll(/^ {2}(?:async )?(\w+)\s*\(\s*req:/gm)].map((m) => m[1]);
    handlerCount += handlers.length;

    for (const h of handlers) {
      if (binds.has(h)) continue;
      // Bağlanmamış handler yalnız route'ta ÇIPLAK geçiliyorsa hatadır.
      if (routeRefs.has(h)) violations.push(`${file} → ${h}`);
    }
  }

  console.log(
    `  (tarandı: bind kullanan ${classesWithBind} sınıf, ${handlerCount} handler, ` +
      `route'larda ${routeRefs.size} çıplak referans)\n`,
  );

  // --- Körlük zemini ---------------------------------------------------------
  check(
    `en az ${MIN_CLASSES_WITH_BIND} controller sınıfı tarandı`,
    classesWithBind >= MIN_CLASSES_WITH_BIND,
    `bulunan: ${classesWithBind} — bind deseni değişmiş olabilir, tarayıcı körleşti`,
  );
  check(
    `en az ${MIN_HANDLERS} handler tarandı`,
    handlerCount >= MIN_HANDLERS,
    `bulunan: ${handlerCount} — handler imzası değişmiş olabilir (regex \`(req:\` bekliyor)`,
  );
  check(
    `route'larda en az ${MIN_ROUTE_REFS} çıplak handler referansı bulundu`,
    routeRefs.size >= MIN_ROUTE_REFS,
    `bulunan: ${routeRefs.size} — route'lardaki değişken adı değişmiş olabilir`,
  );

  // --- Asıl kural ------------------------------------------------------------
  check(
    "route'a çıplak geçilen her handler constructor'da bind edilmiş",
    violations.length === 0,
    violations.length
      ? `bağlanmamış: ${violations.join(", ")} → çağrıldığında \`this\` undefined, 500`
      : "",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

try {
  main();
} catch (e) {
  console.error("HATA:", e);
  fail++;
}
process.exit(fail > 0 ? 1 : 0);
