; =============================================================================
; TeksERP SUNUCU KURULUMU - Inno Setup 6 betiği (TeksERP-Kurulum-<sürüm>.exe) · Dağıtım v2 D5
; =============================================================================
; Sihirbaz YALNIZ cevap toplar ve aşama koşucusunu (kurulum.ps1) çağırır; karar ve ölçüm betiktedir:
;   ön ölçüm (on-olcum.ps1, salt okuma; açılışta HAFİF, kök seçilince TAM - ikisi de "Sistem denetleniyor"
;   penceresiyle) → PrepareToInstall: kök kilidi + cevap.json + OnKosul →
;   dosyalar → Paket → PostgreSQL → Backend → Hizmetler → [Sirlar: BORUYLA] → Dogrulama.
; SIR HİJYENİ: satıcı parolası/PIN ve yerel yedek parolası cevap dosyasına, komut satırına, ortama,
;   günlüğe GİRMEZ — Sirlar aşamasına anonim boruyla (STDIN) gider (BoruIleKos). Müşteri yedek
;   anahtarı istenirse yalnız sonuç sayfasında BİR KEZ gösterilir.
; SESSİZ KİP (bayi): TeksERP-Kurulum.exe /VERYSILENT /SUPPRESSMSGBOXES /CEVAP=<cevap.json> [/LOG=<dosya>]
;   cevap biçimi deploy\kurulum\cevap-semasi.json (SIRSIZ). Sessiz kipte satıcı hesabı ve yerel yedek
;   anahtarı kurulmaz; kurulum sonunda <kök>\kurulum\kurulum.json "acik" listesinde komutlarıyla durur.
;   ÇIKIŞ: 0 tamam · 1 başlatılamadı (cevap/paket/ön ölçüm) · 2 iptal · 7 ön koşul (OnKosul) düştü ·
;   12 Paket · 13 PostgreSQL · 14 Backend · 15 Hizmetler · 16 Sirlar · 17 Dogrulama düştü
;   (ayrıntı <kök>\kurulum\gunluk\kurulum-<gün>.log; aynı paketle yeniden koşmak KALDIĞI YERDEN sürer).
; DERLEME (CI, windows-latest; .github/workflows/kurulum-windows.yml):
;   ISCC /DKurulumSurumu=<x.y.z> /DDogrulayiciExe=<tekserp-guncelleyici.exe> /O<çıktı> tekserp-kurulum.iss
;   /DBORU_SINAMASI: boru öz-sınaması derlemesi (yalnız CI; /SINAMA=<dosya> ile koşar, kurulum YAPMAZ).
; İMZA KANCASI: /DImzaAraci + ISCC /Simza="signtool sign /fd sha256 ... $f" (bugün İMZASIZ).
; Doğrulayıcı: kurulumun KENDİ tekserp-guncelleyici.exe'si (aynı commit, üretim çapası; paketin ikilisi
;   kendini doğrulayamaz). Bekçi: Teks-Erp/scripts/test_kurulum_betikleri.ts.
; =============================================================================

#if Ver < EncodeVer(6, 3, 0, 0)
  #error Inno Setup 6.3 ya da sonrasi gerekir (x64compatible, ExtractTemporaryFiles)
#endif
#ifndef KurulumSurumu
  #define KurulumSurumu "0.0.0-yerel"
#endif
#ifndef DogrulayiciExe
  #define DogrulayiciExe "..\..\Teks-Erp\native\target\release\tekserp-guncelleyici.exe"
#endif

