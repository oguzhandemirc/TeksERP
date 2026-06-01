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

[Icons]
Name: "{group}\TeksERP Durumu"; Filename: "powershell.exe"; \
  Parameters: "-NoExit -NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action status"
Name: "{group}\TeksERP Yedek Al"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action backup"
Name: "{group}\Swagger API Dokumani"; Filename: "http://localhost:4000/api-docs"
Name: "{group}\TeksERP Kaldir"; Filename: "{uninstallexe}"

[Run]
; Kurulum/guncelleme sonrasi tum kurulum islemini manage.ps1 yapar.
; Konsol GORUNUR birakildi: ilk kurulumda (initdb/migrate/seed dakikalarca surebilir)
; admin ilerlemeyi ve olasi hatalari gorsun.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\manage.ps1"" -Action install -InstallDir ""{app}"""; \
  StatusMsg: "PostgreSQL, veritabani, migration ve servisler ayarlaniyor (ilk seferde birkac dakika)..."; \
  Flags: waituntilterminated

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
