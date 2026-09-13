#!/usr/bin/env node
// =============================================================================
// GIT PRE-COMMIT KAPISI — zero-dep (husky/lefthook YOK, paket eklemedik).
// =============================================================================
// NEDEN VAR (2026-09-05 ölçümü): yerelde hiçbir git hook'u yoktu. Tip kontrolü
// yalnız Claude'un Bash aracındaki PreToolUse hook'unda koşuyordu, yani KİMSE
// elle commit attığında koşmuyordu — ve main'de 9 tip hatası + 7 kırmızı test
// bir gün boyunca durdu. CI de yakalamadı çünkü Electron tip adımı no-op'tu.
//
// ÖLÇÜM (2026-09-05): tek proje değiştiğinde 30-50 sn; ÜÇ proje birden
// değiştiğinde 13 adım / 142 sn. Bedel değişenle orantılıdır, commit'in kendisiyle değil.
//
// KADANS (docs/standart/TEST-VE-DERLEME.md): commit anında UCUZ ve DEĞİŞENE
// ORANTILI kapılar koşar — değişen alt projede tip + lint + lint tavanı, ve o
// projenin HIZLI test paketi (Electron 23sn / mobil 29sn). Backend bekçi paketi
// (6,5 dk) commit kadansında DEĞİLDİR; o PR/push öncesidir.
//
// Kaçış: `TEKSERP_HOOK_SKIP=1 git commit …` ya da `git commit --no-verify`.
// Kaçış bir KARARDIR: kırmızıyı bilerek geçiyorsan commit mesajında söyle.
//
// Kurulum: node scripts/hooks-kur.mjs   (git config core.hooksPath .githooks)
// =============================================================================

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deftereYaz } from "./lib/kapi-defteri.mjs";
import { etkilenenProjeler, stagedFiles } from "./lib/staged.mjs";
import { slotAl } from "./lib/semafor.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Kapı defteri: wt BASENAME'i (wt-0c · Teks-Erp), tam yol ve kimlik yok — lib/kapi-defteri.mjs.
const WT = basename(REPO);

if (process.env.TEKSERP_HOOK_SKIP === "1") {
  process.stderr.write("⚠️  commit kapısı ATLANDI (TEKSERP_HOOK_SKIP=1)\n");
  process.exit(0);
}

// KAPI KİPİ beyanı — her adım miras alır: cırcır çürüme kolu uyarıya iner (circir-kolu.ts),
// Electron vitest zaman aşımı 5 → 20 sn'ye çıkar (yük altında CPU açlığı, kod hatası değil).
// CI ve elle koşum bu env'i görmez, sert davranış orada kalır.
process.env.TEKSERP_KAPI_ADIMI = "commit";

const staged = stagedFiles(REPO);
if (staged.length === 0) process.exit(0);

const basladi = Date.now();
const adimlar = [];

const headOku = () => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const headBasta = headOku();