[Setup]
AppId={code:UygulamaKimligi}
AppName=TeksERP Sunucu
AppVersion={#KurulumSurumu}
AppVerName=TeksERP Sunucu (kurulum {#KurulumSurumu})
AppPublisher=Etkili Yazılım
DefaultDirName={code:VarsayilanKok}
DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=yes
DisableReadyPage=no
DirExistsWarning=no
AppendDefaultDirName=no
AllowRootDirectory=no
AllowUNCPath=no
AllowNetworkDrive=no
UsePreviousAppDir=yes
; AppId kanaldan ({code:}) türer: dil seçimi AppId'den ÖNCE okunurdu - Inno bu ikisini birlikte kabul etmez.
UsePreviousLanguage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
SetupLogging=yes
UninstallFilesDir={app}\kurulum\kaldirici
UninstallDisplayName={code:KaldirmaAdi}
CloseApplications=no
RestartApplications=no
ShowLanguageDialog=no
OutputDir=cikti
#ifdef BORU_SINAMASI
OutputBaseFilename=TeksERP-Kurulum-{#KurulumSurumu}-boru-sinamasi
#else
OutputBaseFilename=TeksERP-Kurulum-{#KurulumSurumu}
#endif
#ifdef ImzaAraci
SignTool=imza
SignedUninstaller=yes
#endif

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Messages]
WelcomeLabel2=Bu sihirbaz TeksERP sunucusunu (uygulama, kendi PostgreSQL örneği ve güncelleyici) Windows hizmetleri olarak kurar.%n%nBu programın yanında tekserp-backend-*.zip, postgresql-*.zip ve pg.json bulunmalıdır.%n%nAynı klasöre yeniden kurulum ONARIM olur; yarıda kalan kurulum kaldığı yerden sürer. Veriler hiçbir adımda silinmez.
SelectDirLabel3=Program, yapılandırma ve günlükler bu klasöre kurulur (yalnız harf, rakam ve noktalama; boşluksuz). Veritabanı verisinin yeri sonraki sayfalarda ayrıca seçilir.
ConfirmUninstall=TeksERP sunucusunun PROGRAMI kaldırılacak: hizmetler, sürümler, gece yedeği görevi ve güvenlik duvarı kuralları.%n%nVERİLER KORUNUR: veritabanı, yedekler, yapılandırma, lisans ve günlükler silinmez; aynı klasöre yeniden kurulum bu veriye bağlanır.%n%nDevam edilsin mi?

[Files]
Source: "{#DogrulayiciExe}"; DestDir: "{app}\kurulum\araclar"; DestName: "tekserp-guncelleyici.exe"; Flags: ignoreversion
Source: "kurulum.ps1"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "kurulum-ortak.ps1"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "..\hizmet\kanal-adlari.ps1"; DestDir: "{app}\kurulum\deploy\hizmet"; Flags: ignoreversion
Source: "..\hizmet\sema-hizasi.ps1"; DestDir: "{app}\kurulum\deploy\hizmet"; Flags: ignoreversion
Source: "on-olcum.ps1"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "kaldir.ps1"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "cevap-semasi.json"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "ornek-cevap.json"; DestDir: "{app}\kurulum\deploy\kurulum"; Flags: ignoreversion
Source: "..\pg\pg-ornegi.json"; DestDir: "{app}\kurulum\deploy\pg"; Flags: ignoreversion
Source: "..\pg\pg-surumu.json"; DestDir: "{app}\kurulum\deploy\pg"; Flags: ignoreversion
Source: "..\pg\pg-sablon.mjs"; DestDir: "{app}\kurulum\deploy\pg"; Flags: ignoreversion
Source: "..\pg\postgresql.tekserp.conf.sablon"; DestDir: "{app}\kurulum\deploy\pg"; Flags: ignoreversion
Source: "..\pg\pg_hba.conf.sablon"; DestDir: "{app}\kurulum\deploy\pg"; Flags: ignoreversion
Source: "..\pg\lib\pg-ornegi.mjs"; DestDir: "{app}\kurulum\deploy\pg\lib"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\kurulum\deploy\kurulum\kaldir.ps1"" -Kok ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "TeksERP-Kaldir"

[Code]
// -----------------------------------------------------------------------------
// Win32 (boru + süreç + ileti döngüsü). Kayıtlar yalnız 4 baytlık alanlar (+ yan yana iki Word):
// Pascal Script kaydı paketli tutar, 32-bit C düzeniyle bayt bayt aynı. Kurulum süreci 32-bit.
// -----------------------------------------------------------------------------
type
  TGuvenlikOz = record
    nLength: LongWord;
    lpSecurityDescriptor: LongWord;
    bInheritHandle: LongWord;
  end;
  TBaslatmaBilgisi = record
    cb: LongWord;
    lpReserved: LongWord;
    lpDesktop: LongWord;
    lpTitle: LongWord;
    dwX: LongWord;
    dwY: LongWord;
    dwXSize: LongWord;
    dwYSize: LongWord;
    dwXCountChars: LongWord;
    dwYCountChars: LongWord;
    dwFillAttribute: LongWord;
    dwFlags: LongWord;
    wShowWindow: Word;
    cbReserved2: Word;
    lpReserved2: LongWord;
    hStdInput: LongWord;
    hStdOutput: LongWord;
    hStdError: LongWord;
  end;
  TSurecBilgisi = record
    hProcess: LongWord;
    hThread: LongWord;
    dwProcessId: LongWord;
    dwThreadId: LongWord;
  end;
  TIleti = record
    Pencere: LongWord;
    Kimlik: LongWord;
    Ek1: LongWord;
    Ek2: LongWord;
    Zaman: LongWord;
    NoktaX: Longint;
    NoktaY: Longint;
  end;

// BOOL dönüşleri Integer (0 = FALSE): Pascal Script'te BOOL tanımına güvenilmez.
function WinCreatePipe(var OkumaUcu: LongWord; var YazmaUcu: LongWord; var Oz: TGuvenlikOz; Boy: LongWord): Integer;
  external 'CreatePipe@kernel32.dll stdcall';
function WinSetHandleInformation(Tutamak: LongWord; Maske: LongWord; Bayrak: LongWord): Integer;
  external 'SetHandleInformation@kernel32.dll stdcall';
function WinCreateProcess(UygulamaAdi: LongWord; KomutSatiri: String; SurecOz: LongWord; IplikOz: LongWord;
  MirasVer: Integer; OlusturmaBayragi: LongWord; Ortam: LongWord; CalismaDizini: LongWord;
  var Baslatma: TBaslatmaBilgisi; var Surec: TSurecBilgisi): Integer;
  external 'CreateProcessW@kernel32.dll stdcall';
function WinWriteFile(Tutamak: LongWord; Tampon: AnsiString; Adet: LongWord; var Yazilan: LongWord; Ortusme: LongWord): Integer;
  external 'WriteFile@kernel32.dll stdcall';
function WinReadFile(Tutamak: LongWord; Tampon: AnsiString; Adet: LongWord; var Okunan: LongWord; Ortusme: LongWord): Integer;
  external 'ReadFile@kernel32.dll stdcall';
function WinPeekNamedPipe(Tutamak: LongWord; Tampon: LongWord; TamponBoyu: LongWord; Okunan: LongWord; var Mevcut: LongWord; IletiKalani: LongWord): Integer;
  external 'PeekNamedPipe@kernel32.dll stdcall';
function WinWaitForSingleObject(Tutamak: LongWord; Ms: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function WinGetExitCodeProcess(Tutamak: LongWord; var CikisKodu: LongWord): Integer;
  external 'GetExitCodeProcess@kernel32.dll stdcall';
function WinTerminateProcess(Tutamak: LongWord; CikisKodu: LongWord): Integer;
  external 'TerminateProcess@kernel32.dll stdcall';
function WinCloseHandle(Tutamak: LongWord): Integer;
  external 'CloseHandle@kernel32.dll stdcall';
function WinGetDriveType(KokYolu: String): LongWord;
  external 'GetDriveTypeW@kernel32.dll stdcall';
function WinGetTickCount: LongWord;
  external 'GetTickCount@kernel32.dll stdcall';
function WinGetCurrentProcess: LongWord;
  external 'GetCurrentProcess@kernel32.dll stdcall';
function WinIsWow64Process(Surec: LongWord; var Wow64: Integer): Integer;
  external 'IsWow64Process@kernel32.dll stdcall';
function WinPeekMessage(var Ileti: TIleti; Pen: LongWord; FiltreAlt: LongWord; FiltreUst: LongWord; Kaldir: LongWord): Integer;
  external 'PeekMessageW@user32.dll stdcall';
function WinTranslateMessage(var Ileti: TIleti): Integer;
  external 'TranslateMessage@user32.dll stdcall';
function WinDispatchMessage(var Ileti: TIleti): LongWord;
  external 'DispatchMessageW@user32.dll stdcall';

// Win32 sabitleri C_ önekli: Inno'nun hazır tanımlarıyla "Duplicate identifier" çakışması olmasın.
const
  C_MIRAS = 1;
  C_PENCERE_GOSTER = $1;
  C_STD_UCLAR = $100;
  C_PENCERESIZ = $08000000;
  C_BEKLEME_TAMAM = 0;
  C_ILETI_KALDIR = 1;
  C_SURUCU_CIKARILABILIR = 2;
  PS_ARGS = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ';
  VARSAYILAN_GUNCELLEME = 'https://guncelleme.etkiliyazilim.com';
  VERI_ACIKLAMASI = 'Veritabanı dosyaları bu dizinde tutulur: yerel, SABİT bir NTFS diski seçin (öneri: D:). Dizin YOK ya da BOŞ olmalı; dolu dizine kurulmaz, veri silinmez.';

var
  OlcumIni: String;
  Sessiz: Boolean;
  CevapDosyasi: String;
  Sonek: String;
  OlculenKok: String;
  Onarim: Boolean;
  Yarim: Boolean;
  ProvaKabul: Boolean;
  KurulumHatasi: String;
  HataAsamasi: Integer;
  MusteriAnahtari: String;
  SaticiUyarisi: String;
  SonucMetni: String;
  OlcumSayfasi: TOutputMsgMemoWizardPage;
  VeriSayfasi: TInputDirWizardPage;
  PortSayfasi: TInputQueryWizardPage;
  AgSayfasi: TInputOptionWizardPage;
  SaticiSayfasi: TInputQueryWizardPage;
  YedekSecimSayfasi: TInputOptionWizardPage;
  YedekSayfasi: TInputQueryWizardPage;
  GelismisSayfasi: TInputQueryWizardPage;
  ProfilSayfasi: TInputOptionWizardPage;
  SonucSayfasi: TOutputMsgMemoWizardPage;
  AnahtarOnay: TNewCheckBox;
  SihirbazHazir: Boolean;
  GelismisKayittan: Boolean;

// -----------------------------------------------------------------------------
// Yardımcılar. Dizin erişimi uzunluk denetiminden SONRA iç içe if ile: kısa devre değerlendirmesine
// güvenilmez (S[i] taşması çalışma anında kurulumu düşürürdü).
// -----------------------------------------------------------------------------
function PowerShellYolu: String;
begin
  // 64-bit kipte {sys} gerçek System32; Exec yönlendirmesiz koşar (64-bit PowerShell).
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

// Doğrudan CreateProcessW (BoruIleKos) Inno'nun yönlendirme kapatmasından geçmez: 32-bit kurulum süreci
// System32 yolunu SysWOW64'e (32-bit PowerShell) çevirir. WOW64 altında Sysnative gerçek System32'dir.
function BoruPowerShellYolu: String;
var Wow64: Integer;
begin
  Result := PowerShellYolu;
  Wow64 := 0;
  if WinIsWow64Process(WinGetCurrentProcess, Wow64) <> 0 then
    if Wow64 <> 0 then Result := ExpandConstant('{win}\Sysnative\WindowsPowerShell\v1.0\powershell.exe');
end;

// Komut satırı yolu: tırnaklı; sondaki ters bölü kapanış tırnağını kaçırmasın diye '.' eklenir (E:\ -> "E:\.").
function ArgYol(const S: String): String;
var Y: String;
begin
  Y := S;
  if Length(Y) > 0 then
    if Y[Length(Y)] = '\' then Y := Y + '.';
  Result := '"' + Y + '"';
end;

function TmpKurulum(const Ad: String): String;
begin
  // ExtractTemporaryFiles hedef yolunu GENİŞLETMEDEN taşır: {tmp}\{app}\kurulum\...
  Result := ExpandConstant('{tmp}') + '\{app}\kurulum\' + Ad;
end;

function Olc(const Anahtar: String): String;
begin
  Result := GetIniString('olcum', Anahtar, '', OlcumIni);
end;

function SonucOku(const Ini, Anahtar: String): String;
begin
  Result := GetIniString('sonuc', Anahtar, '', Ini);
end;

function Hata(const Metin: String): Boolean;
begin
  Log('HATA: ' + Metin);
  // Sessiz kipte kutu YOK (karar günlükte + çıkış kodunda); /SUPPRESSMSGBOXES'e de güvenilmez.
  if not WizardSilent then SuppressibleMsgBox(Metin, mbCriticalError, MB_OK, IDOK);
  Result := False;
end;

// JSON metni: ASCII dışı ve denetim karakterleri \uXXXX (dosya ve boru saf ASCII; kod sayfası sorunu yok).
function JsonMetin(const S: String): String;
var
  I, C: Integer;
begin
  Result := '"';
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if C = 34 then Result := Result + '\"'
    else if C = 92 then Result := Result + '\\'
    else if (C < 32) or (C > 126) then Result := Result + '\u' + Lowercase(Format('%.4x', [C]))
    else Result := Result + S[I];
  end;
  Result := Result + '"';
end;

function JsonYaDaNull(const S: String): String;
begin
  if S = '' then Result := 'null' else Result := JsonMetin(S);
end;

function JsonMantik(B: Boolean): String;
begin
  if B then Result := 'true' else Result := 'false';
end;

function RakamMi(const S: String): Boolean;
var I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do
    if (Ord(S[I]) < 48) or (Ord(S[I]) > 57) then Result := False;
end;

// cevap-semasi.json 'yol': ^[A-Za-z]:\\[\x21-\x7E]*$, '..' ve '"' yok (.env'e tırnaksız yazılır).
function YolGecerli(const S: String): Boolean;
var I, C: Integer; Harf: String;
begin
  Result := False;
  if Length(S) < 3 then Exit;
  if (S[2] <> ':') or (S[3] <> '\') or (Pos('..', S) > 0) or (Pos('"', S) > 0) then Exit;
  Harf := Uppercase(Copy(S, 1, 1));
  C := Ord(Harf[1]);
  if (C < 65) or (C > 90) then Exit;
  Result := True;
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if (C < 33) or (C > 126) then Result := False;
  end;
end;

// Dosya yolu (müşteri anahtarı çıktısı): X:\ ile başlar, denetim ve <>|*?" yok.
function DosyaYoluGecerli(const S: String): Boolean;
var I, C: Integer;
begin
  Result := False;
  if Length(S) < 4 then Exit;
  if (S[2] <> ':') or (S[3] <> '\') then Exit;
  Result := True;
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if (C < 32) or (C = 34) or (C = 60) or (C = 62) or (C = 124) or (C = 42) or (C = 63) then Result := False;
  end;
end;

// ^https?://[A-Za-z0-9.-]{1,120}(:[0-9]{1,5})?$ (vekilde port ZORUNLU).
function AdresGecerli(const S, Onek: String; PortZorunlu: Boolean): Boolean;
var Govde, Ana, Port: String; I, C, P: Integer;
begin
  Result := False;
  if Copy(S, 1, Length(Onek)) <> Onek then Exit;
  Govde := Copy(S, Length(Onek) + 1, Length(S));
  P := Pos(':', Govde);
  if P > 0 then begin Ana := Copy(Govde, 1, P - 1); Port := Copy(Govde, P + 1, Length(Govde)); end
  else begin Ana := Govde; Port := ''; end;
  if (Length(Ana) < 1) or (Length(Ana) > 120) then Exit;
  for I := 1 to Length(Ana) do
  begin
    C := Ord(Ana[I]);
    if not (((C >= 48) and (C <= 57)) or ((C >= 65) and (C <= 90)) or ((C >= 97) and (C <= 122)) or (C = 46) or (C = 45)) then Exit;
  end;
  if (P > 0) and (not RakamMi(Port) or (Length(Port) > 5)) then Exit;
  if PortZorunlu and (P = 0) then Exit;
  Result := True;
end;

function KullaniciAdiGecerli(const S: String): Boolean;
var I, C: Integer;
begin
  Result := (Length(S) >= 3) and (Length(S) <= 50);
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if not (((C >= 48) and (C <= 57)) or ((C >= 65) and (C <= 90)) or ((C >= 97) and (C <= 122)) or (C = 46) or (C = 95) or (C = 45)) then Result := False;
  end;
end;

function Utf8Bayt(const S: String): Integer;
var I, C: Integer;
begin
  Result := 0;
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if C < 128 then Result := Result + 1
    else if C < 2048 then Result := Result + 2
    else if (C >= $D800) and (C <= $DFFF) then Result := Result + 2
    else Result := Result + 3;
  end;
end;

function AsciiParola(const S: String): Boolean;
var I, C: Integer;
begin
  Result := (Length(S) >= 10) and (Length(S) <= 128);
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if (C < 33) or (C > 126) then Result := False;
  end;
end;

function SaatGecerli(const S: String): Boolean;
begin
  Result := False;
  if Length(S) <> 5 then Exit;
  if S[3] <> ':' then Exit;
  Result := RakamMi(Copy(S, 1, 2)) and RakamMi(Copy(S, 4, 2))
    and (StrToIntDef(Copy(S, 1, 2), 99) <= 23) and (StrToIntDef(Copy(S, 4, 2), 99) <= 59);
end;

function PortDegeri(const S: String): Integer;
begin
  Result := -1;
  if RakamMi(S) and (Length(S) <= 5) then Result := StrToIntDef(S, -1);
  if (Result < 1025) or (Result > 65535) then Result := -1;
end;

function Kok: String;
begin
  Result := RemoveBackslashUnlessRoot(WizardDirValue);
end;

// -----------------------------------------------------------------------------
// İleti döngüsü + BORU: STDIN'e sır yazılır, STDOUT+STDERR okunur (argv/ortam/dosya YOK).
// Dönüş boş = koşu bitti (Kod geçerli); dolu = koşturulamadı/zaman aşımı.
// -----------------------------------------------------------------------------
procedure IletileriIsle;
var M: TIleti;
begin
  while WinPeekMessage(M, 0, 0, 0, C_ILETI_KALDIR) <> 0 do
  begin
    WinTranslateMessage(M);
    WinDispatchMessage(M);
  end;
end;

function BoruIleKos(const Exe, Arglar: String; const Girdi: AnsiString; ZamanAsimiSn: Integer; var Cikti: AnsiString; var Kod: Integer): String;
var
  Sa: TGuvenlikOz;
  Bb: TBaslatmaBilgisi;
  Sb: TSurecBilgisi;
  GirdiOku, GirdiYaz, CiktiOku, CiktiYaz: LongWord;
  Komut: String;
  Yazilan, Mevcut, Okunan, CikisKodu: LongWord;
  Tampon: AnsiString;
  Bas, Bitis: LongWord;
  Bitti, Cikti0: Boolean;
begin
  Result := '';
  Cikti := '';
  Kod := -1;
  GirdiOku := 0; GirdiYaz := 0; CiktiOku := 0; CiktiYaz := 0;
  Sa.nLength := 12; Sa.lpSecurityDescriptor := 0; Sa.bInheritHandle := 1;
  if WinCreatePipe(GirdiOku, GirdiYaz, Sa, 0) = 0 then begin Result := 'CreatePipe (girdi) ' + IntToStr(DLLGetLastError); Exit; end;
  if WinCreatePipe(CiktiOku, CiktiYaz, Sa, 65536) = 0 then
  begin
    Result := 'CreatePipe (cikti) ' + IntToStr(DLLGetLastError);
    WinCloseHandle(GirdiOku); WinCloseHandle(GirdiYaz);
    Exit;
  end;
  // Kurulumun uçları çocuğa GEÇMEZ (yalnız çocuğun okuyacağı/yazacağı uçlar miras).
  WinSetHandleInformation(GirdiYaz, C_MIRAS, 0);
  WinSetHandleInformation(CiktiOku, C_MIRAS, 0);
  Bb.cb := 68; Bb.lpReserved := 0; Bb.lpDesktop := 0; Bb.lpTitle := 0;
  Bb.dwX := 0; Bb.dwY := 0; Bb.dwXSize := 0; Bb.dwYSize := 0; Bb.dwXCountChars := 0; Bb.dwYCountChars := 0;
  Bb.dwFillAttribute := 0; Bb.dwFlags := C_STD_UCLAR or C_PENCERE_GOSTER;
  Bb.wShowWindow := 0; Bb.cbReserved2 := 0; Bb.lpReserved2 := 0;
  Bb.hStdInput := GirdiOku; Bb.hStdOutput := CiktiYaz; Bb.hStdError := CiktiYaz;
  Sb.hProcess := 0; Sb.hThread := 0; Sb.dwProcessId := 0; Sb.dwThreadId := 0;
  Komut := '"' + Exe + '" ' + Arglar;
  if WinCreateProcess(0, Komut, 0, 0, 1, C_PENCERESIZ, 0, 0, Bb, Sb) = 0 then
  begin
    Result := 'CreateProcess ' + IntToStr(DLLGetLastError);
    WinCloseHandle(GirdiOku); WinCloseHandle(GirdiYaz); WinCloseHandle(CiktiOku); WinCloseHandle(CiktiYaz);
    Exit;
  end;
  WinCloseHandle(Sb.hThread);
  WinCloseHandle(GirdiOku);
  WinCloseHandle(CiktiYaz);
  Yazilan := 0;
  if Length(Girdi) > 0 then
    if (WinWriteFile(GirdiYaz, Girdi, LongWord(Length(Girdi)), Yazilan, 0) = 0) or (Integer(Yazilan) <> Length(Girdi)) then
      Result := 'STDIN yazilamadi (' + IntToStr(DLLGetLastError) + ')';
  WinCloseHandle(GirdiYaz);

  Bas := WinGetTickCount;
  Bitis := 0;
  Bitti := False;
  Cikti0 := False;
  repeat
    Mevcut := 0;
    if WinPeekNamedPipe(CiktiOku, 0, 0, 0, Mevcut, 0) = 0 then
      Bitti := True
    else if Mevcut > 0 then
    begin
      if Mevcut > 65536 then Mevcut := 65536;
      SetLength(Tampon, Integer(Mevcut));
      Okunan := 0;
      if (WinReadFile(CiktiOku, Tampon, Mevcut, Okunan, 0) <> 0) and (Okunan > 0) then
        Cikti := Cikti + Copy(Tampon, 1, Integer(Okunan))
      else
        Bitti := True;
    end
    else
    begin
      if not Cikti0 and (WinWaitForSingleObject(Sb.hProcess, 50) = C_BEKLEME_TAMAM) then
      begin
        Cikti0 := True;
        Bitis := WinGetTickCount;
      end;
      // Süreç bitti ama boru torunda açık kaldıysa 3 sn boşaltıp çık.
      if Cikti0 and (WinGetTickCount - Bitis > 3000) then Bitti := True;
      IletileriIsle;
      if not Cikti0 and (WinGetTickCount - Bas > LongWord(ZamanAsimiSn) * 1000) then
      begin
        WinTerminateProcess(Sb.hProcess, 1);
        Result := 'zaman asimi (' + IntToStr(ZamanAsimiSn) + ' sn) - surec sonlandirildi';
        Bitti := True;
      end;
    end;
  until Bitti;
  WinWaitForSingleObject(Sb.hProcess, 10000);
  CikisKodu := 0;
  if WinGetExitCodeProcess(Sb.hProcess, CikisKodu) <> 0 then Kod := Integer(CikisKodu);
  WinCloseHandle(Sb.hProcess);
  WinCloseHandle(CiktiOku);
end;

// Çıktıdan "ONEK..." satırının değeri (satır sonu CR/LF).
function SatirDegeri(const Metin: AnsiString; const Onek: String): String;
var P, I: Integer; S: String;
begin
  Result := '';
  S := Metin;
  P := Pos(Onek, S);
  if P = 0 then Exit;
  I := P + Length(Onek);
  while I <= Length(S) do
  begin
    if (S[I] = #13) or (S[I] = #10) then Break;
    I := I + 1;
  end;
  Result := Copy(S, P + Length(Onek), I - P - Length(Onek));
end;

// -----------------------------------------------------------------------------
// Ön ölçüm (on-olcum.ps1, salt okuma) — {tmp} kopyasından.
// -----------------------------------------------------------------------------
function GeciciDosyalariAc: Boolean;
begin
  Result := True;
  try
    ExtractTemporaryFiles('{app}\kurulum\deploy\kurulum\*');
    ExtractTemporaryFiles('{app}\kurulum\deploy\pg\*');
  except
    Result := Hata('Kurulum dosyaları açılamadı: ' + GetExceptionMessage);
  end;
end;

// "Sistem denetleniyor" penceresi: ölçüm (PowerShell) sürerken ekran boş kalmasın - kullanıcı programı donmuş
// sanmasın (thinkpad-1 D8b: ilk pencere ~60 sn görünmedi). Sessiz kipte açılmaz. Exec beklerken iletileri işler.
function DenetimPenceresiAc(const Ayrinti: String): TSetupForm;
var F: TSetupForm; Baslik, Metin: TNewStaticText; Cubuk: TNewProgressBar;
begin
  F := TSetupForm.CreateNew(nil);
  F.Caption := 'TeksERP Sunucu Kurulumu';
  F.BorderStyle := bsDialog;
  F.Position := poScreenCenter;
  F.ClientWidth := 460;
  F.ClientHeight := 128;
  Baslik := TNewStaticText.Create(F);
  Baslik.Parent := F;
  Baslik.Left := 16;
  Baslik.Top := 14;
  Baslik.Font.Style := [fsBold];
  Baslik.Caption := 'Sistem denetleniyor...';
  Metin := TNewStaticText.Create(F);
  Metin.Parent := F;
  Metin.AutoSize := False;
  Metin.WordWrap := True;
  Metin.Left := 16;
  Metin.Top := 38;
  Metin.Width := 428;
  Metin.Height := 46;
  Metin.Caption := Ayrinti;
  Cubuk := TNewProgressBar.Create(F);
  Cubuk.Parent := F;
  Cubuk.Left := 16;
  Cubuk.Top := 94;
  Cubuk.Width := 428;
  Cubuk.Height := 18;
  Cubuk.Style := npbstMarquee;
  F.Show;
  IletileriIsle;
  Result := F;
end;

// Ölçümün kendisi (pencere yok): boş = tamam, dolu = hata metni.
function OlcumKos(const KokAdayi: String; Hafif: Boolean): String;
var Kod: Integer; Arg: String;
begin
  Result := '';
  OlcumIni := ExpandConstant('{tmp}\olcum.ini');
  DeleteFile(OlcumIni);
  Arg := '-Kaynak ' + ArgYol(ExpandConstant('{src}')) + ' -Kok ' + ArgYol(KokAdayi) + ' -Cikti ' + ArgYol(OlcumIni);
  if CevapDosyasi <> '' then Arg := Arg + ' -Cevap ' + ArgYol(CevapDosyasi);
  if Hafif then Arg := Arg + ' -Hafif';
  if not Exec(PowerShellYolu, PS_ARGS + ArgYol(TmpKurulum('deploy\kurulum\on-olcum.ps1')) + ' ' + Arg, '', SW_HIDE, ewWaitUntilTerminated, Kod) then
  begin
    Result := 'PowerShell başlatılamadı (' + SysErrorMessage(Kod) + ').';
    Exit;
  end;
  if not FileExists(OlcumIni) or (Olc('tamam') <> '1') then
  begin
    Result := 'Ön ölçüm yapılamadı (çıkış ' + IntToStr(Kod) + '): ' + Olc('hata') + #13#10 + 'Yürütme ilkesi (GPO AllSigned) PowerShell betiklerini engelliyor olabilir.';
    Exit;
  end;
  if Olc('x64Surec') <> '1' then Result := '64-bit PowerShell çalıştırılamadı (32-bit kabuk). Kurulum 64-bit Windows PowerShell ister.';
end;

// Hafif: sihirbaz açılmadan önce yalnız paketin kimliği (AppId'nin kanal soneki) - CIM/port/kök ölçümü YOK.
// Görünür kipte ölçüm boyunca denetim penceresi açık; sihirbaz varsa ölçüm bitene dek KİLİTLİ (Exec iletileri
// işler, ikinci "İleri" tıklaması ölçümü iç içe başlatmasın).
function OnOlcumKipli(const KokAdayi: String; Hafif: Boolean): Boolean;
var Pencere: TSetupForm; Sorun, Ayrinti: String;
begin
  Pencere := nil;
  if not Sessiz then
  begin
    if Hafif then Ayrinti := 'Kurulum paketi okunuyor; sihirbaz birazdan açılacak.'
    else Ayrinti := 'Bu bilgisayar, ' + KokAdayi + ' klasörü ve kurulum paketi ölçülüyor (önceki kurulum, portlar, diskler). Bu bir dakika kadar sürebilir.';
    try
      Pencere := DenetimPenceresiAc(Ayrinti);
    except
      Log('denetim penceresi acilamadi: ' + GetExceptionMessage);
      Pencere := nil;
    end;
    if SihirbazHazir then WizardForm.Enabled := False;
  end;
  try
    Sorun := OlcumKos(KokAdayi, Hafif);
  finally
    if SihirbazHazir and not Sessiz then WizardForm.Enabled := True;
    if Pencere <> nil then Pencere.Free;
  end;
  if Sorun <> '' then
  begin
    Result := Hata(Sorun);
    Exit;
  end;
  Sonek := Olc('sonek');
  OlculenKok := Olc('kok');
  Onarim := Olc('onarim') = '1';
  Yarim := Olc('yarim') = '1';
  Result := True;
end;

function OnOlcum(const KokAdayi: String): Boolean;
begin
  Result := OnOlcumKipli(KokAdayi, False);
end;

// Gerçek kurulu sürüm (ölçüm: current · kurulum-gecmisi.jsonl · güncelleyici durumu); yoksa kayıttaki.
function KuruluSurum: String;
begin
  Result := Olc('kuruluSurum');
  if Result = '' then Result := Olc('oncekiSurum');
end;

function KipMetni: String;
begin
  if Onarim then Result := 'ONARIM (kurulu sürüm ' + KuruluSurum + ', paket ' + Olc('paketSurum') + '; veri korunur)'
  else if Yarim then Result := 'DEVAM (yarım kalan kurulum ' + Olc('oncekiSurum') + ' - kaldığı yerden)'
  else Result := 'yeni kurulum';
end;

// Engeller (kurulum ilerlemez): boş = yok.
function OlcumEngelleri: String;
begin
  Result := '';
  if Olc('yonetici') <> '1' then Result := Result + '- Yönetici olarak çalıştırılmalı.' + #13#10;
  if Olc('paketSayisi') <> '1' then Result := Result + '- Kurulum klasöründe TEK tekserp-backend-*.zip olmalı (bulunan: ' + Olc('paketSayisi') + ').' + #13#10;
  if Olc('paketHata') <> '' then Result := Result + '- Paket: ' + Olc('paketHata') + #13#10;
  if (Olc('paketSayisi') = '1') and (Olc('paketKorumali') <> '1') then Result := Result + '- Paket KORUMALI win-x64 değil (hizmet düzenine kurulamaz).' + #13#10;
  if Olc('pgZipSayisi') <> '1' then Result := Result + '- Kurulum klasöründe TEK postgresql-*.zip olmalı (bulunan: ' + Olc('pgZipSayisi') + ').' + #13#10;
  if Olc('pgKunyeVar') <> '1' then Result := Result + '- pg.json (PostgreSQL künyesi) yok.' + #13#10;
  if Olc('pgPortHata') <> '' then Result := Result + '- PostgreSQL portu: ' + Olc('pgPortHata') + #13#10;
  if (Olc('kokYabanci') <> '') and (Olc('kokYabanci') <> '0') then Result := Result + '- Kök klasör boş değil ve TeksERP kurulumu değil (' + Olc('kokYabanci') + ' girdi): başka bir klasör seçin; var olan veri ezilmez.' + #13#10;
  if (Onarim or Yarim) and (Olc('oncekiHizmet') <> '') and (Olc('oncekiHizmet') <> Olc('backendHizmeti')) then
    Result := Result + '- Bu klasördeki kurulum başka bir kanalın (' + Olc('oncekiHizmet') + '); bu paket ' + Olc('backendHizmeti') + '.' + #13#10;
  if Yarim and (Olc('oncekiSurum') <> Olc('paketSurum')) then
    Result := Result + '- Yarım kalan kurulum ' + Olc('oncekiSurum') + ' paketiyle başlamış; aynı paketle sürdürün ya da önce kaldırın (veri korunur).' + #13#10;
  // Kaldırılıp ESKİ kitle yeniden kurulum: eski kod yeni şemalı veritabanına inmez (OnKosul da aynı kuralla durur).
  if Olc('eskiPaket') = 'eski' then
    Result := Result + '- Bu klasörde daha YENİ bir sürüm kurulu: ' + Olc('kuruluSurum') + ' (' + Olc('kuruluKaynak') + '); bu paket ' + Olc('paketSurum') +
      '. Eski paket kurulmaz - veritabanı yeni sürümün şemasında. ' + Olc('kuruluSurum') + ' ya da daha yeni bir kurulum paketi kullanın. Hiçbir şey değiştirilmedi.' + #13#10
  else if Olc('eskiPaket') <> '' then
    Result := Result + '- Paket sürümü (' + Olc('paketSurum') + ') kurulu sürümle (' + Olc('kuruluSurum') + ') karşılaştırılamadı; hiçbir şey değiştirilmedi.' + #13#10;
end;

function OlcumOzeti: String;
begin
  Result :=
    'Paket          : ' + Olc('paketSurum') + '  (kanal: ' + Olc('paketKanal') + ')' + #13#10 +
    'Kip            : ' + KipMetni + #13#10 +
    'Kök            : ' + Olc('kok') + #13#10 +
    'Hizmetler      : ' + Olc('backendHizmeti') + ' · ' + Olc('guncelleyiciHizmeti') + ' · ' + Olc('pgHizmeti') + #13#10 +
    'PostgreSQL     : ' + Olc('pgSurum') + '  (port önerisi ' + Olc('pgPort') + ' - ' + Olc('pgPortNeden') + ')' + #13#10 +
    'API portu      : ' + Olc('apiPort');
  if Olc('apiMesgul') = '1' then Result := Result + '  MEŞGUL - öneri: ' + Olc('apiOneri');
  Result := Result + #13#10 +
    'Windows / RAM  : ' + Olc('windows') + ' · ' + Olc('ramMB') + ' MB' + #13#10 +
    'Sürücüler      : ' + Olc('suruculer') + '  (sürücü|boş GB)' + #13#10;
  if Olc('paketProva') = '1' then Result := Result + #13#10 + 'UYARI: bu bir PROVA paketidir - fabrikaya kurulmaz.' + #13#10;
end;

// -----------------------------------------------------------------------------
// [Setup] kod sabitleri
// -----------------------------------------------------------------------------
function UygulamaKimligi(P: String): String;
begin
  Result := 'TeksERP-Sunucu' + Sonek;
end;

function VarsayilanKok(P: String): String;
begin
  if Olc('cevapKok') <> '' then Result := Olc('cevapKok') else Result := 'C:\TeksERP' + Sonek;
end;

function KaldirmaAdi(P: String): String;
begin
  if Sonek = '' then Result := 'TeksERP Sunucu' else Result := 'TeksERP Sunucu (' + Copy(Sonek, 2, Length(Sonek)) + ')';
end;

// -----------------------------------------------------------------------------
// Boru öz-sınaması (yalnız /DBORU_SINAMASI derlemesi; CI). Kurulum YAPMAZ.
// -----------------------------------------------------------------------------
#ifdef BORU_SINAMASI
function BoruSinamasi(const Rapor: String): Boolean;
var Betik: String; Cikti: AnsiString; Kod: Integer; Sonuc, Hatasi: String;
begin
  Betik := ExpandConstant('{tmp}\boru-sinamasi.ps1');
  SaveStringToFile(Betik,
    '$ham = [Console]::In.ReadToEnd()' + #13#10 +
    '$j = $ham | ConvertFrom-Json' + #13#10 +
    'Write-Output ("SIR:x64=" + [Environment]::Is64BitProcess)' + #13#10 +
    'Write-Output ("SIR:uzunluk=" + $j.parola.Length)' + #13#10 +
    'Write-Output ("SIR:ilk=" + [int][char]$j.parola[0])' + #13#10 +
    'Write-Output ("SIR:son=" + [int][char]$j.parola[$j.parola.Length - 1])' + #13#10 +
    '1..4000 | ForEach-Object { Write-Output ("satir " + $_ + " " + ("x" * 40)) }' + #13#10 +
    '[Console]::Error.WriteLine("SIR:stderr=evet")' + #13#10 +
    'Write-Output "SIR:son-satir=tamam"' + #13#10 +
    'exit 7' + #13#10, False);
  // Parola: Türkçe harf + tırnak + ters bölü (JSON kaçışı ve kod sayfası ölçülür); 4000 satır > 64 KB boru tamponu.
  Hatasi := BoruIleKos(BoruPowerShellYolu, PS_ARGS + ArgYol(Betik),
    '{"parola":' + JsonMetin('Ğüşİöç"\x') + '}', 120, Cikti, Kod);
  Sonuc := 'BORU_HATA=' + Hatasi + #13#10 + 'KOD=' + IntToStr(Kod) + #13#10 + 'CIKTI_BAYT=' + IntToStr(Length(Cikti)) + #13#10 +
    'X64=' + SatirDegeri(Cikti, 'SIR:x64=') + #13#10 + 'UZUNLUK=' + SatirDegeri(Cikti, 'SIR:uzunluk=') + #13#10 +
    'ILK=' + SatirDegeri(Cikti, 'SIR:ilk=') + #13#10 + 'SON=' + SatirDegeri(Cikti, 'SIR:son=') + #13#10 +
    'STDERR=' + SatirDegeri(Cikti, 'SIR:stderr=') + #13#10 + 'SON_SATIR=' + SatirDegeri(Cikti, 'SIR:son-satir=') + #13#10;
  if (Hatasi = '') and (Kod = 7) and (SatirDegeri(Cikti, 'SIR:x64=') = 'True') and (SatirDegeri(Cikti, 'SIR:uzunluk=') = '9')
    and (SatirDegeri(Cikti, 'SIR:ilk=') = '286') and (SatirDegeri(Cikti, 'SIR:son=') = '120')
    and (SatirDegeri(Cikti, 'SIR:stderr=') = 'evet') and (SatirDegeri(Cikti, 'SIR:son-satir=') = 'tamam') and (Length(Cikti) > 65536) then
    Sonuc := Sonuc + 'BORU=TAMAM' + #13#10
  else
    Sonuc := Sonuc + 'BORU=HATA' + #13#10;
  // Exec yolu: ön ölçüm (64-bit süreç + INI) kurulum klasörü olmadan da koşar.
  if OnOlcum('C:\TeksERP-sinama') then Sonuc := Sonuc + 'OLCUM=TAMAM x64Surec=' + Olc('x64Surec') + ' paketSayisi=' + Olc('paketSayisi') + #13#10
  else Sonuc := Sonuc + 'OLCUM=HATA' + #13#10;
  SaveStringToFile(Rapor, Sonuc, False);
  Result := False;
end;
#endif

// -----------------------------------------------------------------------------
// Olaylar
// -----------------------------------------------------------------------------
function InitializeSetup: Boolean;
var Engel: String;
begin
  Result := False;
  Sessiz := WizardSilent;
  CevapDosyasi := '';
  if Sessiz then CevapDosyasi := ExpandConstant('{param:CEVAP|}');
  HataAsamasi := 0;
  KurulumHatasi := '';
  MusteriAnahtari := '';
  SaticiUyarisi := '';
  ProvaKabul := False;
  if not GeciciDosyalariAc then Exit;
#ifdef BORU_SINAMASI
  if ExpandConstant('{param:SINAMA|}') <> '' then
  begin
    BoruSinamasi(ExpandConstant('{param:SINAMA|}'));
    Exit;
  end;
#endif
  if Sessiz and (CevapDosyasi = '') then
  begin
    Hata('Sessiz kurulum /CEVAP=<cevap.json> ister (biçim: deploy\kurulum\cevap-semasi.json).');
    Exit;
  end;
  if (CevapDosyasi <> '') and not FileExists(CevapDosyasi) then
  begin
    Hata('Cevap dosyası yok: ' + CevapDosyasi);
    Exit;
  end;
  // Görünür kipte HAFİF ölçüm (sihirbaz hemen açılsın); tam ölçüm kök seçilince. Sessiz kipte karar cevap dosyasında: TAM.
  if not OnOlcumKipli('C:\TeksERP', not Sessiz) then Exit;
  if CevapDosyasi <> '' then
  begin
    if Olc('cevapGecerli') <> '1' then
    begin
      Hata('Cevap dosyası geçersiz (' + Olc('cevapHataSayisi') + ' hata): ' + Olc('cevapHata1'));
      Exit;
    end;
  end;
  Engel := OlcumEngelleri;
  if Engel <> '' then
  begin
    Hata('Kurulum başlatılamıyor:' + #13#10 + Engel);
    Exit;
  end;
  Result := True;
end;

procedure InitializeWizard;
begin
  OlcumSayfasi := CreateOutputMsgMemoPage(wpSelectDir, 'Ön ölçüm', 'Bu bilgisayar ve paket ölçüldü',
    'Aşağıdaki değerler kuruluma esas alınır. Engel varsa kurulum ilerlemez.', '');
  VeriSayfasi := CreateInputDirPage(OlcumSayfasi.ID, 'Veritabanı verisi', 'PostgreSQL veri dizini', VERI_ACIKLAMASI, False, '');
  VeriSayfasi.Add('Veri dizini (boşluksuz):');
  PortSayfasi := CreateInputQueryPage(VeriSayfasi.ID, 'Portlar', 'Uygulama ve veritabanı portları',
    'API portu panel ve tabletlerin bağlandığı porttur (varsayılan 4000; meşgulse kurulum durur). PostgreSQL yalnız bu bilgisayardan (127.0.0.1) dinler.');
  PortSayfasi.Add('API portu:', False);
  PortSayfasi.Add('PostgreSQL portu:', False);
  AgSayfasi := CreateInputOptionPage(PortSayfasi.ID, 'Ağ ve güvenlik duvarı', 'API portuna kimler erişebilir?',
    'API portu yalnız yerel alt ağa (LocalSubnet) açılır; Genel (Public) ağ profiline açılmaz. PostgreSQL için gelen kural AÇILMAZ.',
    False, False);
  AgSayfasi.Add('Tailscale ağından da erişilsin (100.64.0.0/10)');
  AgSayfasi.Add('Etki alanı (Domain) ağ profilinde açık');
  AgSayfasi.Add('Özel (Private) ağ profilinde açık');
  AgSayfasi.Add('Yerel ağda otomatik bulma (mDNS, UDP 5353)');
  AgSayfasi.Values[0] := False;
  AgSayfasi.Values[1] := True;
  AgSayfasi.Values[2] := True;
  AgSayfasi.Values[3] := True;
  SaticiSayfasi := CreateInputQueryPage(AgSayfasi.ID, 'Satıcı hesabı', 'Destek (süperadmin) hesabı',
    'Parola ve PIN dosyaya, günlüğe, komut satırına yazılmaz; kuruluma kayıt dışı bir boruyla aktarılır. Boş bırakırsanız hesap kurulum sonunda konsoldan kurulur.');
  SaticiSayfasi.Add('Kullanıcı adı (3-50; harf, rakam . _ -):', False);
  SaticiSayfasi.Add('Parola (en az 10 karakter):', True);
  SaticiSayfasi.Add('Parola (tekrar):', True);
  SaticiSayfasi.Add('PIN (6 hane):', True);
  SaticiSayfasi.Add('PIN (tekrar):', True);
  YedekSecimSayfasi := CreateInputOptionPage(SaticiSayfasi.ID, 'Yedekleme', 'Gece yedeği şifrelensin mi?',
    'Şifreli yedeği yalnız müşteri anahtarı (ve isteğe bağlı yerel parola) açar. Müşteri anahtarının ÖZEL yarısı sunucuda BIRAKILMAZ.',
    True, False);
  YedekSecimSayfasi.Add('Şifrele - müşteri anahtarı USB/dosyaya yazılsın (önerilen)');
  YedekSecimSayfasi.Add('Şifrele - müşteri anahtarı kurulum sonunda BİR KEZ ekranda gösterilsin');
  YedekSecimSayfasi.Add('Şifreleme (önerilmez)');
  YedekSecimSayfasi.SelectedValueIndex := 0;
  YedekSayfasi := CreateInputQueryPage(YedekSecimSayfasi.ID, 'Yedekleme', 'Yedek ayrıntıları',
    'Yerel yedek parolası panelden geri yüklemeyi açar (10-128 ASCII karakter; Türkçe harf yok - başka klavyede yazılacak). Boş bırakılabilir.');
  YedekSayfasi.Add('Müşteri anahtarı dosyası (USB; örn. E:\musteri-yedek-anahtari.txt):', False);
  YedekSayfasi.Add('Yerel yedek parolası (isteğe bağlı):', True);
  YedekSayfasi.Add('Yerel yedek parolası (tekrar):', True);
  YedekSayfasi.Add('Gece yedeği saati (SS:DD):', False);
  YedekSayfasi.Add('İkinci yedek hedefi (isteğe bağlı; örn. E:\Yedek):', False);
  YedekSayfasi.Values[3] := '03:00';
  GelismisSayfasi := CreateInputQueryPage(YedekSayfasi.ID, 'Gelişmiş', 'Bağlantı ayarları',
    'Varsayılanlar çoğu kurulum için doğrudur. Güncelleyici yalnız güncelleme sunucusuna (ve verilirse vekile) çıkar.');
  GelismisSayfasi.Add('Güncelleme sunucusu (https://):', False);
  GelismisSayfasi.Add('HTTP vekili (isteğe bağlı; http://ad:port):', False);
  GelismisSayfasi.Add('Lisans sunucusu (boş = paketin kanalı; https://):', False);
  GelismisSayfasi.Values[0] := VARSAYILAN_GUNCELLEME;
  ProfilSayfasi := CreateInputOptionPage(GelismisSayfasi.ID, 'Modül profili', 'Kurulum profili (TEKSERP_PROFIL)',
    'Profil ilk açılışta modül bayraklarını belirler.', True, False);
  ProfilSayfasi.Add('Paketin varsayılanı');
  ProfilSayfasi.Add('basit');
  ProfilSayfasi.Add('standart');
  ProfilSayfasi.Add('perde');
  ProfilSayfasi.Add('perde-dokuma');
  ProfilSayfasi.Add('dokuma');
  ProfilSayfasi.Add('tam');
  ProfilSayfasi.SelectedValueIndex := 0;
  SonucSayfasi := CreateOutputMsgMemoPage(wpInfoAfter, 'Kurulum sonucu', 'TeksERP sunucusu', '', '');
  SonucSayfasi.RichEditViewer.Height := SonucSayfasi.SurfaceHeight - ScaleY(32);
  AnahtarOnay := TNewCheckBox.Create(SonucSayfasi);
  AnahtarOnay.Parent := SonucSayfasi.Surface;
  AnahtarOnay.Top := SonucSayfasi.RichEditViewer.Top + SonucSayfasi.RichEditViewer.Height + ScaleY(8);
  AnahtarOnay.Width := SonucSayfasi.SurfaceWidth;
  AnahtarOnay.Caption := 'Müşteri yedek anahtarını kâğıda yazdım / güvenli yere kaydettim (bir daha gösterilmez).';
  AnahtarOnay.Visible := False;
  SihirbazHazir := True;
end;

function ProfilDegeri: String;
begin
  case ProfilSayfasi.SelectedValueIndex of
    1: Result := 'basit';
    2: Result := 'standart';
    3: Result := 'perde';
    4: Result := 'perde-dokuma';
    5: Result := 'dokuma';
    6: Result := 'tam';
  else
    Result := '';
  end;
end;

procedure SayfalariOlcumleDoldur;
begin
  OlcumSayfasi.RichEditViewer.Lines.Text := OlcumOzeti;
  if Olc('veriOneri') <> '' then VeriSayfasi.Values[0] := Olc('veriOneri');
  if Olc('apiMesgul') = '1' then PortSayfasi.Values[0] := Olc('apiOneri') else PortSayfasi.Values[0] := Olc('apiPort');
  PortSayfasi.Values[1] := Olc('pgPort');
  // Onarım/devam: veri dizini ve portlar KAYITTAN gelir, değiştirilmez ("Göz at" da kilitli; metin onarımı anlatır).
  VeriSayfasi.Edits[0].Enabled := not (Onarim or Yarim);
  VeriSayfasi.Buttons[0].Enabled := not (Onarim or Yarim);
  if Onarim then VeriSayfasi.SubCaptionLabel.Caption := 'ONARIM: veritabanı kayıttaki dizinde kalır ve korunur; bu dizin değiştirilemez.'
  else if Yarim then VeriSayfasi.SubCaptionLabel.Caption := 'DEVAM: veritabanı yarım kalan kurulumun dizininde kalır; bu dizin değiştirilemez.'
  else VeriSayfasi.SubCaptionLabel.Caption := VERI_ACIKLAMASI;
  PortSayfasi.Edits[0].Enabled := not (Onarim or Yarim);
  PortSayfasi.Edits[1].Enabled := not (Onarim or Yarim);
  // Gelişmiş ayarlar kayıttan (güncelleyicinin ayar.json'u + .env'deki lisans sunucusu). Onarım .env'i yeniden
  // yazmaz: lisans sunucusu orada korunur, alan kilitli. Yeni köke dönülürse varsayılanlar geri gelir.
  // Lisans sunucusu yoksa paketin kanalından (paketLisans; boş = kanal), kullanıcının girdiği değer ezilmez.
  if Onarim or Yarim then
  begin
    if Olc('oncekiGuncellemeSunucusu') <> '' then GelismisSayfasi.Values[0] := Olc('oncekiGuncellemeSunucusu');
    if Olc('oncekiVekil') <> '' then GelismisSayfasi.Values[1] := Olc('oncekiVekil');
    if Olc('oncekiLisansOkundu') = '1' then GelismisSayfasi.Values[2] := Olc('oncekiLisansSunucusu')
    else if GelismisSayfasi.Values[2] = '' then GelismisSayfasi.Values[2] := Olc('paketLisans');
    GelismisSayfasi.Edits[2].Enabled := Olc('oncekiLisansOkundu') <> '1';
    GelismisKayittan := True;
  end
  else if GelismisKayittan then
  begin
    GelismisSayfasi.Values[0] := VARSAYILAN_GUNCELLEME;
    GelismisSayfasi.Values[1] := '';
    GelismisSayfasi.Values[2] := Olc('paketLisans');
    GelismisSayfasi.Edits[2].Enabled := True;
    GelismisKayittan := False;
  end
  else if GelismisSayfasi.Values[2] = '' then GelismisSayfasi.Values[2] := Olc('paketLisans');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Engel, S: String; Api, Pg: Integer;
begin
  Result := True;
  // Sessiz kip: Inno her sayfa için yine çağırır, ama karar ve doğrulama cevap dosyasındadır (InitializeSetup
  // ölçtü, OnKosul yeniden ölçer). Buradaki MsgBox /SUPPRESSMSGBOXES'le BASTIRILMAZ - sessiz kurulum soruda
  // sonsuza dek beklerdi (thinkpad-1 D8: prova sorusu). Sayfalar yine ölçümle DOLDURULUR: veri dizini sayfası
  // boş kalırsa Inno'nun kendi yol denetimi sessiz kurulumu durdurur.
  if Sessiz then
  begin
    if CurPageID = wpSelectDir then SayfalariOlcumleDoldur;
    Log('sessiz kip: sayfa ' + IntToStr(CurPageID) + ' sorusuz gecildi (karar cevap dosyasinda)');
    Exit;
  end;
  if CurPageID = wpSelectDir then
  begin
    if not YolGecerli(Kok) then
    begin
      Result := Hata('Kök klasör yalnız ASCII harf, rakam ve noktalama içerebilir; boşluk ve ".." olmaz (örn. C:\TeksERP).');
      Exit;
    end;
    if not OnOlcum(Kok) then begin Result := False; Exit; end;
    SayfalariOlcumleDoldur;
  end
  else if CurPageID = OlcumSayfasi.ID then
  begin
    Engel := OlcumEngelleri;
    if Engel <> '' then begin Result := Hata('Kurulum ilerleyemez:' + #13#10 + Engel); Exit; end;
    if Olc('paketProva') = '1' then
    begin
      ProvaKabul := MsgBox('Bu bir PROVA paketidir ve fabrikaya kurulmaz. Yalnız test makinesine kurulsun mu?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
      Result := ProvaKabul;
    end;
  end
  else if CurPageID = VeriSayfasi.ID then
  begin
    S := RemoveBackslashUnlessRoot(VeriSayfasi.Values[0]);
    if (Onarim or Yarim) and (Olc('oncekiVeri') <> '') and (Uppercase(S) <> Uppercase(Olc('oncekiVeri'))) then
      Result := Hata('Onarım/devam: veri dizini kayıttaki dizindir (' + Olc('oncekiVeri') + '); değiştirilemez.')
    else if not YolGecerli(S) then Result := Hata('Veri dizini yalnız ASCII harf, rakam ve noktalama içerebilir; boşluk ve ".." olmaz.')
    else if Uppercase(S) = Uppercase(Kok) then Result := Hata('Veri dizini kök klasörün kendisi olamaz (örn. ' + Kok + '\pgveri ya da D:\TeksERP\pgveri).');
  end
  else if CurPageID = PortSayfasi.ID then
  begin
    Api := PortDegeri(PortSayfasi.Values[0]);
    Pg := PortDegeri(PortSayfasi.Values[1]);
    if (Api < 0) or (Pg < 0) then Result := Hata('Portlar 1025-65535 arasında bir sayı olmalı.')
    else if Api = Pg then Result := Hata('API portu ile PostgreSQL portu aynı olamaz.');
  end
  else if CurPageID = AgSayfasi.ID then
  begin
    if not AgSayfasi.Values[1] and not AgSayfasi.Values[2] then Result := Hata('En az bir ağ profili (Etki alanı ya da Özel) seçilmeli.');
  end
  else if CurPageID = SaticiSayfasi.ID then
  begin
    if SaticiSayfasi.Values[0] <> '' then
    begin
      if not KullaniciAdiGecerli(SaticiSayfasi.Values[0]) then Result := Hata('Kullanıcı adı 3-50 karakter; yalnız harf, rakam, nokta, alt çizgi, tire.')
      else if Length(SaticiSayfasi.Values[1]) < 10 then Result := Hata('Parola en az 10 karakter olmalı.')
      else if Utf8Bayt(SaticiSayfasi.Values[1]) > 72 then Result := Hata('Parola 72 baytı aşıyor (Türkçe harfler 2 bayt sayılır).')
      else if SaticiSayfasi.Values[1] <> SaticiSayfasi.Values[2] then Result := Hata('Parolalar aynı değil.')
      else if (Length(SaticiSayfasi.Values[3]) <> 6) or not RakamMi(SaticiSayfasi.Values[3]) then Result := Hata('PIN TAM 6 haneli rakam olmalı.')
      else if SaticiSayfasi.Values[3] <> SaticiSayfasi.Values[4] then Result := Hata('PIN''ler aynı değil.');
    end
    else if (SaticiSayfasi.Values[1] <> '') or (SaticiSayfasi.Values[3] <> '') then
      Result := Hata('Parola/PIN girildi ama kullanıcı adı boş.')
    else
      Result := MsgBox('Satıcı hesabı şimdi kurulmayacak; kurulum sonunda konsol komutu gösterilir. Devam edilsin mi?', mbConfirmation, MB_YESNO) = IDYES;
  end
  else if CurPageID = YedekSayfasi.ID then
  begin
    if YedekSecimSayfasi.SelectedValueIndex = 0 then
    begin
      S := YedekSayfasi.Values[0];
      if not DosyaYoluGecerli(S) then begin Result := Hata('Müşteri anahtarı dosyası X:\... biçiminde tam bir yol olmalı.'); Exit; end;
      if FileExists(S) then begin Result := Hata('Bu dosya zaten var (üzerine yazılmaz): ' + S); Exit; end;
      if not DirExists(ExtractFileDir(S)) then begin Result := Hata('Klasör yok: ' + ExtractFileDir(S)); Exit; end;
      if WinGetDriveType(Copy(S, 1, 3)) <> C_SURUCU_CIKARILABILIR then
        if MsgBox(Copy(S, 1, 2) + ' çıkarılabilir bir sürücü değil. Özel anahtar sunucuda BIRAKILMAMALI; yine de buraya yazılsın mı?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then
        begin Result := False; Exit; end;
    end;
    if YedekSecimSayfasi.SelectedValueIndex < 2 then
    begin
      if (YedekSayfasi.Values[1] <> '') and not AsciiParola(YedekSayfasi.Values[1]) then begin Result := Hata('Yerel yedek parolası 10-128 ASCII karakter olmalı (Türkçe harf ve boşluk yok).'); Exit; end;
      if YedekSayfasi.Values[1] <> YedekSayfasi.Values[2] then begin Result := Hata('Yerel yedek parolaları aynı değil.'); Exit; end;
    end;
    if not SaatGecerli(YedekSayfasi.Values[3]) then begin Result := Hata('Yedek saati SS:DD biçiminde olmalı (örn. 03:00).'); Exit; end;
    if (YedekSayfasi.Values[4] <> '') and not YolGecerli(RemoveBackslashUnlessRoot(YedekSayfasi.Values[4])) then Result := Hata('İkinci yedek hedefi boşluksuz ASCII bir yol olmalı.');
  end
  else if CurPageID = GelismisSayfasi.ID then
  begin
    if not AdresGecerli(GelismisSayfasi.Values[0], 'https://', False) then Result := Hata('Güncelleme sunucusu https://ad[:port] biçiminde olmalı.')
    else if (GelismisSayfasi.Values[1] <> '') and not AdresGecerli(GelismisSayfasi.Values[1], 'http://', True) then Result := Hata('Vekil http://ad:port biçiminde olmalı.')
    else if (GelismisSayfasi.Values[2] <> '') and not AdresGecerli(GelismisSayfasi.Values[2], 'https://', False) then Result := Hata('Lisans sunucusu https://ad[:port] biçiminde olmalı.');
  end
  else if CurPageID = SonucSayfasi.ID then
  begin
    if AnahtarOnay.Visible and not AnahtarOnay.Checked then Result := Hata('Müşteri yedek anahtarını kaydettiğinizi onaylayın; bu anahtar bir daha gösterilmez.');
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // Onarım/devam: veri dizini ve portlar kayıtta - sayfalar gösterilir ama alanlar kilitli (SayfalariOlcumleDoldur).
  if (PageID = YedekSayfasi.ID) and (YedekSecimSayfasi.SelectedValueIndex = 2) then
  begin
    YedekSayfasi.Values[1] := '';
    YedekSayfasi.Values[2] := '';
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = YedekSayfasi.ID then
  begin
    YedekSayfasi.Edits[0].Enabled := YedekSecimSayfasi.SelectedValueIndex = 0;
    YedekSayfasi.Edits[1].Enabled := YedekSecimSayfasi.SelectedValueIndex < 2;
    YedekSayfasi.Edits[2].Enabled := YedekSecimSayfasi.SelectedValueIndex < 2;
  end
  else if CurPageID = SonucSayfasi.ID then
  begin
    SonucSayfasi.RichEditViewer.Lines.Text := SonucMetni;
    AnahtarOnay.Visible := MusteriAnahtari <> '';
    if MusteriAnahtari <> '' then SonucSayfasi.RichEditViewer.Font.Name := 'Consolas';
  end;
end;

// Özet: etkili lisans sunucusu + paketin kanalından farklıysa UYARI (engel değil). Karar kurulum.ps1'de
// (kurulum-ortak.ps1 LisansSunucusuKarari; sonuç sayfası onun uyarısını gösterir): boş = kanal, onarımda kayıttaki .env.
function LisansOzeti(const NewLine: String): String;
var Kanal, Etkili, Ad, Duzelt: String;
begin
  Kanal := Olc('paketLisans');
  Etkili := GelismisSayfasi.Values[2];
  Ad := 'girilen';
  Duzelt := 'yanlışsa Geri ile düzeltin (boş = kanal)';
  if (Onarim or Yarim) and (Olc('oncekiLisansOkundu') = '1') then
  begin
    Ad := 'kayıttaki .env';
    Duzelt := 'onarım .env dosyasını değiştirmez; yapilandirma\.env LICENSE_SERVER_URL satırını elle düzeltin';
    if Etkili = '' then Etkili := Olc('paketLisansVarsayilan');
  end
  else if Etkili = '' then Etkili := Kanal;
  if Etkili = '' then Result := 'Lisans sunucusu: derleme varsayılanı' + NewLine
  else Result := 'Lisans sunucusu: ' + Etkili + NewLine;
  if Kanal = '' then
    Result := Result + 'UYARI: paket lisans sunucusunun kanal değerini taşımıyor (eski ya da kanal dışı paket); kanal kaydıyla karşılaştırılamadı.' + NewLine
  else if Lowercase(Etkili) <> Lowercase(Kanal) then
    Result := Result + 'UYARI: lisans sunucusu paketin kanalından FARKLI - beklenen ' + Kanal + ' (kanal ' + Olc('paketKanal') + '), ' +
      Ad + ' ' + Etkili + '. Kurulum sürer; ' + Duzelt + '.' + NewLine;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var S, Ag: String;
begin
  Ag := 'LocalSubnet';
  if AgSayfasi.Values[0] then Ag := Ag + ' + Tailscale';
  S := 'Kip: ' + KipMetni + NewLine +
    'Kök: ' + Kok + NewLine +
    'Paket: ' + Olc('paketSurum') + ' (kanal ' + Olc('paketKanal') + ')' + NewLine +
    'PostgreSQL: ' + Olc('pgSurum') + ' - veri ' + RemoveBackslashUnlessRoot(VeriSayfasi.Values[0]) + ' - port ' + PortSayfasi.Values[1] + NewLine +
    'API portu: ' + PortSayfasi.Values[0] + ' (' + Ag + ')' + NewLine;
  if SaticiSayfasi.Values[0] <> '' then S := S + 'Satıcı hesabı: ' + SaticiSayfasi.Values[0] + ' (parola ve PIN girildi)' + NewLine
  else S := S + 'Satıcı hesabı: SONRA (konsoldan)' + NewLine;
  case YedekSecimSayfasi.SelectedValueIndex of
    0: S := S + 'Yedek: şifreli - müşteri anahtarı ' + YedekSayfasi.Values[0] + NewLine;
    1: S := S + 'Yedek: şifreli - müşteri anahtarı sonuç sayfasında BİR KEZ' + NewLine;
  else
    S := S + 'Yedek: ŞİFRESİZ' + NewLine;
  end;
  S := S + 'Gece yedeği: ' + YedekSayfasi.Values[3] + NewLine + 'Güncelleme sunucusu: ' + GelismisSayfasi.Values[0] + NewLine;
  if GelismisSayfasi.Values[1] <> '' then S := S + 'HTTP vekili: ' + GelismisSayfasi.Values[1] + NewLine;
  S := S + LisansOzeti(NewLine);
  if ProfilDegeri <> '' then S := S + 'Profil: ' + ProfilDegeri + NewLine;
  Result := S;
end;

// -----------------------------------------------------------------------------
// Cevap dosyası (SIRSIZ - cevap-semasi.json alanları). Sessiz kipte verilen dosya kilitli dizine KOPYALANIR.
// -----------------------------------------------------------------------------
function CevapJson: String;
var Izinli, Profiller, Musteri, Etkili: String; Sifre: Boolean;
begin
  Izinli := '"LocalSubnet"';
  if AgSayfasi.Values[0] then Izinli := Izinli + ', "100.64.0.0/10"';
  Profiller := '';
  if AgSayfasi.Values[1] then Profiller := '"Domain"';
  if AgSayfasi.Values[2] then
  begin
    if Profiller <> '' then Profiller := Profiller + ', ';
    Profiller := Profiller + '"Private"';
  end;
  Sifre := YedekSecimSayfasi.SelectedValueIndex < 2;
  Musteri := '';
  if YedekSecimSayfasi.SelectedValueIndex = 0 then Musteri := YedekSayfasi.Values[0];
  Etkili := '';
  if Sifre then Etkili := Olc('etkiliAnahtar');
  Result := '{' + #13#10 +
    '  "v": 1,' + #13#10 +
    '  "kok": ' + JsonMetin(Kok) + ',' + #13#10 +
    '  "paket": { "backend": ' + JsonYaDaNull(Olc('paketDosya')) + ', "pg": ' + JsonYaDaNull(Olc('pgDosya')) + ', "pgKunye": ' + JsonYaDaNull(Olc('pgKunyeDosya')) + ' },' + #13#10 +
    '  "pg": { "veriDizini": ' + JsonMetin(RemoveBackslashUnlessRoot(VeriSayfasi.Values[0])) + ', "port": ' + IntToStr(PortDegeri(PortSayfasi.Values[1])) + ', "defenderDislamasi": true },' + #13#10 +
    '  "api": { "port": ' + IntToStr(PortDegeri(PortSayfasi.Values[0])) + ', "izinliAdresler": [' + Izinli + '], "agProfilleri": [' + Profiller + '], "mdns": ' + JsonMantik(AgSayfasi.Values[3]) + ' },' + #13#10 +
    '  "guncelleme": { "sunucu": ' + JsonMetin(GelismisSayfasi.Values[0]) + ', "vekil": ' + JsonYaDaNull(GelismisSayfasi.Values[1]) + ' },' + #13#10 +
    '  "lisans": { "saticiAdresi": ' + JsonYaDaNull(GelismisSayfasi.Values[2]) + ' },' + #13#10 +
    '  "profil": ' + JsonYaDaNull(ProfilDegeri) + ',' + #13#10 +
    '  "yedek": { "saat": ' + JsonMetin(YedekSayfasi.Values[3]) + ', "ikinciHedef": ' + JsonYaDaNull(RemoveBackslashUnlessRoot(YedekSayfasi.Values[4])) +
      ', "sifreleme": ' + JsonMantik(Sifre) + ', "musteriAnahtariCikti": ' + JsonYaDaNull(Musteri) + ', "etkiliAcikAnahtar": ' + JsonYaDaNull(Etkili) + ' },' + #13#10 +
    '  "saticiHesabi": { "kullaniciAdi": ' + JsonYaDaNull(SaticiSayfasi.Values[0]) + ' },' + #13#10 +
    '  "provaKabul": ' + JsonMantik(ProvaKabul) + #13#10 +
    '}' + #13#10;
end;

function KurulumCevabi: String;
begin
  Result := Kok + '\kurulum\cevap.json';
end;

// Kilit: sahip Administrators, miras kesik, yalnız SYSTEM + Administrators (iyi bilinen SID'ler - dil bağımsız).
function Kilitle(const Yol: String; Agac: Boolean): Boolean;
var Kod: Integer; Ek: String;
begin
  Ek := '';
  if Agac then Ek := ' /T';
  Result := Exec(ExpandConstant('{sys}\icacls.exe'), ArgYol(Yol) + ' /setowner *S-1-5-32-544' + Ek + ' /Q', '', SW_HIDE, ewWaitUntilTerminated, Kod) and (Kod = 0);
  // Miras kesme + (OI)(CI) izni YALNIZ dizine: /T ile dosyalara uygulanınca (OI)(CI) dosyada geçersiz, miras da
  // kesildiği için dosyanın DACL'i BOŞ kalır (thinkpad-1 D8: yarım kurulumun durum.json'u okunamadı). Alt öğeler
  // mirası bu dizinden alır (/reset).
  if Result then
    Result := Exec(ExpandConstant('{sys}\icacls.exe'), ArgYol(Yol) + ' /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q', '', SW_HIDE, ewWaitUntilTerminated, Kod) and (Kod = 0);
  if Result and Agac then
    Result := Exec(ExpandConstant('{sys}\icacls.exe'), ArgYol(Yol + '\*') + ' /reset /T /C /Q', '', SW_HIDE, ewWaitUntilTerminated, Kod) and (Kod = 0);
  Log('kilit ' + Yol + ' -> ' + IntToStr(Kod));
end;

function AsamaKos(const Betik, Asama, Ek: String; var Ini: String): Integer;
var Kod: Integer;
begin
  Ini := ExpandConstant('{tmp}\sonuc-' + Asama + '.ini');
  DeleteFile(Ini);
  Log('asama ' + Asama + ' basliyor');
  if not Exec(PowerShellYolu, PS_ARGS + ArgYol(Betik) + ' -Asama ' + Asama + ' -Cevap ' + ArgYol(KurulumCevabi) +
    ' -Kaynak ' + ArgYol(ExpandConstant('{src}')) + ' -Sonuc ' + ArgYol(Ini) + Ek, '', SW_HIDE, ewWaitUntilTerminated, Kod) then
    Kod := -1;
  Log('asama ' + Asama + ' cikis ' + IntToStr(Kod) + ' tamam=' + SonucOku(Ini, 'tamam'));
  Result := Kod;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Ini: String; Kod: Integer;
begin
  Result := '';
  if Sessiz and (Uppercase(Kok) <> Uppercase(Olc('cevapKok'))) then
  begin
    Result := 'Kurulum klasörü (' + Kok + ') cevap dosyasındaki kök değil (' + Olc('cevapKok') + ').';
    Exit;
  end;
  if Uppercase(Kok) <> Uppercase(OlculenKok) then
    if not OnOlcum(Kok) then begin Result := 'Ön ölçüm yapılamadı.'; Exit; end;
  // Kök: yoksa ya da TeksERP kurulumu değilse sahiplik + kilit (kurulum betikleri YÖNETİCİ koşar; genel yazılabilir
  // dizinde beklemeleri yetki yükseltme olurdu). Onarım/devamda kök izinleri D6 betiklerinindir: yalnız kurulum\ kilitlenir.
  if not DirExists(Kok) then
    if not ForceDirectories(Kok) then begin Result := 'Kök klasör oluşturulamadı: ' + Kok; Exit; end;
  if not Onarim and not Yarim then
    if not Kilitle(Kok, False) then begin Result := 'Kök klasörün izinleri yazılamadı (icacls): ' + Kok; Exit; end;
  if not ForceDirectories(Kok + '\kurulum') or not Kilitle(Kok + '\kurulum', True) then
  begin
    Result := 'kurulum\ klasörü hazırlanamadı: ' + Kok + '\kurulum';
    Exit;
  end;
  if Sessiz then
  begin
    if Uppercase(ExpandFileName(CevapDosyasi)) <> Uppercase(KurulumCevabi) then
      if not FileCopy(CevapDosyasi, KurulumCevabi, False) then begin Result := 'Cevap dosyası kopyalanamadı: ' + KurulumCevabi; Exit; end;
  end
  else if not SaveStringToFile(KurulumCevabi, CevapJson, False) then
  begin
    Result := 'Cevap dosyası yazılamadı: ' + KurulumCevabi;
    Exit;
  end;
  // OnKosul dosyalar kurulmadan ÖNCE ({tmp} kopyasından): engel varsa kuruluma hiç başlanmaz.
  Kod := AsamaKos(TmpKurulum('deploy\kurulum\kurulum.ps1'), 'OnKosul', '', Ini);
  if (Kod <> 0) or (SonucOku(Ini, 'tamam') <> '1') then
  begin
    HataAsamasi := 1;
    Result := 'Ön koşullar sağlanmadı: ' + SonucOku(Ini, 'hata') + #13#10#13#10 + 'Günlük: ' + SonucOku(Ini, 'gunluk');
    if (Kod = 2) then Result := Result + #13#10 + '(cevap dosyası geçersiz)';
  end;
end;

// Sırlar BORUYLA: JSON (ASCII) yalnız çocuk sürecin STDIN'ine yazılır.
function SirlarKos(const Betik: String; var Ini: String): Integer;
var Girdi: AnsiString; Cikti: AnsiString; Hatasi: String; Kod: Integer; Ekran: Boolean;
begin
  Ini := ExpandConstant('{tmp}\sonuc-Sirlar.ini');
  DeleteFile(Ini);
  Ekran := YedekSecimSayfasi.SelectedValueIndex = 1;
  Girdi := '{"saticiParolasi":' + JsonYaDaNull(SaticiSayfasi.Values[1]) + ',"saticiPin":' + JsonYaDaNull(SaticiSayfasi.Values[3]) +
    ',"yedekParolasi":' + JsonYaDaNull(YedekSayfasi.Values[1]) + ',"musteriAnahtariEkrana":' + JsonMantik(Ekran) + '}';
  Hatasi := BoruIleKos(BoruPowerShellYolu, PS_ARGS + ArgYol(Betik) + ' -Asama Sirlar -Cevap ' + ArgYol(KurulumCevabi) + ' -Sonuc ' + ArgYol(Ini), Girdi, 600, Cikti, Kod);
  Girdi := '';
  if Hatasi <> '' then
  begin
    Log('Sirlar asamasi kosturulamadi: ' + Hatasi);
    Result := -1;
    Exit;
  end;
  MusteriAnahtari := SatirDegeri(Cikti, 'SIR:musteriAnahtari=');
  Cikti := '';
  Result := Kod;
end;

function AsamaAdi(I: Integer): String;
begin
  case I of
    2: Result := 'Paket';
    3: Result := 'PostgreSQL';
    4: Result := 'Backend';
    5: Result := 'Hizmetler';
    6: Result := 'Sirlar';
    7: Result := 'Dogrulama';
  else
    Result := 'OnKosul';
  end;
end;

function AsamaMetni(I: Integer): String;
begin
  case I of
    2: Result := 'Paket doğrulanıyor ve açılıyor (imza + her dosya)...';
    3: Result := 'PostgreSQL kuruluyor (doğrulama, veri dizini, hizmet, roller)...';
    4: Result := 'Veritabanı şeması kuruluyor (göçler) ve bakım rolü...';
    5: Result := 'Hizmetler kaydediliyor ve başlatılıyor (sağlık ölçümü)...';
    6: Result := 'Satıcı hesabı ve yedek anahtarları...';
    7: Result := 'Kurulum doğrulanıyor...';
  else
    Result := 'Ön koşullar...';
  end;
end;

procedure SonucMetniKur(const SonIni: String);
var I, N: Integer; S: String;
begin
  if KurulumHatasi = '' then
    S := 'KURULUM TAMAM' + #13#10#13#10 +
      'Sunucu adresi : http://' + GetComputerNameString + ':' + PortSayfasi.Values[0] + #13#10 +
      'Sürüm         : ' + Olc('paketSurum') + #13#10 +
      'Hizmetler     : ' + Olc('backendHizmeti') + ' · ' + Olc('guncelleyiciHizmeti') + ' · ' + Olc('pgHizmeti') + #13#10
  else
    S := 'KURULUM TAMAMLANAMADI - aşama: ' + AsamaAdi(HataAsamasi) + #13#10#13#10 + KurulumHatasi + #13#10#13#10 +
      'Sorunu giderip bu kurulum programını AYNI klasörle yeniden çalıştırın: kaldığı yerden sürer, veri silinmez.' + #13#10;
  if SonIni <> '' then
  begin
    if SonucOku(SonIni, 'gunluk') <> '' then S := S + 'Günlük        : ' + SonucOku(SonIni, 'gunluk') + #13#10;
    N := StrToIntDef(SonucOku(SonIni, 'acikSayisi'), 0);
    if N > 0 then
    begin
      S := S + #13#10 + 'YAPILACAKLAR:' + #13#10;
      for I := 1 to N do S := S + '  - ' + SonucOku(SonIni, 'acik' + IntToStr(I)) + #13#10;
    end;
    N := StrToIntDef(SonucOku(SonIni, 'uyariSayisi'), 0);
    if N > 0 then
    begin
      S := S + #13#10 + 'UYARILAR:' + #13#10;
      for I := 1 to N do S := S + '  - ' + SonucOku(SonIni, 'uyari' + IntToStr(I)) + #13#10;
    end;
  end;
  if SaticiUyarisi <> '' then S := S + #13#10 + SaticiUyarisi + #13#10;
  if MusteriAnahtari <> '' then
    S := S + #13#10 + '================ MÜŞTERİ YEDEK ANAHTARI (ÖZEL) ================' + #13#10 +
      'Şifreli yedekleri bu satır açar. Şimdi kâğıda yazın ya da güvenli bir yere kaydedin;' + #13#10 +
      'sunucuda BIRAKILMADI ve BİR DAHA GÖSTERİLMEZ.' + #13#10#13#10 + MusteriAnahtari + #13#10 +
      '===============================================================' + #13#10;
  SonucMetni := S;
end;

procedure AsamalariKos;
var I, Kod: Integer; Betik, Ini, SonIni, SirIni: String; SirGerek, IptalDurumu: Boolean;
begin
  IptalDurumu := WizardForm.CancelButton.Enabled;
  Betik := ExpandConstant('{app}\kurulum\deploy\kurulum\kurulum.ps1');
  SonIni := '';
  SirIni := '';
  SirGerek := not Sessiz and ((SaticiSayfasi.Values[0] <> '') or (YedekSayfasi.Values[1] <> '') or (YedekSecimSayfasi.SelectedValueIndex = 1));
  WizardForm.CancelButton.Enabled := False;
  WizardForm.ProgressGauge.Style := npbstMarquee;
  for I := 2 to 7 do
  begin
    if (I = 6) and not SirGerek then Continue;
    WizardForm.StatusLabel.Caption := 'TeksERP: ' + AsamaMetni(I);
    WizardForm.FilenameLabel.Caption := '';
    if I = 6 then Kod := SirlarKos(Betik, Ini)
    else Kod := AsamaKos(Betik, AsamaAdi(I), '', Ini);
    if I = 6 then SirIni := Ini;
    if FileExists(Ini) then SonIni := Ini;
    if (Kod <> 0) or (SonucOku(Ini, 'tamam') <> '1') then
    begin
      HataAsamasi := I;
      KurulumHatasi := SonucOku(Ini, 'hata');
      if KurulumHatasi = '' then KurulumHatasi := AsamaAdi(I) + ' aşaması sonuç vermedi (çıkış ' + IntToStr(Kod) + ').';
      Break;
    end;
  end;
  if (SirIni <> '') and (SonucOku(SirIni, 'satici.kod') <> '') and (SonucOku(SirIni, 'satici.kod') <> '0') then
    SaticiUyarisi := 'Satıcı hesabı KURULAMADI [' + SonucOku(SirIni, 'satici.hata') + ']: konsoldan kurun (kurulum.json "acik").';
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.CancelButton.Enabled := IptalDurumu;
  SonucMetniKur(SonIni);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Gunluk: String;
begin
  if CurStep = ssPostInstall then AsamalariKos
  else if CurStep = ssDone then
  begin
    // Kurulumun kendi günlüğü (sırsız) kurulum\gunluk\ altına.
    Gunluk := ExpandConstant('{log}');
    if (Gunluk <> '') and DirExists(Kok + '\kurulum\gunluk') then
      FileCopy(Gunluk, Kok + '\kurulum\gunluk\setup-' + GetDateTimeString('yyyymmdd-hhnnss', #0, #0) + '.log', False);
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := 0;
  if KurulumHatasi <> '' then Result := 10 + HataAsamasi;
end;

procedure DeinitializeSetup;
begin
  MusteriAnahtari := '';
  SaticiUyarisi := '';
  SonucMetni := '';
end;
