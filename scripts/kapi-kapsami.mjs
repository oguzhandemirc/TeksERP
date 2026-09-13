#!/usr/bin/env node
// =============================================================================
// TİP KAPISININ KAPSAMI — ölçüm çekirdeği (zero-dep, Node ESM)
// =============================================================================
// Çalıştır: node scripts/kapi-kapsami.mjs <proje>        (Teks-Erp | Electron | mobil)
// Çıkış: 0 = her kapı hedefi en az bir dosya derliyor · 1 = SIFIR dosya · 2 = ARIZA
//
// ⭐ NEDEN AYRI DOSYA (2026-09-13): `test_kapi_kapsami.ts` üç projeyi de TEK
//    job'dan ölçüyordu. CI'ın Backend job'ı `npm ci`yi yalnız `Teks-Erp`te
//    koşuyor ⇒ `Electron/` ve `mobil/`de `node_modules` yok ⇒ `npx tsc` config'i
//    çözemiyor ve kapı ÜÇ TUR kırmızı verdi. Kapı doğru davranıyordu (ARIZA
//    diyordu, "0 dosya" demiyordu) ama YANLIŞ YERDEN ölçüyordu.
//
//    (a) beyan indi: ölçülemeyen kapsam `atla()` ile bildirilir — ama BEYAN
//    KAPSAMIN YERİNE GEÇMEZ. (b) budur: kapsam, bağımlılıkları KURULU olan
//    kendi job'ında ölçülür.
//
// ⚠️ NEDEN BEKÇİNİN İÇİNE İKİNCİ BİR KOPYA YAZILMADI: Electron/mobil job'larında
//    `tsx` ve Teks-Erp bağımlılıkları YOK; bekçiyi oradan koşturamayız. İnline
//    bir sayım yazmak İKİ GERÇEK üretirdi (bu gece `tr-kokler.ts` ile tam bunu
//    reddettik). Çözüm: ölçüm TEK yerde, hem bekçi hem CI adımı BURAYA çağırır.
//    ⇒ *Bir ölçüm iki yerde koşacaksa, iki kez YAZILMAZ; bir kez yazılıp iki kez
//      ÇAĞRILIR.*
//
// ⚠️ ZERO-DEP ve `node_modules` GEREKTİRMEZ (kendisi için): yalnız `npx tsc`
//    çağırır, o da ölçülen projenin KENDİ kurulumunu kullanır. Bu yüzden her
//    job'da, kendi dizininde koşabilir.
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `package.json > scripts` içindeki tip kapılarından `-p <config>` hedefleri. */
export function kapiConfigleri(proje) {
  const pkg = JSON.parse(readFileSync(join(KOK, proje, "package.json"), "utf8"));
  const konu = Object.entries(pkg.scripts ?? {}).filter(([ad]) => /^typecheck/.test(ad));
  const out = new Set();
  for (const [, cmd] of konu) {
    const p = [...cmd.matchAll(/-p\s+(\S+)/g)].map((m) => m[1]);
    // `-p` yoksa varsayılan `tsconfig.json` — o da bir kapı hedefidir.
    if (p.length === 0) out.add("tsconfig.json");
    else for (const x of p) out.add(x);
  }
  return [...out];
}

/**
 * O config'in KÖK DOSYA sayısı. `-1` = config ÇÖZÜLEMEDİ (ARIZA) — "0 dosya"dan
 * AYRI tutulur: biri kapsam bulgusu, öteki araç arızası.
 */
export function dosyaSayisi(proje, cfg) {
  let ham = "";
  try {
    ham = execFileSync("npx", ["tsc", "--showConfig", "-p", cfg], {
      cwd: join(KOK, proje),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    ham = err?.stdout ?? "";
  }
  try {
    return (JSON.parse(ham).files ?? []).length;
  } catch {
    return -1;
  }
}

/** Bağımlılıkları kurulu mu — kurulu değilse ölçüm YAPILAMAZ (ARIZA değil). */
export function kurulu(proje) {
  return existsSync(join(KOK, proje, "node_modules"));
}

function main() {
  const proje = process.argv[2];
  if (!proje) {
    console.error("kullanım: node scripts/kapi-kapsami.mjs <proje>");
    process.exit(2);
  }
  if (!kurulu(proje)) {
    // ⚠️ ÖLÇÜLEMEDİ ≠ İHLAL. Bu job'da bağımlılık yoksa hüküm VERİLMEZ; çıkış 2
    // (ARIZA) ki "0 dosya" (çıkış 1) ile karışmasın.
    console.error(`⛔ ${proje}: bağımlılıklar kurulu DEĞİL — kapsam BU JOB'DA ÖLÇÜLEMEZ (hüküm yok)`);
    process.exit(2);
  }
  const configler = kapiConfigleri(proje);
  // KÖRLÜK ZEMİNİ: script adı değişirse liste boşalır ve her kontrol VAKUMEN
  // yeşil olurdu — boş liste bir BULGU değil, aracın körlüğüdür.
  if (configler.length === 0) {
    console.error(`❌ ${proje}: package.json'da 'typecheck*' script'i YOK — kapı hedefi çözülemedi`);
    process.exit(1);
  }
  let kotu = 0;
  for (const cfg of configler) {
    const n = dosyaSayisi(proje, cfg);
    if (n > 0) {
      console.log(`✅ ${proje}/${cfg} — ${n} dosya`);
    } else {
      kotu++;
      console.error(
        n === 0
          ? `❌ ${proje}/${cfg} — 0 DOSYA: bu kapı HİÇBİR ŞEY ölçmüyor, her zaman yeşil verir`
          : `❌ ${proje}/${cfg} — config ÇÖZÜLEMEDİ (ARIZA, kapsam bulgusu değil)`,
      );
    }
  }
  console.log(`   ${proje}: ${configler.length} kapı hedefi ölçüldü, ${kotu} sorunlu`);
  process.exit(kotu > 0 ? 1 : 0);
}

// Doğrudan çalıştırıldığında ölç; ithal edildiğinde yalnız yardımcıları ver.
if (process.argv[1] && process.argv[1].endsWith("kapi-kapsami.mjs")) main();
