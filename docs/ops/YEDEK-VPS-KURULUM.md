# Makine dışı yedek — kendi VDS'imize (çok fabrikalı)

> **DURUM: SUNUCU TARAFI KURULDU ve ÖLÇÜLDÜ — 2026-09-01.**
> Kalan tek adım fabrika sunucusuna rclone kurulumu (§B).

Sunucu: **`80.253.255.188`** (`tekserp-vds`, Ubuntu 24.04 LTS) — güncelleme
yayınıyla aynı makine, ayrı kullanıcılar ve ayrı dizin ağaçlarıyla.

**Amaç:** fabrikanın gece yedeği, fabrikanın diskinden BAŞKA bir yerde de dursun.
Öncesinde yedekler veritabanıyla aynı diskteydi; disk giderse geri dönülecek şey
de giderdi. Fidye yazılımı ayrıca standart olarak **önce yedek klasörünü**
hedefler ve orada saldırgan için tek bir hedef vardı.

**Karar seti (kullanıcı):** kimlik IP ile değil **anahtarla** · dosyalama çok
fabrikalı ve okunur · içerik **şifreli**, dosya adları **açık** · saklama
**30 gün günlük + 12 ay aylık** · uyarı şimdilik yalnız panelde.

---

## Kim neye erişir (güven modeli)

| Taraf | Yapabildiği | Yapamadığı |
|---|---|---|
| **Fabrikanın sunucusu** (arka plan servisi) | Kendi `gelen/` klasörüne dosya bırakmak; bıraktığını görmek | Başka fabrikanın klasörüne bakmak · arşive ulaşmak · geçmişi yok etmek · dosyaları açmak (şifre onda değil) |
| **Fabrika personeli** | — | Sunucuya giriş yapmak (kabuk yok, oturum yok, parola yok) |
| **Siz (satıcı)** | Arşivi okumak, indirmek, şifreyi açmak, geri yüklemek | — |
| **Sunucuyu ele geçiren** | Şifreli blobları görmek | Onları açmak — çözme parolası sunucuda YOK |

**Ölçüldü (2026-09-01):** fabrika kullanıcısı `/srv/tekserp-arsiv` ve `/etc`
dizinlerini göremiyor (`Can't ls: not found`), chroot kökünde yalnız `gelen/`
görüyor, kabuk isteği `This service allows sftp connections only` ile
reddediliyor.

⚠️ **Şifreyi yalnız siz taşıyorsanız, yedeği yalnız siz açabilirsiniz.** Bu
istenen şeydir ama bir yükümlülük doğurur: size ulaşılamazsa fabrika bu
kopyalardan dönemez. Fabrikanın kendi diskinde 30 günlük yerel yedeği yine durur
(bu kopya onun *ikinci* hattıdır), ama disk de gitmişse tek yol sizsiniz.
Sözleşmede karşılığı yoksa, mühürlü bir zarfta fabrika kasasına bir kopya
bırakmak dürüst orta yoldur.

---

## Neden bu tasarım (dört karar, dört gerekçe)

**① Kimlik anahtarla, IP'yle değil.** Fabrikanın internet IP'si değişebilir;
anahtar değişmez, iptal edilebilir ve *kimin* gönderdiğini kesin söyler. Her
fabrikanın kendi kullanıcısı (`fab-<fabrika>`) ve kendi anahtarı olur.

**② `rclone copy` — `sync` DEĞİL.** `sync` hedefi kaynağa eşitler: yereldeki
dosya silinir/şifrelenirse uzaktaki de gider, yani fidye yazılımı offsite
kopyayı da imha eder. `copy` yalnız **ekler**. Bu kural
`offsite-backup.helper.ts`te de yazılıdır; orada uzaktan silen tek satır yok.

**③ İçerik kilitli, dosya adları açık.** Sunucuda *"kimin hangi yedeği ne zaman
gelmiş"* tek bakışta okunur — çok fabrikalı düzende asıl işletme ihtiyacı bu.
İçerik anahtarsız işe yaramaz.
**Ölçüldü:** kaynak `62aadd8d…` · sunucudaki ham içerik `c825b5bd…` (farklı →
gerçekten şifreli) · doğru parolayla `62aadd8d…` · yanlış parolayla
`failed to authenticate decrypted block`.

