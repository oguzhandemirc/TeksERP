// =============================================================================
// Takas komutu (Faz B) — SAF üretici
// =============================================================================
// Backend takası ÇALIŞTIRAMAZ: rename kendi bağlantısını koparır ve kendi sürecini
// (`pm2 stop`/`start` ya da hizmet düzeninde `Stop-Service`/`Start-Service`) yönetemez. Bu yüzden operatörün sunucuda çalıştıracağı komut
// bloğunu üretiyoruz — ileri ve GERİ ALMA olmak üzere iki tane.
//
// Blok BACKEND'de üretilir (istemcide değil): `PG_BIN_DIR`'den çözülmüş psql
// yolu, bakım DB adı, backend cwd'si (`migrate deploy` için) ve canlı DB adı
// sunucu bilgisidir; bayat istemci durumundan kurulmamalı.
//
// -----------------------------------------------------------------------------
// BEŞ KURAL — hepsi load-bearing, hiçbiri "sadeleştirilmemeli"
// -----------------------------------------------------------------------------
// 1. `exit`/`throw` YOK. Blok interaktif konsola YAPIŞTIRILIYOR; üst seviye
//    `throw` yalnız o satırı düşürür, sonraki satırlar KOŞMAYA DEVAM EDER.
//    `exit` ise pencereyi kapatır ve backend durdurulmuş hâlde ASILI kalır.
//    Guard iptal değil, KOŞULLU ÇALIŞTIRMA olmak zorunda.
// 2. Her native çağrıdan ÖNCE `$LASTEXITCODE = 1`. Bu değişken yalnız *native*
//    exe'lerce yazılır; `psql` PATH'te yoksa PowerShell throw eder ve değişken
//    ÖNCEKİ değerini korur → guard sessizce geçer. Buradaki bedeli "backend hiç
//    açılmaz" olduğu için yerine-yazma bloğundan bile kritiktir.
// 3. SQL komut satırından DEĞİL **STDIN**'den verilir. `"TeksErpDb"` çift tırnak
//    gerektiriyor; PowerShell 5.1'in native argüman geçişi argüman içindeki `"`
//    karakterlerini kaçırmaz (PS 7.3+ kuralı ayrıca değiştirdi) → `psql -c '… "x" …'`
//    bozuk komut satırı üretir. Tek tırnaklı PS string → stdin: sürümler arası güvenli.
// 4. Her `if` TEK SATIR. Çok satırlı `if (...) {` … `}` satır-satır yapıştırmada bozulur.
// 5. Temizlik (`Remove-Item Env:PGPASSWORD`, `pm2 start`/`Start-Service`) KOŞULSUZ ve SONDA.
//    Takas başarısızsa DB'ye dokunulmamıştır ama backend duruyordur — mutlaka kalkmalı.
// =============================================================================

export interface SwapCommandParams {
  /** Canlı veritabanı (takas sonrası `_old_` olacak). */
  liveDatabase: string;
  /** Devreye alınacak kopya. */
  copyDatabase: string;
  /** Canlının kenara çekileceği ad. */
  oldDatabase: string;
  /** Geri alma sırasında başarısız kopyanın çekileceği ad. */
  failedDatabase: string;
  /** `pgTool("psql")` çıktısı — boşluklu yol olabilir. */
  psqlPath: string;
  maintenanceDb: string;
  host: string;
  port: string;
  user: string;
  pm2AppName: string;
  /** Süreç yöneticisi; verilmezse pm2 (`pm2AppName`). Hizmet düzeninde SCM komutları üretilir. */
  process?: ProcessControlInfo;
  /** Backend çalışma dizini — `prisma migrate deploy` oradan koşar. */
  backendCwd: string;
  /** Hizmet düzeninde göç: paketin Node'u (npx/.bin pakette yok) ve `.env` yolu (DATABASE_URL). */
  nodePath?: string;
  envFile?: string;
  /** Doğrulama `missing` migration bulduysa true → deploy adımı zorunlu. */
  needsMigrateDeploy: boolean;
}

import type { ProcessControlInfo } from "../../lib/hizmet-duzeni";

export interface SwapCommands {
  forward: string;
  rollback: string;
}