// ⚠️ `scripts/` 2026-09-13'e kadar HİÇBİR commit kapısının tip kapsamında değildi
// (6e ölçtü, ve boşluk ölçüldükten BİR SAAT sonra `main`e dört TS2739 indirdi).
// Sebep: `tsconfig.json` include = ["src/**/*"] ⇒ 554 dosyalık `scripts/` dışarıda,
// ve tek koşan yer `npm test`in tip geçidiydi — o da filtreli koşumda düşüyor.
//
// ⚠️ EK ADIM DEĞİL, DEĞİŞTİRME: `tsconfig.scripts.json` `src`i DE kapsıyor
// (ölçüldü: 487 ⊂ 1143 kök dosya) ⇒ ikisini birden koşmak aynı 487'yi iki kez
// derlerdi. Geniş config DARI KAPSAR, yerine geçer.
//
// ⚠️ BEDEL YALNIZ RİSKİ TAŞIYAN COMMIT'E YÜKLENİR (ölçüldü: 37 sn ↔ 67 sn).
// Her backend commit'ine +30 sn eklemek kapının İKİNCİ ölüm biçimini doğurur:
// yavaş kapı kaçışa iter ve kaçılan kapı hiç koşmaz. `scripts/` ya da `prisma/`
// dokunulmuyorsa dar config zaten doğru cevabı verir.
const genisTip = (ad) =>
  ad === "Teks-Erp" &&
  staged.some((f) => /^Teks-Erp\/(scripts|prisma)\//.test(f));

// AĞIR ADIMLARA HEAP PAYI (ölçüldü 2026-09-13, d5): tsc 3,3 GB · eslint 3,4–3,5 GB
// tepe RSS, Node'un varsayılan heap tavanı 4192 MB — 700 MB kaldı; proje %20
// büyüyünce eşzamanlılıktan BAĞIMSIZ "Reached heap limit" gelir. Tavan 6144'e
// çekilir (24 GB makinede 3 eşzamanlı kapı 9,4 GB'de paging'siz). npm → node
// zincirinde NODE_OPTIONS aynen iner; kullanıcının kendi NODE_OPTIONS'ı korunur.
const AGIR_ADIM_ENV = {
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=6144`.trim(),
};
// Lint raporu için kapıya özel geçici dizin — çıkışta silinir (yeşil/kırmızı).
const RAPOR_DIZINI = mkdtempSync(join(tmpdir(), "tekserp-kapi-"));
process.on("exit", () => rmSync(RAPOR_DIZINI, { recursive: true, force: true }));

for (const proje of etkilenenProjeler(REPO, staged)) {
  const genis = genisTip(proje.ad);
  adimlar.push({
    ad: `${proje.ad} · tip${genis ? " (+scripts)" : ""}`,
    cwd: proje.ad,
    cmd: genis ? ["npm", ["run", "typecheck:scripts"]] : proje.typecheck,
    env: AGIR_ADIM_ENV,
  });
  // Lint doğrudan değil KAPI üzerinden: taranan küme aynı kalır (tavan aynı kümeyi
  // ölçmek zorunda), yalnız verdikt commit'in kendi dosyalarına daralır. Staged liste
  // stdin'den geçer — kapı tabanı yeniden türetmesin (bkz. lint-gate.mjs § KÜME).
  adimlar.push({
    ad: `${proje.ad} · lint`,
    cwd: ".",
    // TEK ESLİNT KOŞUMU (ölçüldü 2026-09-13): lint ve tavan aynı kümeyi ayrı ayrı
    // tarıyordu (19 sn + 3,5 GB × 2). Rapor bir kez yazılır, tavan onu okur.
    cmd: ["node", ["scripts/hooks/lint-gate.mjs", `--proje=${proje.ad}`, `--rapor=${join(RAPOR_DIZINI, `${proje.ad}.json`)}`]],
    stdin: `${staged.join("\n")}\n`,
    env: AGIR_ADIM_ENV,
  });
  const anahtar = { "Teks-Erp": "backend", Electron: "electron", mobil: "mobil" }[proje.ad];
  if (existsSync(join(REPO, proje.ad, "lint-baseline.json"))) {
    adimlar.push({
      ad: `${proje.ad} · lint tavanı`,
      cwd: ".",
      // Tavan da commit kapısı kipinde: SAYIM proje geneli kalır (tabanla
      // karşılaştırılabilir olmalı), yalnız VERDİKT bu commit'in dosyalarına bakar.
      cmd: ["node", ["scripts/check-lint-baseline.mjs", `--proje=${anahtar}`, "--commit-kapisi", `--rapor=${join(RAPOR_DIZINI, `${proje.ad}.json`)}`]],
      stdin: `${staged.join("\n")}\n`,
      env: AGIR_ADIM_ENV,
    });
  }
  if (proje.test) adimlar.push({ ad: `${proje.ad} · test`, cwd: proje.ad, cmd: proje.test });
}

// Migration/bekçi hijyeni: bu bekçinin değeri YERELDEDİR (CI'da temiz checkout
// yüzünden "untracked migration" gibi kapıları yapısal olarak hep yeşildir).
if (staged.some((f) => f.startsWith("Teks-Erp/prisma/") || f.startsWith("Teks-Erp/scripts/"))) {
  // `--commit-kapisi` + stdin: takipsiz kapılar (GATE 1/4) yalnız commit
  // migration'a dokunuyorsa SERT; yoksa uyarı (bkz. check-migrations.mjs § COMMIT
  // KAPISI KİPİ). Bayraksız çağrı — CI, `npm test` — sert davranışı korur.
  adimlar.push({
    ad: "migration hijyeni",
    cwd: ".",
    cmd: ["node", ["scripts/check-migrations.mjs", "--commit-kapisi"]],
    stdin: `${staged.join("\n")}\n`,
  });
}

// TANIMLAYICI DİLİ ([IL-16]): üretim kodunda İngilizce. ESLint bunu ölçemiyor —
// yalnız Türkçe KARAKTERİ yasaklıyor, ASCII yazılmış Türkçe KELİMEYİ değil.
// ⚠️ KAPIDA OLMASI ŞART: bu tam olarak "commit ederken fark edilmezse bir daha
// hiç fark edilmez" sınıfı. 2026-09-10'da tek oturumda 8 tanımlayıcı bu şekilde
// girdi ve hiçbir şey ses çıkarmadı. Yalnız `src/` değişince koşar (0,4 sn).
if (staged.some((f) => /^(Teks-Erp|Electron|mobil)\/src\/.*\.tsx?$/.test(f))) {
  adimlar.push({
    ad: "tanımlayıcı dili",
    cwd: "Teks-Erp",
    cmd: ["npx", ["tsx", "scripts/test_identifier_language.ts"]],
    // ⚠️ KAPSAM LİSTESİ BURADAN GİDER, bekçi kendisi TÜRETMEZ. Altı oturum aynı
    // ağacı paylaşıyor: bekçi ağaca baksa BAŞKASININ commit edilmemiş dosyasındaki
    // ihlalden bizi durdururdu (2026-09-13 gecesi tam olarak bu oldu). Liste
    // `stagedFiles()`ten gelir — `git status`tan DEĞİL: kısmi commit'te geçici
    // indeks yüzünden o yanlış cevap verir.
    env: { TEKSERP_KOMIT_DOSYALARI: staged.join("\n") },
  });
}

// HIZLI MANDALLAR (1e hükmü 2026-09-13): kapı bekçi koşmaz, mandallar yalnız
// CI'da ısırıyordu. DB'siz + ≤5 sn + `scripts/`/`docs/standart/`/`docs/kurallar/`ı
// konu edinen 12 mandal, eşzamanlı 4, yalnız izole ağaçta (ortak ağaçta ⏭ beyanla).
// Küme, gerekçe ve ölçüm `scripts/hooks/hizli-mandallar.mjs` başlığında.
if (staged.some((f) => /^(Teks-Erp\/scripts\/|docs\/standart\/|docs\/kurallar\/)/.test(f))) {
  adimlar.push({ ad: "hızlı mandallar", cwd: ".", cmd: ["node", ["scripts/hooks/hizli-mandallar.mjs"]] });
}

// KAPININ KENDİSİ (1e hükmü 2026-09-13): hook'u ve kapı betiklerini değiştiren
// commit, hook tarafından ÖLÇÜLMÜYORDU (kök `scripts/` hiçbir tetikte değil —
// aynı gün üç kapı commit'i adımsız indi, bekçiler elle koşuldu). Tetik dördüncü
// dizin: `scripts/hooks/**` + kök `scripts/*.mjs` (check-*/kapi-kapsami — kapı
// adımlarının kendileri). Üç ölçüm: kapsam bekçisi · hook config · semafor sondası.
if (staged.some((f) => /^scripts\/(hooks\/|[^/]+\.mjs$)/.test(f))) {
  adimlar.push({
    ad: "kapının kendisi · kapsam",
    cwd: "Teks-Erp",
    cmd: ["npx", ["tsx", "scripts/test_commit_gate_scope.ts"]],
    env: { DATABASE_URL: "postgresql://kapi:kapi@127.0.0.1:1/kapi_test?schema=public" },
    gitEnvSil: true,
  });
  adimlar.push({
    ad: "kapının kendisi · hook config",
    cwd: "Teks-Erp",
    cmd: ["npx", ["tsx", "scripts/test_hook_config.ts"]],
    env: { DATABASE_URL: "postgresql://kapi:kapi@127.0.0.1:1/kapi_test?schema=public" },
    gitEnvSil: true,
  });
  adimlar.push({ ad: "kapının kendisi · semafor sondası", cwd: ".", cmd: ["node", ["scripts/hooks/lib/semafor-sonda.mjs"]], gitEnvSil: true });
}

// Doküman kapısı: ölü link + CLAUDE.md boyut tavanı.
if (staged.some((f) => f.endsWith(".md"))) {
  adimlar.push({ ad: "doküman kapısı", cwd: ".", cmd: ["node", ["scripts/check-docs.mjs"]] });
}

// ⚠️ SÜRÜM NOTU KAPISI: notlar YAYIN KAPISIDIR ama gövdeleri `.json`, ve proje
// adımları yalnız `.ts/.tsx` değişiminde doğuyor — yani not commit'leri HİÇ adım
// koşmadan iniyordu (ölçüldü 2026-09-12: notlara dokunan 22 commit'in 16'sı
// YALNIZ `.json` değiştirmiş). Kapı zaten vardı, tetiği yoktu. Yollar ADIYLA
// listelenir: `src/data/` altında bugün başka üretilmiş dosya YOK (ölçüldü) ve
// jenerik bir `.json` deseni ölçülmemiş bir kapsam iddia ederdi.
const SURUM_NOTU_YOLLARI = new Set([
  "surum-notlari.json",
  "Electron/src/data/surum-notlari.json",
  "mobil/src/data/surum-notlari.json",
]);
if (staged.some((f) => SURUM_NOTU_YOLLARI.has(f))) {
  adimlar.push({
    ad: "sürüm notu kapısı",
    cwd: ".",
    cmd: ["node", ["scripts/check-surum-notlari.mjs"]],
  });
}

if (adimlar.length === 0) process.exit(0);

// KAPI SEMAFORU (1e hükmü 2026-09-13): ağır adım (tsc/eslint/test) varsa makine
// genelinde en çok KAPASITE kapı aynı anda koşar — ölçüm ve tuzaklar lib/semafor.mjs.
// Yalnız doküman/sürüm-notu kapısı (saniyeler, MB'lar) sıraya girmez.
const agirVar = adimlar.some((a) => a.env === AGIR_ADIM_ENV || a.ad.endsWith(" · test"));
const semaforBasladi = Date.now();
const slotBirak = agirVar ? slotAl() : () => {};
// Bekleme süresi deftere — semafor kapasitesi (2/3/4) sahadan bu satırla ölçülür.
if (agirVar) deftereYaz({ wt: WT, adim: "semafor bekleme", sonuc: "✅", sn: (Date.now() - semaforBasladi) / 1000, cikis: 0 });

process.stderr.write(`⏳ commit kapısı: ${adimlar.length} adım (${adimlar.map((a) => a.ad).join(" · ")})\n`);

for (const adim of adimlar) {
  const t0 = Date.now();
  const r = spawnSync(adim.cmd[0], adim.cmd[1], {
    cwd: join(REPO, adim.cwd),
    encoding: "utf8",
    timeout: 600_000,
    // `gitEnvSil`: git, hook sürecine GIT_DIR/GIT_INDEX_FILE/GIT_PREFIX verir ve bunlar
    // çocuğa iner. Geçici repoda `git init/add/commit` yapan bir adım (kapsam bekçisi)
    // o env ile GERÇEK repoya commit atar — 2026-09-13'te oldu, ÜÇ YÜZÜ vardı: "taban"
    // commit'i dala indi (3977 dosya silindi, reset ile döndü) · `git init` cwd'de değil
    // GIT_DIR'da koştuğu için ortak .git/config'e core.bare=true yazdı (ana ağaçta
    // reset "bare repository" ile düştü) · testin `git config user.*`ı ortak config'e
    // gitti, bir origin commit'i "bekci" kimliğiyle doğdu. Yalnız işaretli adımlarda
    // sökülür: index okuyan adımlar (identifier_language `git show :yol`) pathspec
    // commit'inde GEÇİCİ index'i GIT_INDEX_FILE'dan bulur, onlara dokunulmaz.
    env: {
      ...(adim.gitEnvSil ? Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) : process.env),
      ...(adim.env ?? {}),
    },
    ...(adim.stdin === undefined ? {} : { input: adim.stdin }),
  });
  const sn = ((Date.now() - t0) / 1000).toFixed(1);
  const cikis = r.status ?? r.error?.code;
  if (r.status === 0 && !r.error) {
    process.stderr.write(`   ✅ ${adim.ad} (${sn}s)\n`);
    deftereYaz({ wt: WT, adim: adim.ad, sonuc: "✅", sn, cikis });
    // Yeşil adımın çıktısı yutulur — ⏭ BEYANI hariç: kapsam kaybı sessiz olamaz
    // (ölüm biçimi ⑪). Beyan satırı adımın kendi çıktısında "⏭" ile başlar.
    for (const satir of `${r.stdout || ""}\n${r.stderr || ""}`.split("\n")) {
      if (satir.trim().startsWith("⏭")) {
        process.stderr.write(`   ${satir.trim()}\n`);
        deftereYaz({ wt: WT, adim: `${adim.ad} · ${satir.trim().slice(0, 80)}`, sonuc: "⏭", sn, cikis });
      }
    }
    continue;
  }
  const govde = `${r.stdout || ""}\n${r.stderr || ""}`.split("\n").filter(Boolean).slice(-30).join("\n");
  process.stderr.write(
    `   ❌ ${adim.ad} KIRMIZI (${sn}s, çıkış ${cikis})\n` +
      `${govde.replace(/^/gm, "      | ")}\n\n` +
      `⛔ Commit atılmadı. Bilerek geçmek gerekiyorsa: TEKSERP_HOOK_SKIP=1 git commit …\n`,
  );
  // Isıran mandalın adı teşhis için yeter; ilk ❌ satırı da alınır (koşucu biçimi: "❌ test_x …"),
  // mutlak yollar kırpılır — defterde tam yol/oturum kimliği taşınmaz.
  const ilkKirmizi = govde
    .split("\n")
    .find((s) => s.includes("❌"))
    ?.split(`${REPO}/`)
    .join("")
    .replace(/\/(?:private\/)?tmp\/claude-501\/\S*?\/scratchpad\//g, "")
    .trim()
    .slice(0, 120);
  deftereYaz({ wt: WT, adim: ilkKirmizi ? `${adim.ad} · ${ilkKirmizi}` : adim.ad, sonuc: "❌", sn, cikis });
  slotBirak();
  process.exit(1);
}

// ⚠️ Ortak çalışma ağacında başka bir oturum, biz kapıyı koştururken commit atmış
// olabilir. Git'in ref kilidi ATOMİKTİR — commit sessizce ezilmez, `fatal: cannot
// lock ref 'HEAD'` ile GÜRÜLTÜLÜ düşer; yani korunması gereken korunuyor. Kaybedilen
// tek şey bu koşumun süresidir (ölçüm 2026-09-12: 48 sn). İNİŞ KİLİDİ ÖNERİLMEDİ:
// bayat kilit beş oturumu birden iniş-siz bırakır ve zaman aşımı eşiği seçilemez
// (kapı 48 sn ↔ `npm test` 6,5 dk). Anlaşma kalır, teşhis eklenir.
const headSonda = headOku();
if (headBasta && headSonda && headBasta !== headSonda) {
  process.stderr.write(
    `⚠️  HEAD koşum sırasında kaydı (${headBasta.slice(0, 8)} → ${headSonda.slice(0, 8)}).\n` +
      `   Commit REDDEDİLECEK (ref kilidi). Kayıp yok: staged dosyalar index'te kalır.\n` +
      `   Yap: git log --oneline -1 ile yeni ucu gör, sonra commit'i TEKRARLA.\n`,
  );
}

const toplamSn = ((Date.now() - basladi) / 1000).toFixed(1);
process.stderr.write(`✅ commit kapısı temiz (${toplamSn}s)\n`);
deftereYaz({ wt: WT, adim: `kapı · toplam (${adimlar.length} adım)`, sonuc: "✅", sn: toplamSn, cikis: 0 });
slotBirak();
process.exit(0);
