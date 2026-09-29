# =============================================================================
# TeksERP - BAKIM ROLU (super kullanici OLMAYAN yedek / DB kopyasi kimligi)
# =============================================================================
# NEREDE: sunucuda, YONETICI PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\bakim-rolu.ps1 -Kok C:\TeksERP
#   (ilk-kurulum.ps1 -BakimRolu ayni betigi surec icinden cagirir)
#
# NEDEN: backend panelden elle yedek, geri yukleme komutu ve DB kopyasi icin
#   BACKUP_PG_USER kimligini kullanir. O kimlik `postgres` olunca SUPER KULLANICI
#   parolasi .env'de durur (COPY ... PROGRAM = isletim sistemi komutu, ALTER SYSTEM,
#   kumedeki her veritabani). Olculen ihtiyac (PG 16) super DEGILDIR:
#     CREATEDB + canli DB sahibinin rolune uyelik (SET + INHERIT)
#     + canlidaki teks.* DB ayarlari icin GRANT SET ON PARAMETER
#     + pg_read_all_settings (disk korumasi PG veri dizinini okur).
#
# NE YAPAR (idempotent - iki kez kosmak guvenli):
#   1) Yonetici (super) kimligi: -PostgresParolaGuvenli > -PostgresParolaDosyasi >
#      .env'deki BACKUP_PG_* (kullanici -PostgresKullanici ise) > gizli soru.
#      Parola ekrana, loga, komut satirina YAZILMAZ.
#   2) Canli DB (.env DATABASE_URL) sahibini olcer; sahip super kullaniciysa DURUR
#      (super role uyelik = super yetkisi).
#   3) Rol yoksa: CREATE ROLE ... NOSUPERUSER. Varsa super OLMADIGI olculur.
#      Parola: .env bu rolu ve CALISAN parolasini zaten tasiyorsa KORUNUR; rol var ama
#      .env'de calisan parola yoksa -ParolaYenile ister (ayni kumede baska kurulum
#      ayni rolu kullaniyor olabilir). Yeni parola rastgele; sunucuya SCRAM dogrulayicisi
#      olarak gider (duz parola SQL metnine girmez), SQL psql'e STDIN'den verilir.
#   4) Yetkiler: GRANT <sahip>, pg_read_all_settings, SET ON PARAMETER teks.*.
#   5) Yeni kimlikle olcer: super degil, CREATEDB, sahip adina SET+USAGE, parametre
#      yetkisi, sema dokumu (pg_dump -s: sahibine erisilemeyen nesne varsa duser).
#   6) .env (+ -EkEnvDosyasi): BACKUP_PG_USER / BACKUP_PG_PASSWORD bakim rolune cevrilir;
#      onceki hali .env.onceki-<damga> (yalniz SYSTEM + Administrators). postgres
#      parolasi .env'den CIKAR; postgres parolasinin kendisi DEGISMEZ (rotasyon ayri is).
#   7) Backend yeni kimligi pm2 restart'ta okur - betik restart ETMEZ, komutu yazar.
#
# GERI ALMA: .env.onceki-<damga> -> .env geri kopyalanir + pm2 restart. Rol kalir
#   (yetkileri super degil; istenirse DROP ROLE ayri karar).
# ESKI KURULUM: BACKUP_PG_USER=postgres olan .env bu betik kosulmadikca AYNEN calisir.
# =============================================================================
param(
  [string]$Kok = "C:\TeksERP",
  [string]$EnvDosyasi,                               # varsayilan <Kok>\app\.env
  [string[]]$EkEnvDosyasi = @(),                     # ayni degisikligi alacak ek .env (app.eski-*: geri donus)
  [string]$BakimKullanici = "tekserp_bakim",
  [string]$PostgresKullanici = "postgres",
  [string]$PostgresParolaDosyasi,
  [SecureString]$PostgresParolaGuvenli,              # ilk-kurulum.ps1 surec icinden verir (argv degil)
  [string]$PgBin,
  [switch]$ParolaYenile
)
$ErrorActionPreference = "Stop"