/** PowerShell tek-tırnaklı string (içerideki `'` ikilenir). */
function ps(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
/** SQL identifier (çift tırnak ikilenir). */
function ident(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
/** SQL string literal. */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function psqlInvoke(p: SwapCommandParams, extra = ""): string {
  return `& $psql -h ${p.host} -p ${p.port} -U ${p.user} -d ${p.maintenanceDb} -v ON_ERROR_STOP=1 -tA${extra}`;
}

function renameLine(p: SwapCommandParams, from: string, to: string): string {
  return `${ps(`ALTER DATABASE ${ident(from)} RENAME TO ${ident(to)};`)} | ${psqlInvoke(p)}`;
}

/** Süreci durdur/başlat satırları: pm2 (bugünkü) ya da Windows hizmeti (SCM). */
function processLines(p: SwapCommandParams, abortText: string) {
  const s = p.process ?? { processManager: "pm2" as const, name: p.pm2AppName };
  if (s.processManager === "service") {
    return {
      variableLine: `$svc  = ${ps(s.name)}`,
      adminNote: [
        `# !!! YONETICI PowerShell GEREKLI - Windows hizmetini durdurmak/baslatmak yonetici ister.`,
      ],
      stopLines: [
        `Stop-Service -Name $svc -ErrorAction SilentlyContinue`,
        `$stopped = ((Get-Service -Name $svc -ErrorAction SilentlyContinue).Status -eq 'Stopped')`,
        `if (-not $stopped) { Write-Host "HIZMET DURDURULAMADI - pencere YONETICI mi? ${abortText}" -ForegroundColor Red }`,
      ],
      startLine: `Start-Service -Name $svc -ErrorAction SilentlyContinue`,
      serviceMode: true,
    };
  }
  return {
    variableLine: `$app  = ${ps(s.name)}`,
    adminNote: [
      `# !!! YONETICI PowerShell GEREKLI - PM2 daemon SYSTEM olarak kosuyor;`,
      `#     normal pencerede pm2 "EPERM \\\\.\\pipe\\rpc.sock" ile duser.`,
    ],
    stopLines: [
      `$LASTEXITCODE = 1`,
      `pm2 stop $app`,
      `$stopped = ($LASTEXITCODE -eq 0)`,
      `if (-not $stopped) { Write-Host "PM2 STOP BASARISIZ - pencere YONETICI mi? ${abortText}" -ForegroundColor Red }`,
    ],
    startLine: `pm2 start $app`,
    serviceMode: false,
  };
}

/** Göç satırları: hizmette paketin Node'u + prisma CLI'nin giriş noktası (paket `.bin` taşımaz). */
function migrateLines(p: SwapCommandParams, serviceMode: boolean): string[] {
  const cd = `if ($s2) { Set-Location ${ps(p.backendCwd)} }`;
  if (!serviceMode || !p.nodePath || !p.envFile) return [cd, `if ($s2) { npx prisma migrate deploy }`];
  return [
    cd,
    `if ($s2) { $env:DOTENV_CONFIG_PATH = ${ps(p.envFile)} }`,
    `if ($s2) { & ${ps(p.nodePath)} ${ps("node_modules/prisma/build/index.js")} migrate deploy }`,
  ];
}

export function buildSwapCommands(p: SwapCommandParams): SwapCommands {
  const L = ident(p.liveDatabase);
  const fwd = processLines(p, "TAKAS YAPILMADI.");
  const back = processLines(p, "GERI ALMA YAPILMADI.");

  const forward = [
    `# ============================================================`,
    `# TAKAS: ${p.copyDatabase}  ->  ${p.liveDatabase}`,
    `# Geri alma blogu ayrica verildi - once ONU kopyalayin.`,
    `# ============================================================`,
    `$psql = ${ps(p.psqlPath)}`,
    fwd.variableLine,
    `$force = $false   # true yaparsaniz acik oturumlar ZORLA kapatilir`,
    ``,
    ...fwd.adminNote,
    ``,
    `# 1) Backend'i durdur (rename, DB'ye acik baglanti varken CALISMAZ)`,
    ...fwd.stopLines,
    `$env:PGPASSWORD = "<veritabani-sifresi>"`,
    ``,
    `# 2) ON KONTROL - hicbir seye dokunmadan`,
    `$LASTEXITCODE = 1`,
    `$dbs = ${ps(`SELECT count(*) FROM pg_database WHERE datname IN (${lit(p.liveDatabase)}, ${lit(p.copyDatabase)});`)} | ${psqlInvoke(p)}`,
    `$okDbs = ($LASTEXITCODE -eq 0) -and ("$dbs".Trim() -eq "2")`,
    `if (-not $okDbs) { Write-Host "ON KONTROL: iki veritabanindan biri yok - takas YAPILMADI." -ForegroundColor Red }`,
    `$LASTEXITCODE = 1`,
    `$conns = ${ps(`SELECT count(*) FROM pg_stat_activity WHERE datname IN (${lit(p.liveDatabase)}, ${lit(p.copyDatabase)}) AND pid <> pg_backend_pid();`)} | ${psqlInvoke(p)}`,
    `$okConn = ($LASTEXITCODE -eq 0) -and ("$conns".Trim() -eq "0")`,
    `if (-not $okConn -and -not $force) { ${ps(`SELECT pid, usename, application_name, client_addr FROM pg_stat_activity WHERE datname IN (${lit(p.liveDatabase)}, ${lit(p.copyDatabase)}) AND pid <> pg_backend_pid();`)} | ${psqlInvoke(p)} }`,
    `if (-not $okConn -and -not $force) { Write-Host "ACIK OTURUM VAR (yukarida) - pgAdmin/psql/Studio kapatin, ya da \\$force = \\$true yapip tekrar calistirin." -ForegroundColor Red }`,
    `if (-not $okConn -and $force) { ${ps(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN (${lit(p.liveDatabase)}, ${lit(p.copyDatabase)}) AND pid <> pg_backend_pid();`)} | ${psqlInvoke(p)} ; $okConn = $true }`,
    `$go = $stopped -and $okDbs -and $okConn`,
    ``,
    `# 3) TAKAS - iki rename atomik DEGIL, bu yuzden otomatik geri alma var`,
    `$LASTEXITCODE = 1`,
    `if ($go) { ${renameLine(p, p.liveDatabase, p.oldDatabase)} }`,
    `$s1 = $go -and ($LASTEXITCODE -eq 0)`,
    `$LASTEXITCODE = 1`,
    `if ($s1) { ${renameLine(p, p.copyDatabase, p.liveDatabase)} }`,
    `$s2 = $s1 -and ($LASTEXITCODE -eq 0)`,
    `$LASTEXITCODE = 1`,
    `if ($s1 -and -not $s2) { ${renameLine(p, p.oldDatabase, p.liveDatabase)} }`,
    `if ($s1 -and -not $s2) { Write-Host "IKINCI RENAME BASARISIZ - OTOMATIK GERI ALINDI." -ForegroundColor Red }`,
    ``,
    `# 4) SON DOGRULAMA - ortada canli veritabani kaldi mi`,
    `$LASTEXITCODE = 1`,
    `$final = ${ps(`SELECT count(*) FROM pg_database WHERE datname = ${lit(p.liveDatabase)};`)} | ${psqlInvoke(p)}`,
    `if ("$final".Trim() -ne "1") { Write-Host "TEHLIKE: ${p.liveDatabase} YOK. Backend acilmayacak. Veritabani adlarini kontrol edin." -ForegroundColor Red }`,
    `if ("$final".Trim() -eq "1" -and $s2) { Write-Host "TAKAS TAMAM." -ForegroundColor Green }`,
    ``,
    p.needsMigrateDeploy
      ? `# 5) SEMA GUNCELLEME - yedek koddan ESKI, bu adim ATLANIRSA backend eski semaya baglanir (P2022)`
      : `# 5) SEMA GUNCELLEME - guvenlik icin her durumda calistirilir (idempotent)`,
    ...migrateLines(p, fwd.serviceMode),
    ``,
    `# 6) HER DURUMDA: sifreyi temizle, backend'i baslat`,
    `Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue`,
    ...(fwd.serviceMode ? [`Remove-Item Env:DOTENV_CONFIG_PATH -ErrorAction SilentlyContinue`] : []),
    fwd.startLine,
  ].join("\n");

  const rollback = [
    `# ============================================================`,
    `# GERI ALMA: ${p.oldDatabase}  ->  ${p.liveDatabase}`,
    `# Takas sonrasi bir sorun gorurseniz BUNU calistirin.`,
    `# ============================================================`,
    `$psql = ${ps(p.psqlPath)}`,
    back.variableLine,
    ``,
    ...(back.serviceMode ? back.stopLines : [`pm2 stop $app`]),
    `$env:PGPASSWORD = "<veritabani-sifresi>"`,
    ``,
    `$LASTEXITCODE = 1`,
    `$dbs = ${ps(`SELECT count(*) FROM pg_database WHERE datname IN (${lit(p.liveDatabase)}, ${lit(p.oldDatabase)});`)} | ${psqlInvoke(p)}`,
    `$go = ${back.serviceMode ? "$stopped -and " : ""}($LASTEXITCODE -eq 0) -and ("$dbs".Trim() -eq "2")`,
    `if (-not $go) { Write-Host "ON KONTROL BASARISIZ - geri alma YAPILMADI." -ForegroundColor Red }`,
    ``,
    `$LASTEXITCODE = 1`,
    `if ($go) { ${renameLine(p, p.liveDatabase, p.failedDatabase)} }`,
    `$r1 = $go -and ($LASTEXITCODE -eq 0)`,
    `$LASTEXITCODE = 1`,
    `if ($r1) { ${renameLine(p, p.oldDatabase, p.liveDatabase)} }`,
    `$r2 = $r1 -and ($LASTEXITCODE -eq 0)`,
    `$LASTEXITCODE = 1`,
    `if ($r1 -and -not $r2) { ${renameLine(p, p.failedDatabase, p.liveDatabase)} }`,
    `if ($r1 -and -not $r2) { Write-Host "GERI ALMA IKINCI ADIMI BASARISIZ - ILK ADIM GERI ALINDI." -ForegroundColor Red }`,
    `if ($r2) { Write-Host "GERI ALMA TAMAM." -ForegroundColor Green }`,
    ``,
    `Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue`,
    back.startLine,
  ].join("\n");

  return { forward, rollback };
}
