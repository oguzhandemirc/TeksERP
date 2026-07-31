// =============================================================================
// Test: startCopyJob atomik claim (A2 — 2026-07-31 veri bütünlüğü denetimi)
// Çalıştır: npx tsx scripts/test_db_copy_single_start.ts
// Doğrulananlar:
//   1. Yarış: iki eşzamanlı startCopyJob → TAM BİRİ started, iş TEK KEZ başlar
//      (eski kod `await listDbCopies()` penceresinde ikisini de başlatıyordu)
//   2. Claim tutulurken üçüncü çağrı "Zaten bir kopya işlemi sürüyor" alır
//   3. Async doğrulama başarısız olursa claim GERİ BIRAKILIR (sonraki çağrı geçer)
//
// Gerçek pg_dump/pg_restore KOŞMAZ: `deps` test kancasıyla sahte list/run enjekte
// edilir; BACKUP_DIR scratch'e yönlendirilir (dummy .dump). DB'ye yazılmaz.
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-dbcopy-test-"));
process.env.BACKUP_DIR = SCRATCH; // backup.service modül-yükünde okur → import'lardan ÖNCE
const DUMMY = "tekserp_test_fixture.dump";
fs.writeFileSync(path.join(SCRATCH, DUMMY), "dummy");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // dotenv (DATABASE_URL → liveConn) prisma lib üzerinden yüklenir; sonra servis.
  await import("../src/lib/prisma");
  const svc = await import("../src/services/db-copy.service");

  type Listing = Awaited<ReturnType<typeof svc.listDbCopies>>;
  const okListing = (): Listing =>
    ({
      capabilityError: undefined,
      capabilities: { enabled: true },
      disk: { ok: true },
    } as unknown as Listing);

  let runCount = 0;
  const slowList = (async () => {
    await sleep(60); // eski kodun TOCTOU penceresini temsil eden gecikme
    return okListing();
  }) as unknown as typeof svc.listDbCopies;
  const fakeRun = (async () => {
    runCount++;
  }) as unknown as Parameters<typeof svc.startCopyJob>[1]["run"];

  try {
    // --- 1) Yarış ---
    const [r1, r2] = await Promise.all([
      svc.startCopyJob(DUMMY, { list: slowList, run: fakeRun }),
      svc.startCopyJob(DUMMY, { list: slowList, run: fakeRun }),
    ]);
    const startedCount = [r1, r2].filter((r) => r.started).length;
    check("yarış: tam biri started", startedCount === 1, JSON.stringify([r1, r2]));
    await sleep(10); // void run'ın koşması için
    check("yarış: iş TEK KEZ başladı", runCount === 1, `runCount=${runCount}`);
    check(
      "yarış: kaybeden 'zaten sürüyor' mesajı aldı",
      [r1, r2].some((r) => !r.started && /Zaten bir kopya/.test(r.message ?? "")),
    );

    // --- 2) Claim tutulurken üçüncü çağrı reddedilir ---
    const r3 = await svc.startCopyJob(DUMMY, { list: slowList, run: fakeRun });
    check("claim sürerken üçüncü çağrı reddedildi", !r3.started);

    // --- 3) Başarısız doğrulama claim'i geri bırakır ---
    svc._setCurrentJob(null);
    const diskFullList = (async () =>
      ({
        capabilityError: undefined,
        capabilities: { enabled: true },
        disk: { ok: false, blockReason: "TEST disk dolu" },
      } as unknown as Listing)) as unknown as typeof svc.listDbCopies;
    const rFail = await svc.startCopyJob(DUMMY, { list: diskFullList, run: fakeRun });
    check("doğrulama başarısız → started:false + mesaj", !rFail.started && /disk dolu/i.test(rFail.message ?? ""));
    check("claim geri bırakıldı (job kalmadı)", !svc.isCopyJobRunning());
    const rAfter = await svc.startCopyJob(DUMMY, { list: slowList, run: fakeRun });
    check("sonraki çağrı yeniden geçebildi", rAfter.started === true);
  } finally {
    svc._setCurrentJob(null);
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
