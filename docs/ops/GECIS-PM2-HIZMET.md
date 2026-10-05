# pm2 → Windows hizmeti geçişi (Dağıtım v2) — runbook

> **Durum:** W3 provası thinkpad-1'de KOŞULDU (2026-10-01, D8c Senaryo 4: testfabrika pm2 düzeni → hizmet; **4 geçiş + 2 geri alma** — ölçümler §0, §1, §2, §10). Provanın bulduğu kusurlar kapandı (§10). SAHINSRV (adnansahin) geçişi **kullanıcının penceresinde, vardiya yokken ve kullanıcının açık cümlesiyle**. demofabrika aynı yolla, sonra.
> ⚠️ **adnansahin için GEÇERSİZ (2026-10-03, kullanıcı kararı):** adnansahin dondurulmuştur — SAHINSRV bu yolla geçmez ve hiçbir güncelleme almaz; ileride setup.exe ile temiz kurulum + kendi DB yedeğinden "yedekten kur" (önce thinkpad-1'de yedek kopyasıyla prova). Bu runbook'un adnansahin'e özgü kısımları (§1 madde 4–5a, §8) tarihseldir. Kural: `docs/kurallar/deploy-kurulum.md`; arşiv "2026-10-03 — adnansahin dondurulur".
> **Araç:** `deploy/gecis/gecis.ps1` (paketin içinde `gecis\gecis.ps1`; betik ve kurduğu paket aynı derlemeden). Yardımcı `gecis\gecis-yardimci.cjs`, izin/kayıt `hizmet\backend-hizmeti.ps1`, güncelleyici `hizmet\guncelleyici-hizmeti.ps1`. Bekçi `Teks-Erp/scripts/test_gecis.ts`; kural `docs/kurallar/deploy-kurulum.md`; sözleşme `docs/design/GUNCELLEYICI.md` §4.
> **SAHINSRV değerleri** bu belgeye `docs/ops/SUNUCU-ENVANTERI.md`'den (2026-09-29 salt okuma) alındı — bu dilimde sunucuya hiç erişilmedi. Her değer pencerede **KURU koşumla yerinde ölçülür**; belge ile ölçüm ayrışırsa ölçüm kazanır ve buraya düzeltme yazılır.

## 0. Ne değişir, ne değişmez

| | Önce (pm2 düzeni) | Sonra (hizmet düzeni) |
|---|---|---|
| Backend süreci | pm2 `tekserp-backend-yeni` (SYSTEM), `C:\TeksERP\app` | Hizmet `TeksERP-Backend`, hesap `NT SERVICE\TeksERP-Backend` (düşük yetki), `C:\TeksERP\current` → `surumler\<sürüm>` |
| Açılışta kalkma | Görev `TeksERP-Backend-Boot` → `pm2 resurrect` | SCM gecikmeli otomatik; görev KAPATILIR (Tamamla'da silinir) |
| Ayar | `app\.env` + `app\ecosystem.config.js` env bloğu | Tek dosya `yapilandirma\.env` — **etkin değerler aynı** (bekçi ölçer) |
| Güncelleme | Elle `kur.ps1 -Paket` | `TeksERP-Guncelleyici` (LocalSystem); politika portaldan (OTOMATİK · ONAYLI · DONDUR) |
| Gece yedeği | `TeksERP-DB-Backup-Yeni` 03:00, `C:\TeksERP\yedekle.ps1 -IkinciHedef E:\TeksERP-yedek` | **Aynı görev, aynı saat, aynı argüman**; yalnız `yedekle.ps1` hizmet düzenini tanıyan sürümle değişir |
| PostgreSQL | `postgresql-tekserp` 16.9 (`D:\PostgreSQL\16`, veri `D:\PostgreSQL\data`) | **DOKUNULMAZ** (harici kip; backend hizmeti ona bağımlı kaydedilir) |
| Veritabanı | — | **DOKUNULMAZ** (aynı derleme, göç yok; geçiş yalnız yedek alır) |
| Lisans · yedek anahtarı · kurulum geçmişi | `lisans\` · `yedek-anahtar\` · `kurulum-gecmisi.jsonl` | **Yerinde**; yalnız hizmet hesabına izin verilir |
| Makine dışı yedek | rclone `gdrive`, `C:\TeksERP\rclone.conf` | `veri\rclone.conf` (KOPYA; eskisi Tamamla'ya dek yerinde) |
| Port · güvenlik duvarı · istemciler | 4000 | **Aynı**; kurulum kimliği aynı — panel ve tabletler yeniden yapılandırılmaz |

Kesinti: yalnız kalem 5–10 (pm2 durdur → normal başlatma). **Ölçüm 24–29 sn** (thinkpad-1, D8c): üç başarılı geçişte 27–29 sn; 9. kalemde otomatik geri alınan geçişte 24 sn; `-GeriAl` 5 sn. Kesinti kalem 6'daki veritabanı yedeğini de içerir, bu yüzden veri boyuyla uzar.

## 1. Önkoşullar — hepsi ✓ olmadan başlanmaz

1. **Kullanıcının açık cümlesi + pencere** (vardiya yok). Fabrika personeline "1–2 dk panel/tablet bağlantısı kopar" bilgisi.
2. **W3 yeşil:** D8'in thinkpad-1'de temiz kurulum + güncelleme + geri dönüş provası VE bu runbook'un thinkpad-1'de pm2 düzenindeki bir kurulumda uçtan uca provası (kuru → uygula → ölçüm → `-GeriAl` → yeniden uygula).
3. **Parmak izi düşük yetkide ölçüldü:** D3'ün `parmak-izi-dusuk-yetki-olcum.ps1`i thinkpad-1'de koşuldu ve sonuç kabul edildi (f1..f4 hizmet hesabında okunuyor ya da kabul edilmiş geçiş planı var). Aksi hâlde lisans hizmet hesabında farklı parmak izi görür.
4. **Geçiş paketi:** Dağıtım v2 içeren, `runtime\tekserp-hizmet.exe` + `runtime\tekserp-guncelleyici.exe` taşıyan, `adnansahin` kanalının imzalı paketi (terfi etiketli). Geçiş bu ikilileri bulamazsa DURUR. `PAKET.json` kanal kimliğini (`backendHizmetAdi` + `backendLisansSunucusu`) taşımalı, yani D8e 2a'dan sonra derlenmiş olmalı; `backendLisansSunucusu` yoksa UYGULA "lisans sunucusu OLCULEMEDI" ile durur.
5. **Sunucu bu pakete pm2 düzeninde GEÇMİŞ olmalı** — ayrı, önceki bir pencerede `kur.ps1 -Paket <aynı zip>` (göçler orada, `kur.ps1`'in kendi geri alma yoluyla). Geçiş `app\`teki derlemeden farklı paketi ve bekleyen göçü REDDEDER.
   ⚠️ **PIN/kart özeti (G21-K) geri çevrilemez.** Dağıtım v2'nin ilk paketi `20261001120000_kisa_kimlik_ozet` göçünü taşır. Bu adımdan sonra her başarılı PIN/kart girişi düz değeri özete çevirir ve düz kolonu boşaltır. Eski backend özetli PIN'i okuyamaz.
   - **(a)** GEÇERSİZ (2026-10-03): adnansahin dondurulmuştur, bu göçü taşıyan sürümü hiçbir yoldan almaz (ileride setup.exe + "yedekten kur"; yukarıdaki not).
   - **(b) Geri alma: iki yol, seçim ÖLÇÜMLE** (yönetici kararı 2026-10-02: fabrikada veri kaybı, PIN'i yeniden dağıtmaktan pahalıdır). pm2 düzenindeyken (geçişten önce ya da `gecis.ps1 -GeriAl`den sonra) bu sürümden eskisine:

     | Ölçüm (aşağıdaki sorgu) | Yol |
     |---|---|
     | Her satırda `kesimden_sonra = 0`: göçten sonra üretim verisi YAZILMADI (hemen fark edilen arıza) | **1.** `kur.ps1 -GeriAl` + aynı pencerenin `premigrate_` dökümünü geri yükle (`DEPLOY-RUNBOOK.md` §9: önce kod, sonra döküm). Düz PIN/kartlar dökümle geri gelir. |
     | En az bir satır > 0 (vardiya sürdü) ya da ölçülemedi | **2. VARSAYILAN.** DB'ye DOKUNMA. Yalnız `kur.ps1 -GeriAl`; sonra PIN/kartı okunamayan kişilere eski backend'de yeni PIN/kart ver (aşağıda). |

     **Ölçüm** (salt okuma, `psql`, bağlantı `.env`deki `DATABASE_URL`). Kesim = dosya adındaki `premigrate_<yyyyMMdd_HHmmss>` damgası. Damga sunucunun yerel saatidir, dilim farkı yazılır (ör. `+03`):
     ```sql
     SELECT tablo, son_yazim, kesimden_sonra FROM (
       SELECT 'rolls' AS tablo, max("updatedAt") AS son_yazim, count(*) FILTER (WHERE "updatedAt" >= TIMESTAMPTZ '<YYYY-MM-DD HH:MM:SS+03>') AS kesimden_sonra FROM rolls
       UNION ALL SELECT 'roll_operations', max("createdAt"), count(*) FILTER (WHERE "createdAt" >= TIMESTAMPTZ '<…>') FROM roll_operations
       UNION ALL SELECT 'roll_movements', max("enteredAt"), count(*) FILTER (WHERE "enteredAt" >= TIMESTAMPTZ '<…>') FROM roll_movements
       UNION ALL SELECT 'work_orders', max("updatedAt"), count(*) FILTER (WHERE "updatedAt" >= TIMESTAMPTZ '<…>') FROM work_orders
       UNION ALL SELECT 'orders', max("updatedAt"), count(*) FILTER (WHERE "updatedAt" >= TIMESTAMPTZ '<…>') FROM orders
       UNION ALL SELECT 'sacks', max("updatedAt"), count(*) FILTER (WHERE "updatedAt" >= TIMESTAMPTZ '<…>') FROM sacks
       UNION ALL SELECT 'shipments', max("updatedAt"), count(*) FILTER (WHERE "updatedAt" >= TIMESTAMPTZ '<…>') FROM shipments
     ) x ORDER BY son_yazim DESC NULLS LAST;
     ```
     Panelde karşı ölçüm: Sistem → Yedekler → `premigrate_` satırı → "Geri yükle (üzerine yaz)…" etki önizlemesi. Pencere onaylanmadan kapatılır. Önizleme INSERT'leri ve audit'i sayar, sayıları "en az" dilindedir.

     **Yol 2'nin aracı (ölçüldü, kod):**
     - G21-K'nın toplu sıfırlaması bu yolda KULLANILAMAZ. Yeri: Kullanıcılar → Kısa Kimlikler → "Toplu hızlı PIN sıfırlama" (önizleme "Doğrulanamayanlar" / "Tüm PIN'liler", kişi başı onay kutusu, yeni PIN listesi bir kez gösterilir + Yazdır; uç `/api/admin/short-credentials/bulk-reset`). Yalnız G21-K'lı backend'de vardır ve yeni PIN'i ÖZET olarak yazar; geri alınmış eski backend özeti okuyamaz.
     - `kisa-kimlik` aracında sıfırlama komutu yok (`durum` · `donustur` · `anahtar-geri-yukle`). `durum` yalnız sayı basar, kişi adı basmaz.
     - Eski backend'de yeniden verme kişi başıdır. Önce kişi listesi (salt okuma):
       ```sql
       SELECT username, "fullName",
              ("quickPinDigest" IS NOT NULL AND "quickPin" IS NULL)   AS pin_yeniden,
              ("cardTokenDigest" IS NOT NULL AND "cardToken" IS NULL) AS kart_yeniden
       FROM users
       WHERE "isActive" AND "deletedAt" IS NULL AND NOT "isSystemAccount"
         AND (("quickPinDigest" IS NOT NULL AND "quickPin" IS NULL) OR ("cardTokenDigest" IS NOT NULL AND "cardToken" IS NULL))
       ORDER BY "fullName";
       ```
       Sonra panelde Kullanıcılar → kişi → Hızlı PIN (üret) ve QR personel kartı (yenile). Uçlar (`/api/admin/users/:id/quick-pin` · `/card-token`) iki sürümde aynı sözleşmededir (panelin istemci imzası G21 öncesiyle aynı).
     - Yeniden yükseltmede eski özet satırda kalır ama BAYATTIR: düz değeri olan satırda giriş düzü esas alır, eski PIN/kart geçmez; ilk başarılı girişte özet ezilir. Aynı PIN bir kişide özet, başka kişide düz duruyorsa giriş kimseyi açmaz (`QUICK_PIN_AMBIGUOUS`) — birine yeni PIN verin. ⚠️ Eski backend'de KALDIRILAN PIN ya da İPTAL edilen kart yeniden yükseltmede tekrar geçer (özet kalır, düz boş); bunları geri almadan önce not edin ve yükseltmeden sonra yeniden kaldırın.
   - **`kur.ps1 -GeriAl` bugün ne yapar (ölçüldü, `deploy/kur.ps1`):** yalnız kodu geri koyar (en yeni geçerli `app.eski-*` → `app\`, pm2 yeniden kayıt) ve DB'ye DOKUNMAZ. Ekrana "DB migration'lari GERI ALINMADI. Eski kod yeni semayla kosuyor" + "Uyumsuzluk varsa yedekten restore gerekir: `<backups>`" yazar.
   - En yeni `premigrate_*` dökümü şifreliyse (`.tkenc`) çözmeyi önerir: parolayı araç sorar; `-Zorla` ya da yönlendirilmiş girişte yalnız komutu basar. `pg_restore … --clean --if-exists` komutunu da yalnız BASAR, koşmaz. Düz dökümde ek bir şey basmaz; döküm yolu kurulum sonundaki "veri:" satırındadır. Geri yükleme `DEPLOY-RUNBOOK.md` §9 sırasıyla yapılır: önce kod, sonra döküm.
   - Döküm `kur.ps1 [3/9]`da, göçten önce alınır: düz PIN/kart değerlerini taşır, ama sonrasında yazılan her veri geri yüklemede gider. Yol 1 bu yüzden yalnız ölçümle seçilir.
   - Geçişin kendi `-GeriAl`ı (§5) aynı derlemeye döner, DB'ye dokunmaz; bu kuraldan etkilenmez.
6. **Portal:** bu kurulumun güncelleme politikası geçiş boyunca **ONAYLI ya da DONDUR** (güncelleyici ilk turunda kendiliğinden sürüm kurmasın; KURU koşum OTOMATİK'i uyarır). Satıcı ve CF Worker sözleşme 3'te.
7. **Yedek:** son gece yedeği (03:00) `backups\backup.log`ta OK ve makine dışı kopya doğrulanmış. Geçiş ayrıca kendi doğrulanmış yedeğini alır.
8. **Erişim:** Tailscale SSH yönetici oturumu. Geçiş SSH oturumunun **içinde koşturulmaz** (oturum koparsa yarım kalır) — `uzaktan-kos.ps1` ile SYSTEM görevi olarak; ya da RDP/konsolda yönetici PowerShell.
9. **İstemciler:** panel ve tablet sürümleri paketin sürüm notundaki asgari sürümün üstünde.
10. **`ilk-kurulum.ps1` YENİDEN KOŞULMAZ** — eksik bir önkoşulu tamamlamak için de koşulmaz. Donmuş betiğin `SirIzniDaralt`ı PS 5.1'de dizinlerde hiç çalışmıyor (thinkpad-1 ölçümü, D8c):
    - Kök neden: `$ek = if ($dizin) { @("/T") }` skalere açılır; `@ek` splat'i icacls'e `/` ve `T` verir → icacls 87 ("Invalid parameter "/"").
    - Sonuç: `pg-setup\` · `backups\` · `yedek-anahtar\` HİÇ daraltılmaz, `C:\` mirası kalır. `db-credentials.json` ve dökümler Authenticated Users = Modify olur. Boş DACL oluşmaz.
    - Betik bunu "YAPILMADAN KALANLAR"da sayar; çıkış kodu anlamsızdır (son psql'inki). Yeniden koşum dokunmaz, bozmaz, ama düzeltmez.
    - Açığı geçiş kapatır: kalem 3 (`-YalnizIskelet`) bu dizinleri korumalı izne alır (SYSTEM + Administrators, gerekiyorsa hizmet SID'i). `-GeriAl` izinleri geçiş öncesine, yani geniş mirasa geri koyar.
    - Donmuş betik yönetici/kullanıcı kararıyla DÜZELTİLMEZ.
    - KURU'dan önce salt okuma ölçümü: `icacls C:\TeksERP\pg-setup` · `icacls C:\TeksERP\backups`. Satırda `Authenticated Users` görünüyorsa miras geniştir, geçiş daraltacaktır.

## 2. Hazırlık (pencereden önce — salt okuma)

```powershell
# Paket sunucuya: özeti sürüm notu / yayın defteriyle karşılaştır
Get-FileHash D:\indir\tekserp-backend-<sürüm>.zip -Algorithm SHA256
Expand-Archive D:\indir\tekserp-backend-<sürüm>.zip D:\indir\paket-<sürüm>
# KURU koşum: hiçbir şeye dokunmaz; envanter + plan + plan özeti basar
powershell -NoProfile -ExecutionPolicy Bypass -File D:\indir\paket-<sürüm>\gecis\gecis.ps1 `
  -Kok C:\TeksERP -Paket D:\indir\tekserp-backend-<sürüm>.zip -PaketOzeti <sha256>
```

KURU çıktısı saklanır. ENGEL varsa pencere açılmaz; engel çözülür (çoğu tek komutluk) ve KURU yeniden koşulur. SAHINSRV'de beklenen envanter:

| Kontrol | Beklenen (envanterden) | Not |
|---|---|---|
| Kök | `C:\TeksERP` | `GUNCELLEYICI.md` §4.1'deki `C:\Etkili-Yazilim` ESKİ köktür (`C:\Etkili-Yazilim.SILINECEK-20260925`); KURU ölçer |
| Paket = app\ derlemesi | derleme kimliği + commit + sürüm aynı | değilse: önce `kur.ps1 -Paket` |
| Göç | bekleyen 0, fazla 0, yarım 0 | |
| pm2 | `tekserp-backend-yeni` online + `pm2-logrotate` modülü | başka pm2 uygulaması varsa ENGEL |
| Port 4000 | yalnız pm2 backend'i dinliyor | |
| PostgreSQL | `postgresql-tekserp` → backend bağımlılığı | tekil bulunamazsa `-PgHizmeti postgresql-tekserp` |
| Görevler | `TeksERP-Backend-Boot` KAPATILACAK · `TeksERP-DB-Backup-Yeni` KORUNUR | TeksERP adlı olmayan bir görev pm2/app\ çağırıyorsa ENGEL (elle kapatılır) |
| `C:\TeksERP\pm2-boot.cmd` | **setlocal YOK** (elle düzenlenmiş; yönetici salt okuma ölçümü 2026-10-01) → etkilenmez | Ölçüm: `Select-String C:\TeksERP\pm2-boot.cmd -Pattern 'setlocal','pm2.cmd'`. `setlocal` VAR ve `pm2.cmd` `call`sız çağrılıyorsa pencereden ÖNCE paketteki `pm2-boot.cmd` (`call`lı) kök dosyanın üstüne konur. `kur.ps1` kök dosyayı EZMEZ. Neden: `-GeriAl` (pm2 daemon'u yokken) ve §5 elle adım 2 açılış görevine dayanır. Bozuk dosyada pm2 SYSTEM profilinde (`systemprofile\.pm2`) boş doğar, backend kalkmaz; thinkpad-1'de telafi `PM2_DURDUR` çıkış 4 verdi. |
| Güvenlik duvarı | port 4000'e PORT kuralı | yoksa plan "TeksERP API 4000" kuralı ekler (Domain+Private, LocalSubnet) — program kuralı node'un eski yolunu tutar |
| rclone.conf | `C:\TeksERP\rclone.conf` → `veri\rclone.conf` | kopya |
| Yedek şifreleme | `yedek-anahtar\*.tkpub` varsa geçiş yedeği şifreli | yoksa düz, korumalı geçiş dizininde |
| Kira | kanal `adnansahin`, politika ONAYLI/DONDUR | OTOMATİK ise önce portaldan değiştir |
| Dokunulmayanlar | `D:\tekserp-build\tekserp`, `C:\Etkili-Yazilim.SILINECEK-*`, Tailscale | geçiş yalnız ölçer |

Beklenen plan **13 kalem** (güvenlik duvarı kuralı gerekiyorsa 14, `-PgKaydiYaz` ile +1):

| # | Kalem | Kesinti | Hata olursa |
|---|---|---|---|
| 1 | Paketi `surumler\<sürüm>`e aç + doğrula (dosya sayısı, derleme kimliği, MZ, Windows şema motoru) | yok | otomatik geri |
| 2 | `current` → `surumler\<sürüm>` | yok | otomatik geri |
| 3 | Dizin iskeleti + korumalı izin (`backend-hizmeti.ps1 -YalnizIskelet`) | yok | otomatik geri |
| 4 | `yapilandirma\.env` (+ `veri\rclone.conf`) | yok | otomatik geri |
| 5 | pm2 backend'i DURDUR | **başlar** | otomatik geri |
| 6 | Veritabanı yedeği (doğrulanmış) → `gecis\<damga>\` | sürer | otomatik geri |
| 7 | `TeksERP-Backend-Boot` KAPAT | sürer | otomatik geri |
| 8 | Hizmet kaydı + izinler (`backend-hizmeti.ps1 -Uygula`: hizmet-kur ÖNCE, ACL SONRA) | sürer | otomatik geri |
| 9 | Doğrulama başlatması (yalnız 127.0.0.1) + sağlık (sürüm + DB + kimlik) | sürer | otomatik geri |
| 10 | Normal başlatma + sağlık + LAN kimliği | **biter** | otomatik geri |
| 11 | pm2 söküm (delete + save + kill) | — | uyarı (çıkış 3) |
| 12 | `C:\TeksERP\yedekle.ps1` ← hizmet-farkında sürüm | — | uyarı (çıkış 3) — gece yedeğini elle doğrula |
| 13 | Güncelleyici: ikili + `ayar.json` + kayıt + başlat | — | uyarı (çıkış 3) |

## 3. Uygulama (pencere)

```powershell
# SSH'tan (önerilen): SYSTEM görevi; oturum kopsa da sürer, çıktı betiğin klasörüne yazılır
powershell -NoProfile -ExecutionPolicy Bypass -File D:\indir\paket-<sürüm>\uzaktan-kos.ps1 `
  -Betik D:\indir\paket-<sürüm>\gecis\gecis.ps1 `
  -Argumanlar '-Kok C:\TeksERP -Paket "D:\indir\tekserp-backend-<sürüm>.zip" -PaketOzeti <sha256> -Uygula -Onay <N> -PlanOzeti <özet>'
# Konsoldan: aynı satır, uzaktan-kos'suz (gecis.ps1 doğrudan)
```

KURU'nun bastığı "Uygulamak icin" satırı tam komuttur: bu koşumun bütün parametrelerini (`-PaketOzeti`, `-HizmetAdi`, `-PgHizmeti`, `-LisansSunucusuYaz`, `-ProvaKabul` …) aynen taşır, sonuna `-Uygula -Onay <N> -PlanOzeti <özet>` ekler. Kopyala-yapıştır aynı planı uygular; SSH'tan aynı parametreler `-Argumanlar`a girer. `-GeriAl` ve `-Tamamla` da tam komut basar. `-Onay <N>` ve `-PlanOzeti` KURU'nun bastığı değerlerdir; arada envanter değiştiyse (ör. pm2 süreci yeniden başladı) geçiş hiçbir şeye dokunmadan durur — KURU tekrarlanır. Çıkış kodu: **0** tamam · **3** tamam, uyarılı (çıktıyı oku) · **1** hata ve OTOMATİK GERİ ALINDI (pm2 düzeni geçiş öncesindeki gibi; sebep çıktıda) · **4** hata ve geri alma EKSİK → §5.

Geçiş kaydı: `C:\TeksERP\gecis\<damga>\` (yalnız SYSTEM + Administrators): `gunluk.jsonl` (her kalem BAŞLADI/BİTTİ), `gecis.log`, `kopya\` (dump.pm2, eski `yedekle.ps1`, açılış görevi XML), geçiş yedeği. Sır (parola, belirteç, `.env` değeri) hiçbirine girmez.

## 4. Ölçüm — geçişten hemen sonra, hepsi kayda geçer

| Ölçüm | Nasıl | Beklenen |
|---|---|---|
| Betiğin durum raporu | `gecis.ps1 -Kok C:\TeksERP` (parametresiz = ölçüm) | hizmetler Running · `/health` UP/UP/v<sürüm> · kimlik aynı · pm2 yok · açılış görevi kapalı · yedek görevi Ready · güncelleyici `durum.json` · izin+kayıt UYUMLU |
| Hizmetler | `Get-Service TeksERP-Backend, TeksERP-Guncelleyici, postgresql-tekserp` | üçü Running |
| API + kimlik | `http://127.0.0.1:4000/health` · `http://<LAN-IP>:4000/api/discovery/identity` | UP; `installationId` geçiş öncesiyle AYNI |
| İzin + kayıt | `D:\indir\paket-<sürüm>\hizmet\backend-hizmeti.ps1 -Kok C:\TeksERP -HizmetAdi <ad> -PgHizmeti postgresql-tekserp` (ölçüm; sonekli kanalda + `-GuncellemeDizini %ProgramData%\TeksERP-<kanal>\guncelleme`) | UYUMLU (çıkış 0). Harici PG'de bağımlılık verilmezse betik `TeksERP-PostgreSQL` bekler ve yanlış UYUMSUZ der; betiğin durum raporu bunu artık plandan kendisi verir |
| Lisans | panel → Lisans ekranı; `C:\TeksERP\logs\backend-err.log`ta `UYARI [lisans]` | durum geçiş öncesiyle aynı; "parmak izi ölçülemedi" YOK |
| Panel | panelden giriş + bir rapor | açılır (sunucu adresi değişmedi) |
| Tablet | her istasyondan bir tablet bağlanır, bir okuma | bağlanır (keşif ya da kayıtlı IP) |
| Gece yedeği | `Start-ScheduledTask TeksERP-DB-Backup-Yeni` → `backups\backup.log` son satır · `E:\TeksERP-yedek` | `OK …` (şifreleme niyeti varsa `sifreli`); ikinci kopya var |
| Makine dışı yedek | panel → Sistem → Yedekler → offsite son başarı | 1 saat içinde başarı (`veri\rclone.conf`) |
| Güncelleyici | `C:\ProgramData\TeksERP\guncelleme\durum\durum.json` (sonekli kanalda `TeksERP-<kanal>`) · panel Sistem → Güncellemeler | `sonCanlilik` taze; `BELIRTEC_YOK` / `ONAY_BEKLIYOR` beklenebilir, lisans etkin değilken `BEKLIYOR`/`KIRA_YOK` (thinkpad-1) |
| Açılış (isteğe bağlı) | pencere izin veriyorsa sunucuyu yeniden başlat | backend kendiliğinden kalkar, pm2 kalkmaz |

## 5. Geri alma

**Ne zaman:** §4'teki bir ölçüm kırmızı ve pencerede çözülemiyor. Veritabanı geri yüklenmez — geçiş dokunmadı; hizmet düzeninde yazılan veri (aynı derleme) korunur.

```powershell
gecis.ps1 -Kok C:\TeksERP -GeriAl                                   # KURU: geri alma planı (N kalem)
gecis.ps1 -Kok C:\TeksERP -GeriAl -Uygula -Onay <N> -PlanOzeti <özet>
```

**Yarım kalan geçiş** (elektrik kesintisi, oturum kopması, yeniden başlatma): sonraki her koşum günlükteki yarım işlemi görür ve `-Uygula`yı REDDEDER — önce `-GeriAl` ile kapatılır, sonra KURU + `-Uygula` baştan (ileriye devam bilerek yok: her durumda tek, sınanmış yol). Açılış görevi kalem 7'ye dek açık kaldığı için o noktaya kadar bir yeniden başlatmada eski pm2 backend'i kendiliğinden döner; kalem 7–8 arasında hiçbir backend kalkmaz (operatör pencerededir); kalem 8'den sonra yeni hizmet kalkar (veritabanı aynı, göç yok).

Ters sırada: güncelleyici durur + kaldırılır → `yedekle.ps1` ve `dump.pm2` geçiş öncesine → backend hizmeti durur + kaldırılır → açılış görevi açılır → **pm2 backend'i yeniden başlar + sağlık** → `yapilandirma\.env`, `veri\rclone.conf`, `surumler\` karantinaya (`gecis\<damga>\geri\`) → izinler geçiş öncesine → `current` kalkar. Sonrasında `kur.ps1` yine kullanılabilir. Geri alma da yarım kalırsa (çıkış 4) aynı komut tekrar koşulur — telafiler tekrarlanabilir, bitenler atlanır.

**Betik çalışamazsa (elle, yönetici PowerShell):**

1. `Stop-Service TeksERP-Guncelleyici, TeksERP-Backend` → `C:\TeksERP\guncelleyici\tekserp-guncelleyici.exe hizmet-kaldir` · `C:\TeksERP\current\runtime\tekserp-hizmet.exe hizmet-kaldir` (ikili yoksa `sc.exe delete <ad>`).
2. `Copy-Item C:\TeksERP\gecis\<damga>\kopya\dump.pm2 C:\TeksERP\pm2-home\dump.pm2 -Force` → `Enable-ScheduledTask -TaskName TeksERP-Backend-Boot` → `Start-ScheduledTask -TaskName TeksERP-Backend-Boot` → `/health` UP.
3. `cmd /c rmdir C:\TeksERP\current` — ⚠️ `Remove-Item -Recurse` **KULLANILMAZ**: PowerShell 5.1'de junction'ın HEDEFİNİ (sürüm dizinini) boşaltır.
4. `C:\TeksERP\yapilandirma` ve `C:\TeksERP\surumler`i `C:\TeksERP\gecis\<damga>\geri\`e taşı (yoksa `kur.ps1` hizmet izi görüp durur).
5. `Copy-Item C:\TeksERP\gecis\<damga>\kopya\yedekle.ps1 C:\TeksERP\yedekle.ps1 -Force`.

**Tamamla'dan sonra** betikle geri dönülmez: `gecis\<damga>\pm2-duzeni\`den `app\` · `pm2\` · `pm2-home\` · `pm2-boot.cmd` geri taşınır, açılış görevi `Register-ScheduledTask -TaskName TeksERP-Backend-Boot -Xml (Get-Content gecis\<damga>\kopya\TeksERP-Backend-Boot.son.xml -Raw)` ile yeniden kaydedilir, sonra yukarıdaki 1–5.

## 6. Tamamla — birkaç gün sorunsuz çalıştıktan sonra, ayrı onayla

```powershell
gecis.ps1 -Kok C:\TeksERP -Tamamla                                  # KURU
gecis.ps1 -Kok C:\TeksERP -Tamamla -Uygula -Onay <N> -PlanOzeti <özet>
```

Açılış görevi silinir (XML geçiş dizininde); `app\` · `app.eski-*` · `pm2\` · `pm2-home\` · `pm2-boot.cmd` · kökteki `kur.ps1` · eski `rclone.conf` → `gecis\<damga>\pm2-duzeni\` (**silinmez**); düz (şifresiz) geçiş yedeği silinir (`-DokumuKoru` ile kalır). Önkoşul: backend hizmeti çalışıyor ve sağlıklı. Arşiv haftalar sonra elle silinebilir. Sonra `docs/ops/SUNUCU-ENVANTERI.md` fabrika satırları güncellenir.

## 7. Geçişten sonra — hizmet düzeninde elle yapılmayanlar ve yapılanlar

- **Onarım setup.exe ile YAPILMAZ.** Geçişle kurulmuş düzende `kurulum.json` yoktur; setup bu kurulumu tanır ve durur. Geçişli kurulum iki yoldan onarılır: güncelleyici (yeni sürüm) ya da `gecis.ps1 -GeriAl`. Yönetici kararı F4-B, 2026-10-02.
  İleride: geçişin setup-uyumlu kurulum kaydı yazması (F4-A) açık borçtur.
- **`current` elle çevrilmez.** Geri dönüş yalnız güncelleyicinin telafisiyle (`GERI_DONDU`) ya da `gecis.ps1 -GeriAl` ile yapılır (kural ve nedeni `docs/design/GUNCELLEYICI.md` §7). §5'teki elle adımlar yalnız betik çalışamazken hizmet düzeninden TAMAMEN çıkış içindir.
- **Paket araçlarını elle koşmak** (`kisa-kimlik` · `superadmin-olustur` …): hizmet düzeninde `.env` `yapilandirma\`dadır. Lisans deposunun yeri, `.env`de `LICENSE_DIR` yoksa aracın çalışma dizininden türer (`..\lisans`; `src/lib/license/store.ts` `resolveLicenseDir`).
  - `C:\TeksERP\current`ten koşulursa doğru dizini (`C:\TeksERP\lisans`) bulur.
  - Sürüm dizininden (`surumler\<sürüm>`) koşulursa `surumler\lisans`ta İKİNCİ bir PIN/kart anahtar halkası sessizce doğar. O halkayla yazılan PIN hizmette doğrulanmaz.
  - Bu yüzden iki yol da AÇIKÇA verilir. Kurulum da aracı böyle koşar (`deploy/kurulum/kurulum.ps1`, satıcı hesabı adımı):

```powershell
cd C:\TeksERP\current; $env:DOTENV_CONFIG_PATH='C:\TeksERP\yapilandirma\.env'; $env:LICENSE_DIR='C:\TeksERP\lisans'; .\runtime\node.exe dist\tools\kisa-kimlik.cjs durum
```

## 8. adnansahin (SAHINSRV) — kanal kimliği geçişte neyi belirler

> ⚠️ Tarihsel (2026-10-03): adnansahin bu geçişi yapmayacak — başlıktaki not.

Geçiş adları ve lisans satıcısını paketin KENDİ kimliğinden çözer (`PAKET.json` → `deploy/hizmet/kanal-adlari.ps1`, setup ile tek çekirdek; kanal kaydı `deploy/kanallar.json`). `-GuncelleyiciAdi` parametresi KALKTI; onu taşıyan eski komut, parametre bağlamasında hiçbir şeye dokunmadan düşer. adnansahin kaydında:

- **Adlar değişmez, soneksiz kalır:** backend `TeksERP-Backend`, güncelleyici `TeksERP-Guncelleyici`, veri kökü `%ProgramData%\TeksERP`. `-HizmetAdi` verilmez, paketten gelir; verilirse `TeksERP-Backend` olmalıdır, farklıysa ENGEL.
- **Lisans satıcısı:** kanal değeri `https://lisans.etkiliyazilim.com`, derlemenin varsayılanıyla aynı. Bu yüzden `yapilandirma\.env`e `LICENSE_SERVER_URL` satırı YAZILMAZ ve KURU "= kanal adnansahin kaydi" der.
  - Sunucunun etkin değeri farklıysa KURU uyarır, UYGULA ENGEL olur. Düzeltme `-LisansSunucusuYaz` ile yapılır: plan kalemi olur, `-GeriAl` geri alır.
  - Değer `LICENSE_SERVER_URL=kapali` ise yalnız uyarı verilir, geçiş dokunmaz.
- **Güncelleyici kaydı:** tek fark budur. Kayıt, setup'taki gibi aynı dizini (`%ProgramData%\TeksERP`) `--veri` ile AÇIKÇA alır.
- **Şema:** veritabanında pakette olmayan BİTMİŞ bir göç varsa (şema ileride) geçiş ENGEL olur. Göçler okunamazsa da ENGEL olur. Ölçüt ad kümesidir, sayı değil; ortak çekirdek `deploy/hizmet/sema-hizasi.ps1`, güncelleyici ve setup ile tek kural.
- **PIN/kart özeti:** §1 madde 5 (G21-K).

Ölçüm, sonekli kanallar için: thinkpad-1 geçişli kurulumunun `.env`inde `LICENSE_SERVER_URL` yok, kurulum üretim satıcısına bakıyor.
- testfabrika (`lisans-test`) geçişinde `-LisansSunucusuYaz` gerekir.
- demofabrika'nın kanal değeri üretim satıcısıdır, yani varsayılanla aynı; orada satır gerekmez.

## 9. demofabrika

2026-10-02'de **2.13.0 ile pm2 düzeninde** kurulur (`ilk-kurulum.ps1` + `kur.ps1`). 2.13.0 Dağıtım v2 ÖNCESİDİR (hizmet ikilileri yok) ⇒ önce `kur.ps1 -Paket` ile Dağıtım v2 paketine pm2 düzeninde geçilir, sonra bu runbook aynen.

Farklar:
- pm2 adı `tekserp-backend-demofabrika`.
- Hizmet adı **`TeksERP-Backend-demofabrika`**: paketin `PAKET.json` `backendHizmetAdi`ından gelir (kanal kaydı `backend.hizmetAdi`). `-HizmetAdi` verilirse aynı olmalı.
- Güncelleyici `TeksERP-Guncelleyici-demofabrika`, veri kökü `%ProgramData%\TeksERP-demofabrika`: setup'la aynı türetme. `ayar.json` `backendHizmeti` backend hizmet adıdır.
- Lisans satıcısı satırı yazılmaz (§8).
- Hazırlık kanalı (terfi yok).

Kök, PostgreSQL hizmeti ve görev adları kurulum günü ölçülür ve buraya yazılır.

## 10. Bilinen sınırlar (pencereden önce bilinmeli)

- Mantık sahte-Windows harness'iyle (`test_gecis` §3) ve thinkpad-1'de gerçek Windows'ta (D8c Senaryo 4: gerçek SCM · icacls · junction · pm2 · güvenlik duvarı) ölçüldü. Provanın bulduğu kusurlar:
  - **(a) Kimlik yarışı:** harness bunu görmüyordu. Gerçek backend `/health` UP iken kurulum kimliği önbelleği henüz boştu; tek atışlık okuma 9. kalemde "kurulum kimligi farkli ya da okunamadi" deyip geçişi otomatik geri aldırdı. Düzeltme: yoklama + harness `KIMLIK_GEC`/`KIMLIK_FARKLI` (`test_gecis` §3f2).
  - **(b) Harici PG bağımlılığı:** durum ölçümü bunu bilmiyordu, yanlış UYUMSUZ verdi. Düzeltme: plan PG'yi taşır (`test_gecis` §3d).
  - **(c) `pm2-boot.cmd`:** `setlocal` vardı ve `pm2.cmd` `call`sız çağrılıyordu (§2). Düzeltme: `call`lı çağrı (`test_sunucu_betikleri` §10e2).
  - **(d) Basılan komut:** "Uygulamak icin" `-ProvaKabul`/`-PaketOzeti` taşımıyordu (§3). Düzeltildi: D8e 2a.
  - **(e) Güncelleyici adı ve veri kökü:** her kanalda SONEKSİZ kuruluyordu. Artık paketin kanalından türer (§8, D8e 2a). thinkpad-1'deki prova kurulumu düzeltmeden önce kuruldu, soneksiz güncelleyiciyle.
- Doğrulama başlatmasında backend yalnız 127.0.0.1'i dinler (istemci yazısı yok) ama arka plan işleri bugün yine koşar (`TEKSERP_DOGRULAMA_KIPI`, D3 açığı); `/health` lisans alanı yok (D3 açığı) — lisans ölçümü panelden ve günlükten.
- `yapilandirma\.env`i backend (dotenv) ve güncelleyici (D2b'den beri dotenv'in birebir aynası) AYNI okur; geçiş yalnız değeri değişen satırı (ecosystem'in ezdiği değer, mutlaklaşan göreli yol) yeniden yazar, diğer satırlar bayt bayt kalır. Tırnaksız değerdeki `#` eskisi gibi yorumu başlatır (parola/adreste `#` varsa değeri tek tırnağa alın).
- Program kuralına dayanan güvenlik duvarı (node.exe'nin eski yolu) sayılmaz; plan PORT kuralı ekler.