**④ Arşiv SERT KOPYA, hardlink değil.** Hardlink yer kazandırırdı ama aynı
inode'u paylaştığı için SFTP ile **yerinde kırpılan** bir dosya arşivdeki
kopyayı da bozardı. Yedek sisteminde çalışma kopyası ile arşiv aynı baytları
paylaşmamalı. Maliyet fabrika başına ~0,5 GB — 59 GB'lık diskte önemsiz.

---

## ⚠️ Ölçümle öğrenilen üç tuzak

Tahmin değil — kurulum sırasında **fiilen ısırdı**:

| Tuzak | Belirti | Çözüm |
|---|---|---|
| **crypt varsayılan son eki** | Dosya sunucuya `…dump.bin` düşer; arşivleme script'inin `*.dump` süzgeci onu **hiç görmez**, yedek sessizce arşivlenmez | `suffix = none` |
| **`known_hosts` tek anahtar tipi** | `knownhosts: key mismatch` — dosyada yalnız ed25519 varken sunucu ecdsa/rsa sunuyor | `ssh-keyscan` çıktısının **tamamını** al (üç tip) |
| **Arşiv `gelen/`den TAŞIRSA** | `rclone copy` dosyayı "eksik" görüp her gece **yeniden yükler**; panelin `missingCount` sayacı kalıcı kırmızıya döner | Arşiv **kopyalar**, taşımaz; `gelen/` yalnız 35 günden eskiyi budar (fabrika onu zaten silmiştir) |

---

## Kapasite

