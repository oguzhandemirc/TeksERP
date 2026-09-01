# =============================================================================
# TeksERP Backend - SURUM PAKETI URETICI
# =============================================================================
# NEREDE CALISIR: GELISTIRME MAKINENDE, repo kokunde (Teks-Erp klasorunun ustu).
#                 Sunucuda CALISMAZ - sunucuda kaynak kod yoktur.
#
# NE URETIR: tekserp-backend-<tarih>-<commit>.zip
#            Sunucudaki kur.ps1 bu paketi bekler.
#
# KULLANIM:
#   .\paketle.ps1                      # node_modules DAHIL (varsayilan, onerilen)
#   .\paketle.ps1 -NodeModulesHaric    # ince paket; sunucu npm ci kosar (internet ister)
#   .\paketle.ps1 -Cikti D:\paketler   # zip'in yazilacagi klasor
#   .\paketle.ps1 -WebPanelHaric      # web panelini pakete KOYMA (asagidaki nota bak)
#
# TASARIM NOTLARI (degistirmeden once oku):
#   * dist\*.js.map PAKETE GIRMEZ. Kaynak haritalar `../../src/...` yoluna atif
#     yapar; sunucuda src OLMADIGI icin ise yaramazlar (238 dosya / 2,2 MB).
#     Icerlerinde TypeScript GOMULU DEGIL (inlineSources kapali) - yani onlari
#     gondermek kaynak sizdirmazdi, sadece olu agirlik olurdu.
#   * prisma\seed*.ts PAKETE GIRMEZ ve prisma.config'in `seed` kancasi da yok.
#     Canli fabrikada seed kosarsa veriyi dusurur; yapisal olarak imkansiz kilariz.
#   * prisma.config.TS degil, deploy\prisma.config.prod.js -> prisma.config.JS
#     gonderilir. Ikisi birden bulunmasin: hangisinin okundugu belirsizlesir.
#   * prisma\migrations CALISMA ZAMANINDA da okunuyor (process.cwd()/prisma/
#     migrations), yalniz migrate deploy icin degil. Cikarilamaz.
#   * .env PAKETE GIRMEZ. Sunucunun kendi .env'i yerinde korunur (kur.ps1 tasir).
#   * WEB PANELI (dist-web) PAKETE GIRER ve backend ile AYNI ZIP'te gider.
#     Gerekce: panel ile backend'in surumleri AYRISAMAZ. Ayri bir kanaldan
#     yayinlansaydi (VPS'e kopyalama gibi) SPA bir surumu, API baska bir surumu
#     konusabilirdi ve arizanin belirtisi "ekran bos" olurdu - teshis edilecek iz
#     birakmadan. Ayni pakette gitmesi bu sinifi TAMAMEN kapatir.
#     ⚠️ Eksik olursa ariza SESSIZDIR: `WEB_DIST_DIR` var olmayan bir klasoru
#     gosterir, `express.static` sessizce no-op olur ve kok (/) panelin YERINE
#     durum sayfasini basar. Bu yuzden derleme basarisizsa paket URETILMEZ.
# =============================================================================
[CmdletBinding()]
param(
  [switch]$NodeModulesHaric,
  [switch]$WebPanelHaric,
  [string]$Cikti = "."
)
$ErrorActionPreference = "Stop"

function Fail($m) { Write-Host ""; Write-Host "  X $m" -ForegroundColor Red; exit 1 }
function Adim($m) { Write-Host ""; Write-Host "$m" -ForegroundColor Cyan }

$repo = (Get-Location).Path
$proj = Join-Path $repo "Teks-Erp"
if (-not (Test-Path (Join-Path $proj "package.json"))) {
  Fail "Teks-Erp\package.json bulunamadi. Bu scripti REPO KOKUNDE calistir."
}

Write-Host ""
Write-Host "================================================================"
Write-Host "  TeksERP Backend - surum paketi uretiliyor"
Write-Host "================================================================"

# --- Commit kimligi ---------------------------------------------------------
$commit = (& git -C $repo rev-parse --short HEAD).Trim()
$dal    = (& git -C $repo rev-parse --abbrev-ref HEAD).Trim()
$kirli  = (& git -C $repo status --porcelain)
if ($kirli) {
  Write-Host ""
  Write-Host "  ! UYARI: calisma agaci temiz DEGIL. Paket commit'lenmemis degisiklik icerecek:" -ForegroundColor Yellow
  $kirli | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
  $c = Read-Host "  Devam edilsin mi? (e/h)"
  if ($c -ne 'e') { Fail "Iptal edildi." }
}
Write-Host "  dal=$dal  commit=$commit"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ad    = "tekserp-backend-$stamp-$commit"
$stage = Join-Path $env:TEMP $ad
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Set-Location $proj

# --- [1/6] Bagimliliklar + derleme ------------------------------------------
Adim "[1/6] npm ci (tam - derleme icin devDependencies gerekli)..."
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm ci basarisiz." }

