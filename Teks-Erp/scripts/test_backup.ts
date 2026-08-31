// =============================================================================
// Yedekleme servisi entegrasyon testi (server'sız)
// =============================================================================
// 2026-07-30: Yedekleme installer'ın PowerShell'inden backend'e taşındı
// (services/backup.service.ts). Bu test o taşımanın davranışını GERÇEK pg_dump ile
// doğrular — dev DB'sinden okur (salt-okuma), dump'ları geçici klasöre yazar.
//
// DİKKAT — BACKUP_DIR / BACKUP_OFFSITE_DIR modül-yükleme anında okunuyor
// (`backup.service.ts` modül seviyesinde `const`'a alır). Bu yüzden import DİNAMİK
// olmak zorunda: env'i önce set et, sonra import et. (Üretimde kısıt değil — env
// değişince pm2 restart edilir.) PG_BIN_DIR ise ÇAĞRI ANINDA okunur, o yüzden
// hatalı-yol dalı yeniden import etmeden test edilebiliyor.
//
// Koşum: npx tsx scripts/test_backup.ts
// =============================================================================

import "dotenv/config"; // DATABASE_URL — servis importlarından ÖNCE
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
    console.log(`✅ ${label}`);
  } else {
    fail += 1;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** pg_dump PATH'te (ya da PG_BIN_DIR'de) yok ise test anlamsız → atla. */
function pgDumpAvailable(): boolean {
  const exe = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, exe) : exe;
  const r = spawnSync(bin, ["--version"], { windowsHide: true });
  return r.status === 0;
}

// =============================================================================
// Bölüm 10 — ad/cutoff çözümleme (SAF: DB'siz, pg_dump'sız)
// =============================================================================
// Erken-return'lerin ÜSTÜNDE koşar: bu mantık env/DB/pg_dump'a bağlı değil,
// dolayısıyla PostgreSQL kurulu olmayan makinede de doğrulanmalı.
async function testNaming(): Promise<void> {
  const n = await import("../src/services/helpers/backup-naming.helper");

  // --- Üç ön ek de parse edilmeli
  const cases: Array<[string, [number, number, number, number, number, number]]> = [
    ["tekserp_20260730_030000.dump", [2026, 7, 30, 3, 0, 0]],
    ["premigrate_1.5.0_20260201_143012.dump", [2026, 2, 1, 14, 30, 12]],
    ["pre-restore_20260730_142312.dump", [2026, 7, 30, 14, 23, 12]],
  ];
  for (const [name, [y, mo, d, hh, mm, ss]] of cases) {
    const dt = n.parseBackupStamp(name);
    // ISO ile DEĞİL alan alan doğrula — toISOString() TZ'i içine gömer ve
    // "yerel kurucu" sözleşmesini test etmez.
    const ok =
      !!dt &&
      dt.getFullYear() === y &&
      dt.getMonth() === mo - 1 &&
      dt.getDate() === d &&
      dt.getHours() === hh &&
      dt.getMinutes() === mm &&
      dt.getSeconds() === ss;
    check(`parse: ${name}`, ok, dt ? dt.toString() : "null");
  }

  // --- Reddedilmesi gerekenler
  const bad = [
    "tekserp_x.dump", // damga yok
    "random.dump",
    "tekserp_20260730_030000.dump.bak", // sona çapalı regex kuyruğu reddeder
    "tekserp_20261332_000000.dump", // 13. ay
    "tekserp_20260230_000000.dump", // 30 Şubat — naif new Date() 2 Mart'a KAYAR
    "tekserp_20260730_250000.dump", // 25. saat
    "tekserp_20190730_030000.dump", // 2020 öncesi akıl sağlığı sınırı
  ];
  for (const name of bad) {
    check(`reddedildi: ${name}`, n.parseBackupStamp(name) === null);
  }

  // --- resolveBackupCutoff: min(ad, mtime) + source
  const nameAt = new Date(2026, 6, 30, 3, 0, 0).getTime(); // 30.07.2026 03:00 yerel
  const fname = "tekserp_20260730_030000.dump";
  const later = n.resolveBackupCutoff(fname, nameAt + 5 * 60_000); // dump 5dk sürdü
  check("ad < mtime → source=name (dump BAŞLANGICI)", later.source === "name" && later.at.getTime() === nameAt);
  const earlier = n.resolveBackupCutoff(fname, nameAt - 60_000); // mtime geriye alınmış
  check("ad > mtime → source=mtime (muhafazakâr)", earlier.source === "mtime");
  const unparsed = n.resolveBackupCutoff("elden_gelen.dump", nameAt);
  check("çözülemeyen ad → source=mtime", unparsed.source === "mtime" && unparsed.at.getTime() === nameAt);

  // --- Gidiş-dönüş + rotasyon bağışıklığı sözleşmesi
  const d0 = new Date(2026, 6, 30, 14, 23, 12, 0);
  const rt = n.parseBackupStamp(n.safetyBackupName(d0));
  check("gidiş-dönüş: parse(safetyBackupName(d)) === d", rt?.getTime() === d0.getTime());
  // Bu iddia tüm güvenlik ağının dayandığı invariant: güvenlik yedeği `tekserp_`
  // ile başlarsa 14'lük rotasyona girer ve bir gün sessizce silinir.
  check(
    "güvenlik yedeği tekserp_ ile BAŞLAMAZ (rotasyon dışı)",
    !n.safetyBackupName(d0).startsWith("tekserp_"),
  );
  check("backupKind sınıflandırma", n.backupKind("pre-restore_20260730_142312.dump") === "pre-restore" &&
    n.backupKind("tekserp_20260730_030000.dump") === "nightly" &&
    n.backupKind("premigrate_1.0.0_20260101_000000.dump") === "premigrate" &&
    n.backupKind("elden.dump") === "other");
}

