// =============================================================================
// Test: Offsite yedek süpürücüsü sözleşmesi
// Çalıştır: npx tsx scripts/test_offsite_sweep.ts
// =============================================================================
// (2026-08-10 denetimi, F-OPS-VER-003)
//
// Bu bekçi sahte bir `rclone` ile koşar (kabuk script'i) — gerçek bir Google
// hesabı, ağ ya da kurulu rclone GEREKTİRMEZ. Ölçtüğü şey bizim sözleşmemizdir,
// rclone'un doğruluğu değil.
//
// KİLİTLENEN DÖRT KURAL:
//  1. `sync` ASLA kullanılmaz — yalnız `copy`. (`sync` hedefi kaynağa eşitler:
//     yerel dosya silinir/şifrelenirse uzaktaki de gider, yani fidye yazılımı
//     offsite kopyayı da imha eder. Aradaki fark özelliğin TAMAMIDIR.)
//  2. Süpürücü `BACKUP_SCHEDULE_ENABLED`e BAĞLI DEĞİL. Sahada o bayrak "false"
//     ve `startBackupScheduler` erken dönüyor; süpürme oraya gömülseydi ihtiyaç
//     duyulan TEK ortamda hiç koşmazdı — ve dev'de çalıştığı için hiçbir testte
//     görünmezdi.
//  3. Kapsam DOĞRULANIR: `copy`nin sıfır dönmesi "bu koşumda hata yok" demek;
//     "yereldeki her şey uzakta" demek DEĞİL. Aylar önce bir kez düşmüş tek bir
//     dosya, listeleme karşılaştırması olmadan sonsuza dek eksik kalır.
//  4. Uzak hedeften HİÇBİR ŞEY SİLİNMEZ.
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";

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

const SRC = path.resolve(__dirname, "../src");
const HELPER = path.join(SRC, "services/helpers/offsite-backup.helper.ts");
const JOB = path.join(SRC, "jobs/offsite-sweeper.ts");
const SCHED = path.join(SRC, "jobs/backup-scheduler.ts");
const SERVER = path.join(SRC, "server.ts");