function Ok($m)   { Write-Host "  + $m" -ForegroundColor Green }
function Uyar($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Dur($m)  { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; Write-Host ""; exit 1 }

# psql'e SQL STDIN'den gider (argv'ye sir girmez; 5.1'in tirnak kacisi sorunu da yok).
# PGPASSWORD cagri basina set/temizlenir; 5.1'de EAP=Stop altinda stderr yonlendirmesi
# satiri olumcul yapar -> cagri suresince "Continue" (ilk-kurulum `Psql` kalibi).
function PsqlStdin($kullanici, $parola, $veritabani, $sql) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $parola
  try {
    $c = $sql | & $script:psql -X -w -h $script:dbHost -p $script:dbPort -U $kullanici -d $veritabani -v ON_ERROR_STOP=1 -tA -f - 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = ""
    $ErrorActionPreference = $eskiEAP
  }
}

# pg_dump -s: bakim rolunun canli semayi GERCEKTEN okuyabildiginin kaniti (dosya silinir).
function SemaDokumu($kullanici, $parola, $veritabani) {
  $eskiEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $parola
  $gecici = [IO.Path]::Combine([IO.Path]::GetTempPath(), "tekserp-bakim-sema-" + [guid]::NewGuid().ToString("N") + ".sql")
  try {
    $c = & $script:pgdump -h $script:dbHost -p $script:dbPort -U $kullanici -d $veritabani -s -f $gecici 2>&1
    $kod = $LASTEXITCODE
    $satirlar = @($c | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    })
    return [pscustomobject]@{ kod = $kod; cikti = ($satirlar -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = ""
    $ErrorActionPreference = $eskiEAP
    Remove-Item $gecici -Force -ErrorAction SilentlyContinue
  }
}

# Sir tasiyan yol yalniz SYSTEM + Administrators'a (SID ile; ilk-kurulum/kur.ps1 kalibi).
function SirIzniDaralt($yol) {
  if (-not (Test-Path $yol)) { return }
  if (-not (Get-Command icacls.exe -ErrorAction SilentlyContinue)) { Uyar "icacls yok - izin DARALTILAMADI: $yol"; return }
  & icacls.exe $yol /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" /remove:g "*S-1-5-32-545" "*S-1-5-11" "*S-1-1-0" | Out-Null
  if ($LASTEXITCODE -ne 0) { Uyar "izin daraltilamadi (icacls $LASTEXITCODE): $yol" }
}

# .env degeri: ilk eslesen satir, cevreleyen tek/cift tirnak soyulur. Buyuk/kucuk harf
# DUYARLI (-cmatch): tr-TR kulturunde -match 'I'yi 'i'ye indirger (thinkpad-1 dersi).
function EnvDeger($satirlar, $ad) {
  foreach ($l in $satirlar) {
    if ($l -cmatch ('^\s*' + $ad + '\s*=\s*(.*)$')) {
      $v = $Matches[1].Trim()
      if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) { $v = $v.Substring(1, $v.Length - 2) }
      return $v
    }
  }
  return $null
}

# 32 karakter, ayirt edilmesi kolay alfabe; 228 = 57*4 -> modulo yanliligi yok.
function YeniParola {
  $abc = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $s = New-Object System.Text.StringBuilder
  while ($s.Length -lt 32) {
    $b = New-Object byte[] 64
    $rng.GetBytes($b)
    foreach ($x in $b) { if ($x -lt 228 -and $s.Length -lt 32) { [void]$s.Append($abc[$x % 57]) } }
  }
  return $s.ToString()
}