async function main(): Promise<void> {
  await testNaming();

  if (!process.env.DATABASE_URL) {
    console.log("⏭️  DATABASE_URL yok — kalan testler atlandı.");
    return;
  }
  if (!pgDumpAvailable()) {
    console.log("⏭️  pg_dump bulunamadı (PATH / PG_BIN_DIR) — kalan testler atlandı.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-backup-test-"));
  const backupDir = path.join(root, "backups");
  const offsiteDir = path.join(root, "offsite");
  const testStart = new Date();
  /** 12c-2'de yaratılan geçici top (restore-impact sayımı için) — finally siler. */
  let impactRollId: string | null = null;

  // Env'i import'tan ÖNCE kur (yukarıdaki not).
  process.env.BACKUP_DIR = backupDir;
  process.env.BACKUP_OFFSITE_DIR = offsiteDir;

  const svc = await import("../src/services/backup.service");
  const { default: prisma } = await import("../src/lib/prisma");

  try {
    // -------------------------------------------------------------------------
    // 1) Rotasyon kurgusu: 20 sahte günlük + 2 premigrate dosyası
    // -------------------------------------------------------------------------
    // Rotasyon en yeni 14 `tekserp_*`'i tutar; `premigrate_*` rotasyon DIŞI.
    fs.mkdirSync(backupDir, { recursive: true });
    const old = Date.now() - 90 * 24 * 60 * 60 * 1000; // 90 gün önce → saklama dışı
    for (let i = 0; i < 20; i++) {
      const f = path.join(backupDir, `tekserp_2026010${(i % 10)}_00000${i % 10}_${i}.dump`);
      fs.writeFileSync(f, "sahte");
      const t = new Date(old + i * 60_000); // her biri 1dk daha yeni
      fs.utimesSync(f, t, t);
    }
    // Saklama penceresi İÇİNDE 5 dosya (10 günlük) — gün bazlı rotasyonun
    // bunlara DOKUNMAMASI gerekir. Sayı bazlı eski davranış bunları silerdi.
    const recent = Date.now() - 10 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      const f = path.join(backupDir, `tekserp_2026072${i}_120000.dump`);
      fs.writeFileSync(f, "sahte");
      const t = new Date(recent + i * 60_000);
      fs.utimesSync(f, t, t);
    }
    // Rotasyon DIŞI ön ekler: migration öncesi + geri yükleme öncesi güvenlik yedeği.
    // Üç `pre-restore_` dosyası bölüm 11'in konusu — tüm geri yükleme güvenlik ağı
    // bunların otomatik silinmemesine dayanıyor.
    const exemptNames = [
      "premigrate_1.0.0_20260101_000000.dump",
      "premigrate_1.5.0_20260201_000000.dump",
      "pre-restore_20260105_101010.dump",
      "pre-restore_20260210_111111.dump",
      "pre-restore_20260315_121212.dump",
    ];
    for (const name of exemptNames) {
      const f = path.join(backupDir, name);
      fs.writeFileSync(f, "sahte");
      const t = new Date(old);
      fs.utimesSync(f, t, t);
    }

    // -------------------------------------------------------------------------
    // 2) Gerçek yedek
    // -------------------------------------------------------------------------
    const result = await svc.runBackupJob("manual");
    check("yedek başarılı", result.ok, result.message);
    check("trigger etiketi 'manual'", result.trigger === "manual");
    check("dosya yolu döndü", !!result.file);

    if (result.file) {
      const st = fs.existsSync(result.file) ? fs.statSync(result.file) : null;
      check("dump dosyası diskte var", !!st);
      // pg_dump -Fc custom format: "PGDMP" imzasıyla başlar. Boş/yarım dosya değil.
      check("dump boş değil (>1KB)", (st?.size ?? 0) > 1024, `boyut=${st?.size}`);
      if (st) {
        const head = fs.readFileSync(result.file).subarray(0, 5).toString("latin1");
        check("dump custom-format imzası (PGDMP)", head === "PGDMP", `imza='${head}'`);
      }
      check("dosya adı tekserp_ ön ekli", path.basename(result.file).startsWith("tekserp_"));
      check("nihai ad .dump ile biter (.part DEĞİL)", result.file.endsWith(".dump"));
    }

    // -------------------------------------------------------------------------
    // 2b) YARIM DOSYA NİHAİ ADI ALMAZ (denetim 2026-08-09, F-CORE-OPS-001)
    // -------------------------------------------------------------------------
    // pg_dump eskiden DOĞRUDAN nihai ada yazıyordu; süreç dump ortasında ölürse
    // (pm2 restart / deploy) yarım `.dump` diskte kalıyor ve `/health` lastBackup +
    // rotasyonun MIN_KEEP koruması + Yedekler ekranı onu TAZE YEDEK sayıyordu.
    // Artık `.part`a yazılır ve YALNIZ doğrulama geçince rename edilir.
    check(
      "başarılı koşum sonrası ARTIK .part dosyası kalmadı",
      fs.readdirSync(backupDir).filter((f) => f.endsWith(".part")).length === 0,
      fs.readdirSync(backupDir).filter((f) => f.endsWith(".part")).join(","),
    );

    // Yarım dosya taklidi: elle bir `.part` bırak → hiçbir listeleme yüzeyi görmemeli.
    const fakePart = path.join(backupDir, "tekserp_20260809_030000.dump.part");
    fs.writeFileSync(fakePart, "YARIM-DUMP");
    const listingWithPart = await svc.listBackups();
    check(
      ".part dosyası listBackups'ta GÖRÜNMÜYOR",
      !listingWithPart.files.some((f) => f.name.endsWith(".part")),
      listingWithPart.files.map((f) => f.name).join(","),
    );
    check(
      ".part dosyası resolveBackupPath ile ÇÖZÜLEMİYOR (indirilemez)",
      svc.resolveBackupPath("tekserp_20260809_030000.dump.part") === null,
    );

    fs.rmSync(fakePart, { force: true }); // fixture sızmasın — aşağıdaki .part sayımları temiz kalsın
    // NOT: bayat `.part` budaması ikinci bir `runBackupJob` gerektiriyor ve o da
    // dosya sayımına dayanan aşağıdaki bölümleri (rotasyon, offsite) bozar —
    // bu yüzden bölüm 12'ye, tüm sayımlardan SONRAYA alındı.

    // -------------------------------------------------------------------------
    // 2c) pg_dump ZAMAN AŞIMI SÖZLEŞMESİ (F-OPS-VER-004) — kaynak kontrolü
    // -------------------------------------------------------------------------
    // Asılan bir child'ı gerçekten üretmek testte pratik değil (3 saatlik varsayılan);
    // korunan şey `spawn`a üst sınırın VERİLMİŞ olmasıdır. Sınır düşerse promise
    // hiç settle etmez ve o gecenin yedeği ne COMPLETED ne FAILED audit'i bırakır.
    const toolSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/services/helpers/pg-tool.helper.ts"),
      "utf8",
    );
    check("runTool spawn'a timeout veriyor", /spawn\([\s\S]*?timeout:/.test(toolSrc));
    check("runTool killSignal tanımlı", /killSignal:/.test(toolSrc));
    check("zaman aşımı sonucu çağırana bildiriliyor (timedOut)", /timedOut/.test(toolSrc));

    // ⚠️ MEKANİZMA KONTROLÜ — kaynak seviyesinde, ve bu BİLİNÇLİ bir tercih.
    // Yukarıdaki `.part` kontrolleri korunan olayı ÖLÇMÜYOR: onların hepsi eski
    // (doğrudan nihai ada yazan) davranışta da YEŞİL kalır — çünkü o davranışta
    // hiç `.part` üretilmez, yani "`.part` kalmadı" iddiası vakumen doğrudur.
    // (Negatif sondayla ölçüldü: dump hedefi `out`a çevrildiğinde 88/88 yeşil kaldı.)
    // Asıl olay — süreç dump ORTASINDA öldürülüyor — süreç içi bir testte
    // üretilemez; dolayısıyla korunabilecek şey ZİNCİRİN KENDİSİDİR:
    //   dump `.part`a yazar → doğrulama `.part`ı okur → rename SONRA gelir.
    const bkSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/services/backup.service.ts"),
      "utf8",
    );
    const dumpAt = bkSrc.indexOf('"-f", partPath');
    const verifyAt = bkSrc.indexOf("verifyBackupFile(partPath)");
    const renameAt = bkSrc.indexOf("rename(partPath, out)");
    check("pg_dump hedefi .part dosyası (nihai ad DEĞİL)", dumpAt !== -1);
    check("bütünlük doğrulaması .part üzerinde koşuyor", verifyAt !== -1);
    check("rename var (doğrulanmış dosya nihai adını alır)", renameAt !== -1);
    check(
      "SIRA: dump → doğrula → rename",
      dumpAt !== -1 && verifyAt !== -1 && renameAt !== -1 && dumpAt < verifyAt && verifyAt < renameAt,
      `dump@${dumpAt} verify@${verifyAt} rename@${renameAt}`,
    );

    // -------------------------------------------------------------------------
    // 3) Saklama rotasyonu
    // -------------------------------------------------------------------------
    const after = fs.readdirSync(backupDir);
    const nightly = after.filter((f) => f.startsWith("tekserp_"));
    const premigrate = after.filter((f) => f.startsWith("premigrate_"));
    const preRestore = after.filter((f) => f.startsWith("pre-restore_"));
    // GÜN bazlı saklama (varsayılan 30): 90 günlük 20 dosya silinir, saklama
    // penceresindeki 5 dosya + bu koşumun yeni yedeği KALIR. Ayrıca MIN_KEEP
    // tabanı gereği en yeni 3 dosya yaşına bakılmaksızın korunur.
    check(
      "gün bazlı rotasyon: saklama içindeki dosyalara DOKUNMADI",
      nightly.length >= 6,
      `bulunan=${nightly.length} (beklenen ≥6: 5 taze + 1 yeni)`,
    );
    check(
      "gün bazlı rotasyon: 30 günden eskiler silindi",
      !nightly.some((f) => f.startsWith("tekserp_2026010")),
      `kalan eskiler=${nightly.filter((f) => f.startsWith("tekserp_2026010")).join(",")}`,
    );
    check("premigrate_* rotasyondan MUAF (2 dosya korundu)", premigrate.length === 2, `bulunan=${premigrate.length}`);
    // Bölüm 11: güvenlik yedeği invariant'ı. Bu düşerse geri yükleme güvenlik ağı
    // sessizce yok olur — dosyalar en eski mtime'a sahip, yani rotasyon onları
    // ilk sırada silmeye çalışırdı.
    check("pre-restore_* rotasyondan MUAF (3 dosya korundu)", preRestore.length === 3, `bulunan=${preRestore.length}`);
    check("durationMs raporlandı", typeof result.durationMs === "number" && result.durationMs >= 0, String(result.durationMs));
    check(
      "yeni yedek rotasyondan sağ çıktı",
      !!result.file && nightly.includes(path.basename(result.file)),
    );

    // -------------------------------------------------------------------------
    // 4) Offsite kopya
    // -------------------------------------------------------------------------
    const offsite = fs.existsSync(offsiteDir) ? fs.readdirSync(offsiteDir) : [];
    check("offsite kopya oluştu", offsite.length === 1, `bulunan=${offsite.length}`);
    if (result.file && offsite.length === 1) {
      check("offsite kopya adı yerel dump ile aynı", offsite[0] === path.basename(result.file));
      check(
        "offsite kopya boyutu yerelle aynı",
        fs.statSync(path.join(offsiteDir, offsite[0]!)).size === fs.statSync(result.file).size,
      );
    }

    // -------------------------------------------------------------------------
    // 5) Eşzamanlılık guard'ı — schtasks serileştirmesi gitti, backend engelliyor
    // -------------------------------------------------------------------------
    const [a, b] = await Promise.all([svc.runBackupJob("manual"), svc.runBackupJob("nightly")]);
    const blocked = [a, b].filter((r) => !r.ok && r.message.includes("sürüyor"));
    check("paralel iki yedekten biri reddedildi", blocked.length === 1, `reddedilen=${blocked.length}`);

    // -------------------------------------------------------------------------
    // 6) listBackups() sözleşmesi (panelin bağlı olduğu alanlar)
    // -------------------------------------------------------------------------
    const listing = await svc.listBackups();
    check("listBackups dosyaları döndü", listing.files.length > 0);
    check("backupDir mutlak yol", !!listing.backupDir && path.isAbsolute(listing.backupDir));
    check("restoreTarget dolu", !!listing.restoreTarget?.database && !!listing.restoreTarget?.host);
    check("pm2AppName dolu", !!listing.pm2AppName);
    check("running artık false", listing.running === false);
    check("lastResult raporlandı", listing.lastResult?.ok === true);
    check(
      "en yeni dosya ilk sırada",
      listing.files.length > 1 && listing.files[0]!.time >= listing.files[1]!.time,
    );

    // -------------------------------------------------------------------------
    // 7) resolveBackupPath güvenliği (path traversal)
    // -------------------------------------------------------------------------
    const good = result.file ? svc.resolveBackupPath(path.basename(result.file)) : null;
    check("geçerli dump adı çözüldü", !!good);
    check("traversal reddedildi", svc.resolveBackupPath("../../etc/passwd") === null);
    check("dump olmayan uzantı reddedildi", svc.resolveBackupPath("notes.txt") === null);
    check("alt dizinli ad reddedildi", svc.resolveBackupPath("sub/x.dump") === null);

    // -------------------------------------------------------------------------
    // 9) Bozuk pg_dump yolu → net hata (sessiz başarısızlık değil)
    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // 12) Geri yükleme etki önizlemesi (backup-impact.service)
    // -------------------------------------------------------------------------
    const impactSvc = await import("../src/services/backup-impact.service");

    // --- 12a) restoreGuards saf fonksiyonu (dört dal)
    const okTarget = { host: "h", port: "5432", user: "u", database: "d" };
    const gBase = { backupDirConfigured: true, running: false, restoreTarget: okTarget, verify: "ok" as const, isNewest: true, newerBackupName: null };
    check("guard: temiz durum → canRestore", impactSvc.restoreGuards(gBase).canRestore);
    check("guard: yedek koşuyor → BLOK", !impactSvc.restoreGuards({ ...gBase, running: true }).canRestore);
    check("guard: restoreTarget yok → BLOK", !impactSvc.restoreGuards({ ...gBase, restoreTarget: null }).canRestore);
    check("guard: verify=corrupt → BLOK", !impactSvc.restoreGuards({ ...gBase, verify: "corrupt" }).canRestore);
    const gUnknown = impactSvc.restoreGuards({ ...gBase, verify: "unknown" });
    check("guard: verify=unknown → geçer + uyarı", gUnknown.canRestore && gUnknown.warnings.length > 0);
    const gOld = impactSvc.restoreGuards({ ...gBase, isNewest: false, newerBackupName: "tekserp_yeni.dump" });
    check("guard: en yeni değil → geçer + uyarı", gOld.canRestore && gOld.warnings.some((w) => w.includes("tekserp_yeni.dump")));

    // --- 12b) Cutoff GELECEKTE → iş kaybı sayımları 0 olmalı
    // Adı parse edilemeyen bir dosya + gelecek mtime → cutoff = mtime (gelecek).
    // Bu aynı zamanda mtime-fallback dalını da doğrular.
    const futureName = "elden_gelecek.dump";
    const futurePath = path.join(backupDir, futureName);
    fs.copyFileSync(result.file!, futurePath);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    fs.utimesSync(futurePath, future, future);

    const impFuture = await impactSvc.getRestoreImpact(futureName);
    check("impact: gelecek cutoff için sonuç döndü", !!impFuture);
    if (impFuture) {
      check("impact: cutoff kaynağı mtime (ad çözülemedi)", impFuture.cutoff.source === "mtime");
      check("impact: mtime fallback uyarısı verildi", impFuture.warnings.some((w) => w.includes("dosya adından çözülemedi")));
      const bizRows = impFuture.groups.filter((g) => g.key !== "system").flatMap((g) => g.rows);
      check("impact: gelecek cutoff → tüm iş sayımları 0", bizRows.every((r) => r.count === 0), JSON.stringify(bizRows.filter((r) => r.count !== 0).map((r) => `${r.key}=${r.count}`)));
      check("impact: totalCreated 0", impFuture.totalCreated === 0);
      check("impact: measuredAllRows true (hiçbir satır düşmedi)", impFuture.measuredAllRows);
      check("impact: 4 grup döndü", impFuture.groups.length === 4);
      check("impact: safetyBackup adı pre-restore_ ile başlıyor", impFuture.safetyBackup?.fileName.startsWith("pre-restore_") === true);
      // Performans kanaryası: enum-IN hilesi düşerse (ya da biri "sadeleştirirse")
      // rolls/orders seq scan'e döner ve bu eşik aşılır.
      check("impact: durationMs < 10sn (performans kanaryası)", impFuture.durationMs < 10_000, `${impFuture.durationMs}ms`);
    }

    // --- 12c) Cutoff GEÇMİŞTE → sayımlar > 0 + audit rollup
    // Test için DOMAIN audit satırları yaz (finally'de silinir).
    await prisma.systemLog.createMany({
      data: [
        { action: "CREATE", tableName: "TEST_IMPACT", recordId: "1", category: "DOMAIN" },
        { action: "CREATE", tableName: "TEST_IMPACT", recordId: "2", category: "DOMAIN" },
        { action: "UPDATE", tableName: "TEST_IMPACT", recordId: "1", category: "DOMAIN" },
      ],
    });

    const pastName = "elden_dun.dump";
    const pastPath = path.join(backupDir, pastName);
    fs.copyFileSync(result.file!, pastPath);
    const past = new Date(Date.now() - 5 * 60 * 1000); // 5dk önce
    fs.utimesSync(pastPath, past, past);

    const impPast = await impactSvc.getRestoreImpact(pastName);
    check("impact: geçmiş cutoff için sonuç döndü", !!impPast);
    if (impPast) {
      check("impact: en yeni yedek DEĞİL uyarısı", !impPast.isNewest && impPast.warnings.some((w) => w.includes("en yeni yedek DEĞİL")));
      // audit.available sözleşmesi: kapsam cutoff'a uzanıyorsa true, uzanmıyorsa false.
      // Mutlak değer yerine INVARIANT'ı doğrula (dev DB'nin log yaşı bilinemez).
      const oldest = impPast.audit.oldestLogAt ? new Date(impPast.audit.oldestLogAt).getTime() : null;
      const cut = new Date(impPast.cutoff.at).getTime();
      const expectedAvailable = oldest !== null && oldest <= cut;
      check("impact: audit.available invariant'ı tutuyor", impPast.audit.available === expectedAvailable, `available=${impPast.audit.available} oldest=${impPast.audit.oldestLogAt} cutoff=${impPast.cutoff.at}`);
      if (impPast.audit.available) {
        const row = impPast.audit.byTable.find((t) => t.tableName === "TEST_IMPACT");
        if (row) {
          // Sakin ortam (CI'ın temiz DB'si dahil): fixture listede → katı doğrulama.
          check("impact: audit rollup TEST_IMPACT satırını buldu", true);
          check("impact: rollup CREATE=2 UPDATE=1", row.created === 2 && row.updated === 1, JSON.stringify(row));
        } else {
          // byTable BİLİNÇLİ top-12 (backup-impact.service slice(0,12) — UI kararı).
          // Yoğun dev DB'de aynı 5dk penceresine 12+ tabloya audit yazan koşular
          // (örn. ardışık tam test paketleri) fixture'ı listeden MEŞRU şekilde iter
          // — "ortam verisine bağımlı olma" kuralı gereği yokluk hata değil,
          // yokluğun SEBEBİ doğrulanır: liste dolu VE en küçüğü fixture'dan yoğun.
          const totals = impPast.audit.byTable.map((t) => t.total);
          const min = totals.length ? Math.min(...totals) : 0;
          check(
            "impact: TEST_IMPACT top-12 dışı — listedekilerin hepsi daha yoğun (slice meşru)",
            impPast.audit.byTable.length === 12 && min >= 3,
            JSON.stringify({ listLen: impPast.audit.byTable.length, minTotal: min }),
          );
        }
        check("impact: rollup UPDATE'leri sayıyor (INSERT-only sınırının telafisi)", impPast.audit.updated >= 1);
      }
    }

    // --- 12c-2) ÇOK ESKİ cutoff → sayımlar > 0 olmalı.
    // Bu kontrol olmadan 12b trivially geçerdi: bir hata yüzünden tüm sayımlar
    // sessizce 0 dönse de "gelecek cutoff → 0" iddiası tutardı. Burada sorguların
    // gerçekten koştuğunu ve filtrenin çalıştığını kanıtlıyoruz.
    //
    // ⚠️ TOPU TEST KENDİ YARATIR — eski hâli "seed verisi var" varsayıyordu ama NE
    // `npm run seed` NE `seed:fixtures` top üretir; dev DB'deki toplar elle/demo
    // işlerden kalmaydı. Sonuç: yerelde geçiyor, TEMİZ CI DB'sinde "yeni top sayısı > 0"
    // düşüyordu (2026-07-30 CI bulgusu). `finally` siler.
    const impactItem = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
    if (impactItem) {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-IMPACT-${Date.now().toString().slice(-9)}`,
          itemId: impactItem.id,
          initialQty: 1,
          currentQty: 1,
          qualityGrade: "1.KALITE",
          width: 100,
          status: "WAREHOUSE",
          entrySource: "SUPPLIER_RECEIPT",
        },
        select: { id: true },
      });
      impactRollId = r.id;
    }
    const ancientName = "elden_2021.dump";
    const ancientPath = path.join(backupDir, ancientName);
    fs.copyFileSync(result.file!, ancientPath);
    const ancient = new Date(2021, 0, 1);
    fs.utimesSync(ancientPath, ancient, ancient);

    const impAncient = await impactSvc.getRestoreImpact(ancientName);
    check("impact: 2021 cutoff → totalCreated > 0 (sorgular gerçekten koştu)", (impAncient?.totalCreated ?? 0) > 0, `total=${impAncient?.totalCreated}`);
    check("impact: 2021 cutoff → yeni top sayısı > 0", ((impAncient?.groups.find((g) => g.key === "production")?.rows.find((r) => r.key === "roll")?.count) ?? 0) > 0);

    // --- 12c-3) `pre-restore_` dosyaları "daha yeni yedek" olarak ÖNERİLMEZ.
    // Onlar terk edilmek üzere olan durumun kopyası; mtime'a göre listenin başında
    // oturabilirler ama daha iyi bir dönüş noktası DEĞİLDİR.
    const freshPreRestore = path.join(backupDir, "pre-restore_20260730_235959.dump");
    fs.copyFileSync(result.file!, freshPreRestore);
    const veryFresh = new Date(Date.now() + 30 * 60 * 1000); // en yeni mtime
    fs.utimesSync(freshPreRestore, veryFresh, veryFresh);

    const impVsPreRestore = await impactSvc.getRestoreImpact(path.basename(result.file!));
    check(
      "impact: pre-restore_ dosyası 'daha yeni yedek' olarak önerilmiyor",
      impVsPreRestore?.newerBackup?.name.startsWith("pre-restore_") !== true,
      `önerilen=${impVsPreRestore?.newerBackup?.name}`,
    );
    fs.rmSync(freshPreRestore, { force: true });

    // --- 12d) Olmayan dosya → null (rota katmanı 404 döndürecek)
    check("impact: olmayan dosya → null", (await impactSvc.getRestoreImpact("yok_boyle.dump")) === null);
    check("impact: traversal → null", (await impactSvc.getRestoreImpact("../../etc/passwd")) === null);

    // -------------------------------------------------------------------------
    // 13) verifyBackupFile — bütünlük doğrulaması gerçekten bozukluğu yakalıyor mu
    // -------------------------------------------------------------------------
    // Geri yükleme önizlemesi bu fonksiyona güveniyor: `--clean` şemayı düşürdükten
    // SONRA "dosya bozukmuş" öğrenmek felakettir.
    if (result.file) {
      check("sağlam dump → verify=ok", (await svc.verifyBackupFile(result.file)) === "ok");
      const truncated = path.join(root, "kirpik.dump");
      fs.writeFileSync(truncated, fs.readFileSync(result.file).subarray(0, 512));
      check("512 bayta kırpılmış dump → verify=corrupt", (await svc.verifyBackupFile(truncated)) === "corrupt");
      check("olmayan dosya → verify=unknown", (await svc.verifyBackupFile(path.join(root, "yok.dump"))) === "unknown");
    }

    // -------------------------------------------------------------------------
    // 8) Yedek saati çözümleme önceliği: SystemSetting → BACKUP_HOUR env → 3
    // -------------------------------------------------------------------------
    // Panelden ayarlanabilirliğin sözleşmesi bu: DB kaydı env'i EZER, kayıt yoksa
    // env geçerli kalır (geriye-uyum), o da yoksa 3.
    const settings = await import("../src/services/system-setting.service");
    const envBefore = process.env.BACKUP_HOUR;
    await prisma.systemSetting.deleteMany({ where: { key: "backup.hour" } });

    delete process.env.BACKUP_HOUR;
    check("kayıt+env yokken default 3", (await settings.readBackupHour()) === 3);

    process.env.BACKUP_HOUR = "5";
    check("kayıt yokken env geçerli (5)", (await settings.readBackupHour()) === 5);

    await prisma.systemSetting.upsert({
      where: { key: "backup.hour" },
      create: { key: "backup.hour", value: 21, description: "test" },
      update: { value: 21 },
    });
    check("DB kaydı env'i EZER (21)", (await settings.readBackupHour()) === 21);

    await prisma.systemSetting.update({ where: { key: "backup.hour" }, data: { value: 99 } });
    check("aralık dışı DB değeri env'e düşer (5)", (await settings.readBackupHour()) === 5);

    await prisma.systemSetting.deleteMany({ where: { key: "backup.hour" } });
    if (envBefore === undefined) delete process.env.BACKUP_HOUR;
    else process.env.BACKUP_HOUR = envBefore;

    // -------------------------------------------------------------------------
    // 9) Bozuk pg_dump yolu → net hata (sessiz başarısızlık değil)
    // -------------------------------------------------------------------------
    // pgTool() env'i çağrı anında okur → yeniden import GEREKMEZ.
    const goodBin = process.env.PG_BIN_DIR;
    process.env.PG_BIN_DIR = path.join(root, "yok-boyle-bir-klasor");
    const broken = await svc.runBackupJob("manual");
    if (goodBin === undefined) delete process.env.PG_BIN_DIR;
    else process.env.PG_BIN_DIR = goodBin;
    check("bulunamayan pg_dump açık hata verdi", !broken.ok);
    check(
      "hata mesajı PG_BIN_DIR'e işaret ediyor",
      broken.message.includes("PG_BIN_DIR") || broken.message.includes("başlatılamadı"),
      broken.message,
    );
    // Bozuk yol koşumu da geriye yarım dosya BIRAKMAMALI (spawnError dalı `.part`ı siler).
    check(
      "başarısız koşum .part bırakmadı",
      fs.readdirSync(backupDir).filter((f) => f.endsWith(".part")).length === 0,
      fs.readdirSync(backupDir).filter((f) => f.endsWith(".part")).join(","),
    );

    // -------------------------------------------------------------------------
    // 12) BAYAT .part BUDAMASI (F-CORE-OPS-001) — dosya sayımlarından SONRA
    // -------------------------------------------------------------------------
    // Ek bir `runBackupJob` gerektirdiği için en sona alındı: yukarıdaki rotasyon
    // ve offsite kontrolleri klasördeki dosya SAYISINA dayanıyor.
    const stalePart = path.join(backupDir, "tekserp_20260101_030000.dump.part");
    fs.writeFileSync(stalePart, "YARIM-DUMP");
    const staleMs = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(stalePart, staleMs / 1000, staleMs / 1000);
    const freshPart = path.join(backupDir, "tekserp_20260102_030000.dump.part");
    fs.writeFileSync(freshPart, "YARIM-DUMP"); // taze → DOKUNULMAMALI
    await svc.runBackupJob("manual");
    check("24 saatten ESKİ .part budandı", !fs.existsSync(stalePart));
    check("TAZE .part'a dokunulmadı (koşan dump'ın dosyası olabilir)", fs.existsSync(freshPart));
  } finally {
    // Test kendi yarattığını siler: geçici klasör + bu koşumun audit satırları
    // + 12c-2'nin geçici topu.
    fs.rmSync(root, { recursive: true, force: true });
    if (impactRollId) {
      await prisma.roll.deleteMany({ where: { id: impactRollId } }).catch(() => {
        /* best-effort — testi düşürmez */
      });
    }
    try {
      await prisma.systemLog.deleteMany({
        where: {
          OR: [
            { action: { in: ["BACKUP_COMPLETED", "BACKUP_FAILED"] }, createdAt: { gte: testStart } },
            { tableName: "TEST_IMPACT" }, // 12c'de yazılan rollup fixture'ı
          ],
        },
      });
    } catch {
      /* audit temizliği best-effort — testi düşürmez */
    }
    await prisma.$disconnect();
  }
}

main()
  .catch((err) => {
    console.error("Test çalıştırılamadı:", err);
    fail += 1;
  })
  .then(async () => {
    // ═══════════════════════════════════════════════════════════════════════
    // §S — GECE YEDEĞİNİN SAHİBİ görünür mü (BULGU-T1-020)
    // ═══════════════════════════════════════════════════════════════════════
    // "Yedek alınıyor mu" ile "yedeği KİM alıyor" ayrı sorular. İkincisi
    // `ecosystem.config.js`te yaşıyor ve `kur.ps1` her kurulumda o dosyayı
    // paketinkiyle EZİYOR (`.env` korunur, ecosystem KORUNMAZ) → sahadaki
    // ayar sessizce repo değerine döner. Ölçüldü (2026-08-31): repo
    // `BACKUP_SCHEDULE_ENABLED:"false"` derken canlı sistem 2026-08-25
    // 03:05'te `trigger=nightly` yedek üretmiş, yani AYRIŞMIŞ.
    //
    // ⚠️ Bu alan bir ALARM DEĞİL, bir OLGU: sahada "harici" MEŞRUDUR (backend
    // çökse de yedek alınsın). Değeri, yaş hükmünün yanında durup "kimse
    // almıyor" durumunu tek bakışta görünür kılmasıdır.
    console.log("\n=== §S: gece yedeğinin sahibi (/api/admin/health) ===");
    const eski = process.env.BACKUP_SCHEDULE_ENABLED;
    try {
      const { backupScheduler } = await import("../src/app");
      process.env.BACKUP_SCHEDULE_ENABLED = "false";
      const harici = backupScheduler();
      delete process.env.BACKUP_SCHEDULE_ENABLED;
      const backend = backupScheduler();
      process.env.BACKUP_SCHEDULE_ENABLED = "true";
      const acikca = backupScheduler();

      check("§S: BACKUP_SCHEDULE_ENABLED=false → 'harici'", harici === "harici", harici);
      // ⚠️ İKİ YÖNLÜ: yalnız 'false' dalını ölçmek, fonksiyon sabit 'harici'
      // döndürse de YEŞİL kalırdı.
      check("§S: değişken YOKKEN → 'backend' (varsayılan)", backend === "backend", backend);
      check("§S: 'true' → 'backend'", acikca === "backend", acikca);
    } finally {
      if (eski === undefined) delete process.env.BACKUP_SCHEDULE_ENABLED;
      else process.env.BACKUP_SCHEDULE_ENABLED = eski;
    }
  })
  .finally(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
