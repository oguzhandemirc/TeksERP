# Güncelleyici karşılıklı onarım — saha provası (W1b)

> Plan: `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §4.7 (senaryo tablosu satır 2, 3, 4, 5, 7, 8) · kodlar `docs/design/GUNCELLEYICI.md` §12.
> Bu belge **kullanıcının kendi eliyle** koşacağı provadır; CI'da koşan dumanlar (`Teks-Erp/native/scripts/duman-windows.ps1` §7, `duman-linux-onarim.sh`) aynı davranışı gerçek SCM/systemd'de ölçer — burada ölçülen, CI'ın yapamadığı şeydir: gerçek güç kesintisi, gerçek açılış, gerçek Defender, gerçek sunucu.
> **Dokunulmaz:** adnansahin (SAHINSRV) ve 91.217.119.138. Prova yalnız thinkpad ve deneme bulut sunucusunda koşar.

Her adımın sonunda **kanıt satırı** yazılır (tarih-saat · adım · gözlenen · komut çıktısının ilgili satırı). Satırlar §9.5 kanıt dosyasının `onarim` bölümüne girer.

## Panelde nereye bakılır

Yönetim paneli → **Sistem** → **Sunucu Güncellemeleri** karosu → "Güncelleyici durumu" bölümü. Beklenen satırlar:

| Kod | Panelde görünen metin | Tür |
|---|---|---|
| `ONARILDI` | "Güncelleme programı kendini onardı — bozulan ya da silinen dosyası doğrulanmış kopyadan geri kondu" | bilgi (24 saat görünür) |
| `ONARIM_TAVANI` | "Güncelleme programı tekrar tekrar bozuldu — otomatik onarım durdu (24 saatte 3 onarım), müdahale gerekiyor" | arıza |
| `ONARIM_KAYNAK_YOK` | "Güncelleme programının dosyası eksik ya da bozuk ve onarmak için doğrulanmış kopya yok — yeniden kurulum gerekiyor" | arıza |
| `GUNCELLEYICI_KAPALI` | "Güncelleme programı hizmeti kapatılmış ya da kaldırılmış — yeniden açılmadıkça güncelleme yapılmaz" | arıza |
| `DISK_DOLU` | "Disk dolu" | arıza |

⚠️ Arıza kodlarında güncelleyici `durum.json`a `HATA` yazar. Panel bunu `DURDU` olarak okur ve bugün bölümün başına "Son güncelleme geri alınamadı — müdahale gerekiyor" kutusunu da koyar. Bu metin onarım arızasına özgü değildir; açık iştir. Kodun kendi satırı yukarıdaki tablodaki gibidir.

Arıza kodlarında panel onay düğmesi SUNMAZ (durmuş güncelleyiciye onay gönderilmez). Kalp atışı eşiği aşılınca ayrıca "Güncelleyici yanıt vermiyor" uyarısı çıkar. Kodlar `gecmis.jsonl`a ve satıcı raporuna kod olarak girmez; satıcı filo görünümünde `guncelleyici.durum` `DURDU`/`YOK` görünür.

---

## A. thinkpad (Windows)

### A0. Hazırlık (yönetici PowerShell)

Başlat menüsü → "PowerShell" → sağ tık → **Yönetici olarak çalıştır**. Aşağıdaki değişkenler her adımda kullanılır (ikinci kanal kuruluysa hizmet adı ve veri dizini ona göre):

```powershell
$kok  = "C:\TeksERP"
$veri = "$env:ProgramData\TeksERP"
$hz   = "TeksERP-Guncelleyici"
$lkg  = "$kok\guncelleyici\tekserp-guncelleyici.lkg.exe"
$durum = "$veri\guncelleme\durum\durum.json"
$gorev = "$hz-Onarim"
function Ikili { $p = (Get-CimInstance Win32_Service -Filter "Name='$hz'").PathName; if ($p -match '^"([^"]+)"') { $Matches[1] } else { ($p -split ' ')[0] } }
function Durum { Get-Content $durum -Raw | ConvertFrom-Json | Select-Object durum, hataKodu, mesaj, @{n='bilgi';e={$_.bilgi.kod}}, sonCanlilik }
function Onarimlar { if (Test-Path "$veri\guncelleme\is\onarim.json") { (Get-Content "$veri\guncelleme\is\onarim.json" -Raw | ConvertFrom-Json).onarimlar } }
```

Ön koşul ölçümü — hepsi tutmalı, tutmuyorsa prova yapılmaz:

```powershell
sc.exe qc $hz                                    # BINARY_PATH_NAME, START_TYPE AUTO_START (DELAYED)
& (Ikili) kunye                                  # "onarim": 1 satırı (W1b'li ikili)
Test-Path $lkg                                   # True (.lkg ilk sağlıklı turda doğar)
Get-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev | Select-Object State, @{n='Exe';e={$_.Actions[0].Execute}}, @{n='Hesap';e={$_.Principal.UserId}}
                                                  # Ready · Exe ...lkg.exe · SYSTEM