# RFC 5802/7677 SCRAM-SHA-256 dogrulayicisi (PostgreSQL saklama bicimi). Sunucu onu oldugu
# gibi saklar; duz parola SQL metnine ve sunucu loguna hic girmez. PBKDF2 elle: SHA-256'li
# Rfc2898DeriveBytes .NET 4.7.2 ister, Server 2016 4.6.2 ile gelir; HMACSHA256 her yerde var.
function Pbkdf2Sha256([byte[]]$parola, [byte[]]$tuz, [int]$tur) {
  $h = [Security.Cryptography.HMACSHA256]::new($parola)
  $u = $h.ComputeHash([byte[]]($tuz + [byte[]](0, 0, 0, 1)))
  $t = [byte[]]$u.Clone()
  for ($i = 1; $i -lt $tur; $i++) {
    $u = $h.ComputeHash($u)
    for ($j = 0; $j -lt 32; $j++) { $t[$j] = $t[$j] -bxor $u[$j] }
  }
  return $t
}
function ScramDogrulayici([string]$parola) {
  $tuz = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tuz)
  $tuzlu = Pbkdf2Sha256 ([Text.Encoding]::UTF8.GetBytes($parola)) $tuz 4096
  $istemci = [Security.Cryptography.HMACSHA256]::new($tuzlu).ComputeHash([Text.Encoding]::ASCII.GetBytes("Client Key"))
  $sunucu = [Security.Cryptography.HMACSHA256]::new($tuzlu).ComputeHash([Text.Encoding]::ASCII.GetBytes("Server Key"))
  $saklanan = [Security.Cryptography.SHA256]::Create().ComputeHash($istemci)
  return "SCRAM-SHA-256`$4096:" + [Convert]::ToBase64String($tuz) + "`$" + [Convert]::ToBase64String($saklanan) + ":" + [Convert]::ToBase64String($sunucu)
}

function SecureCoz([SecureString]$ss) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Ident($ad) { return '"' + ($ad -creplace '"', '""') + '"' }
function Lit($s) { return "'" + ($s -creplace "'", "''") + "'" }

# BACKUP_PG_USER / BACKUP_PG_PASSWORD satirlarini degistirir (yoksa ekler); BOM ve ACL korunur.
function EnvGuncelle($dosya, $kullanici, $parola, $damga) {
  $bayt = [IO.File]::ReadAllBytes($dosya)
  $bom = ($bayt.Length -ge 3 -and $bayt[0] -eq 0xEF -and $bayt[1] -eq 0xBB -and $bayt[2] -eq 0xBF)
  $onceki = "$dosya.onceki-$damga"
  Copy-Item $dosya $onceki
  SirIzniDaralt $onceki
  $yeni = New-Object System.Collections.Generic.List[string]
  $u = $false; $p = $false
  foreach ($l in [IO.File]::ReadAllLines($dosya)) {
    if ($l -cmatch '^\s*BACKUP_PG_USER\s*=') { if (-not $u) { $yeni.Add('BACKUP_PG_USER="' + $kullanici + '"'); $u = $true }; continue }
    if ($l -cmatch '^\s*BACKUP_PG_PASSWORD\s*=') { if (-not $p) { $yeni.Add('BACKUP_PG_PASSWORD="' + $parola + '"'); $p = $true }; continue }
    $yeni.Add($l)
  }
  if (-not $u) { $yeni.Add('BACKUP_PG_USER="' + $kullanici + '"') }
  if (-not $p) { $yeni.Add('BACKUP_PG_PASSWORD="' + $parola + '"') }
  [IO.File]::WriteAllLines($dosya, $yeni, (New-Object Text.UTF8Encoding $bom))
  return $onceki
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP - BAKIM ROLU ($BakimKullanici)"
Write-Host "================================================================"

if ($BakimKullanici -cnotmatch '^[a-z_][a-z0-9_]{0,62}$') { Dur "-BakimKullanici yalniz kucuk harf, rakam ve _ olabilir: $BakimKullanici" }
if ($BakimKullanici -ceq $PostgresKullanici) { Dur "-BakimKullanici yonetici kullanicisiyla ayni olamaz." }
if (-not $EnvDosyasi) { $EnvDosyasi = Join-Path $Kok "app\.env" }
if (-not (Test-Path $EnvDosyasi)) { Dur ".env bulunamadi: $EnvDosyasi" }
foreach ($e in $EkEnvDosyasi) { if (-not (Test-Path $e)) { Dur "ek .env bulunamadi: $e" } }
if (-not $PgBin) { $PgBin = Join-Path $Kok "pgsql\bin" }
$script:psql = Join-Path $PgBin "psql.exe"
$script:pgdump = Join-Path $PgBin "pg_dump.exe"
if (-not (Test-Path $script:psql)) { Dur "psql.exe yok: $script:psql  (-PgBin ver)" }
if (-not (Test-Path $script:pgdump)) { Dur "pg_dump.exe yok: $script:pgdump  (-PgBin ver)" }

$envSatir = [IO.File]::ReadAllLines($EnvDosyasi)
$url = EnvDeger $envSatir "DATABASE_URL"
if (-not $url) { Dur ".env'de DATABASE_URL yok: $EnvDosyasi" }
try { $u = [uri]$url } catch { Dur "DATABASE_URL cozumlenemedi." }
$script:dbHost = if ($u.Host) { $u.Host } else { "localhost" }
$script:dbPort = if ($u.Port -gt 0) { $u.Port } else { 5432 }
$dbAdi = [uri]::UnescapeDataString($u.AbsolutePath.TrimStart('/'))
$uygulamaRolu = [uri]::UnescapeDataString(($u.UserInfo -csplit ':', 2)[0])
if (-not $dbAdi) { Dur "DATABASE_URL veritabani adi tasimiyor." }
Write-Host "  Veritabani: $dbAdi @ $($script:dbHost):$($script:dbPort)  |  uygulama rolu: $uygulamaRolu"

# --- 1) Yonetici kimligi -------------------------------------------------------
$suParola = $null; $kaynak = ""
if ($PostgresParolaGuvenli) { $suParola = SecureCoz $PostgresParolaGuvenli; $kaynak = "cagiran" }
elseif ($PostgresParolaDosyasi) {
  if (-not (Test-Path $PostgresParolaDosyasi)) { Dur "parola dosyasi yok: $PostgresParolaDosyasi" }
  $suParola = ([IO.File]::ReadAllText((Resolve-Path $PostgresParolaDosyasi).Path)).TrimEnd("`r", "`n"); $kaynak = "dosya"
} elseif ((EnvDeger $envSatir "BACKUP_PG_USER") -ceq $PostgresKullanici) {
  $suParola = EnvDeger $envSatir "BACKUP_PG_PASSWORD"; $kaynak = ".env (BACKUP_PG_*)"
} elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
  $suParola = SecureCoz (Read-Host -AsSecureString "  PostgreSQL yonetici ($PostgresKullanici) parolasi"); $kaynak = "soru"
} else { Dur "Yonetici parolasi gerekli ve bu oturum soru soramiyor: -PostgresParolaDosyasi <yol> ver." }
if (-not $suParola) { Dur "Yonetici parolasi bos." }
$y = PsqlStdin $PostgresKullanici $suParola "postgres" "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;"
if ($y.kod -ne 0) { Dur "PostgreSQL'e '$PostgresKullanici' ile baglanilamadi (kaynak: $kaynak).`n       $($y.cikti)" }
if ($y.cikti -cne "t") { Dur "'$PostgresKullanici' super kullanici DEGIL - rol ve yetki veremez." }
Ok "yonetici kimligi dogrulandi ($PostgresKullanici, kaynak: $kaynak)"
$vnum = [int](PsqlStdin $PostgresKullanici $suParola "postgres" "SHOW server_version_num;").cikti

