// =============================================================================
// BEKÇİ — COMMIT KAPISI DOĞRU AĞACI OKUR ve DOĞRU KİŞİYİ DURDURUR
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts commit_gate_scope
//
// ⭐ NEDEN VAR (2026-09-13): ortak çalışma ağacında commit kapısı DÖRT kez YANLIŞ
//    KİŞİYİ durdurdu. İki ayrı mekanizma, aynı semptom:
//
//    (a) GATE 1/4 YANLIŞ AĞACI okuyordu. Kısmi (pathspec) commit'te — `git commit
//        -- <yol>` — git GEÇİCİ bir indeks kurar (`GIT_INDEX_FILE=<gitdir>/
//        next-index-<pid>.lock`) ve pathspec dışındaki her şeyi HEAD'e geri sarar.
//        Başkasının SAHNELENMİŞ dosyası o indekste YOKTUR → hook'a `??` görünür →
//        "commit edilmemiş migration/test" kırmızısı. Düzeltme: soru GERÇEK indekse
//        sorulur (`GIT_INDEX_FILE=<gitdir>/index`).
//
//    (b) lint DOĞRU ağacı okuyordu, kusur VERDİKTTEYDİ. `eslint src scripts prisma`
//        dizin alır, git'e hiç sormaz; başkasının yarım kalmış dosyasındaki hata
//        benim commit'imi durduruyordu. Düzeltme: taranan küme AYNI kalır, verdikt
//        commit'in kendi dosyalarına daralır (scripts/hooks/lint-gate.mjs).
//
// ⚠️ İKİ MEKANİZMA TEK BEKÇİDE, çünkü tek bir cümleyi koruyorlar: KAPI BENİM
//    COMMIT'İMİ YARGILAR. Ayrı bekçilere bölünürse biri düşerken öbürü yeşil kalır
//    ve "kapı düzeltildi" cümlesi yarım doğru olur.
//
// ⭐ NEGATİF SONDA (§1 ve §2 zaten iki yönlü kurgulanmıştır: her dalın hem ısırması
//    hem ısırmaması ölçülür). §3'ün tripwire'ları BOZULMUŞ KOPYAYA karşı ayrıca
//    ölçülür — çift terimli bir tripwire'da tek terim yeniden adlandırılınca bekçi
//    yeşil kalır ama korumaz (kapının dördüncü ölüm biçimi, 2026-09-12).
// =============================================================================
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
const MIGRATIONS_DIR = "Teks-Erp/prisma/migrations";