Durum                                            # durum BEKLIYOR/... · hataKodu boş
```

Bir kez **yedek**: `Copy-Item "$kok\guncelleyici" "$env:TEMP\guncelleyici-yedek" -Recurse` (geri dönüşlerin son çaresi).

### A1. İkili silindi (Defender karantinası kalıbı) — senaryo 3

1. `Stop-Service $hz; $exe = Ikili; Move-Item $exe "$env:TEMP\karantina-$(Get-Date -f HHmmss).exe"`
2. Bekle: görev **en geç 15 dakikada** kendiliğinden koşar. Beklemeden ölçmek için: `Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev`
3. Beklenen:
   - `Get-Service $hz` → `Running`;
   - `Ikili` → `...\guncelleyici\s\<sürüm>\tekserp-guncelleyici.exe` (sürümlü yol; `.lkg` hizmete ASLA verilmez);
   - `Onarimlar` → bir satır, `neden` `EKSIK`;
   - `Durum` → `bilgi` `ONARILDI`;
   - panelde `ONARILDI` bilgi satırı.
4. Kanıt: `(Get-ScheduledTaskInfo -TaskPath "\TeksERP\" -TaskName $gorev).LastTaskResult` → `0`; Olay Görüntüleyicisi → Windows Günlükleri → Uygulama → kaynak `TeksERP-Guncelleyici`, "ONARILDI" uyarısı.
5. Geri dönüş: gerek yok, onarım kendisi geri dönüştür. `$env:TEMP\karantina-*.exe` silinir.

**Gerçek Defender varyantı (bir kez):** Windows Güvenliği → Virüs ve tehdit koruması → Koruma geçmişi. EICAR test dizisini ikiliye eklemek ikiliyi bozar ve Defender'ı tetikler; bu, A2'nin bozuk bayt adımıyla aynı yoldan onarılır. Defender'ın karantinaya aldığı dosyayı geri yükleme.

### A2. İkili bozuldu (son 4 KB kesik) — senaryo 4

1. `Stop-Service $hz; $exe = Ikili; $f = [IO.File]::Open($exe, "Open", "ReadWrite"); $f.SetLength($f.Length - 4096); $f.Close()`
2. `Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev` (ya da 15 dk bekle).
3. Beklenen: hizmet `Running`; `Onarimlar` son satırı `neden` `BOZUK`; bozuk dosya HİÇ çalıştırılmadı (Olay günlüğünde o yoldan başlatma yok); panelde `ONARILDI`.
4. Geri dönüş: gerek yok.

### A3. Hizmet devre dışı bırakıldı — senaryo 5 (bilinçli: ONARILMAZ)

1. `Stop-Service $hz; sc.exe config $hz start= disabled`
2. `Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev`, ardından 1 dk bekle.
3. Beklenen:
   - hizmet `Stopped` ve `StartType` `Disabled` kalır (yöneticinin kararı geri alınmaz);
   - `Durum` → `hataKodu` `GUNCELLEYICI_KAPALI`;
   - `LastTaskResult` → `14`;
   - panelde `GUNCELLEYICI_KAPALI`, birkaç dakika sonra "Güncelleyici yanıt vermiyor";
   - satıcı portalında bu kurulumun güncelleyici durumu bir yoklama turunda `DURDU`/`YOK` olur.
4. Geri dönüş: `sc.exe config $hz start= delayed-auto; Start-Service $hz`. Panel uyarısı ilk sağlıklı turda kalkar.

### A4. Disk dolu iken onarım — senaryo 7

⚠️ C: sürücüsünü doldurur. Diğer programları kapatın ve adım bitince dolgu dosyasını HEMEN silin.

1. `Stop-Service $hz; $exe = Ikili; Remove-Item $exe`
2. Dolgu: `$bos = (Get-PSDrive C).Free; fsutil file createnew C:\onarim-dolgu.bin ($bos - 512KB)`
3. `Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev`, 1 dk bekle.
4. Beklenen:
   - `Durum` → `hataKodu` `DISK_DOLU`;
   - `LastTaskResult` → `13`;
   - `.lkg` ve öteki kaynaklar YERİNDE (`Test-Path $lkg` → True);
   - `guncelleyici\s\` altında yarım `.tmp` YOK (`Get-ChildItem "$kok\guncelleyici" -Recurse -Filter *.tmp` boş).
5. Geri dönüş: `Remove-Item C:\onarim-dolgu.bin`, ardından `Start-ScheduledTask ...`. Beklenen: hizmet `Running` ve `ONARILDI`.

### A5. Onarım tavanı — senaryo 8

1. A1'in 1–2. adımlarını art arda tekrarla. Her seferinde hizmetin `Running` olmasını bekle; `Onarimlar` sayısını izle.
2. Dördüncü silmede beklenen:
   - hizmet `Stopped` kalır;
   - `Durum` → `hataKodu` `ONARIM_TAVANI`;
   - `LastTaskResult` → `11`;
   - panelde `ONARIM_TAVANI`.
   - Son 24 saatteki onarımlar (A1–A4 dahil) sayılır; tavan daha erken gelebilir.
3. Geri dönüş:
   - Elle ikili kopyalama ya da `sc.exe config binPath=` YAPMA.
   - Tavan, insanın baktığını gösteren sayaçtır. Sayaç dosyasını kenara al ve görevi koştur:
     ```powershell
     Move-Item "$veri\guncelleme\is\onarim.json" "$env:TEMP\onarim.json.prova"
     Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev
     ```
   - Beklenen: `ONARILDI`, hizmet `Running`.
   - Kendiliğinden kalkış: sayaç, 24 saat penceresi dolunca ya da tavandan sonraki ilk sağlıklı turda sıfırlanır.

### A6. Doğrulanmış kaynak yok — senaryo 6 (isteğe bağlı, ileri)

Kaynak sırası: `.lkg` → `kendi.json` `eskiYol` → `current\runtime` → `surumler\<v>\runtime`. Hepsi, kayıt tutularak geçici klasöre taşınır:

1. Taşı:
   ```powershell
   $y = "$env:TEMP\onarim-kaynak"; New-Item $y -ItemType Directory -Force | Out-Null
   Stop-Service $hz
   $adaylar = @(Get-ChildItem "$kok\guncelleyici" -Recurse -Filter "tekserp-guncelleyici*.exe") + @(Get-ChildItem "$kok\surumler\*\runtime\tekserp-guncelleyici.exe")
   $i = 0; $kayit = foreach ($d in $adaylar) { $h = "$y\$i-$($d.Name)"; Move-Item $d.FullName $h; [pscustomobject]@{ Yer = $d.FullName; Yedek = $h }; $i++ }
   $kayit | Export-Csv "$y\kayit.csv" -NoTypeInformation
   ```
   `current` bir `surumler\<v>` bağlantısıdır; onun ikilisi de bu listeye girer.
2. Görev `.lkg`yi bulamayacağı için koşamaz. Kanıt için taşınan `.lkg`yi elle koştur:
   ```powershell
   & ($kayit | Where-Object Yer -like "*.lkg.exe").Yedek onar --kok $kok --veri $veri
   ```
3. Beklenen: çıkış `12`, `Durum` → `ONARIM_KAYNAK_YOK`, panelde `ONARIM_KAYNAK_YOK`.
4. Geri dönüş:
   ```powershell
   Import-Csv "$y\kayit.csv" | ForEach-Object { Move-Item $_.Yedek $_.Yer }
   Start-ScheduledTask -TaskPath "\TeksERP\" -TaskName $gorev
   ```
   Beklenen: hizmet `Running`. İkili yerine döndüğü için onarım yoksa yalnız başlatma olur.

### A7. Gerçek güç kesintisi — senaryo 2

Her alt adım iki kez koşulur: bir kez `shutdown /r /f /t 0` (sert yeniden başlatma), bir kez **fişi ve pili çekerek**.

- **A7a — iş yokken:** hizmet `Running` iken kesinti. Açılıştan ~2 dk sonra (görevin açılış tetiği PT2M) beklenen: hizmet `Running`, `Durum` kalp atışı taze, onarım satırı EKLENMEZ.
- **A7b — onarımın ortasında:**
  1. `Stop-Service $hz; Remove-Item (Ikili)`.
  2. `Start-ScheduledTask ...` ver ve 1 sn içinde güç kes.
  3. Açılıştan ≤2 dk sonra beklenen: hizmet `Running`, `Ikili` doğrulanmış (`Get-FileHash` `.lkg` ile aynı) ve `guncelleyici\` altında `.tmp` YOK.
- **A7c — kendini güncellemenin ortasında:** ancak hazırlık kanalında yeni güncelleyicili bir sürüm varken koşulur (T3 "GUC" satırı). Güncelleyici günlüğünde `HAZIRLANDI`/`YER_DEGISTIRILDI` görülünce güç kes. Açılıştan sonra beklenen: hizmet ya yeni ya eski doğrulanmış ikiliyle `Running`, `sc qc` yolu var olan bir dosyayı gösterir.
- Kanıt: açılış sonrası `sc.exe qc $hz`, `Durum`, `Onarimlar`, Olay Görüntüleyicisi satırları.

### A8. Kapanış

`sc.exe qc $hz` · `Get-ScheduledTask ...` · `Durum` → başlangıçtaki gibi. `$env:TEMP\guncelleyici-yedek` silinir. Ayrıca `powershell -File $kok\current\hizmet\guncelleyici-hizmeti.ps1 -Kok $kok` (ölçüm kipi) **UYUMLU** demeli: sürümlü ImagePath uyumlu sayılır.

---

## B. Deneme bulut sunucusu (Linux · deneme.etkiliyazilim.com)

Bağlantı (Mac Terminal'den): `ssh tekserp-bulut-deneme`, ardından `sudo -i`. Linux'ta onarım zamanlanmış görevle DEĞİL, birim **başlarken** koşar (`ExecStartPre=-… onar --yalniz-asil-ad`): onarım her yeniden başlatmada (çökme sonrası `Restart=always` 10 sn dahil) olur. Çalışırken silinen ikili süreç bitene dek fark edilmez; bu bilinçlidir (L-D RED).

### B0. Hazırlık ve ön koşul

```bash
H=tekserp-guncelleyici; K=/opt/tekserp; V=/var/lib/tekserp
systemctl cat $H | grep ExecStartPre      # iki satır: ...tekserp-guncelleyici.lkg onar --yalniz-asil-ad ... ve .../current/tekserp-guncelleyici onar ...
$K/guncelleyici/$H kunye                  # "onarim": 1
ls -l $K/guncelleyici/                     # tekserp-guncelleyici + tekserp-guncelleyici.lkg
systemctl is-active $H                     # active
cat $V/guncelleme/durum/durum.json
```

Birim yoksa ya da `.lkg` yoksa prova yapılmaz: güncelleyici bu sunucuya henüz Linux kurulumuyla (L7) kurulmamıştır. Yedek: `cp -a $K/guncelleyici /root/guncelleyici-yedek`.

ℹ️ İkinci `ExecStartPre` satırı (`current/` ikilisi), Linux sürüm dizini bütünlük doğrulaması gelene dek kendini doğrulayamaz. Günlükte o satır için çıkış `10` ("kendi doğrulanmadı") görmek BEKLENENDİR; satır `-` önekli olduğundan başlatma sürer ve onarım `.lkg` satırından gelir.

### B1. İkili silindi + `kill -9`

1. `rm $K/guncelleyici/$H; kill -9 $(systemctl show -p MainPID --value $H)`
2. 10–15 sn bekle (`RestartSec=10`).
3. Beklenen:
   - `systemctl is-active $H` → `active`;
   - `ls -l $K/guncelleyici/$H` dosyası `.lkg` ile aynı (`sha256sum $K/guncelleyici/$H{,.lkg}`);
   - `journalctl -u $H -n 30` içinde `UYARI: ONARILDI: ikili yoktu — son bilinen iyi (...lkg)`;
   - `cat $V/guncelleme/is/onarim.json` bir satır;
   - panelde `ONARILDI`.
4. Geri dönüş: gerek yok.

### B2. Yalnız `kill -9` (ikili sağlam)

1. `kill -9 $(systemctl show -p MainPID --value $H)`
2. Beklenen: 10 sn içinde `active`; `onarim.json`a satır EKLENMEZ (asıl ad sağlam, yapılacak iş yok).

### B3. Bozuk bayt

1. `systemctl stop $H; truncate -s -4096 $K/guncelleyici/$H; systemctl start $H`
2. Beklenen: `active`; journal'da `ONARILDI` ve neden `BOZUK`; bozuk dosya hiç çalıştırılmadı.

### B4. Yönetici kararı (ONARILMAZ)

1. `systemctl disable --now $H`
2. Beklenen: birim durur ve kendiliğinden başlamaz. Panelde birkaç dakika içinde "Güncelleyici yanıt vermiyor"; satıcıda `DURDU`/`YOK`.
3. Geri dönüş: `systemctl enable --now $H`.

### B5. Sert yeniden başlatma (sağlayıcı paneli) — senaryo 2

- **B5a — iş yokken:** sağlayıcının yönetim panelinden sunucuya **Hard reset / Power cycle** ver (işletim sisteminden değil). Açılıştan sonra yeniden `ssh` ile bağlan. Beklenen: `systemctl is-active $H` → `active`, `journalctl -b -u $H` içinde onarım yok, kalp atışı taze.
- **B5b — ikili eksikken:** `systemctl stop $H; rm $K/guncelleyici/$H` ver, sonra panelden sert yeniden başlat. Açılışta beklenen: `ExecStartPre` `.lkg`den geri koyar, `active`, `journalctl -b -u $H` içinde `ONARILDI`.
- **B5c — onarımın ortasında:** bunu elle zamanlamak güvenilir değildir. Yarım kopya (`.onarim` geçici adı) sonraki başlatmada atılır, asıl ad yalnız tek `rename(2)` ile iner. Bu durum CI'da ölüm döngüsüyle ölçülür, prova satırı gerekmez.

### B6. Onarım tavanı (isteğe bağlı)

1. B1'i art arda dört kez yap.
2. Dördüncüde beklenen:
   - birim her 10 sn yeniden dener ama ikili gelmez;
   - journal'da `ONARIM_TAVANI`, `durum.json` `hataKodu` `ONARIM_TAVANI`;
   - panelde `ONARIM_TAVANI`.
3. Geri dönüş: `mv $V/guncelleme/is/onarim.json /root/onarim.json.prova && systemctl restart $H`. Beklenen: `ONARILDI`, `active`.

### B7. Kapanış

`systemctl is-active $H` → `active`; `rm -rf /root/guncelleyici-yedek`.

---

## Kanıt satırı biçimi

`2026-MM-DD HH:MM · A1 · thinkpad · hizmet Running, ImagePath s\2.x.y\, onarim.json 1 (EKSIK), panel ONARILDI · LastTaskResult 0`