# ZORUNLU ve tsc'DEN ONCE. npm 11 install-script'leri BLOKLAR (@prisma/engines
# postinstall'i kosmaz), bu yuzden `npm ci` sonrasi `@prisma/client` HENUZ HICBIR
# TIP EXPORT ETMEZ. Atlanirsa derleme yuzlerce
#   "Module '@prisma/client' has no exported member 'Prisma'/'PrismaClient'/<enum>"
# hatasiyla duser ve ardindan tip cikarimi coktugu icin implicit-any yagmuru gelir
# - yani asil sebep gorunmez olur. (2026-08-01'de tam bu sekilde patladi.)
npx prisma generate
if ($LASTEXITCODE -ne 0) { Fail "prisma generate basarisiz - tsc'nin ihtiyac duydugu tipler uretilemedi." }

Adim "[2/6] Derleniyor (tsc --removeComments -> dist)..."
# --removeComments: URETIM paketinde yorumlar SILINIR. Gerekce: derlenmis JS
# varsayilan olarak tum yorumlari tasir; bu kod tabaninda yorumlar is mantiginin
# GEREKCESINI anlatir (tek serviste 478 satir) ve kopyalanan dist'i neredeyse
# kaynak kadar degerli kilar. Bayrak yalniz BURADA verilir - `npm run build`
# ile yapilan gelistirme derlemen yorumlu kalir.
#
# Yan etki: swagger-jsdoc route JSDoc'larindan okur; yorumlar gidince sunucuda
# baslangicta "[swagger] UYARI: OpenAPI spec BOS" satiri gorunur. ZARARSIZ -
# Swagger uretimde zaten mount EDILMIYOR (NODE_ENV=production -> erken return).
if (Test-Path "$proj\dist") { Remove-Item "$proj\dist" -Recurse -Force }  # olu cikti birikmesin
npx tsc --removeComments
if ($LASTEXITCODE -ne 0) { Fail "DERLEME BASARISIZ - paket uretilmedi." }
if (-not (Test-Path "$proj\dist\server.js")) { Fail "dist\server.js yok. tsconfig rootDir/outDir bozulmus olabilir." }
# `//# sourceMappingURL=` pragmasi yorum DEGILDIR (--removeComments onu birakir, .map dosyalari
# asagida ayrica cikarilir) - eski desen onu da sayiyordu ve her deploy'da "67 (0 olmali)"
# basip gercek bir yorum sizintisini gorunmez kiliyordu (2026-08-25 saha olcumu: 67/67 pragma).
$kalanYorum = (Select-String -Path "$proj\dist\services\*.js" -Pattern '^\s*//(?!#\s*sourceMappingURL)' -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "  yorum temizligi: dist\services icinde kalan // satiri = $kalanYorum (0 olmali)"

# --- Web paneli (Electron/dist-web) -----------------------------------------
# Ayni React kaynagi, Electron kabugu OLMADAN (Electron\vite.config.web.ts).
# Backend onu `WEB_DIST_DIR` ile ayni origin'den servis eder -> CORS/karisik-icerik/
# sunucu-adresi ucluSU tamamen duser ve patron paneli de bu yoldan yayinlanir.
$elektron = Join-Path $repo "Electron"
$webDist  = Join-Path $elektron "dist-web"
if ($WebPanelHaric) {
  Adim "[2b] Web paneli ATLANDI (-WebPanelHaric)."
  Write-Host "  UYARI: WEB_DIST_DIR tanimliysa sunucuda panel ACILMAZ, kok (/) durum sayfasi olur." -ForegroundColor Yellow
} else {
  Adim "[2b] Web paneli derleniyor (Electron -> dist-web)..."
  if (-not (Test-Path (Join-Path $elektron "node_modules"))) {
    Fail "Electron\node_modules yok - web paneli derlenemez. 'npm install' kos ya da -WebPanelHaric ver."
  }
  if (Test-Path $webDist) { Remove-Item $webDist -Recurse -Force }  # bayat cikti gitmesin
  Push-Location $elektron
  npm run build:web
  $webRc = $LASTEXITCODE
  Pop-Location
  if ($webRc -ne 0) { Fail "Web paneli derlemesi basarisiz - paket uretilmedi." }
  # ⚠️ Cikti KONTROL EDILIR: derleme 0 dondurup bos klasor birakirsa ariza
  # sunucuda "panel yerine durum sayfasi" olarak, haftalar sonra gorunurdu.
  if (-not (Test-Path (Join-Path $webDist "index.html"))) {
    Fail "dist-web\index.html yok - web paneli derlemesi bos cikti uretti."
  }
}

# --- [3/6] Calisma zamani dosyalari -----------------------------------------
Adim "[3/6] Calisma zamani dosyalari toplaniyor..."

# dist - .js.map HARIC
Copy-Item "$proj\dist" "$stage\dist" -Recurse
$maps = Get-ChildItem "$stage\dist" -Recurse -Filter "*.js.map"
$mapMB = [math]::Round(($maps | Measure-Object Length -Sum).Sum / 1MB, 1)
$maps | Remove-Item -Force
Write-Host "  dist        : $((Get-ChildItem "$stage\dist" -Recurse -File).Count) dosya  (.map cikarildi: $($maps.Count) dosya / $mapMB MB)"

# prisma - YALNIZ schema + migrations (seed'ler HARIC)
New-Item -ItemType Directory -Path "$stage\prisma" | Out-Null
Copy-Item "$proj\prisma\schema.prisma" "$stage\prisma\"
Copy-Item "$proj\prisma\migrations"    "$stage\prisma\migrations" -Recurse
$migSayi = (Get-ChildItem "$stage\prisma\migrations" -Directory).Count
Write-Host "  prisma      : schema.prisma + $migSayi migration  (seed*.ts DAHIL DEGIL)"

# cwd'den okunan varliklar
Copy-Item "$proj\public" "$stage\public" -Recurse
Copy-Item "$proj\assets" "$stage\assets" -Recurse
Write-Host "  public+assets: durum sayfasi + etiket fontlari"

# Web paneli - sunucuda `app\dist-web` olur; .env'deki WEB_DIST_DIR bunu gosterir.
if (-not $WebPanelHaric) {
  Copy-Item $webDist "$stage\dist-web" -Recurse
  $webSayi = (Get-ChildItem "$stage\dist-web" -Recurse -File).Count
  $webMB = [math]::Round(((Get-ChildItem "$stage\dist-web" -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Write-Host "  dist-web    : $webSayi dosya / $webMB MB  (WEB_DIST_DIR bunu gosterir)"
}

# manifest / calistirici
Copy-Item "$proj\package.json"        "$stage\"
Copy-Item "$proj\package-lock.json"   "$stage\"
Copy-Item "$proj\ecosystem.config.js" "$stage\"

# Prisma yapilandirmasi: TS DEGIL, seed kancasi OLMAYAN JS surumu
$prodCfg = "$proj\deploy\prisma.config.prod.js"
if (-not (Test-Path $prodCfg)) { Fail "deploy\prisma.config.prod.js yok - uretim prisma config'i olmadan paket uretilmez." }
Copy-Item $prodCfg "$stage\prisma.config.js"
Write-Host "  prisma.config.js : seed kancasi YOK (canli DB'de seed kazasi imkansiz)"

# --- [4/6] node_modules -----------------------------------------------------
if ($NodeModulesHaric) {
  Adim "[4/6] node_modules ATLANDI - sunucu 'npm ci --omit=dev' kosacak (internet gerekir)."
} else {
  Adim "[4/6] Uretim bagimliliklari kuruluyor (paketin icine)..."
  Push-Location $stage
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm ci --omit=dev basarisiz." }
  # Prisma istemcisi + sorgu motorlari: npm 11 install-script'leri blokladigi icin
  # motorlari postinstall DEGIL, `generate` ceker. Paket kendi kendine yetsin.
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "prisma generate basarisiz." }
  Pop-Location
  $nmMB = [math]::Round((Get-ChildItem "$stage\node_modules" -Recurse -Force | Measure-Object Length -Sum).Sum / 1MB, 1)
  Write-Host "  node_modules: $nmMB MB (uretim-only, Prisma istemcisi uretilmis)"
}

# --- [5/6] Manifest ---------------------------------------------------------
Adim "[5/6] Manifest yaziliyor..."
$dosyalar = Get-ChildItem $stage -Recurse -File -Force
$manifest = [ordered]@{
  ad              = $ad
  commit          = $commit
  dal             = $dal
  calismaAgaciTemiz = [bool](-not $kirli)
  uretimZamani    = (Get-Date).ToString("s")
  ureten          = "$env:COMPUTERNAME\$env:USERNAME"
  nodeSurumu      = (& node --version).Trim()
  npmSurumu       = (& npm --version).Trim()
  uygulamaSurumu  = (Get-Content "$proj\package.json" -Raw | ConvertFrom-Json).version
  migrationSayisi = $migSayi
  nodeModulesDahil= (-not $NodeModulesHaric)
  dosyaSayisi     = $dosyalar.Count
  toplamBayt      = ($dosyalar | Measure-Object Length -Sum).Sum
  serverJsSha256  = (Get-FileHash "$stage\dist\server.js" -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 4 | Out-File "$stage\PAKET.json" -Encoding utf8
Write-Host "  $($manifest.dosyaSayisi) dosya / $([math]::Round($manifest.toplamBayt/1MB,1)) MB"

# --- [6/6] Zip --------------------------------------------------------------
Adim "[6/6] Zip'leniyor..."
$ciktiDir = (Resolve-Path $Cikti).Path
$zip = Join-Path $ciktiDir "$ad.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$zipMB = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$sha   = (Get-FileHash $zip -Algorithm SHA256).Hash

Set-Location $repo
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  PAKET HAZIR" -ForegroundColor Green
Write-Host "  $zip"
Write-Host "  $zipMB MB  |  commit $commit  |  $migSayi migration"
Write-Host "  SHA256: $sha"
Write-Host ""
Write-Host "  Sunucuya kopyala, sonra YONETICI PowerShell'de:"
Write-Host "    C:\Etkili-Yazilim\kur.ps1 -Paket <zip yolu>"
Write-Host "================================================================"
Write-Host ""
