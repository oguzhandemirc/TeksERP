# Makine dışı yedek — kendi VPS'imize (çok fabrikalı)

> **Amaç:** fabrikanın gece yedeği, fabrikanın diskinden BAŞKA bir yerde de dursun.
> Bugün yedekler veritabanıyla aynı diskte; disk giderse geri dönülecek şey de gider.
>
> **Karar seti (kullanıcı, 2026-08-31):** kimlik IP ile değil **anahtarla** ·
> dosyalama çok fabrikalı ve okunur · içerik **şifreli**, dosya adları **açık** ·
> kurulum adım adım birlikte.

---

## Kim neye erişir (güven modeli)

Bu tablo mimarinin özetidir; kurulum adımları bunu zorlar.

| Taraf | Yapabildiği | Yapamadığı |
|---|---|---|
| **Fabrikanın sunucusu** (arka plan servisi) | Kendi klasörüne (`gelen/`) dosya bırakmak; bıraktığını görmek | Başka fabrikanın klasörüne bakmak · arşive ulaşmak · geçmişi yok etmek · dosyaları açmak (şifre onda değil) |
| **Fabrika personeli** | — | VPS'e giriş yapmak (kabuk yok, oturum yok, parola yok) |
| **Siz (satıcı)** | Arşivi okumak, indirmek, şifreyi açmak, geri yüklemek | — |

**Fabrika personeli VPS'e erişmez.** Bağlanan şey insan değil, arka plandaki
yedek servisidir; onun anahtarı kabuk açamaz (`internal-sftp`), yalnız kendi
klasörünü görür (`ChrootDirectory`) ve o klasörde bulduğu tek şey kendi
gönderdiği dosyalardır — zaten fabrikanın kendi diskinde de duran, üstelik
**şifreli** dosyalar. Yani o anahtarla hiçbir yeni bilgi elde edilemez.

⚠️ **Şifreyi yalnız siz taşıyorsanız, yedeği yalnız siz açabilirsiniz.** Bu
istenen şeydir ama bir yükümlülük doğurur: size ulaşılamazsa fabrika bu
kopyalardan dönemez. Fabrikanın kendi diskinde 30 günlük yerel yedeği yine durur
(bu kopya onun *ikinci* hattıdır), ama disk de gitmişse tek yol sizsiniz.
Sözleşmede karşılığı yoksa, mühürlü bir zarfta fabrika kasasına bir kopya
bırakmak dürüst orta yoldur.

---

## Neden bu tasarım (üç karar, üç gerekçe)

**① Kimlik anahtarla, IP'yle değil.** Fabrikanın internet IP'si değişebilir;
anahtar değişmez, iptal edilebilir ve *kimin* gönderdiğini kesin söyler. Yeni
fabrika = yeni anahtar + yeni klasör.

**② İçerik şifreli, dosya adı açık.** Yedek dosyası müşteri/fiyat listesinin
yanında **her operatörün PIN'ini ve kart kodunu DÜZ METİN** taşıyor
(`schema.prisma`: `quickPin`, `cardToken` — hash yok). VPS kiralık ve internete
açık bir makine; ele geçerse fabrikaya giriş de ele geçerdi. Dosya adlarını
şifrelemiyoruz ki "hangi fabrikadan ne zaman geldi" sunucuda gözle okunabilsin.

**③ Silme değil, kopya + anlık görüntü.** Yükleme `rclone copy` ile yapılır
(`sync` DEĞİL — kodda gerekçesi yazılı: `sync` yereli silineni uzaktan da
silerdi, yani fidye yazılımı offsite kopyayı da imha ederdi). Buna ek olarak VPS
her gece `gelen/` içeriğinin **sabit-bağ (hardlink) anlık görüntüsünü** yalnız
`root`'un eriştiği arşive alır. Fabrikanın anahtarı ele geçse bile geçmiş durur.

> ⚠️ **Neden "taşıma" değil "anlık görüntü":** dosyaları `gelen/`den taşısaydık,
> fabrikanın `rclone`u onları uzakta bulamayıp **her saat yeniden yüklerdi**.
> Sabit bağ ile dosya iki yerde birden görünür, disk maliyeti sıfırdır ve
> `gelen/` budandığında arşiv kopyası yaşamaya devam eder.

