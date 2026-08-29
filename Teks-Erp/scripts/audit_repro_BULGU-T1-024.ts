// =============================================================================
// AUDIT REPRO — BULGU-T1-024: "son yedek" bayatlık sayacı deploy yedeğiyle
// (premigrate_) sıfırlanıyor; klasör okunamayınca 48 saatlik yedeksizlikten
// DAHA HAFİF alarm üretiliyor.
//
// Ortam: SADECE dev. Prod/uzak hedefte çalışmayı REDDEDER (devDbGuard).
// DB'YE HİÇ DOKUNMAZ (ne okuma ne yazma) — bulgu dosya sistemi + saf fonksiyon
// sınıfındadır. Guard yine de koşar (sözleşme + yanlış makinede çalışmasın).
//
// Beklenen (sağlıklı sistem):
//   - "son yedek" = son GECE yedeği (tekserp_*.dump). Deploy güvenlik yedeği
//     (premigrate_) ve geri-yükleme yedeği (pre-restore_) bayatlığı SIFIRLAMAZ.
//   - Yedek klasörü okunamıyorsa alarm, 48 saat yedeksizlikten DAHA AĞIR olur.
// Gözlenen: aşağıdaki koşum logu (audit/repro/BULGU-T1-024.log).
//
// YÖNTEM — YENİDEN YAZIM YOK: denetlenen iki kod parçası dosyadan BİREBİR
// (satır aralığıyla) okunur, TypeScript derleyicisiyle JS'e çevrilir ve
// çalıştırılır. Yani ölçülen şey üretim kaynağının kendisidir:
//   ① Teks-Erp/src/app.ts:194-219            → latestBackupInfo()
//   ② Electron/src/pages/System/ServerStatus/serverHealth.ts:208-211 → yedek alarmı
//
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-024.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "";
  let db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { backupKind } from "../src/services/helpers/backup-naming.helper";

