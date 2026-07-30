// =============================================================================
// Migration DB↔DİZİN mutabakatı — "dev'e uygulandı ama dosya kayboldu/commit
// edilmedi" durumunu yakalar.
//
// NEDEN VAR: 2026-07-30'da üç migration dev DB'sine `prisma db execute` +
// `migrate resolve --applied` ile uygulandı ama git'e HİÇ girmedi. `_prisma_
// migrations` onları "uygulandı" gösteriyordu, dizinde de vardılar — yani DEV
// tarafında her şey normal görünüyordu; eksik olan tek şey commit'ti ve bunu
// hiçbir mekanizma söylemiyordu. `scripts/check-migrations.mjs` git tarafını
// (untracked/modified) tutar; bu dosya DB tarafını tutar:
//
//   [FAIL] `_prisma_migrations`'ta VAR, dizinde YOK → dosya silinmiş/taşınmış.
//          Bu ölümcül: `migrate deploy` yeni bir ortamda o adımı hiç uygulamaz
//          ama dev DB'de etkisi durur → "bende çalışıyor" sınıfı hata.
//   [UYARI] Dizinde VAR, DB'de YOK → dev DB geride (pending migration).
//   [UYARI] `applied_steps_count = 0` satırları → `migrate resolve --applied` ile
//          ELLE işaretlenmiş demektir. ⚠️ `resolve` SQL'in gerçekten KOŞTUĞUNU
//          DOĞRULAMAZ: yalnız `_prisma_migrations`'a satır yazar. `statement_
//          timeout=50s` ile yarıda kesilen bir DDL de sessizce "uygulandı"
//          görünür (DB-MIMARI-DENETIM.md D-23). Bu satırlar el yordamıyla
//          doğrulanmalı — bu yüzden listelenir, ama FAIL değil (meşru sıfırlar var).
//
// Salt-okunur: hiçbir yazma/fixture yok, herhangi bir ortamda güvenle koşar.
// CI'da (taze DB + temiz checkout) üç kontrol de boş geçer — değeri YERELDEDİR.
// Koşum: npx tsx scripts/test_migration_hygiene.ts
// =============================================================================
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";

let pass = 0,
  fail = 0,
  warn = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function warnLine(msg: string): void {
  warn++;
  console.log(`⚠️  ${msg}`);
}

const MIGRATIONS_DIR = join(__dirname, "..", "prisma", "migrations");

async function main() {
  // --- Dizin tarafı ---------------------------------------------------------
  const onDisk = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR)
        .filter((d) => statSync(join(MIGRATIONS_DIR, d)).isDirectory())
        .sort()
    : [];
  check("prisma/migrations okunabildi", onDisk.length > 0, `${onDisk.length} dizin`);

  // --- DB tarafı ------------------------------------------------------------
  const applied = await prisma.$queryRaw<
    {
      migration_name: string;
      applied_steps_count: number;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }[]
  >`SELECT migration_name, applied_steps_count, finished_at, rolled_back_at
      FROM "_prisma_migrations" ORDER BY migration_name`;

  const diskSet = new Set(onDisk);
  const dbActive = applied.filter((a) => a.rolled_back_at == null);
  const dbSet = new Set(dbActive.map((a) => a.migration_name));

  // --- 1) DB'de var, dizinde YOK → FAIL ------------------------------------
  const orphans = dbActive.filter((a) => !diskSet.has(a.migration_name));
  check(
    "DB'de uygulanmış her migration dizinde de var (kayıp dosya yok)",
    orphans.length === 0,
    orphans.length ? orphans.map((o) => o.migration_name).join(", ") : `${dbSet.size} kayıt`
  );

  // --- 2) Dizinde var, DB'de YOK → uyarı (pending) --------------------------
  const pending = onDisk.filter((d) => !dbSet.has(d));
  if (pending.length) {
    warnLine(
      `Dev DB ${pending.length} migration geride (pending): ${pending.join(", ")}\n` +
        "     → Elle yazılmış migration ise: git add → prisma db execute → migrate resolve --applied"
    );
  } else {
    check("Dizindeki her migration dev DB'ye uygulanmış (pending yok)", true);
  }

  // --- 3) applied_steps_count = 0 → uyarı (resolve SQL'i doğrulamaz) --------
  const resolvedOnly = dbActive.filter((a) => a.applied_steps_count === 0);
  if (resolvedOnly.length) {
    warnLine(
      `${resolvedOnly.length} migration \`applied_steps_count = 0\` ile kayıtlı — yani ` +
        `\`migrate resolve --applied\`\n     ile ELLE işaretlenmiş; SQL'in gerçekten koştuğu ` +
        `DOĞRULANMADI (D-23). Şema-etkili olanları\n     elle teyit et (\\d+ <tablo>, pg_enum, ` +
        `pg_index.indisvalid):`
    );
    for (const r of resolvedOnly.slice(-8)) {
      console.log(`       • ${r.migration_name}`);
    }
    if (resolvedOnly.length > 8) {
      console.log(`       … +${resolvedOnly.length - 8} daha (en yeni 8 gösterildi)`);
    }
  } else {
    check("Elle resolve edilmiş (applied_steps_count=0) migration yok", true);
  }

  // --- 4) Yarıda kalmış migration (finished_at NULL) → FAIL ----------------
  const unfinished = dbActive.filter((a) => a.finished_at == null);
  check(
    "Yarıda kalmış migration yok (finished_at dolu)",
    unfinished.length === 0,
    unfinished.length ? unfinished.map((u) => u.migration_name).join(", ") : ""
  );

  console.log(
    `\n=== Sonuç: ${pass} geçti, ${fail} başarısız${warn > 0 ? `, ${warn} uyarı` : ""} ===`
  );
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: `_prisma_migrations`'ta kayıtlı bir migration'ın dosyası yok ya da bir\n" +
        "migration yarıda kaldı. Dosya kayıpsa git geçmişinden geri getir (silme KASITLIYSA\n" +
        "`migrate resolve --rolled-back` ile DB kaydını da kapat). Git tarafı için:\n" +
        "node ../scripts/check-migrations.mjs"
    );
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