---

## Kapasite

Saha veritabanı **33 MB** (ölçüldü 2026-08-31) → sıkıştırılmış yedek ~5–15 MB.
Aylık ~450 MB. On fabrika × bir yıl bile birkaç GB. Saklama konusunda cömert
olabiliriz.

---

## Dosya düzeni

```
/srv/tekserp-yedek/                     ← chroot kökü (root'a ait, yazılamaz)
└── yedek-adnansahin/
    └── gelen/                          ← fabrika YALNIZ buraya yazar
        tekserp_2026-08-31_0200.dump    ← içerik şifreli, ad açık

/srv/tekserp-arsiv/                     ← YALNIZ root
└── adnansahin/2026/08/
    tekserp_2026-08-31_0200.dump        ← gelen/ ile sabit bağ (disk maliyeti ~0)
    INDEX.tsv                           ← tarih · dosya · boyut · sha256 · varış
DURUM.txt                               ← tüm fabrikalar: son yedek, yaş, boyut
```

Yeni fabrika eklemek: yeni kullanıcı + klasör + anahtar. Güncelleme sunucusunda
zaten kullanılan `/<müşteri>/<ürün>/` düzeninin aynısı.

---

## KURULUM

> **Ne prova edildi, ne edilmedi (dürüst ayrım):**
> - ✅ **`rclone.conf` biçimi ve şifreleme davranışı GERÇEK `rclone` ile ölçüldü**
>   (v1.74.3, 2026-08-31). Aşağıdaki B4 bloğu olduğu gibi kabul edildi; içerik
>   şifreli çıktı, düz PIN/kart kodu/müşteri adı dosyada BULUNAMADI; yanlış
>   parolayla açma denemesi "bad password" ile reddedildi (kontrolün körlük
>   zemini). Doğru parolayla içerik birebir geri okundu.
> - ⚠️ **VPS ve Windows adımları prova EDİLMEDİ** (bu makinede VPS erişimi ve
>   Windows yok). Adım adım birlikte koşacağız; her adımın sonunda bir DOĞRULAMA
>   var — o geçmeden ilerlemeyin.
>
> ⚠️ **ÖLÇÜLDÜ: `rclone` şifreli dosyaya `.bin` soneki ekler.** Sunucuda dosya
> `tekserp_2026-08-31_0200.dump**.bin**` olarak görünür — ad hâlâ okunur ("kim,
> ne zaman" bilgisi durur), yalnız uzantı değişir. Geri yüklerken `rclone` bunu
> kendisi çözer; `.bin`i elle silmeyin.

### A) VPS tarafı — bir kez (`sudo`)

> **HEDEF SUNUCU (2026-08-31'de ölçüldü):** `mail.fztmehmetilhan.com`
> (91.217.119.138, SSH portu **2222**, kullanıcı `oguzhan`, parolasız `sudo` var).
> Ubuntu 22.04.5 · kökte 41 GB boş · `tekserp-guncelleme` ve `tekserp-demo`
> konteynerleri burada.
>
> ⚠️ **PAYLAŞIMLI MAKİNE:** aynı sunucuda başka müşterilerin WordPress siteleri,
> `postgres`, `mariadb`, `redis` ve `traefik` koşuyor. Bu, şifrelemeyi
> "iyi olur"dan "şart"a çıkarır: o sitelerden biri ele geçse bile yedek dosyası
> anlamsız bir blok olarak kalır.

#### Ölçülmüş üç tuzak (hepsi sessiz arıza üretirdi)

| Tuzak | Neden sessiz | Ölçüm |
|---|---|---|
| **`AllowUsers oguzhan`** | Sunucuda YALNIZ bu kullanıcı giriş yapabiliyor. Yeni yedek kullanıcısı açılsa bile kapıdan dönerdi; kurulum "bitti" görünürdü. | `00-hardening.conf` okundu |
| **`Match Group` doğrulanamaz** | Kullanıcı henüz yokken grup da yok → `sshd -T` bloğun ateşlemediğini gösterdi. Kurulum sonrası "acaba çalışıyor mu" belirsiz kalırdı. | `sshd -T -C user=…` |
| **`sshd -t` yeterli sanmak** | Sözdizimi kontrolü ETKİN AYARI göstermez. İki farklı yapılandırmayı da "geçerli" dedi. | aşağıdaki A5 |

⚠️ **İki tahminim ÖLÇÜMLE ÇÜRÜDÜ, kayda geçiyorum:** ① `Subsystem sftp` satırının
`Match` bloğunun içine düşüp sshd'yi kıracağını sandım — kırmadı; ② naif `Match`
bloğunun genel ayarları bozacağını sandım — `sshd -T` çıktısı canlıyla birebir
aynı çıktı. Yine de `Match all` ile kapatıyoruz: maliyeti sıfır, ileride
`Include` sırası değişirse koruma yerinde kalır.

```bash
# A1. Dizinler. ⚠️ chroot kökü root'a ait ve başkasınca YAZILAMAZ olmak ZORUNDA.
sudo mkdir -p /srv/tekserp-yedek /srv/tekserp-arsiv
sudo chown root:root /srv/tekserp-yedek /srv/tekserp-arsiv
sudo chmod 755 /srv/tekserp-yedek
sudo chmod 700 /srv/tekserp-arsiv          # arşiv YALNIZ root

# A2. Fabrika kullanıcısı (kabuk YOK, ev dizini chroot kökü)
sudo groupadd -f yedek
sudo useradd -r -g yedek -s /usr/sbin/nologin -M \
     -d /srv/tekserp-yedek/yedek-adnansahin yedek-adnansahin
sudo mkdir -p /srv/tekserp-yedek/yedek-adnansahin/gelen
sudo chown root:root          /srv/tekserp-yedek/yedek-adnansahin
sudo chmod 755                /srv/tekserp-yedek/yedek-adnansahin
sudo chown yedek-adnansahin:yedek /srv/tekserp-yedek/yedek-adnansahin/gelen
sudo chmod 700                /srv/tekserp-yedek/yedek-adnansahin/gelen

# A3. Anahtarlar chroot'un DIŞINDA (fabrika kendi anahtarını değiştiremesin)
sudo mkdir -p /etc/ssh/yedek-anahtarlari && sudo chmod 755 /etc/ssh/yedek-anahtarlari
```

```bash
# A4a. ⚠️ ÖNCE giriş listesini genişlet — TEK SATIR hâlinde (iki ayrı AllowUsers
#      satırı yazma; ilk satır kazanır ve yenisi sessizce yok sayılabilir).
sudo cp /etc/ssh/sshd_config.d/00-hardening.conf /etc/ssh/sshd_config.d/00-hardening.conf.yedek
sudo sed -i 's|^AllowUsers oguzhan$|AllowUsers oguzhan yedek-*|' /etc/ssh/sshd_config.d/00-hardening.conf

# A4b. Yedek kullanıcısının kuralı. `Match User` (Group DEĞİL) — kullanıcı
#      yokken bile doğrulanabilir; `Match all` bloğu kapatır.
sudo tee /etc/ssh/sshd_config.d/90-tekserp-yedek.conf >/dev/null <<'EOF'
Match User yedek-*
  ChrootDirectory /srv/tekserp-yedek/%u
  ForceCommand internal-sftp
  AllowTcpForwarding no
  PermitTTY no
  AuthorizedKeysFile /etc/ssh/yedek-anahtarlari/%u
Match all
EOF
```

```bash
# A5. ⚠️ ASIL KAPI — `sshd -t` YETMEZ, ETKİN AYARI karşılaştır.
sudo sshd -t && echo "sözdizimi OK"
echo "--- yedek kullanıcısı: hapis + zorunlu sftp GÖRÜNMELİ ---"
sudo sshd -T -C user=yedek-adnansahin,host=t,addr=1.2.3.4 \
  | grep -E '^(chrootdirectory|forcecommand|permittty|authorizedkeysfile)'
echo "--- normal kullanıcı: hepsi none/yes KALMALI ---"
sudo sshd -T -C user=oguzhan,host=t,addr=1.2.3.4 \
  | grep -E '^(chrootdirectory|forcecommand|permittty|subsystem)'
```

**DOĞRULAMA A (geçmeden ilerleme):** yedek kullanıcısında
`chrootdirectory /srv/tekserp-yedek/%u` + `forcecommand internal-sftp`,
normal kullanıcıda `chrootdirectory none` + `forcecommand none`.
Beklenen çıkmazsa: `sudo cp …00-hardening.conf.yedek …00-hardening.conf`,
`sudo rm …90-tekserp-yedek.conf` — **reload ETME**.

```bash
# A6. Ancak DOĞRULAMA A geçtiyse:
sudo systemctl reload ssh
# ⚠️ Bu terminali KAPATMA. Yeni bir pencerede `ssh yenisunucu` ile giriş
# yapabildiğini teyit et; edemiyorsan açık terminalden geri al.
```

### B) Fabrika sunucusu — bir kez

```powershell
# B1. rclone (yoksa): https://rclone.org/downloads/ → Windows AMD64
#     rclone.exe → C:\Etkili-Yazilim\rclone\rclone.exe

# B2. Bu fabrikaya ait anahtar (parolasız — servis kendi kendine koşar)
ssh-keygen -t ed25519 -N "" -C "tekserp-yedek-adnansahin" `
  -f C:\Etkili-Yazilim\backups\vps_yedek_key
type C:\Etkili-Yazilim\backups\vps_yedek_key.pub    # ← çıktıyı bana/VPS'e verin
```

**A3'e dönüş (VPS, root):** yukarıdaki `.pub` içeriğini tek satır olarak
`/etc/ssh/yedek-anahtarlari/yedek-adnansahin` dosyasına yazın, `chmod 644`.

```powershell
# B3. Şifreleme parolası — birlikte üretilir, parola yöneticisine + kasaya yazılır.
#     rclone parolayı düz saklamaz; "obscure" edilmiş hâlini ister:
C:\Etkili-Yazilim\rclone\rclone.exe obscure "<parola>"
```

```ini
; B4. C:\Etkili-Yazilim\backups\rclone.conf
[vps]
type = sftp
host = <VPS-IP>
user = yedek-adnansahin
key_file = C:\Etkili-Yazilim\backups\vps_yedek_key
; ⚠️ Kabuk YOK (internal-sftp): rclone kabuk komutu denemesin.
shell_type = none
md5sum_command = none
sha1sum_command = none

[yedek]
type = crypt
remote = vps:gelen
; ⚠️ Dosya adları AÇIK kalsın — "kim, ne zaman" sunucuda okunabilsin.
filename_encryption = off
directory_name_encryption = false
password = <B3'ün ÇIKTISI>
```

```javascript
// B5. ecosystem.config.js (sunucununki) → env
BACKUP_RCLONE_CONFIG: "C:/Etkili-Yazilim/backups/rclone.conf",
BACKUP_RCLONE_BIN:    "C:/Etkili-Yazilim/rclone/rclone.exe",
BACKUP_RCLONE_REMOTE: "yedek:",
// pm2 restart gerekir. ⚠️ kur.ps1 bu dosyayı KORUYOR (2026-08-29) ama pakette
// YENİ bir anahtar gelirse elle eklenir — deploy sonrası kontrol listesine bakın.
```

**DOĞRULAMA B:** Panel → Sistem → Yedekler → *Makine dışı kopya* →
**"Bağlantıyı test et"** yeşil olmalı. Sonra **"Şimdi kopyala"** → VPS'te
`/srv/tekserp-yedek/yedek-adnansahin/gelen/` dolmalı.

### C) VPS tarafı — arşivleme ve saklama (root cron)

`/usr/local/bin/tekserp-yedek-arsivle.sh` her gece koşar:
`gelen/` içeriğini `/srv/tekserp-arsiv/<müşteri>/<yıl>/<ay>/` altına **sabit
bağla** kopyalar, `INDEX.tsv`ye satır ekler, `DURUM.txt`yi tazeler, `gelen/`i
N günden eskiler için budar (arşiv kopyası yaşamaya devam eder).

### D) Provası — kurulum bitmiş sayılmaz

VPS'ten bir dosya indirilip **şifresi açılarak** geri yüklenmeli:
`rclone copy yedek:<dosya> .` → `pg_restore` → doğrulama.
Aksi hâlde "yedek var" ile "yedekten dönülüyor" ayrı iddialar olarak kalır
(bkz. [`YEDEK-GERI-YUKLEME-TATBIKATI.md`](YEDEK-GERI-YUKLEME-TATBIKATI.md)).