const REPO = path.resolve(__dirname, "..", "..");
const APP_TS = path.join(REPO, "Teks-Erp", "src", "app.ts");
const EL_TS = path.join(
  REPO, "Electron", "src", "pages", "System", "ServerStatus", "serverHealth.ts",
);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass += 1; console.log(`✅ ${label}`); }
  else { fail += 1; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** Dosyadan [ilk,son] satır aralığını BİREBİR alır (1 tabanlı, uçlar dahil). */
function slurpLines(file: string, first: number, last: number): string {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  return lines.slice(first - 1, last).join("\n");
}

function toJs(tsSrc: string): string {
  return ts.transpileModule(tsSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

type BackupInfo = { name: string; time: string } | null;
type Alert = { level: "warn" | "crit"; message: string };

// ── ① Üretim kaynağından latestBackupInfo (her çağrıda TAZE kapanış: 30 sn'lik
//     modül-içi cache senaryolar arasında sızmasın) ────────────────────────────
const APP_FIRST = 194;
const APP_LAST = 219;
const appSnippet = slurpLines(APP_TS, APP_FIRST, APP_LAST);

function makeLatestBackupInfo(backupDir: string | undefined): () => BackupInfo {
  const js = toJs(`${appSnippet}\nexports.fn = latestBackupInfo;`);
  const factory = new Function("exports", "fs", "path", "backupDir", `${js}\nreturn exports.fn;`);
  return factory({}, fs, path, backupDir) as () => BackupInfo;
}

// ── ② Üretim kaynağından yedek alarmı (Electron) ─────────────────────────────
const EL_FIRST = 208;
const EL_LAST = 211;
const elSnippet = slurpLines(EL_TS, EL_FIRST, EL_LAST);
const alertJs = toJs(`exports.fn = function (d, out) {\n${elSnippet}\n};`);
const backupAlert = new Function("exports", `${alertJs}\nreturn exports.fn;`)({}) as (
  d: { lastBackup: BackupInfo }, out: Alert[],
) => void;

function alertsFor(info: BackupInfo): Alert[] {
  const out: Alert[] = [];
  backupAlert({ lastBackup: info }, out);
  return out;
}

const H = 3_600_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auditrepro-t1-024-"));

/** Klasörü sıfırlayıp verilen dosyaları (yaş = saat) yazar. */
function seed(files: Array<{ name: string; ageH: number }>): void {
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
  for (const f of files) {
    const p = path.join(tmp, f.name);
    fs.writeFileSync(p, "PGDMP-AUDITREPRO");           // içerik önemsiz: kod yalnız ada+mtime bakar
    const t = new Date(Date.now() - f.ageH * H);
    fs.utimesSync(p, t, t);
  }
}

function describe(info: BackupInfo): string {
  if (!info) return "null (yedek yok gibi okunur)";
  const ageH = (Date.now() - new Date(info.time).getTime()) / H;
  return `${info.name}  [tür=${backupKind(info.name)}, yaş=${ageH.toFixed(1)} sa]`;
}

function scenario(
  baslik: string, files: Array<{ name: string; ageH: number }>, dirOverride?: string,
): { info: BackupInfo; alerts: Alert[] } {
  if (!dirOverride) seed(files);
  const info = makeLatestBackupInfo(dirOverride ?? tmp)();
  const alerts = alertsFor(info);
  console.log(`\n── ${baslik}`);
  console.log(`   klasör içeriği : ${files.map((f) => `${f.name}(${f.ageH}sa)`).join(", ") || "(yok)"}`);
  console.log(`   lastBackup     : ${describe(info)}`);
  console.log(
    `   panel alarmı   : ${alerts.length === 0 ? "— HİÇ ALARM YOK —" : alerts.map((a) => `${a.level.toUpperCase()}: ${a.message}`).join(" | ")}`,
  );
  return { info, alerts };
}

let bozulma = 0;

async function main(): Promise<void> {
  console.log("=".repeat(78));
  console.log("AUDIT REPRO — BULGU-T1-024");
  console.log("=".repeat(78));
  console.log(`Kaynak ①: Teks-Erp/src/app.ts:${APP_FIRST}-${APP_LAST} (latestBackupInfo, BİREBİR)`);
  console.log(`Kaynak ②: Electron/.../serverHealth.ts:${EL_FIRST}-${EL_LAST} (yedek alarmı, BİREBİR)`);
  console.log(`Geçici klasör: ${tmp}`);
  console.log("\n--- ① dosyadan alınan üretim kodu (doğrulanabilir olsun diye basılıyor) ---");
  console.log(appSnippet);
  console.log("--- ② ---");
  console.log(elSnippet);

  // Ön kontrol: doğru satırları aldık mı?
  check(
    "① doğru blok alındı (latestBackupInfo + cache değişkenleri)",
    appSnippet.includes("function latestBackupInfo()") &&
      appSnippet.includes("backupCacheComputedAt") &&
      appSnippet.trimEnd().endsWith("}"),
  );
  check(
    "② doğru blok alındı (ageH dallanması)",
    elSnippet.includes("const ageH") && elSnippet.includes("ageH >= 48"),
  );
  check(
    "① kaynakta yedek TÜRÜ süzgeci YOK (yalnız .dump uzantısı)",
    appSnippet.includes('.endsWith(".dump")') &&
      !appSnippet.includes("backupKind") &&
      !appSnippet.includes("tekserp_") &&
      !appSnippet.includes("NIGHTLY_PREFIX"),
  );

  console.log("\n" + "=".repeat(78));
  console.log("SENARYOLAR");
  console.log("=".repeat(78));

  // S1 — sağlıklı: dün gece yedeği var
  const s1 = scenario("S1 · Gece yedeği dün alınmış (referans)", [
    { name: "tekserp_20260827_030500.dump", ageH: 20 },
  ]);
  check("S1 · alarm yok (doğru davranış)", s1.alerts.length === 0);

  // S2 — gece yedeği 10 gündür alınmıyor, deploy YOK
  const s2 = scenario("S2 · Gece yedeği 10 GÜNDÜR alınmıyor, deploy yok", [
    { name: "tekserp_20260818_030500.dump", ageH: 240 },
  ]);
  check(
    "S2 · KRİTİK alarm çıkıyor (kapı burada çalışıyor)",
    s2.alerts.some((a) => a.level === "crit"),
  );

  // S3 — AYNI durum + bugün bir sürüm çıkıldı (kur.ps1 premigrate_ yazar)
  const s3 = scenario(
    "S3 · Aynı 10 günlük yedeksizlik + BUGÜN deploy (kur.ps1 premigrate_ yazdı)",
    [
      { name: "tekserp_20260818_030500.dump", ageH: 240 },
      { name: "premigrate_20260828_101500.dump", ageH: 0.2 },
    ],
  );
  const s3Bozuk =
    backupKind(s3.info?.name ?? "") !== "nightly" && s3.alerts.length === 0;
  if (s3Bozuk) bozulma += 1;
  // Bekçi semantiği: ✅ = sağlıklı, ❌ = bulgu CANLI.
  check(
    "S3 · SAĞLIKLI BEKLENTİ: deploy yedeği 10 günlük yedeksizliği gizlemez",
    !s3Bozuk,
    "BOZULMA: premigrate_ dosyası 'son yedek' sayıldı, alarm sıfırlandı",
  );

  // S4 — geri yükleme güvenlik yedeği de aynı etkiyi yapar
  const s4 = scenario(
    "S4 · Aynı yedeksizlik + geri-yükleme güvenlik yedeği (pre-restore_)",
    [
      { name: "tekserp_20260818_030500.dump", ageH: 240 },
      { name: "pre-restore_20260828_101500.dump", ageH: 0.2 },
    ],
  );
  const s4Bozuk = backupKind(s4.info?.name ?? "") !== "nightly" && s4.alerts.length === 0;
  if (s4Bozuk) bozulma += 1;
  check(
    "S4 · SAĞLIKLI BEKLENTİ: pre-restore_ yedeği bayatlık sayacını sıfırlamaz",
    !s4Bozuk,
    "BOZULMA: pre-restore_ dosyası 'son yedek' sayıldı",
  );

  // S5 — klasör okunamıyor (disk/paylaşım/izin) → catch → null
  const s5 = scenario(
    "S5 · Yedek klasörü OKUNAMIYOR (silinmiş/izin yok) → catch → null",
    [],
    path.join(tmp, "hic-olmayan-klasor"),
  );
  const s5Level = s5.alerts[0]?.level ?? "yok";
  const inversiyon = s5Level === "warn" && s2.alerts.some((a) => a.level === "crit");
  if (inversiyon) bozulma += 1;
  check(
    "S5 · SAĞLIKLI BEKLENTİ: klasör okunamıyorsa alarm >= 48 saatlik yedeksizlik kadar ağır",
    !inversiyon,
    `BOZULMA (ters sıralama): okunamayan klasör "${s5Level}", 48 sa yedeksizlik "crit"`,
  );

  // S6 — bilgi ZATEN elde: aynı adlar backupKind ile doğru sınıflanıyor
  console.log("\n── S6 · Türü ayırt edecek bilgi zaten var (backup-naming.helper.backupKind)");
  for (const n of [
    "tekserp_20260818_030500.dump",
    "premigrate_20260828_101500.dump",
    "pre-restore_20260828_101500.dump",
  ]) {
    console.log(`   ${n.padEnd(38)} → ${backupKind(n)}`);
  }
  check(
    "S6 · sınıflandırıcı mevcut ve doğru (eksik olan yalnız ÇAĞRI)",
    backupKind("tekserp_x.dump") === "nightly" &&
      backupKind("premigrate_x.dump") === "premigrate" &&
      backupKind("pre-restore_x.dump") === "pre-restore",
  );

  // ── §5 GERÇEK VERİ: bu makinenin yedek klasörü ─────────────────────────────
  console.log("\n" + "=".repeat(78));
  console.log("GERÇEK KLASÖR ÖLÇÜMÜ (salt-okunur) — BACKUP_DIR");
  console.log("=".repeat(78));
  const realDir = process.env.BACKUP_DIR;
  if (!realDir || !fs.existsSync(realDir)) {
    console.log(`   BACKUP_DIR okunamadı (${realDir ?? "tanımsız"}) — bu bölüm atlandı.`);
  } else {
    const rows = fs
      .readdirSync(realDir)
      .filter((f) => f.toLowerCase().endsWith(".dump"))
      .map((name) => ({
        name,
        kind: backupKind(name),
        mtime: fs.statSync(path.join(realDir, name)).mtimeMs,
      }))
      .sort((a, b) => a.mtime - b.mtime);
    console.log(`   ${realDir} → ${rows.length} .dump dosyası`);
    const sayim = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`   tür dağılımı: ${JSON.stringify(sayim)}`);
    // Kronolojik yürü: "en yeni .dump" gece yedeği DEĞİLKEN geçen pencereler.
    let sonNightly = 0;
    let pencere = 0;
    let toplamDk = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      if (r.kind === "nightly") { sonNightly = r.mtime; continue; }
      const bitis = rows.slice(i + 1).find((x) => x.kind === "nightly")?.mtime ?? Date.now();
      const dk = (bitis - r.mtime) / 60000;
      if (dk >= 1) {
        pencere += 1;
        toplamDk += dk;
        console.log(
          `   • ${new Date(r.mtime).toISOString().slice(0, 16)} → ${new Date(bitis).toISOString().slice(0, 16)}` +
            `  (${(dk / 60).toFixed(1)} sa) "son yedek" = ${r.name} [${r.kind}]` +
            (sonNightly ? `, gerçek gece yedeği ${((r.mtime - sonNightly) / 3600000).toFixed(1)} sa önceydi` : ""),
        );
      }
    }
    console.log(
      `   ⇒ ${pencere} pencerede panel "son yedek" olarak gece yedeği OLMAYAN bir dosya gösterirdi (toplam ${(toplamDk / 60).toFixed(1)} sa).`,
    );
  }

  console.log("\n" + "=".repeat(78));
  console.log(`SONUÇ: ${pass} geçti / ${fail} kaldı — gözlenen BOZULMA sayısı: ${bozulma}/3`);
  console.log("(❌ = bulgu CANLI; düzeltme sonrası hepsi ✅ olmalı)");
  console.log("=".repeat(78));
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); fail += 1; })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = fail > 0 ? 1 : 0;
  });
