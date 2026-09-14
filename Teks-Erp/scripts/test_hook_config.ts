// =============================================================================
// BEKÇİ — KANCA YAPILANDIRMASI GERÇEKTEN ÇÖZÜLÜYOR MU
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts hook_config
//
// ⭐ NEDEN VAR (2026-09-13): `.claude/settings.json` komut kapısını GÖRELİ YOLLA
//    çağırıyordu (`node scripts/claude-hooks/bash-guard.mjs`). Kabuğun çalışma
//    dizini alt projeye kaydığı her an düğüm dosyayı bulamıyor ve Claude Code
//    hatayı **NON-BLOCKING** sayıyor: komut çalışıyor, KAPI SESSİZCE YOK SAYILIYOR.
//
//    ÖLÇÜM (36 oturum günlüğü, 150.712 satır, toolUseID ile KESİN eşleme):
//      · 4.962 ölü-kapı olayı
//      · kapının arandığı 24 AYRI yanlış dizin (Teks-Erp/ 4.134 · Electron/ 609 ·
//        mobil/ 54 · docs/design/ 38 · …) — yani kapı YALNIZ kök dizinde canlı
//      · o 4.962 komutun 27'si bir yasağa uyuyordu: 23'ü desenin YANLIŞ POZİTİFİ
//        (CSS sınıfı `truncate`, grep deseni, yorum metni, echo etiketi), 4'ü
//        GERÇEK veritabanı düşürme — dördü de çağıran oturumun KENDİ sonda
//        veritabanını düşürüp yeniden yaratması. Fabrika/canlı veri kaybı ÖLÇÜLMEDİ.
//
// ⚠️ KAPI ÖLÜM SINIFININ YENİSİ: şimdiye kadar saydıklarımızda (sahte kırmızı ·
//    yavaşlık · gürültü · erken sertlik · doğru davranışı pahalı kılmak) kapı
//    KOŞUYORDU. Bu farklı: kapı, koruduğu şeyle ilgisiz bir sebeple (kabuğun
//    dizini) ölebilir ve ölümünün tek izi kimsenin okumadığı bir "non-blocking"
//    satırıdır. ⇒ YAPILANDIRILMIŞ BİR KAPI DA BİR KAPI DEĞİLDİR; KOŞTUĞU
//    ÖLÇÜLMEDİKÇE.
//
// ⚠️ FAIL-OPEN YAPILANDIRMAYLA KAPATILAMAZ: Claude Code'da yalnız ÇIKIŞ 2 engeller;
//    başlatılamayan bir kanca her zaman non-blocking sayılır ve bunu değiştiren bir
//    ayar YOKTUR (resmî belge). Dolayısıyla tek kalıcı koruma budur: yapılandırmanın
//    DOĞRU olduğunu ölçmek. Bu bekçi kapının kendisi değil, KAPININ VARLIĞININ
//    bekçisidir.
//
// ⚠️ BU DOSYA `.claude/settings.json`'ı DEĞİŞTİRMEZ, yalnız OKUR. Ayar dosyası
//    kullanıcının denetim yüzeyidir; düzeltmeyi kullanıcı uygular, bekçi bozulduğunu
//    söyler.
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";

const KOK = join(__dirname, "..", "..");
const AYAR_YOLU = join(KOK, ".claude", "settings.json");

let pass = 0;
let fail = 0;
let skip = 0; // ⏭ beyanla atlanan kontrol — özet satırında sayılır (bekçi sözleşmesi)
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

type Kanca = { type?: string; command?: string; args?: string[] };
type Ayar = { hooks?: Record<string, Array<{ hooks?: Kanca[] }>> };