# --- 2) Canli veritabaninin sahibi ---------------------------------------------
$s = PsqlStdin $PostgresKullanici $suParola "postgres" "SELECT o.rolname || '|' || o.rolsuper::text FROM pg_database d JOIN pg_roles o ON o.oid = d.datdba WHERE d.datname = $(Lit $dbAdi);"
if ($s.kod -ne 0 -or $s.cikti -cnotmatch '^[^|]+\|(true|false)$') { Dur "Canli veritabaninin sahibi okunamadi: $($s.cikti)" }
$sahip, $sahipSuper = $s.cikti -csplit '\|', 2
if ($sahipSuper -ceq "true") {
  Dur "Canli veritabaninin sahibi '$sahip' SUPER kullanici - ona uyelik super yetkisi demektir. Once: ALTER DATABASE $(Ident $dbAdi) OWNER TO $(Ident $uygulamaRolu);"
}
if ($sahip -cne $uygulamaRolu) { Uyar "veritabani sahibi ($sahip) uygulama rolunden ($uygulamaRolu) farkli - bakim rolu SAHIBE uye yapilir." }
Ok "canli veritabaninin sahibi: $sahip (super degil)"

# --- 3) Rol ----------------------------------------------------------------------
$r = PsqlStdin $PostgresKullanici $suParola "postgres" "SELECT rolsuper::text FROM pg_roles WHERE rolname = $(Lit $BakimKullanici);"
if ($r.kod -ne 0) { Dur "Rol sorgulanamadi: $($r.cikti)" }
$rolVar = [bool]$r.cikti
if ($r.cikti -ceq "true") { Dur "'$BakimKullanici' adinda SUPER bir rol var - bakim rolu olamaz. Baska ad ver (-BakimKullanici)." }
$envBk = EnvDeger $envSatir "BACKUP_PG_USER"
$envBkP = EnvDeger $envSatir "BACKUP_PG_PASSWORD"
$parolaKorunur = $rolVar -and ($envBk -ceq $BakimKullanici) -and $envBkP -and ((PsqlStdin $BakimKullanici $envBkP "postgres" "SELECT 1;").kod -eq 0)
$ozellik = "LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS"
if ($parolaKorunur) {
  $bkParola = $envBkP
  $a = PsqlStdin $PostgresKullanici $suParola "postgres" "ALTER ROLE $(Ident $BakimKullanici) WITH $ozellik;"
  if ($a.kod -ne 0) { Dur "Rol ozellikleri yazilamadi: $($a.cikti)" }
  Ok "rol zaten var, .env'deki parolasi calisiyor - parola KORUNDU"
} else {
  if ($rolVar -and -not $ParolaYenile) {
    Dur "'$BakimKullanici' rolu var ama bu .env'de calisan parolasi yok. Ayni kumede baska kurulum bu rolu kullaniyor olabilir: baska ad ver (-BakimKullanici) ya da bilerek -ParolaYenile."
  }
  $bkParola = YeniParola
  $fiil = if ($rolVar) { "ALTER" } else { "CREATE" }
  $a = PsqlStdin $PostgresKullanici $suParola "postgres" ("SET log_statement = 'none';`n$fiil ROLE $(Ident $BakimKullanici) WITH $ozellik PASSWORD " + (Lit (ScramDogrulayici $bkParola)) + ";")
  if ($a.kod -ne 0) { Dur "Rol $(if ($rolVar) { 'guncellenemedi' } else { 'olusturulamadi' }): $($a.cikti)" }
  if ((PsqlStdin $BakimKullanici $bkParola "postgres" "SELECT 1;").kod -ne 0) { Dur "Rol yazildi ama yeni parolayla BAGLANILAMIYOR - .env'e dokunulmadi." }
  Ok "rol $(if ($rolVar) { 'guncellendi (parola yenilendi)' } else { 'olusturuldu' }): $BakimKullanici ($ozellik)"
}