let pass = 0;
let fail = 0;
function check(ad: string, ok: boolean, detay = "") {
  if (ok) {
    pass++;
    console.log(`   ✅ ${ad}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`   ❌ ${ad}${detay ? ` — ${detay}` : ""}`);
  }
}

// =============================================================================
// §1 — GATE 1/4: soru GERÇEK indekse sorulur
// =============================================================================
// Kum havuzu GERÇEK bir git deposudur: `GIT_INDEX_FILE` davranışı git'in kendi
// işidir, taklit edilemez. Bekçi gerçek `check-migrations.mjs`i o havuza kopyalar.
console.log("\n§1 — GATE 1/4 gerçek indeksi okuyor mu");

const havuz = mkdtempSync(join(tmpdir(), "tekserp-gate-"));
// ⚠️ GİT ORTAMI İZOLE (2026-09-13, iki kez ısırdı): bu bekçi hook'a alınınca git'in
// hook'a verdiği GIT_DIR/GIT_INDEX_FILE miras kaldı — `git init/config/commit`
// GEÇİCİ dizini değil GERÇEK repoyu gördü: dala "taban" commit'i indi, ortak
// .git/config'e core.bare=true + user.name=bekci yazıldı, bir origin commit'i o
// kimlikle doğdu. Cwd'ye güvenilmez, git GIT_DIR'a bakar. Üç kat: GIT_* sökülür ·
// global/sistem config kapatılır · HOME geçici — kimlik yalnız KENDİ repo'suna yazılır.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: havuz,
};
try {
  const g = (args: string[]) => execFileSync("git", args, { cwd: havuz, encoding: "utf8", env: GIT_ENV });
  mkdirSync(join(havuz, "scripts"), { recursive: true });
  mkdirSync(join(havuz, "Teks-Erp/prisma/migrations/20260101_taban"), { recursive: true });
  mkdirSync(join(havuz, "Teks-Erp/scripts"), { recursive: true });
  writeFileSync(
    join(havuz, "scripts/check-migrations.mjs"),
    readFileSync(join(KOK, "scripts/check-migrations.mjs"), "utf8"),
  );
  // Kapı betiği artık bağımlılık taşıyor (stdin zaman aşımı, 2026-09-13): kopya
  // yalnız betik değil, import ettiği kütüphane — yoksa havuzda "module not found"
  // ile çöker ve sekiz kontrol birden kırmızı düşer (bu kapı bunu ölçtü).
  mkdirSync(join(havuz, "scripts/hooks/lib"), { recursive: true });
  writeFileSync(
    join(havuz, "scripts/hooks/lib/stdin-liste.mjs"),
    readFileSync(join(KOK, "scripts/hooks/lib/stdin-liste.mjs"), "utf8"),
  );
  writeFileSync(join(havuz, "Teks-Erp/prisma/migrations/20260101_taban/migration.sql"), "SELECT 1;\n");
  writeFileSync(join(havuz, "Teks-Erp/scripts/test_taban.ts"), "export const x = 1;\n");
  g(["init", "-q", "."]);
  g(["config", "user.email", "bekci@test"]);
  g(["config", "user.name", "bekci"]);
  g(["add", "-A"]);
  g(["commit", "-qm", "taban"]);

  const bekciyiKos = () =>
    spawnSync("node", [join(havuz, "scripts/check-migrations.mjs")], {
      cwd: havuz,
      encoding: "utf8",
      env: GIT_ENV,
    });

  // ① GERÇEKTEN takipsiz migration + test → KIRMIZI (kapı hâlâ ısırıyor)
  mkdirSync(join(havuz, "Teks-Erp/prisma/migrations/20260202_unutulan"), { recursive: true });
  writeFileSync(join(havuz, "Teks-Erp/prisma/migrations/20260202_unutulan/migration.sql"), "SELECT 2;\n");
  writeFileSync(join(havuz, "Teks-Erp/scripts/test_unutulan.ts"), "export const y = 1;\n");
  const r1 = bekciyiKos();
  const cikti1 = `${r1.stdout}${r1.stderr}`;
  check("⭐ gerçekten takipsiz migration → KIRMIZI", r1.status === 1 && cikti1.includes("GATE 1"));
  check("⭐ gerçekten takipsiz test → KIRMIZI", r1.status === 1 && cikti1.includes("GATE 4"));
  rmSync(join(havuz, "Teks-Erp/prisma/migrations/20260202_unutulan"), { recursive: true, force: true });
  rmSync(join(havuz, "Teks-Erp/scripts/test_unutulan.ts"), { force: true });

  // ② BAŞKASININ SAHNELENMİŞ dosyası + PATHSPEC commit → YEŞİL
  //    (düzeltmeden ÖNCE bu dal KIRMIZIYDI — kapının yanlış kişiyi durdurduğu tam an)
  mkdirSync(join(havuz, "Teks-Erp/prisma/migrations/20260303_yabanci"), { recursive: true });
  writeFileSync(join(havuz, "Teks-Erp/prisma/migrations/20260303_yabanci/migration.sql"), "SELECT 3;\n");
  writeFileSync(join(havuz, "Teks-Erp/scripts/test_yabanci.ts"), "export const z = 1;\n");
  g(["add", "Teks-Erp/prisma/migrations/20260303_yabanci", "Teks-Erp/scripts/test_yabanci.ts"]);
  writeFileSync(join(havuz, "benim.txt"), "benim\n");
  g(["add", "benim.txt"]);

  const hookYolu = join(havuz, ".git/hooks/pre-commit");
  const raporYolu = join(havuz, "hook-raporu.txt");
  writeFileSync(
    hookYolu,
    `#!/bin/sh\nnode "${join(havuz, "scripts/check-migrations.mjs")}" > "${raporYolu}" 2>&1\n` +
      `echo "CIKIS=$?" >> "${raporYolu}"\nexit 0\n`,
  );
  execFileSync("chmod", ["+x", hookYolu]);

  g(["commit", "-qm", "kismi", "--", "benim.txt"]);
  const rapor2 = readFileSync(raporYolu, "utf8");
  check(
    "⭐ yabancı SAHNELENMİŞ dosya + pathspec commit → YEŞİL",
    /CIKIS=0/.test(rapor2) && !rapor2.includes("GATE 1") && !rapor2.includes("GATE 4"),
    rapor2.split("\n").filter(Boolean).slice(-2).join(" | "),
  );

  // ③ KONTROL GRUBU: pathspec commit ama dosya GERÇEKTEN takipsiz → hâlâ KIRMIZI.
  //    ②'nin yeşili "pathspec commit'te kapı susuyor" diye okunamasın diye ZORUNLU.
  mkdirSync(join(havuz, "Teks-Erp/prisma/migrations/20260404_unutulan"), { recursive: true });
  writeFileSync(join(havuz, "Teks-Erp/prisma/migrations/20260404_unutulan/migration.sql"), "SELECT 4;\n");
  writeFileSync(join(havuz, "benim2.txt"), "benim2\n");
  g(["add", "benim2.txt"]);
  g(["commit", "-qm", "kismi2", "--", "benim2.txt"]);
  const rapor3 = readFileSync(raporYolu, "utf8");
  check(
    "⭐ kontrol: pathspec commit + GERÇEK takipsiz → hâlâ KIRMIZI",
    /CIKIS=1/.test(rapor3) && rapor3.includes("GATE 1"),
  );

  // ④–⑥ COMMIT KAPISI KİPİ: takipsiz kapılar yalnız commit migration'a
  //     dokunuyorsa SERT. Ağaçta şu an GERÇEKTEN takipsiz bir migration var
  //     (20260404_unutulan) — üç kip aynı ağaç üstünde ölçülür, yani fark
  //     kipten gelir, ortamdan değil.
  const kipiKos = (argv: string[], staged: string) =>
    spawnSync("node", [join(havuz, "scripts/check-migrations.mjs"), ...argv], {
      cwd: havuz,
      encoding: "utf8",
      input: staged,
      env: GIT_ENV,
    });

  const r4 = kipiKos(["--commit-kapisi"], "docs/bir-belge.md\n");
  check(
    "⭐ commit kipi + commit migration'a DOKUNMUYOR → UYARI, çıkış 0",
    r4.status === 0 && `${r4.stdout}`.includes("GATE 1") && `${r4.stdout}`.includes("kapı geçti"),
    `çıkış=${r4.status}`,
  );
  check(
    "uyarı dosyayı ADIYLA söylüyor ve SAHİP UYDURMUYOR",
    /20260404_unutulan/.test(r4.stdout) && !/oturum|sahibi|kimin/i.test(r4.stdout),
  );

  const r5 = kipiKos(["--commit-kapisi"], `${MIGRATIONS_DIR}/20260505_benim/migration.sql\n`);
  check(
    "⭐ commit kipi + commit migration'a DOKUNUYOR → SERT, çıkış 1",
    r5.status === 1 && `${r5.stderr}`.includes("GATE 1"),
    `çıkış=${r5.status}`,
  );

  const r6 = kipiKos([], "");
  check(
    "⭐ BAYRAKSIZ çağrı (CI / npm test) sert davranışı KORUYOR",
    r6.status === 1 && `${r6.stderr}`.includes("GATE 1"),
    `çıkış=${r6.status}`,
  );
} finally {
  rmSync(havuz, { recursive: true, force: true });
}

// =============================================================================
// §2 — lint verdikti: commit'in kendi dosyası KIRMIZI, yabancı dosya UYARI
// =============================================================================
// Sentetik ESLint raporu: 1100 dosyalık gerçek koşum (~40 sn) bu üç dalı ölçmek
// için gerekmez. Taramayı eslint yapar, SINIFLANDIRMAYI biz — ölçülen bizimki.
console.log("\n§2 — lint verdikti commit'e daralıyor mu");

function degerlendirmeyiKos(staged: string[], rapor: unknown) {
  const kod =
    `const { degerlendir } = await import(${JSON.stringify(join(KOK, "scripts/hooks/lint-gate.mjs"))});\n` +
    `const s = degerlendir(${JSON.stringify(rapor)}, ${JSON.stringify(staged)}, "Teks-Erp", ${JSON.stringify(KOK)});\n` +
    `console.log(JSON.stringify({ kod: s.kod, satirlar: s.satirlar }));\n`;
  const r = spawnSync("node", ["--input-type=module", "-e", kod], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`degerlendir koşulamadı: ${r.stderr}`);
  return JSON.parse(r.stdout.trim()) as { kod: number; satirlar: string[] };
}

const HATA = { severity: 2, ruleId: "@typescript-eslint/no-explicit-any", message: "Unexpected any.", line: 1, column: 1 };
const benimDosya = join(KOK, "Teks-Erp/src/benim.ts");
const yabanciDosya = join(KOK, "Teks-Erp/src/yabanci.ts");
const rapor = [
  { filePath: benimDosya, messages: [HATA] },
  { filePath: yabanciDosya, messages: [HATA] },
];

const s1 = degerlendirmeyiKos(["Teks-Erp/src/benim.ts"], rapor);
check("⭐ commit'e GİREN dosyada hata → KIRMIZI (çıkış 1)", s1.kod === 1);
check(
  "kırmızı raporu dosyayı ADIYLA gösteriyor",
  s1.satirlar.some((x) => x.includes("Teks-Erp/src/benim.ts")),
);

const s2 = degerlendirmeyiKos(["Teks-Erp/package.json"], rapor);
check("⭐ yalnız YABANCI dosyada hata → UYARI + çıkış 0", s2.kod === 0);
check(
  "uyarı iki dosyayı da ADIYLA sayıyor",
  s2.satirlar.some((x) => x.includes("Teks-Erp/src/benim.ts")) &&
    s2.satirlar.some((x) => x.includes("Teks-Erp/src/yabanci.ts")),
);
check(
  "⭐ SAHİP UYDURULMUYOR (uyarıda kişi/oturum adı yok)",
  !/oturum|sahibi|kimin|teks-erp-[0-9a-z]/i.test(s2.satirlar.join("\n")),
);

const s3 = degerlendirmeyiKos(["Teks-Erp/src/benim.ts"], [{ filePath: benimDosya, messages: [] }]);
check("temiz rapor → YEŞİL", s3.kod === 0);

// UYARI severity'si (1) hata DEĞİLDİR: tavan onları sayar, kapı saymaz.
const s4 = degerlendirmeyiKos(
  ["Teks-Erp/src/benim.ts"],
  [{ filePath: benimDosya, messages: [{ ...HATA, severity: 1 }] }],
);
check("⭐ severity 1 (uyarı) kapıyı KIRMIZI yapmaz — o tavanın işi", s4.kod === 0);

// =============================================================================
// §2b — ARIZA ≠ İHLAL: `ruleId: null` iki sınıftır, yalnız `fatal` arızadır
// =============================================================================
// VAKA (2026-09-13): kullanılmayan bir `eslint-disable` yorumu (ESLint 9,
// reportUnusedDisableDirectives: "error" → { ruleId: null, severity: 2 }) tavanda
// "parse hatası / ARIZA (çıkış 2)" diye kapıyı HERKESE kapattı — verdikt (benim/
// yabancı) hiç sorulmadı. Gerçek parse çökmesi { ruleId: null, fatal: true } ise
// ARIZA kalmalı. İki şekil de gerçek eslint çıktısından alındı, uydurulmadı.
// Uçtan uca ölçülür: gerçek check-lint-baseline.mjs, sentetik `--rapor`, kapı kipi.
console.log("\n§2b — tavan: kullanılmayan eslint-disable İHLAL, fatal parse ARIZA");

const UNUSED = {
  ruleId: null,
  message: "Unused eslint-disable directive (no problems were reported from 'no-console').",
  line: 7,
  column: 1,
  severity: 2,
};
const FATAL = { ruleId: null, fatal: true, severity: 2, message: "Parsing error: Expression expected.", line: 3, column: 17 };
// Zemin (EN_AZ_DOSYA.backend = 900) kapsam sinyalidir; sentetik rapor onu boş dosyalarla aşar.
const dolgu = Array.from({ length: 905 }, (_, i) => ({ filePath: join(KOK, `Teks-Erp/src/dolgu_${i}.ts`), messages: [] }));
const sondaDosya = "Teks-Erp/src/zz_sonda_unused_directive.ts";

function tavaniKos(mesaj: Record<string, unknown>) {
  const dizin = mkdtempSync(join(tmpdir(), "tekserp-tavan-"));
  const raporYolu = join(dizin, "eslint.json");
  writeFileSync(raporYolu, JSON.stringify([...dolgu, { filePath: join(KOK, sondaDosya), messages: [mesaj] }]));
  try {
    return spawnSync(
      "node",
      ["scripts/check-lint-baseline.mjs", "--proje=backend", `--rapor=${raporYolu}`, "--commit-kapisi"],
      { cwd: KOK, encoding: "utf8", input: `${sondaDosya}\n`, timeout: 60_000 },
    );
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

const t1 = tavaniKos(UNUSED);
const t1Cikti = `${t1.stdout}\n${t1.stderr}`;
check("⭐ kullanılmayan eslint-disable → İHLAL (çıkış 1), ARIZA değil", t1.status === 1 && !/ARIZA|parse hatası/.test(t1Cikti), `çıkış=${t1.status}`);
check(
  "   ↳ rapor `dosya:satır` gösteriyor ve kuralı adlandırıyor",
  t1Cikti.includes(`${sondaDosya}:7`) && t1Cikti.includes("unused-disable-directive"),
);

const t2 = tavaniKos(FATAL);
const t2Cikti = `${t2.stdout}\n${t2.stderr}`;
check("⭐ fatal parse çökmesi → ARIZA (çıkış 2) KORUNUYOR", t2.status === 2 && /parse hatası/.test(t2Cikti), `çıkış=${t2.status}`);

// Aynı ayrım lint kapısının ETİKETİNDE: gereksiz yorum "parse" diye etiketlenmez.
const s5 = degerlendirmeyiKos(["Teks-Erp/src/benim.ts"], [{ filePath: benimDosya, messages: [UNUSED] }]);
check(
  "lint kapısı etiketi: unused-disable-directive (parse değil)",
  s5.kod === 1 && s5.satirlar.some((x) => x.includes("unused-disable-directive")) && !s5.satirlar.some((x) => /\bparse\b/.test(x)),
);
const s6 = degerlendirmeyiKos(["Teks-Erp/src/benim.ts"], [{ filePath: benimDosya, messages: [FATAL] }]);
check("lint kapısı etiketi: fatal → parse", s6.kod === 1 && s6.satirlar.some((x) => /\bparse\b/.test(x)));

// =============================================================================
// §3 — kablolama tripwire'ları (her biri BOZULMUŞ KOPYAYA karşı da ölçülür)
// =============================================================================
console.log("\n§3 — kablolama yerinde mi (ve tripwire gerçekten ısırıyor mu)");

function tripwire(ad: string, dosya: string, yuklem: (kaynak: string) => boolean, boz: (k: string) => string) {
  const kaynak = readFileSync(join(KOK, dosya), "utf8");
  check(ad, yuklem(kaynak));
  check(`   ↳ sonda: bozulmuş kopyada ısırıyor`, !yuklem(boz(kaynak)));
}

tripwire(
  "check-migrations.mjs GERÇEK indeksi zorluyor",
  "scripts/check-migrations.mjs",
  (k) => /GIT_INDEX_FILE/.test(k) && /--absolute-git-dir/.test(k) && /env:\s*GIT_ENV/.test(k),
  (k) => k.replace(/env:\s*GIT_ENV/g, "env: process.env"),
);

tripwire(
  "pre-commit lint adımı lint-gate.mjs'ten geçiyor",
  "scripts/hooks/pre-commit.mjs",
  (k) => /lint-gate\.mjs/.test(k),
  (k) => k.replace(/lint-gate\.mjs/g, "eslint"),
);

tripwire(
  "pre-commit staged listeyi lint kapısına stdin'den veriyor",
  "scripts/hooks/pre-commit.mjs",
  (k) => /stdin:\s*`\$\{staged\.join/.test(k) && /input:\s*adim\.stdin/.test(k),
  (k) => k.replace(/input:\s*adim\.stdin/g, "input: undefined"),
);

tripwire(
  "pre-commit migration kapısını `--commit-kapisi` + stdin ile çağırıyor",
  "scripts/hooks/pre-commit.mjs",
  (k) => /"--commit-kapisi"/.test(k) && /ad: "migration hijyeni"[\s\S]{0,260}?stdin:/.test(k),
  (k) => k.replace(/"--commit-kapisi"/g, '"--x"'),
);

tripwire(
  "pre-commit lint TAVANINI `--commit-kapisi` + stdin ile çağırıyor",
  "scripts/hooks/pre-commit.mjs",
  (k) => /check-lint-baseline\.mjs"[^\]]*"--commit-kapisi"/.test(k),
  (k) => k.replace(/"--commit-kapisi"/g, '"--x"'),
);

tripwire(
  "tavan verdikti 'DEĞDİ Mİ' değil 'ARTTI MI' soruyor (HEAD ile karşılaştırma)",
  "scripts/check-lint-baseline.mjs",
  (k) => /headSayim\(/.test(k) && /--stdin-filename/.test(k) && /> \(h\[a\.kural\] \?\? 0\)/.test(k),
  (k) => k.replace(/> \(h\[a\.kural\] \?\? 0\)/, ">= 0"),
);

tripwire(
  "tavan ve lint kapısı `ruleId: null`ı TEK helper'dan anahtarlıyor (kuralAnahtari) — parse ≠ unused directive",
  "scripts/check-lint-baseline.mjs",
  (k) => (k.match(/kuralAnahtari\(m\)/g) ?? []).length >= 2 && !/if \(!m\.ruleId\)/.test(k),
  (k) => k.replace(/kuralAnahtari\(m\)/g, "m.ruleId"),
);
tripwire(
  "   ↳ lint-gate etiketi de aynı helper'dan",
  "scripts/hooks/lint-gate.mjs",
  (k) => /kuralAnahtari\(m\) \?\? "parse"/.test(k),
  (k) => k.replace(/kuralAnahtari\(m\) \?\? "parse"/, 'm.ruleId ?? "parse"'),
);

tripwire(
  "tavan verdikti STAGED kümesine bakıyor ve kural→dosya atfını tutuyor",
  "scripts/check-lint-baseline.mjs",
  (k) => /kuralDosyalari/.test(k) && /asan\.filter\([\s\S]{0,120}STAGED\.has/.test(k),
  (k) => k.replace(/STAGED\.has\(f\)/g, "true"),
);

// ⚠️ CI KÖRLÜĞÜ SEDDİ: `--commit-kapisi` kapıyı yumuşatır ve CI'da hiçbir şey
// staged olmadığı için orada takipsiz kapılar yapısal olarak hep yumuşak olurdu.
// Bayrağın CI'ya sızmadığı AYRICA ölçülür — bayrağı yazmak yetmez, YERİ de kural.
const ciYml = readFileSync(join(KOK, ".github/workflows/ci.yml"), "utf8");
check("⭐ `--commit-kapisi` CI'ya SIZMAMIŞ", !ciYml.includes("--commit-kapisi"));
check(
  "   ↳ sonda: sızsaydı yakalanırdı",
  `${ciYml}\n  run: node scripts/check-migrations.mjs --commit-kapisi`.includes("--commit-kapisi"),
);

tripwire(
  "lint-gate CI'da koşmuyor (yalnız doğrudan çağrılınca main)",
  "scripts/hooks/lint-gate.mjs",
  (k) => /process\.argv\[1\]\s*===\s*fileURLToPath\(import\.meta\.url\)/.test(k),
  (k) => k.replace(/if \(process\.argv\[1\] === fileURLToPath\(import\.meta\.url\)\) main\(\);/, "main();"),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