/** Yorumları söker — kural metinleri kodun kendisiyle karıştırılmasın. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      let q = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const c = line[i]!;
        if (c === '"' || c === "'" || c === "`") q++;
        if (c === "/" && line[i + 1] === "/" && q % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

// ── §1 Kaynak sözleşmesi ────────────────────────────────────────────────────
function sourceContract(): void {
  console.log("\n--- §1 Kaynak sözleşmesi ---");
  const helper = stripComments(fs.readFileSync(HELPER, "utf8"));
  const job = stripComments(fs.readFileSync(JOB, "utf8"));
  const server = stripComments(fs.readFileSync(SERVER, "utf8"));

  check("körlük zemini: yardımcı okundu", helper.length > 800, `${helper.length} bayt`);

  // (1) sync YASAK
  check("rclone `copy` kullanılıyor", /"copy"/.test(helper));
  const syncHit = /["']sync["']/.test(helper) || /["']delete["']/.test(helper) || /["']purge["']/.test(helper);
  check(
    "rclone `sync`/`delete`/`purge` KULLANILMIYOR (fidye yazılımı offsite'ı da silerdi)",
    !syncHit,
  );

  // (4) uzaktan silme yok
  check(
    "yardımcı uzak hedeften silmeye dair hiçbir çağrı taşımıyor",
    !/rmdir|deletefile|--min-age/i.test(helper),
  );

  // (3) kapsam doğrulaması
  check("kapsam doğrulaması var (`lsf` ile listeleme)", /"lsf"/.test(helper));
  check(
    "`missing` kümesi yerel−uzak farkından türetiliyor",
    /local\.filter\(\(n\)\s*=>\s*!remoteSet\.has\(n\)\)/.test(helper),
  );
  // Listeleme HATASI boş listeye düşmemeli.
  check(
    "listeleme başarısızlığı `null` döner (boş dizi DEĞİL — 'uzakta yok' ile 'bakamadım' ayrı)",
    /return null;/.test(helper) && /remoteList === null/.test(helper),
  );

  // (2) zamanlayıcı bağımsızlığı
  check(
    "süpürücü AYRI bir iş dosyasında",
    fs.existsSync(JOB),
  );
  check(
    "süpürücü BACKUP_SCHEDULE_ENABLED'e BAKMIYOR",
    !/BACKUP_SCHEDULE_ENABLED/.test(job),
    "bayrak 'yedeği kim alır'ı yanıtlar, 'kopyası nereye gider'i değil",
  );
  check(
    "backup-scheduler hâlâ o bayrakta erken dönüyor (bağımsızlık gerekçesi CANLI)",
    /BACKUP_SCHEDULE_ENABLED === "false"/.test(stripComments(fs.readFileSync(SCHED, "utf8"))),
    "erken dönüş kalkmışsa bu testin gerekçesini yeniden düşün",
  );
  check(
    "server.ts süpürücüyü AYRI çağırıyor",
    /startOffsiteSweeper\(\)/.test(server) && /startBackupScheduler\(\)/.test(server),
  );

  // Ön ekler tek kaynaktan
  check(
    "kopyalanacak ön ekler backup-naming.helper'dan geliyor (elle string yok)",
    /from "\.\/backup-naming\.helper"/.test(helper) &&
      !/["']tekserp_["']/.test(helper.replace(/NIGHTLY_PREFIX/g, "")),
  );
  check(
    "güvenlik yedekleri de kapsamda (premigrate + pre-restore)",
    /PREMIGRATE_PREFIX/.test(helper) && /PRE_RESTORE_PREFIX/.test(helper),
  );

  // Çocuk süreç disiplini
  check(
    "rclone `runProcess` üzerinden çalışıyor (timeout + SIGKILL tek noktada)",
    /runProcess\(/.test(helper) && !/\bspawn\(/.test(helper),
  );
  check("yükleme zaman aşımı tanımlı", /SWEEP_TIMEOUT_MS/.test(helper));
}

// ── §2 Davranış: sahte rclone ile uçtan uca ─────────────────────────────────
async function behaviour(): Promise<void> {
  console.log("\n--- §2 Davranış (sahte rclone) ---");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "offsite-"));
  const backupDir = path.join(tmp, "backups");
  const remoteDir = path.join(tmp, "remote");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(remoteDir, { recursive: true });

  // Sahte rclone: `copy <src> <dst> ...` ve `lsf <dst> --files-only`.
  // Gerçek rclone'un davranışını taklit eder (var olanı atlar, hiçbir şey silmez).
  const fake = path.join(tmp, "fake-rclone.sh");
  fs.writeFileSync(
    fake,
    `#!/bin/sh
CMD="$1"
if [ "$CMD" = "copy" ]; then
  SRC="$2"; DST="$3"
  mkdir -p "$DST"
  for f in "$SRC"/*.dump; do
    [ -e "$f" ] || continue
    b=$(basename "$f")
    case "$b" in
      tekserp_*|premigrate_*|pre-restore_*)
        [ -e "$DST/$b" ] || cp "$f" "$DST/$b" ;;
    esac
  done
  exit 0
fi
if [ "$CMD" = "lsf" ]; then
  DST="$2"
  ls -1 "$DST" 2>/dev/null
  exit 0
fi
exit 64
`,
    { mode: 0o755 },
  );

  process.env.BACKUP_DIR = backupDir;
  process.env.BACKUP_RCLONE_REMOTE = remoteDir;
  process.env.BACKUP_RCLONE_BIN = fake;

  // Modülü env kurulduktan SONRA yükle (değerler çağrı anında okunuyor ama
  // yine de gerçek sırayı taklit edelim).
  const { sweepOffsiteBackups } = await import("../src/services/helpers/offsite-backup.helper");

  // Boş klasör
  let r = await sweepOffsiteBackups();
  check("boş klasör: hata değil ama uyarı üretir", r.ok && r.warnings.length > 0, r.warnings[0] ?? "");

  // Üç yedek + kapsam dışı bir dosya
  fs.writeFileSync(path.join(backupDir, "tekserp_20260810_020000.dump"), "A");
  fs.writeFileSync(path.join(backupDir, "premigrate_20260810_030000.dump"), "B");
  fs.writeFileSync(path.join(backupDir, "pre-restore_20260810_040000.dump"), "C");
  fs.writeFileSync(path.join(backupDir, "notlar.txt"), "kapsam disi");

  r = await sweepOffsiteBackups();
  check("üç yedek de kopyalandı", r.ok && r.missing.length === 0, `yerel ${r.localCount}, uzak ${r.remoteCount}`);
  check("yerel sayım yalnız yedek dosyalarını içerir (notlar.txt hariç)", r.localCount === 3, `${r.localCount}`);
  check(
    "güvenlik yedekleri de gitti",
    fs.existsSync(path.join(remoteDir, "premigrate_20260810_030000.dump")) &&
      fs.existsSync(path.join(remoteDir, "pre-restore_20260810_040000.dump")),
  );

  // İkinci koşum: idempotent, yeniden yüklemez
  const before = fs.statSync(path.join(remoteDir, "tekserp_20260810_020000.dump")).mtimeMs;
  r = await sweepOffsiteBackups();
  const after = fs.statSync(path.join(remoteDir, "tekserp_20260810_020000.dump")).mtimeMs;
  check("ikinci süpürme idempotent (var olanı yeniden yüklemez)", before === after && r.ok);

  // ⚠️ ASIL KONTROL: yerelden silinen dosya UZAKTAN SİLİNMEZ.
  // Bu, `copy` ile `sync` arasındaki farkın ta kendisi ve özelliğin var oluş
  // sebebi — yerel rotasyon (30 gün) offsite geçmişi budayamaz, ve fidye
  // yazılımının yereli imha etmesi offsite kopyayı öldüremez.
  fs.rmSync(path.join(backupDir, "tekserp_20260810_020000.dump"));
  r = await sweepOffsiteBackups();
  check(
    "YEREL SİLME UZAĞA YANSIMAZ (copy ≠ sync)",
    fs.existsSync(path.join(remoteDir, "tekserp_20260810_020000.dump")),
    "uzak kopya silinmiş olsaydı özellik hiçbir işe yaramazdı",
  );
  check("uzak sayım yerelden büyük olabilir (geçmiş korunuyor)", r.remoteCount > r.localCount, `${r.remoteCount} > ${r.localCount}`);

  // Kapsam eksiği tespiti: uzaktan bir dosyayı elle sil (kopya düşmüş gibi),
  // ve sahte rclone'u kopyalamayacak şekilde bozarak eksikliği ölçtür.
  fs.writeFileSync(path.join(backupDir, "tekserp_20260811_020000.dump"), "D");
  const noop = path.join(tmp, "noop-rclone.sh");
  fs.writeFileSync(noop, `#!/bin/sh\n[ "$1" = "lsf" ] && ls -1 "$2" 2>/dev/null\nexit 0\n`, { mode: 0o755 });
  process.env.BACKUP_RCLONE_BIN = noop;
  r = await sweepOffsiteBackups();
  check(
    "kopya sessizce yapılmazsa KAPSAM EKSİĞİ yakalanır",
    !r.ok && r.missing.includes("tekserp_20260811_020000.dump"),
    r.warnings.join(" | ").slice(0, 90),
  );

  // rclone yoksa: sessiz atlama YOK
  process.env.BACKUP_RCLONE_BIN = path.join(tmp, "yok-boyle-bir-dosya");
  r = await sweepOffsiteBackups();
  check("rclone bulunamazsa açık uyarı üretir (sessiz atlama yok)", !r.ok && r.warnings.some((w) => /rclone çalıştırılamadı/.test(w)));

  // Hedef tanımsız: bugünkü uyarı korunur
  process.env.BACKUP_RCLONE_REMOTE = "";
  r = await sweepOffsiteBackups();
  check(
    "hedef boşken 'OFFSITE HEDEF AYARLANMADI' uyarısı korunur",
    !r.configured && r.warnings.some((w) => /OFFSITE HEDEF AYARLANMADI/.test(w)),
  );

  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log("=== Offsite yedek süpürücüsü sözleşmesi ===");
  sourceContract();
  await behaviour();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
