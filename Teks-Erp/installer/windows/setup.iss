; =============================================================================
;  TeksERP — Windows Kurulum Paketi (Inno Setup 6)
; =============================================================================
;  Bu script setup.exe'yi uretir. build.ps1 once payload + runtime klasorlerini
;  hazirlar, sonra ISCC.exe ile bunu derler:
;
;     ISCC.exe /DMyAppVersion=1.0.0 setup.iss
;
;  Cikti: dist\TeksERP-Setup-<surum>.exe
;
;  Kurulum = ilk kurulum VE guncelleme (ayni AppId -> yerinde upgrade).
;  Tum is mantigi scripts\manage.ps1 icindedir; bu installer sadece dosyalari
;  kopyalar ve manage.ps1'i cagirir.
; =============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#define MyAppName "TeksERP"
#define MyAppPublisher "TeksERP"
#define MyAppId "{{8F3A6C21-7B4E-4D9A-9C2E-1A2B3C4D5E6F}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\TeksERP
DefaultGroupName=TeksERP
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=dist
OutputBaseFilename=TeksERP-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
WizardStyle=modern
; TeksERP markasi: setup.exe ikonu, sihirbaz kucuk gorseli, kaldir listesi ikonu.
; wizard-small.bmp build.ps1 tarafindan logodan uretilir.
SetupIconFile=branding\TeksERP.ico
WizardSmallImageFile=branding\wizard-small.bmp
UninstallDisplayIcon={app}\branding\TeksERP.ico
UninstallDisplayName=TeksERP Backend (Sunucu)
SetupLogging=yes
; Guncellemede backend servisi dosyalari kilitleyebilir -> kapanmasini bekle
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Files]
; Derlenmis backend + node_modules + prisma + prisma.config.js  (build.ps1 hazirlar)
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; Gomulu runtime: node.exe, pgsql\, nssm.exe
Source: "runtime\*"; DestDir: "{app}\runtime"; Flags: recursesubdirs createallsubdirs ignoreversion
; Yonetim scriptleri
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs ignoreversion
; Sistem tepsisi durum paneli (tray.ps1 + tray-launch.vbs)
Source: "tray\*"; DestDir: "{app}\tray"; Flags: recursesubdirs createallsubdirs ignoreversion
; Marka varliklari: logo ikonu (tray + kisayollar bunu kullanir)
Source: "branding\*"; DestDir: "{app}\branding"; Flags: recursesubdirs createallsubdirs ignoreversion
; Kullanim kilavuzu — kurulum dizinine ({app}) kopyalanir + asagida Baslat menusu kisayolu.
; Log komutlari, gunluk yonetim, yedek/geri-yukleme ve sorun giderme burada.
Source: "README-KURULUM.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "REHBER.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
; Markali durum sayfasi (API/DB OK mi) — tarayicida acilir.
Name: "{group}\TeksERP Durum Sayfasi"; Filename: "http://localhost:4000/"; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{group}\TeksERP Durumu (konsol)"; Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action status"; \
  IconFilename: "{app}\branding\TeksERP.ico"
; Canli log izleme (pm2 logs karsiligi) — Baslat menusu + masaustu.
Name: "{group}\TeksERP Loglari (canli)"; Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action logs"; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{commondesktop}\TeksERP Loglari (canli)"; Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action logs"; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{group}\Veritabani (Prisma Studio)"; Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action studio"; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{group}\TeksERP Yedek Al"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action backup"; \
  IconFilename: "{app}\branding\TeksERP.ico"
; Kullanim kilavuzu (log komutlari + yonetim + yedek + sorun giderme) — Baslat menusu.
Name: "{group}\TeksERP Kullanim Kilavuzu"; Filename: "notepad.exe"; \
  Parameters: """{app}\README-KURULUM.md"""; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{group}\TeksERP Kaldir"; Filename: "{uninstallexe}"; \
  IconFilename: "{app}\branding\TeksERP.ico"
; Tepsi durum paneli: Baslat menusunden elle, ve TUM kullanicilar icin acilista otomatik.
Name: "{group}\TeksERP Durum Paneli"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\tray\tray-launch.vbs"""; \
  IconFilename: "{app}\branding\TeksERP.ico"
Name: "{commonstartup}\TeksERP Durum Paneli"; Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\tray\tray-launch.vbs"""; \
  IconFilename: "{app}\branding\TeksERP.ico"

[Run]
; Kurulum/guncelleme sonrasi tum kurulum islemini manage.ps1 yapar.
; Konsol GORUNUR birakildi: ilk kurulumda (initdb/migrate/seed dakikalarca surebilir)
; admin ilerlemeyi ve olasi hatalari gorsun.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action install -InstallDir ""{app}"""; \
  StatusMsg: "PostgreSQL, veritabani, migration ve servisler ayarlaniyor (ilk seferde birkac dakika)..."; \
  Flags: waituntilterminated
; Kurulum bitince tepsi durum panelini hemen baslat (oturum acan kullanicinin
; baglaminda, yonetici degil -> ikon dogru oturumun tepsisinde gozuksun).
Filename: "{sys}\wscript.exe"; \
  Parameters: """{app}\tray\tray-launch.vbs"""; \
  Flags: nowait runasoriginaluser skipifsilent

[UninstallRun]
; Kaldirma: veriyi silmek kullanicinin ek onayina baglidir (asagidaki Code).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action uninstall {code:UninstParams}"; \
  RunOnceId: "TeksErpUninstall"; Flags: waituntilterminated runhidden

[Code]
var
  RemoveDataChecked: Boolean;

// GUNCELLEME: calisan servisler {app} icindeki node.exe/pgsql DLL'lerini kilitler.
// Inno dosyalari kopyalamadan ONCE servisleri durdur ki dosyalar guncellenebilsin.
// Ilk kurulumda servisler henuz yok -> komut sessizce gecer.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-Service TeksErpBackend,TeksErpDB -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Calisan tepsi panellerini de durdur (her konumdan): aksi halde guncellemede
  // eski tepsi ikonu calismaya devam eder, manage.ps1 yenisini baslatinca
  // yeniden baslatmaya kadar IKI ikon gorunur. Boylece tek ikon kalir.
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq ''powershell.exe'' -and $_.CommandLine -like ''*tray.ps1*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

// Kaldirma sirasinda: veritabanini da silmek isteyip istemedigini sor (varsayilan: HAYIR).
function InitializeUninstall(): Boolean;
begin
  RemoveDataChecked := False;
  Result := True;
  if MsgBox('TeksERP kaldiriliyor.' + #13#10#13#10 +
            'VERITABANI ve tum kayitlar da SILINSIN mi?' + #13#10#13#10 +
            'EVET = her sey silinir (geri alinamaz).' + #13#10 +
            'HAYIR = sadece program kaldirilir, veriler C:\ProgramData\TeksERP altinda korunur.',
            mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
  begin
    if MsgBox('Emin misiniz? TUM uretim verisi kalici olarak silinecek!',
              mbCriticalError, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      RemoveDataChecked := True;
  end;
end;

// UninstallRun parametresine -RemoveData ekle (sadece onaylandiysa).
function UninstParams(Param: String): String;
begin
  if RemoveDataChecked then
    Result := '-RemoveData'
  else
    Result := '';
end;