Dump ~10 MB (saha DB'si 33 MB, sıkıştırılmış custom format). **30 gün günlük +
12 ay aylık** → fabrika başına **~0,5 GB**; `gelen/` aynası ~0,3 GB. On fabrika
bile ~8 GB.

> ℹ️ Fabrikanın kendi diski de 30 gün tutuyor (`BACKUP_RETENTION_DAYS=30`).
> Sunucudaki kopya günlük pencerede **derinlik değil, makine bağımsızlığı**
> ekler; derinliği 12 aylık kopyalar verir. Uzatmak tek satır:
> `/usr/local/sbin/tekserp-yedek-arsivle` → `GUNLUK_SAKLA` / `AYLIK_SAKLA`.

---

## Dosya düzeni

```
/srv/tekserp-yedek/adnansahin/          ← chroot KÖKÜ (root:root 755)
└── gelen/                              ← fabrika buraya YAZAR (fab-adnansahin 755)

/srv/tekserp-arsiv/adnansahin/          ← root:root 750 — fabrika ERİŞEMEZ
├── gunluk/2026-09-01/tekserp_20260901_020000.dump
├── aylik/2026-09/tekserp_20260901_020000.dump
├── INDEX.tsv    dosya · boyut · sha256 · geliş anı · gün · arşiv yolu
└── DURUM.txt    son yedek · kapsanan gün · eksik gün · bütünlük · arşiv boyutu
```

Yeni fabrika = aynı iki ağaca bir dizin + bir kullanıcı + bir anahtar.
Arşivleme script'i `/srv/tekserp-yedek/*/` üzerinde döner, **elle liste tutmaz**.

---

## A) Sunucu tarafı — KURULDU

```bash
# A1. Dizinler. ⚠️ chroot kökü root'a ait ve başkasınca YAZILAMAZ olmak ZORUNDA
#     (aksi halde sshd "bad ownership or modes" ile reddeder).
mkdir -p /srv/tekserp-yedek/adnansahin/gelen
chown root:root /srv/tekserp-yedek /srv/tekserp-yedek/adnansahin
chmod 755       /srv/tekserp-yedek /srv/tekserp-yedek/adnansahin
mkdir -p /srv/tekserp-arsiv/adnansahin/{gunluk,aylik}
chown -R root:root /srv/tekserp-arsiv && chmod -R 750 /srv/tekserp-arsiv

# A2. Fabrika kullanıcısı — kabuk YOK
useradd --system --no-create-home \
  --home-dir /srv/tekserp-yedek/adnansahin --shell /usr/sbin/nologin fab-adnansahin
chown fab-adnansahin:fab-adnansahin /srv/tekserp-yedek/adnansahin/gelen

# A3. Anahtar chroot'un DIŞINDA — fabrika kendi anahtarını değiştiremesin
mkdir -p /etc/ssh/yedek-anahtarlari
# <açık anahtar> → /etc/ssh/yedek-anahtarlari/fab-adnansahin  (root:root 644)

# A4a. ⚠️ ÖNCE giriş listesi — TEK SATIR. İkinci bir AllowUsers satırı yazma:
#      ilk satır kazanır, yenisi sessizce yok sayılır ve fabrika giremez.
#      00-hardening.conf → AllowUsers oguzhan yayinci fab-adnansahin
```

`/etc/ssh/sshd_config.d/90-tekserp-yedek.conf`:

```
Match User fab-adnansahin
    ChrootDirectory /srv/tekserp-yedek/adnansahin
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    PasswordAuthentication no
    PubkeyAuthentication yes
    AuthorizedKeysFile /etc/ssh/yedek-anahtarlari/%u
Match all
```

⚠️ `Match User` (Group DEĞİL): kullanıcı yokken de doğrulanabilir ve
`sshd -T -C user=…` ile **ölçülebilir**. `Match all` bloğu KAPATIR — yoksa
ayarlar sonraki dosyalara sızar.

### ⚠️ A5 — ASIL KAPI: `sshd -t` YETMEZ

`sshd -t` yalnız sözdizimine bakar. Kuralın **kime** uygulandığını ve bizi
bozmadığını ancak etkin ayar söyler:

```bash
sshd -t
sshd -T -C user=fab-adnansahin | grep -iE 'chroot|forcecommand|authorizedkeys'
sshd -T -C user=oguzhan        | grep -iE 'chroot|forcecommand'   # none olmalı
```

**Ölçüldü:** fabrika kullanıcısı chroot + `internal-sftp` alıyor; `oguzhan`
`chrootdirectory none` / `forcecommand none` — `Match all` doğru kapatmış.

> ⚠️ Reload'dan sonra **mevcut terminali KAPATMA**; yeni pencerede
> `ssh tekserp-vds` ile girebildiğini teyit et. Giremiyorsan açık terminalden
> `/root/00-hardening.conf.yedek-*` dosyasını geri koy ve reload et.

---

## B) Fabrika sunucusu — YAPILACAK (tek kalan adım)

Kurulum paketi: **`~/Documents/TeksERP-VDS-Kurulum/fabrika-adnansahin/`**
(depo DIŞINDA — özel anahtar git'e girmez). Klasörü fabrika sunucusuna kopyala,
**içinden** yönetici PowerShell'de:

```powershell
.\kur-yedek.ps1
```

Script beş adımı sırayla yapar: rclone (yoksa indirir) → yapılandırma + anahtar
→ **bağlantı ve YAZMA sınaması** → `ecosystem.config.js` → `pm2 restart`.

⚠️ **Sıra bilinçli: yapılandırmaya ancak sınama geçtiyse dokunulur.** Ters
sırada, çalışmayan bir hedefle pm2 yeniden başlar ve gece yedeği sessizce
hiçbir yere gitmez. Okuma sınaması da yetmez — yazma izni ayrıca kanıtlanır.

⚠️ **Ayarlar `.env`de DEĞİL, `ecosystem.config.js`te yaşar** (`C:\TeksERP\app\`).
O dosya **sunucunundur, paketin değil** (denetim 2026-08-29, BULGU-T1-020): paketteki
kopya repo varsayılanlarını taşır ve her kurulum sahadaki ayarı sessizce geri
alıyordu — gece yedeği ve makine dışı kopya, güncelleme yapılan gece kapanıyordu.
Script dosyayı yedekler, düzenler ve `node --check` ile doğrular; sözdizimi
bozulursa **geri alır** (bozuk ecosystem pm2'yi hiç başlatmaz).

⚠️ `--config` **açıkça** verilmek zorunda. Verilmezse rclone, pm2'nin koştuğu
Windows hesabının profilini (`%APPDATA%\rclone\rclone.conf`) okur ve
yapılandırmayı bulamaz — sessiz başarısızlık.

**Son adım panelde:** Sistem → Yedekler → Makine Dışı Yedek → hedef `yedek:` →
"Bağlantıyı test et" + "Şimdi kopyala". Kartta **eksik: 0** görünmeli.

> ℹ️ Hedefin yetkili kaynağı **panel ayarıdır** (`readOffsiteRemote`); ortam
> değişkeni yalnız yedektir. Süpürücünün açılış uyarısı yalnız ortam değişkenine
> bakar ve DB'ye gidemez (boot'ta koşar) — bu yüzden metni koşullu yazıldı.
> Script ikisini de aynı değere ayarlar, böylece uyarı hiç doğmaz.

**Fabrika tarafında yeni kod YAZILMAZ.** Süpürücü, motor, uçlar ve panel kartı
2026-08-10 denetiminde yazıldı ve duruyor:
`src/jobs/offsite-sweeper.ts` · `src/services/helpers/offsite-backup.helper.ts` ·
`src/routes/admin.routes.ts` (`/backups/offsite`, `/test`, `/sweep`) ·
`Electron/src/pages/System/Backups/OffsiteBackupCard.tsx`

---

## C) Sunucu tarafı — arşivleme, doğrulama, budama

`/usr/local/sbin/tekserp-yedek-arsivle`, `/etc/cron.d/tekserp-yedek` ile
**15 dakikada bir**:

1. `gelen/`deki yeni `*.dump` dosyalarını bulur (INDEX'te olanı atlar)
2. Hâlâ yükleniyor olabileceği için boyutu **20 sn arayla iki kez ölçer**
3. sha256 hesaplar, `gunluk/<gün>/` altına **kopyalar**
4. Ayın ilk yedeğini ayrıca `aylik/<ay>/` altına kopyalar
5. `INDEX.tsv`e satır ekler
6. Budar: günlük >30 gün · aylık >12 ay · `gelen/` >35 gün
7. Arşivin tamamını sha256 ile **yeniden doğrular**, `DURUM.txt` yazar

### ⚠️ Bütünlük ≠ Geçerlilik

Sunucu şifreli blobu **açamaz** (anahtar burada yok, bilinçli). Buradaki kontrol
baytın bozulmadığını söyler, dump'ın **açılabildiğini** söylemez — o fabrikada
`verifyBackupFile` (`pg_restore --list`) ile ölçülür. Ayrım `DURUM.txt`in
altında yazılıdır; yanlış güven üretmemek için oradan silinmemeli.

---

## D) Provası — kurulum bitmiş sayılmaz

**Denenmemiş yedek, yedek değildir.** Sunucudan bir yedek indirilir, şifresi
çözülür ve **kopya veritabanına** yüklenir (`db-copy.service.ts` — canlı DB'ye
asla dokunulmaz). Reçete:
[`YEDEK-GERI-YUKLEME-TATBIKATI.md`](YEDEK-GERI-YUKLEME-TATBIKATI.md)

```bash
rclone --config <conf> copy yedek:tekserp_YYYYMMDD_HHMMSS.dump ./
```

---

## Negatif sondalar — koruma gerçekten kırmızı verebiliyor mu

Kırmızı verebildiği kanıtlanmamış bir bekçi, bekçi değil süstür.
**2026-09-01'de üçü de koşuldu ve geçti:**

| Sonda | Yapılan | Sonuç |
|---|---|---|
| **A — silme** | Fabrika kullanıcısı `gelen/`den dosyayı SFTP ile sildi | Arşiv kopyası **sağ kaldı** (3.000.000 bayt) — fidye yazılımı senaryosunun karşılığı |
| **B — bozulma** | Arşivdeki dosyanın 100. baytı değiştirildi | `DURUM.txt`: **"1 dosya kontrol edildi, 1 BOZUK"** |
| **C — yanlış parola** | crypt yanlış parolayla okundu | `failed to authenticate decrypted block` |

Script'i değiştirirsen **üçünü de tekrarla**.

---

## Geri dönüş

```bash
rm /etc/ssh/sshd_config.d/90-tekserp-yedek.conf
cp /root/00-hardening.conf.yedek-* /etc/ssh/sshd_config.d/00-hardening.conf
sshd -t && systemctl reload ssh
rm /etc/cron.d/tekserp-yedek
```

Arşiv silinmez — geri dönüş yalnız erişimi kapatır, veriyi değil.