# --- 4) Yetkiler -----------------------------------------------------------------
$g = PsqlStdin $PostgresKullanici $suParola "postgres" "GRANT $(Ident $sahip) TO $(Ident $BakimKullanici);`nGRANT pg_read_all_settings TO $(Ident $BakimKullanici);"
if ($g.kod -ne 0) { Dur "Uyelik verilemedi: $($g.cikti)" }
Ok "uyelik: $sahip (sahip adina kopya/yedek/takas) + pg_read_all_settings (disk korumasi)"
$parametreler = @("teks.audit_guard")
$ps = PsqlStdin $PostgresKullanici $suParola "postgres" "SELECT split_part(kv, '=', 1) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase, unnest(s.setconfig) kv WHERE d.datname = $(Lit $dbAdi) AND s.setrole = 0;"
foreach ($k in @($ps.cikti -csplit "`n" | Where-Object { $_ -cmatch '^[a-z_][a-z0-9_]*\.[a-z0-9_.]+$' })) { if ($parametreler -cnotcontains $k) { $parametreler += $k } }
if ($vnum -ge 150000) {
  foreach ($k in $parametreler) {
    $pg = PsqlStdin $PostgresKullanici $suParola "postgres" "GRANT SET ON PARAMETER $k TO $(Ident $BakimKullanici);"
    if ($pg.kod -ne 0) { Dur "Parametre yetkisi verilemedi ($k): $($pg.cikti)" }
  }
  Ok "parametre yetkisi (SET): $($parametreler -join ', ')"
} else {
  Uyar "PostgreSQL $vnum < 15: parametre yetkisi verilemez - teks.* ayari olan kopya dogrulamadan gecmeyebilir."
}