/** Komut metninden yerel script yolunu çıkarır (`node <yol> …` kalıbı). */
function scriptYolu(cmd: string): string | null {
  // ⚠️ TEK TOKEN TIRNAKLI PARÇA İÇEREBİLİR: `node "${CLAUDE_PROJECT_DIR}"/scripts/x.mjs`
  // tek bir yoldur. İlk yazımda yüklem tırnağın kapanışında duruyordu ve yolun
  // yarısını döndürüyordu — §3e sondası bunu yakaladı (sonda kendi yazarını ısırdı).
  const m = cmd.match(/\b(?:node|npx\s+tsx|tsx)\s+((?:"[^"]*"|'[^']*'|\S)+)/);
  if (!m) return null;
  return m[1].trim() || null;
}

/**
 * Yol KABUĞUN DİZİNİNDEN BAĞIMSIZ mı?
 * Kabul: mutlak yol ya da `${CLAUDE_PROJECT_DIR}` ile çapalanmış yol.
 * (`${CLAUDE_PROJECT_DIR}` Claude Code'un kendi genişlettiği bir yer tutucudur.)
 */
function dizindenBagimsiz(yol: string): boolean {
  return isAbsolute(yol) || /\$\{?CLAUDE_PROJECT_DIR\}?/.test(yol);
}

/** Yer tutucuyu depo köküne çözerek dosyanın gerçekten var olup olmadığına bakar. */
function dosyaVar(yol: string): boolean {
  const cozulmus = yol.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, KOK).replace(/"/g, "");
  return existsSync(isAbsolute(cozulmus) ? cozulmus : join(KOK, cozulmus));
}

function kancalariTopla(ayar: Ayar): Array<{ olay: string; cmd: string }> {
  const out: Array<{ olay: string; cmd: string }> = [];
  for (const [olay, gruplar] of Object.entries(ayar.hooks ?? {})) {
    for (const g of gruplar ?? []) {
      for (const h of g.hooks ?? []) {
        const cmd = [h.command, ...(h.args ?? [])].filter(Boolean).join(" ");
        if (h.type === "command" && cmd) out.push({ olay, cmd });
      }
    }
  }
  return out;
}

function main(): void {
  console.log("=== Kanca yapılandırması bekçisi ===\n");

  check("§0a körlük zemini: settings.json bulundu", existsSync(AYAR_YOLU), AYAR_YOLU.replace(KOK, "."));
  if (!existsSync(AYAR_YOLU)) {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  const ayar = JSON.parse(readFileSync(AYAR_YOLU, "utf8")) as Ayar;
  const kancalar = kancalariTopla(ayar);
  // Zemin: kanca listesi boşsa aşağıdaki her kontrol VAKUMEN yeşil olur.
  check("§0b körlük zemini: en az bir komut kancası tanımlı", kancalar.length > 0, `${kancalar.length} kanca`);

  console.log("\n§1 — her kancanın script'i GERÇEKTEN var mı");
  for (const k of kancalar) {
    const yol = scriptYolu(k.cmd);
    if (!yol) {
      check(`§1 ${k.olay}: yol çıkarılabildi`, false, k.cmd.slice(0, 70));
      continue;
    }
    check(`§1 ${k.olay} → ${yol}`, dosyaVar(yol), dosyaVar(yol) ? "dosya var" : "DOSYA YOK");
  }

  console.log("\n§2 — yol KABUĞUN DİZİNİNDEN bağımsız mı (ölü-kapı sınıfı)");
  for (const k of kancalar) {
    const yol = scriptYolu(k.cmd);
    if (!yol) continue;
    const ok = dizindenBagimsiz(yol);
    check(
      `§2 ${k.olay} → dizinden bağımsız`,
      ok,
      ok ? "mutlak / ${CLAUDE_PROJECT_DIR}" : `GÖRELİ ('${yol}') — kabuk kökten çıkınca kanca SESSİZCE ölür`,
    );
    // ⚠️ KIRMIZI, DÜZELTMEYİ BASAR. Haklı olup ne istediğini söylemeyen bir kapı,
    // "doğru davranışı pahalı kılmak" ölüm sınıfının kardeşidir: kırmızıyı gören
    // kişi "ne yapmalıyım" sorusunu sormak zorunda kalmamalı.
    if (!ok) {
      const duzeltilmis = k.cmd.replace(yol, `"$\{CLAUDE_PROJECT_DIR}"/${yol.replace(/^\.\//, "")}`);
      console.error(
        `      → DÜZELT (.claude/settings.json, tek satır):\n` +
          `        "command": ${JSON.stringify(duzeltilmis)}\n` +
          `      ⚠️ Bu dosya KULLANICININ denetim yüzeyidir; düzeltmeyi kullanıcı uygular.\n` +
          `        \${CLAUDE_PROJECT_DIR} Claude Code'un kendi genişlettiği yer tutucudur.`,
      );
    }
  }

  console.log("\n§3 — sondalar: yüklemler gerçekten ısırıyor mu");
  check("§3a ⭐ olmayan bir yol DOSYA YOK verir", !dosyaVar("scripts/claude-hooks/yok-boyle-bir-dosya.mjs"));
  check("§3b ⭐ göreli yol 'bağımsız' SAYILMAZ", !dizindenBagimsiz("scripts/claude-hooks/bash-guard.mjs"));
  check("§3c mutlak yol bağımsız SAYILIR", dizindenBagimsiz("/tmp/x.mjs"));
  check("§3d ${CLAUDE_PROJECT_DIR} çapası bağımsız SAYILIR", dizindenBagimsiz('"${CLAUDE_PROJECT_DIR}"/scripts/x.mjs'));
  check(
    "§3e ⭐ yol çıkarıcı gerçek kalıbı tanıyor",
    scriptYolu('node "${CLAUDE_PROJECT_DIR}"/scripts/claude-hooks/bash-guard.mjs') ===
      '"${CLAUDE_PROJECT_DIR}"/scripts/claude-hooks/bash-guard.mjs',
  );

  // ── §4 ORTAK .git/config TEMİZ Mİ (tripwire, 2026-09-13) ─────────────────
  // Hook'a alınan bir bekçi git'in GIT_DIR'ını miras alıp `git init/config`i
  // GERÇEK repoya koştu: ortak config'e `core.bare=true` (ana ağaçta `git reset`
  // "bare repository" ile düştü) ve `user.name=bekci` yazıldı — bir origin commit'i
  // o kimlikle doğdu. `.git/config` TÜM worktree'lerin ortak dosyasıdır; ona yazan
  // her şey buradan görülsün. Yerel config'in DOĞRU hâli: bare=false · worktree
  // anahtarı yok · kimlik yerelde YOK (global'den gelir). Sonda: `--file` ile
  // bozuk bir kopya (TEKSERP_GIT_CONFIG_SONDA) — gerçek config'e dokunulmaz.
  const gitConfig = (anahtar: string): string | null => {
    const dosya = process.env.TEKSERP_GIT_CONFIG_SONDA;
    const r = spawnSync("git", dosya ? ["config", "--file", dosya, "--get", anahtar] : ["config", "--local", "--get", anahtar], {
      cwd: KOK,
      encoding: "utf8",
    });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const bare = gitConfig("core.bare");
  check("§4a ⭐ ortak config: core.bare=false", bare === "false", `core.bare=${bare ?? "(yok)"}`);
  check("§4b ⭐ ortak config: core.worktree YOK", gitConfig("core.worktree") === null, gitConfig("core.worktree") ?? "yok");
  const yerelKimlik = [gitConfig("user.name"), gitConfig("user.email")].filter((v) => v !== null);
  check("§4c ⭐ ortak config: user.name/email YEREL değil (global'den gelir)", yerelKimlik.length === 0, yerelKimlik.length ? `yerelde: ${yerelKimlik.join(" / ")}` : "temiz");

  // ── §5 KAPI DEFTERİ (1e hükmü 2026-09-14) ───────────────────────────────────
  // Satır biçimi tek kontrol; asıl sonda: defter YAZILAMIYORKEN kapı düşmez ve
  // uyarı basmaz. Kapının çıkış kodu adımlardan gelir; defter yalnız izdir —
  // izin kapıyı değiştirebilmesinin tek yolu bir istisnanın sızmasıdır, o ölçülür.
  console.log("\n§5 — kapı defteri: biçim + best-effort");
  const defterKos = (env: Record<string, string>, kod: string) =>
    spawnSync("node", ["--input-type=module", "-e", kod], { encoding: "utf8", env: { ...process.env, ...env }, cwd: KOK });
  const defterMod = JSON.stringify(join(KOK, "scripts/hooks/lib/kapi-defteri.mjs"));
  const r5a = defterKos(
    {},
    `const { defterSatiri } = await import(${defterMod});\n` +
      `process.stdout.write(defterSatiri({ wt: "/tam/yol/wt-0c", adim: "hızlı\\tmandallar", sonuc: "❌", sn: "10.53", cikis: 1 }));`,
  );
  const satir = r5a.stdout;
  const kolonlar = satir.replace(/\n$/, "").split("\t");
  check(
    "§5a ⭐ defter satırı biçimi: zaman · wt · adım · ✅/❌/⏭ · sn · çıkış · load1 (7 kolon, tek satır, wt'de yol yok)",
    r5a.status === 0 &&
      kolonlar.length === 7 &&
      /^\d+\.\d$/.test(kolonlar[6]) &&
      /^\d{4}-\d{2}-\d{2}T/.test(kolonlar[0]) &&
      !kolonlar[1].includes("/") &&
      kolonlar[1].endsWith("wt-0c") &&
      kolonlar[2] === "hızlı mandallar" &&
      kolonlar[3] === "❌" &&
      kolonlar[4] === "10.5" &&
      kolonlar[5] === "1" &&
      satir.endsWith("\n") &&
      satir.split("\n").length === 2,
    JSON.stringify(satir),
  );

  // ⏭ kolu — sahada henüz gözlenmedi (336 satırın hepsi izole ağaçtan, d9 ölçtü
  // 2026-09-14); satır biçimi yalnız ❌ ile sondalanmıştı. Glif her üç kolda ölçülür.
  const r5aTik = defterKos(
    {},
    `const { defterSatiri } = await import(${defterMod});\n` +
      `process.stdout.write(defterSatiri({ wt: "wt-x", adim: "hızlı mandallar · ⏭ ortak ağaçta atlandı", sonuc: "⏭", sn: 0, cikis: 0 }));`,
  );
  const k5aTik = r5aTik.stdout.replace(/\n$/, "").split("\t");
  check("§5a′ ⭐ ⏭ (beyanla atlandı) satırı da biçime uyuyor", r5aTik.status === 0 && k5aTik.length === 7 && k5aTik[3] === "⏭", JSON.stringify(r5aTik.stdout));

  // TANIMSIZ GLİF: sessiz "?" DEĞİL — satır yazılmaz, stderr'e tek satır, çıkış 0.
  // (Glif ya da beyan öneki yeniden adlandırılırsa defter sessizce "?"le dolmasın.)
  const glifDizin = mkdtempSync(join(tmpdir(), "tekserp-defter-glif-"));
  const glifDefter = join(glifDizin, "defter.tsv");
  const r5e = defterKos(
    { TEKSERP_KAPI_DEFTERI: glifDefter },
    `const { deftereYaz } = await import(${defterMod});\n` +
      `const ok = deftereYaz({ wt: "x", adim: "y", sonuc: "✔", sn: 1, cikis: 0 });\n` +
      `process.stdout.write(JSON.stringify(ok));`,
  );
  const glifYazildi = existsSync(glifDefter);
  rmSync(glifDizin, { recursive: true, force: true });
  check(
    "§5e ⭐ tanımsız glif: satır YAZILMAZ + stderr'e TEK satır + çıkış 0 (kapı düşmez)",
    r5e.status === 0 && r5e.stdout === "false" && !glifYazildi && r5e.stderr.trim().split("\n").length === 1 && /tanımsız sonuç glifi/.test(r5e.stderr),
    `çıkış=${r5e.status} stdout=${r5e.stdout} dosya=${glifYazildi} stderr=${JSON.stringify(r5e.stderr).slice(0, 100)}`,
  );

  // Yazılamayan hedef: DİZİN (EISDIR) — appendFileSync fırlatır. Beklenen: dönüş false,
  // istisna yok, stderr boş. Sonda hedefi sahte (kendi tmp'i), gerçek defter yok sayılır.
  const r5b = defterKos(
    { TEKSERP_KAPI_DEFTERI: KOK },
    `const { deftereYaz } = await import(${defterMod});\n` +
      `const ok = deftereYaz({ wt: "x", adim: "y", sonuc: "✅", sn: 1, cikis: 0 });\n` +
      `process.stdout.write(JSON.stringify(ok));`,
  );
  check(
    "§5b ⭐ defter yazılamıyorsa: istisna YOK, stderr BOŞ, çıkış 0 (kapı düşmez)",
    r5b.status === 0 && r5b.stdout === "false" && r5b.stderr === "",
    `çıkış=${r5b.status} stdout=${r5b.stdout} stderr=${JSON.stringify(r5b.stderr).slice(0, 80)}`,
  );

  // Kablolama: pre-commit defteri YALNIZ deftereYaz ile yazar (doğrudan appendFileSync
  // yok → yutulmayan istisna yolu yok) ve semafor bekleme satırı düşülüyor.
  const preCommit = readFileSync(join(KOK, "scripts/hooks/pre-commit.mjs"), "utf8");
  const defterKaynak = readFileSync(join(KOK, "scripts/hooks/lib/kapi-defteri.mjs"), "utf8");
  check(
    "§5c pre-commit deftere yalnız deftereYaz ile yazıyor, semafor beklemesini (makinedeki ağır süreç sayısıyla) de düşüyor",
    (preCommit.match(/deftereYaz\(/g) ?? []).length >= 4 && !/appendFileSync/.test(preCommit) && /adim: `semafor bekleme · ağır \$\{agirSurecSayisi\(\)\}`/.test(preCommit),
  );
  const tryIcinde = (k: string) => /try \{\s*appendFileSync\([\s\S]*?\} catch \{/.test(k);
  check("§5d kapi-defteri.mjs appendFileSync'i try/catch içinde tutuyor", tryIcinde(defterKaynak));
  check("   ↳ sonda: try sökülmüş kopyada ısırıyor", !tryIcinde(defterKaynak.replace("try {", "{")));

  // ── §6 ELECTRON VITEST ZAMAN AŞIMI KİPE BAĞLI (1e hükmü 2026-09-14) ──────────
  // Kapı kipinde 20 sn (yük altında CPU açlığı 5 sn'yi aşıyordu: load ≈ 25'te 3 test,
  // tek başına 21 sn), bayraksız 5 sn (CI, elle koşum).
  //
  // ⚠️ ÜÇ SONUÇ (hotfix 2026-09-14, CI iki tur kırmızı — d9 mekanizmayı yeniden üretti):
  //    config'i GERÇEKTEN yüklemek Electron'un bağımlılıklarını ister (vitest/config,
  //    @vitejs/plugin-react). CI'ın Backend job'ı `npm ci`yi yalnız Teks-Erp'te koşar ⇒
  //    `Electron/node_modules` YOK ⇒ yükleme oradan ölçülemez. Bekçi başka paketin
  //    kurulumuna bağlıydı ve bunu beyan etmiyordu (araç ortamın içinde, gözlenenin
  //    dışında). Şimdi: bağımlılık VARSA gerçek yükleme (§6a/§6b) · YOKSA ⏭ "yükleme
  //    ÖLÇÜLEMEDİ" beyanı — ve METİN ölçümü (§6d) HER İKİ dalda koşar: ifade dosyada
  //    yoksa ❌. Sessiz yeşil değil, beyanlı; asıl yükleme sondası Electron job'ında
  //    (Electron/src/test/vitest-timeout-mode.test.ts, aynı hüküm).
  console.log("\n§6 — Electron vitest zaman aşımı kipe bağlı mı");
  const vitestConfigKaynak = readFileSync(join(KOK, "Electron/vitest.config.ts"), "utf8");
  const kipIfadesi = (k: string) =>
    /const KAPI_KIPI = process\.env\.TEKSERP_KAPI_ADIMI === "commit"/.test(k) && /testTimeout: KAPI_KIPI \? 20_000 : 5_000/.test(k);
  check("§6d ⭐ vitest.config.ts kip ifadesini taşıyor (KAPI_KIPI ? 20_000 : 5_000) — metin ölçümü, her ortamda", kipIfadesi(vitestConfigKaynak));
  check("   ↳ sonda: ifade bozulmuş kopyada ısırıyor", !kipIfadesi(vitestConfigKaynak.replace("? 20_000 : 5_000", "? 5_000 : 5_000")));

  // Sonda anahtarı TEKSERP_SONDA_ELECTRON_BAGIMLILIK_YOK=1: CI'ın Backend job'ını yerelde taklit eder.
  const electronBagimlilik =
    process.env.TEKSERP_SONDA_ELECTRON_BAGIMLILIK_YOK !== "1" &&
    existsSync(join(KOK, "Electron/node_modules/vitest")) &&
    existsSync(join(KOK, "Electron/node_modules/@vitejs/plugin-react"));
  if (!electronBagimlilik) {
    skip++;
    console.log("   ⏭ §6a/§6b yükleme ÖLÇÜLEMEDİ — Electron/node_modules (vitest · @vitejs/plugin-react) kurulu değil; metin ölçümü (§6d) ayakta, yükleme sondası Electron job'ında");
  } else {
    const configOku = (env: Record<string, string | undefined>) => {
      const ortam = { ...process.env, ...env };
      if (env.TEKSERP_KAPI_ADIMI === undefined) delete ortam.TEKSERP_KAPI_ADIMI;
      const r = spawnSync(
        join(KOK, "Teks-Erp/node_modules/.bin/tsx"),
        ["--eval", 'import c from "./vitest.config.ts"; process.stdout.write(String(c.test?.testTimeout))'],
        { cwd: join(KOK, "Electron"), encoding: "utf8", env: ortam, timeout: 60_000 },
      );
      return r.status === 0 ? r.stdout.trim() : `HATA(${r.status}): ${r.stderr.slice(0, 120)}`;
    };
    const kapiKipi = configOku({ TEKSERP_KAPI_ADIMI: "commit" });
    const bayraksiz = configOku({ TEKSERP_KAPI_ADIMI: undefined });
    check("§6a ⭐ kapı kipinde (TEKSERP_KAPI_ADIMI=commit) testTimeout 20000 (gerçek yükleme)", kapiKipi === "20000", kapiKipi);
    check("§6b ⭐ bayraksız (CI / elle) testTimeout 5000 (gerçek yükleme)", bayraksiz === "5000", bayraksiz);
  }
  // Kip her adıma pre-commit'ten iner; yalnız mandallara verilirse vitest 5 sn'de kalır.
  check(
    "§6c pre-commit kapı kipini BÜTÜN adımlara ilan ediyor (process.env.TEKSERP_KAPI_ADIMI = \"commit\")",
    /process\.env\.TEKSERP_KAPI_ADIMI = "commit"/.test(preCommit),
  );

  // ── §7 ADIM SIRASI: ucuz KAYIT adımları önce, ağırlar sonra (1e hükmü 2026-09-14) ──
  // Defter ölçümü: ilk 336 satırın 5 ❌'i de kayıt sınıfı ve tip+lint'ten SONRA düştü —
  // iki `identity_ledger` ısırığında 144 ve 165 sn boşa gitti. Sıralama kararlı olmalı:
  // lint tavanı lint'in raporunu okur, lint'in hemen ardında kalır.
  console.log("\n§7 — adım sırası: ucuz kayıt adımları önce, ağırlar sonra (kararlı)");
  const siraMod = JSON.stringify(join(KOK, "scripts/hooks/lib/adim-sirasi.mjs"));
  const r7 = defterKos(
    {},
    `const { sirala } = await import(${siraMod});\n` +
      `const a = [{ ad: "tip", agir: true }, { ad: "lint", agir: true }, { ad: "lint tavanı", agir: true }, { ad: "test", agir: true }, { ad: "migration hijyeni" }, { ad: "hızlı mandallar" }, { ad: "kapının kendisi" }, { ad: "doküman kapısı" }];\n` +
      `process.stdout.write(sirala(a).map((x) => x.ad).join("|"));`,
  );
  check(
    "§7a ⭐ ucuzlar başa, ağırlar sona; grup içi sıra korunur (lint → lint tavanı bitişik)",
    r7.stdout === "migration hijyeni|hızlı mandallar|kapının kendisi|doküman kapısı|tip|lint|lint tavanı|test",
    r7.stdout || r7.stderr.slice(0, 120),
  );
  const agirSayisi = (preCommit.match(/agir: true/g) ?? []).length;
  check(
    "§7b pre-commit dört ağır adımı (tip · lint · tavan · test) `agir: true` ile işaretliyor ve `sirala(` üzerinden koşuyor",
    agirSayisi === 4 && /const sirali = sirala\(adimlar\)/.test(preCommit) && /for \(const adim of sirali\)/.test(preCommit),
    `agir işareti ${agirSayisi}`,
  );
  check(
    "§7c semafor slotu İLK AĞIR ADIMDAN önce alınıyor (ucuz adımlar slot tutmaz, kayıt ısırığında slot alınmaz)",
    /if \(adim\.agir && !slotBirak\) slotAlVeYaz\(\);/.test(preCommit) && !/const slotBirak = agirVar/.test(preCommit),
  );

  // ── §8 PRISMA İSTEMCİSİ GÜNCEL Mİ (1e hükmü 2026-09-14) ─────────────────────
  // Rebase şemayı taşır, üretileni taşımaz; tip kapısı sebebi söylemeden kırmızı verir.
  // Üç sonuç: GÜNCEL 0 · BAYAT/İSTEMCİ YOK 1 (çare basılır) · ŞEMA OKUNAMADI 2 (ARIZA).
  // Sonda sahte hedefte: geçici şema + kopya; gerçek istemciye dokunulmaz.
  console.log("\n§8 — prisma istemcisi şemayla güncel mi (tip kapısından ÖNCE, çaresiyle)");
  const pi = join(KOK, "scripts/hooks/lib/prisma-istemci.mjs");
  const piDizin = mkdtempSync(join(tmpdir(), "tekserp-prisma-istemci-"));
  const sema = join(piDizin, "schema.prisma");
  const kopya = join(piDizin, "kopya.prisma");
  const govde = 'enum StationKind {\n  RAW_QC\n  TAMBUR\n}\nmodel Roll {\n  id String @id\n  @@unique([id])\n}\n';
  // Prisma kopyayı yeniden biçimler ve blok özniteliklerini sıralar — kopya farklı hizalı/sıralı ama AYNI küme.
  writeFileSync(sema, govde);
  writeFileSync(kopya, '// üretildi\nenum StationKind {\n    RAW_QC\n    TAMBUR\n}\nmodel Roll {\n  @@unique([id])\n  id    String   @id\n}\n');
  const piKos = (args: string[]) => spawnSync("node", [pi, ...args], { encoding: "utf8", cwd: KOK });
  const r8a = piKos([`--sema=${sema}`, `--istemci=${kopya}`]);
  check("§8a ⭐ biçim/sıra farkı BAYAT DEĞİL (Prisma kopyayı yeniden biçimler) → çıkış 0", r8a.status === 0, `çıkış=${r8a.status} ${r8a.stderr.trim().slice(0, 80)}`);
  writeFileSync(sema, govde.replace("  TAMBUR\n", "  TAMBUR\n  WEAVING\n"));
  const r8b = piKos([`--sema=${sema}`, `--istemci=${kopya}`]);
  check("§8b ⭐ şemaya enum değeri eklendi, generate koşmadı → çıkış 1 + çare 'prisma generate'", r8b.status === 1 && /prisma generate/.test(r8b.stderr), `çıkış=${r8b.status}`);
  const r8c = piKos([`--sema=${sema}`, `--istemci=${join(piDizin, "yok.prisma")}`]);
  check("§8c istemci hiç üretilmemiş → çıkış 1 + çare", r8c.status === 1 && /prisma generate/.test(r8c.stderr), `çıkış=${r8c.status}`);
  const r8d = piKos([`--sema=${join(piDizin, "yok-sema.prisma")}`, `--istemci=${kopya}`]);
  check("§8d şema okunamadı → ARIZA çıkış 2 (ihlal değil)", r8d.status === 2 && /ARIZA/.test(r8d.stderr), `çıkış=${r8d.status}`);
  rmSync(piDizin, { recursive: true, force: true });
  check(
    "§8e pre-commit adımı Teks-Erp etkilenince ekliyor ve ağır işaretli DEĞİL (tip'ten önce koşar)",
    /ad: "prisma istemcisi güncel", cwd: "\.", cmd: \["node", \["scripts\/hooks\/lib\/prisma-istemci\.mjs"\]\] \}/.test(preCommit) && !/prisma istemcisi güncel"[^\n]*agir: true/.test(preCommit),
  );

  // ── §9 SEMAFOR KAPASİTESİ (1e hükmü 2026-09-14): 4 — defterden ölçüldü (108 alım/26 bekleme/
  //    max 268 sn); sabit tek yerde yaşar ve BURADA sondalanır ki sessizce oynamasın.
  //    Yeniden ölçüm 2026-09-21; hüküm değişirse bu sayı ve semafor.mjs başlığı birlikte değişir.
  console.log("\n§9 — semafor kapasitesi hükümle aynı mı");
  const r9 = defterKos({}, `const m = await import(${JSON.stringify(join(KOK, "scripts/hooks/lib/semafor.mjs"))}); process.stdout.write(String(m.KAPASITE));`);
  check("§9 ⭐ KAPASITE = 4 (1e hükmü 2026-09-14; yeniden ölçüm 2026-09-21)", r9.status === 0 && r9.stdout.trim() === "4", `KAPASITE=${r9.stdout.trim() || r9.stderr.slice(0, 60)}`);

  // ── §10 TEST DB'Sİ ŞEMANIN GERİSİNDE Mİ (1e hükmü 2026-09-14): kapı DURMAZ, ⏭ ile söyler ─
  //    Sınıflandırıcı GERÇEK `migrate status` çıktı örnekleriyle ölçülür (uydurma değil: wt-d5'te
  //    üç durum koşuldu 2026-09-14); fabrika yedeği adı status'a hiç bağlanmaz.
  console.log("\n§10 — test DB'si şeması: üç sonuç + fabrika yedeği kapısı, kapı durmaz");
  const tds = JSON.stringify(join(KOK, "scripts/hooks/lib/test-db-semasi.mjs"));
  const r10 = defterKos(
    {},
    `const m = await import(${tds});\n` +
      `const g = m.siniflandir("Loaded Prisma config from prisma.config.ts.\\n295 migrations found in prisma/migrations\\nDatabase schema is up to date!");\n` +
      `const b = m.siniflandir("295 migrations found\\nFollowing migrations have not yet been applied:\\n20260914120300_yarn_movement_kind_warp_return_reversal\\n20260914120400_reason_preset_kind_warp_return\\n\\nTo apply migrations in development run prisma migrate dev.");\n` +
      `const y = m.siniflandir("Error: P1001: Can't reach database server at \`127.0.0.1:1\`");\n` +
      `const a = m.siniflandir("something entirely else");\n` +
      `process.stdout.write(JSON.stringify([g, b, y, a, m.dbAdi("postgresql://u:p@h:5432/" + m.FABRIKA_YEDEGI + "?schema=public"), m.FABRIKA_YEDEGI]));`,
  );
  let s10: unknown[] = [];
  try { s10 = JSON.parse(r10.stdout) as unknown[]; } catch { /* aşağıda kırmızı */ }
  const [g10, b10, y10, a10, ad10, fab10] = s10 as [{ durum: string }, { durum: string; n: number }, { durum: string }, { durum: string }, string, string];
  check("§10a ⭐ sınıflandırıcı: güncel → GUNCEL · geride → GERIDE n=2 · P1001 → OLCULEMEDI · başka → ARIZA (gerçek çıktı örnekleri)",
    g10?.durum === "GUNCEL" && b10?.durum === "GERIDE" && b10?.n === 2 && y10?.durum === "OLCULEMEDI" && a10?.durum === "ARIZA",
    r10.status === 0 ? JSON.stringify(s10).slice(0, 120) : r10.stderr.slice(0, 120));
  // Fabrika DB adı BURAYA YAZILMAZ (kimlik sızıntısı mandalı): sabit yalnız modülde yaşar, test onu okur.
  check("§10b ⭐ fabrika yedeği adı URL'den çözülüyor ve sabit tek yerde (modül)", typeof fab10 === "string" && fab10.length > 0 && ad10 === fab10);
  // Uçtan uca: fabrika yedeği URL'i → status HİÇ koşmaz (hızlı, ⏭ metni), DB yok → ⏭, ikisi de çıkış 0.
  const t10 = Date.now();
  const rFab = spawnSync("node", [join(KOK, "scripts/hooks/lib/test-db-semasi.mjs"), `--url=postgresql://u:p@127.0.0.1:1/${fab10}?schema=public`], { encoding: "utf8", cwd: KOK, timeout: 30_000 });
  const fabMs = Date.now() - t10;
  check("§10c ⭐ fabrika yedeği hedefinde status BİLE koşmaz (⏭ FABRİKA YEDEĞİ, <2 sn, çıkış 0)", rFab.status === 0 && /FABRİKA YEDEĞİ/.test(rFab.stdout) && fabMs < 2000, `${fabMs} ms`);
  const rYok = spawnSync("node", [join(KOK, "scripts/hooks/lib/test-db-semasi.mjs"), "--url=postgresql://m:m@127.0.0.1:1/x"], { encoding: "utf8", cwd: KOK, timeout: 60_000 });
  check("§10d ⭐ DB yok → ⏭ ÖLÇÜLEMEDİ, çıkış 0 (kapı durmaz)", rYok.status === 0 && /ÖLÇÜLEMEDİ/.test(rYok.stdout), `çıkış=${rYok.status}`);
  check("§10e pre-commit adımı 'prisma istemcisi güncel'in ardında, ağır değil",
    /ad: "prisma istemcisi güncel"[\s\S]{0,400}ad: "test DB'si şeması", cwd: "\.", cmd: \["node", \["scripts\/hooks\/lib\/test-db-semasi\.mjs"\]\] \}/.test(preCommit) && !/test DB'si şeması"[^\n]*agir: true/.test(preCommit));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${skip > 0 ? `, ${skip} atlandı` : ""} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
