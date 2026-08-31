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

### A) VPS tarafı — bir kez (root)

```bash
# A1. Dizinler. ⚠️ chroot kökü root'a ait ve grup/başkası tarafından
#     YAZILAMAZ olmak ZORUNDA — sshd aksi hâlde bağlantıyı reddeder.
mkdir -p /srv/tekserp-yedek /srv/tekserp-arsiv
chown root:root /srv/tekserp-yedek /srv/tekserp-arsiv
chmod 755 /srv/tekserp-yedek
chmod 700 /srv/tekserp-arsiv          # arşiv YALNIZ root

# A2. Fabrika kullanıcısı (kabuk YOK)
groupadd -f yedek
useradd -r -g yedek -s /usr/sbin/nologin -M -d /srv/tekserp-yedek/yedek-adnansahin yedek-adnansahin
mkdir -p /srv/tekserp-yedek/yedek-adnansahin/gelen
chown root:root /srv/tekserp-yedek/yedek-adnansahin      # chroot içi kök: root
chmod 755        /srv/tekserp-yedek/yedek-adnansahin
chown yedek-adnansahin:yedek /srv/tekserp-yedek/yedek-adnansahin/gelen
chmod 700        /srv/tekserp-yedek/yedek-adnansahin/gelen

# A3. Anahtar dosyası chroot'un DIŞINDA (fabrika kendi anahtarını değiştiremesin)
mkdir -p /etc/ssh/yedek-anahtarlari && chmod 755 /etc/ssh/yedek-anahtarlari
# (fabrikanın AÇIK anahtarı buraya yazılacak — B2'den sonra)
```

```bash
# A4. sshd kuralı
cat > /etc/ssh/sshd_config.d/tekserp-yedek.conf <<'EOF'
Match Group yedek
  AuthorizedKeysFile /etc/ssh/yedek-anahtarlari/%u
  ChrootDirectory /srv/tekserp-yedek/%u
  ForceCommand internal-sftp
  PasswordAuthentication no
  AllowTcpForwarding no
  X11Forwarding no
  PermitTTY no
EOF
sshd -t && systemctl reload ssh      # ⚠️ `sshd -t` GEÇMEDEN reload ETMEYİN
```

**DOĞRULAMA A:** `sshd -t` sessiz çıkmalı. Çıkmazsa dosyayı silin, `reload`
etmeyin — bozuk yapılandırma ile reload SSH'ı tamamen kapatabilir.

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