# --- 5) Yeni kimlikle olcum --------------------------------------------------------
$setYetki = if ($vnum -ge 160000) { "SET" } else { "MEMBER" }
$parSorgu = if ($vnum -ge 150000) { "has_parameter_privilege('teks.audit_guard', 'SET')::text" } else { "'olculemedi'" }
$o = PsqlStdin $BakimKullanici $bkParola "postgres" ("SELECT r.rolsuper::text || '|' || r.rolcreatedb::text || '|' || pg_has_role(current_user, d.datdba, '$setYetki')::text || '|' || pg_has_role(current_user, d.datdba, 'USAGE')::text || '|' || $parSorgu || '|' || (SELECT count(*) FROM pg_settings WHERE name = 'data_directory')::text FROM pg_roles r, pg_database d WHERE r.rolname = current_user AND d.datname = " + (Lit $dbAdi) + ";")
if ($o.kod -ne 0) { Dur "Yeni kimlikle olcum yapilamadi: $($o.cikti)" }
$super, $createdb, $setOk, $usageOk, $parOk, $veriDizini = $o.cikti -csplit '\|'
if ($super -cne "false") { Dur "OLCUM: '$BakimKullanici' SUPER gorunuyor - .env'e dokunulmadi." }
if ($createdb -cne "true" -or $setOk -cne "true" -or $usageOk -cne "true") { Dur "OLCUM: CREATEDB=$createdb sahip SET=$setOk USAGE=$usageOk - .env'e dokunulmadi." }
if ($parOk -ceq "false") { Dur "OLCUM: teks.audit_guard SET yetkisi yok - .env'e dokunulmadi." }
if ($veriDizini -cne "1") { Uyar "OLCUM: data_directory gorunmuyor - panel disk korumasi yanlis birimi olcebilir (PGDATA_DIR ile ver)." }
$d = SemaDokumu $BakimKullanici $bkParola $dbAdi
if ($d.kod -ne 0) { Dur "OLCUM: '$BakimKullanici' canli semayi dokemiyor (sahibine erisilemeyen nesne?) - .env'e dokunulmadi.`n       $($d.cikti)" }
Ok "olcum: super degil, CREATEDB, sahip adina SET+USAGE, teks.audit_guard SET=$parOk, sema dokumu OK"

# --- 6) .env ---------------------------------------------------------------------
$damga = Get-Date -Format "yyyyMMdd_HHmmss"
$oncekiler = @()
foreach ($f in @($EnvDosyasi) + $EkEnvDosyasi) {
  $eski = EnvDeger ([IO.File]::ReadAllLines($f)) "BACKUP_PG_USER"
  if (($eski -ceq $BakimKullanici) -and $parolaKorunur -and ($f -ceq $EnvDosyasi)) { Ok "zaten bakim rolunde: $f"; continue }
  $oncekiler += EnvGuncelle $f $BakimKullanici $bkParola $damga
  $l = [IO.File]::ReadAllLines($f)
  if ((EnvDeger $l "BACKUP_PG_USER") -cne $BakimKullanici -or (EnvDeger $l "BACKUP_PG_PASSWORD") -cne $bkParola) { Dur "yazildi ama geri okunamadi: $f  (onceki hali: $f.onceki-$damga)" }
  Ok "guncellendi: $f  (onceki: $(if ($eski) { $eski } else { 'yok' }) -> $BakimKullanici)"
}
$bkParola = $null; $suParola = $null; $envBkP = $null

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  BAKIM ROLU HAZIR: $BakimKullanici (super DEGIL)" -ForegroundColor Green
Write-Host "================================================================"
Write-Host "  1) Backend yeni kimligi yeniden baslatinca okur:"
Write-Host "       `$env:PM2_HOME='$Kok\pm2-home'; & '$Kok\pm2\node_modules\.bin\pm2.cmd' restart <uygulama-adi>"
Write-Host "  2) Panel: Sistem > Yedekler > Elle yedek al  +  Veritabani Kopyasi yetenek satiri (kullanici $BakimKullanici)."
if ($oncekiler.Count) {
  Write-Host "  3) Ikisi de yesilse onceki .env kopyalarini sil (eski BACKUP_PG_* degerini tasirlar):"
  foreach ($x in $oncekiler) { Write-Host "       Remove-Item `"$x`"" }
}
Write-Host "  postgres parolasi artik bu .env'lerde YOK; parolanin kendisi degismedi (rotasyon ayri adim)."
Write-Host ""
exit 0
