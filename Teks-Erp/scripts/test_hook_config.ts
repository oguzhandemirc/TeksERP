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
import { existsSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";

const KOK = join(__dirname, "..", "..");
const AYAR_YOLU = join(KOK, ".claude", "settings.json");

let pass = 0;
let fail = 0;
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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
