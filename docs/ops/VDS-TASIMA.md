# Güncelleme yayınını + yedekleri yeni VDS'e taşıma

> **Karar (kullanıcı, 2026-08-31):** güncelleme yayını ve yedekler, başka
> müşterilerin siteleriyle paylaşılan makineden **ayrı bir VDS'e** alınır.
> Demo şimdilik eski yerinde kalır.
>
> ## DURUM — 2026-09-01
>
> Sunucu kiralandı: **`80.253.255.188`** (`tekserp-vds`, Ubuntu 24.04.1 LTS,
> 2 çekirdek / 3 GB / 66 GB). Envanter: [`SUNUCU-ENVANTERI.md`](SUNUCU-ENVANTERI.md)
>
> | Adım | Durum |
> |---|---|
> | Sertleştirme (SSH · ufw · fail2ban · yamalar) | ✅ **bitti, ölçüldü** |
> | Docker + traefik + dizin düzeni | ✅ bitti |
> | Yayın dosyaları (356 MB) kopyalandı | ✅ **bayt bayt doğrulandı** |
> | DNS öncesi içerik doğrulaması (`Host` başlığı) | ✅ eski sunucuyla birebir |
> | Yedek mimarisi (SFTP hapsi · şifreleme · arşiv) | ✅ **bitti, negatif sondalı** |
> | Cloudflare Origin CA sertifikası | ✅ kuruldu — geçerlilik **2041-08-28** |
> | DNS çevirme | ✅ **çevrildi ve kanıtlandı** (iz, yeni sunucunun erişim kaydında) |
> | Yayın script'lerinin hedefi | ✅ `tekserp-yayin`e çevrildi (eskisi eski sunucuya yüklüyordu) |
> | Cloudflare SSL kipi → Full (strict) | ⏳ **kullanıcıda** |
> | Fabrikaya rclone kurulumu | ⏳ |
> | Geri yükleme provası | ⏳ |
> | Eski sunucudaki kopyayı kapat | ⏳ ~2026-09-08 |

## Neden

Ölçüldü (2026-08-31): Electron güncelleme paketi **imzasız**
(`build.win`'de sertifika yok; `ELECTRON-OTOMATIK-GUNCELLEME.md` de yazıyor).
Yani o klasöre dosya yazabilen biri, fabrikanın paneline **istediği kodu**
gönderebilir — panel indirip kurar, imza kontrolü olmadığı için fark edilmez.

O klasör bugün `mail.fztmehmetilhan.com` üzerinde ve aynı makinede başka
müşterilerin **WordPress** siteleri, `postgres`, `mariadb`, `redis` koşuyor.
WordPress internetteki en sık ele geçirilen yazılımdır. Yani en olası saldırı
yolu ile fabrikanın içine kod göndermek arasında yalnızca dosya izinleri var.

⚠️ **Taşıma riski AZALTIR, YOK ETMEZ.** Kalıcı çözüm kod imzalamadır: paket
imzalıysa sunucu ele geçse bile sahte güncelleme kurulmaz. Taşıma "ihtimali",
imzalama "sonucu" ortadan kaldırır — ikisi birbirinin yerine geçmez.

---

## Ne alındı (ve neden yeter — ölçüldü)

| | Alınan | Gerçek ihtiyaç |
|---|---|---|
| CPU | 2 çekirdek | Statik dosya servisi + gece kopyalama — işlemci neredeyse boşta |
| RAM | 3 GB | **0,5 GB**: nginx 17 MB + traefik 30 MB + işletim sistemi ~400 MB |
| Disk | 66 GB | Yayın 356 MB + yedek ~0,5 GB/fabrika/yıl |
| Ağ | 100 Mbit/s | Bir panel güncellemesi 141 MB ≈ 15 sn; Cloudflare önbelleği yükü ayrıca düşürür |
| OS | **Ubuntu 24.04.1 LTS** | 2029'a kadar destek (22.04 → 2027) |

Bellek rakamları tahmin değil, eski sunucuda `docker stats` ile ölçüldü.

## Taşınacaklar (ölçülmüş envanter)

```
/opt/stack/traefik/                      ← traefik + Origin CA sertifikası
│   traefik.yml · dynamic/ · certs/ · acme/
└─ (sertifika *.etkiliyazilim.com wildcard — yeni makinede aynen kullanılır)

/opt/stack/apps/tekserp-guncelleme/      ← 356 MB, TAMAMI statik
├── docker-compose.yml                   (nginx:alpine, ağ: web, Host kuralı)
├── nginx/
└── html/adnansahin/
    ├── electron/  141 MB                (TeksERP-<sürüm>-Setup.exe + blockmap + latest.yml)
    └── mobil/      74 MB                (ota/ + apk/)

YENİ (taşınmıyor, sıfırdan kurulur):
/srv/tekserp-yedek/   +  /srv/tekserp-arsiv/     ← YEDEK-VPS-KURULUM.md
```

**Taşınmıyor:** `tekserp-demo` (repodan derleniyor + ortak veritabanına bağlı;
ayrı ve daha zahmetli bir iş — istenirse sonra).

---

## Sıra — PAZARLIK DIŞI

> **Kural: önce kopyala ve doğrula, DNS'i EN SON çevir.**
>
> ⚠️ Ters sırada Cloudflare, henüz kopyalanmamış bir dosyanın **404'ünü bir
> hafta önbellekte tutar**. Bu tuzak bu projede bir kez yaşandı (147 MB'lık
> paket sunucuda dururken adres 404 döndü) — `MOBIL-UZAKTAN-GUNCELLEME.md`de
> kayıtlı.

### 1. Yeni sunucu hazırlanır
Docker + compose kurulur, `web` ağı oluşturulur, `/opt/stack` düzeni birebir
kopyalanır. SSH sertleştirmesi eski sunucudakiyle aynı olsun (`Port`,
`PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers`).

### 2. traefik + sertifika taşınır
`/opt/stack/traefik/` olduğu gibi kopyalanır. Sertifika **Cloudflare Origin CA**
ve `*.etkiliyazilim.com` wildcard'ı bu alt alan adını da kapsıyor → yeniden
sertifika almaya gerek YOK.
⚠️ **Cloudflare'de proxy (turuncu bulut) AÇIK kalmalı.** Origin CA'ya yalnız
Cloudflare Edge güvenir; DNS-only'ye çevrilirse `electron-updater` sertifikayı
reddeder ve güncelleme sessizce durur.

### 3. Yayın dosyaları kopyalanır (DNS DEĞİŞMEDEN)
`rsync` ile `tekserp-guncelleme/` yeni sunucuya taşınır, konteyner ayağa
kaldırılır.

**DOĞRULAMA 3 — DNS'e dokunmadan, `Host` başlığıyla doğrudan yeni IP'ye sor:**
```bash
curl -sk -H 'Host: guncelleme.etkiliyazilim.com' \
  https://<YENİ-IP>/adnansahin/electron/latest.yml | head -3
```
`version:` satırı eski sunucudakiyle **aynı** olmalı. Aynı değilse durun.

### 4. DNS çevrilir
Cloudflare'de `guncelleme` A kaydının IP'si yeni sunucuya alınır, **proxy açık**.

**DOĞRULAMA 4:**
```bash
curl -sI https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml
curl -sI "https://guncelleme.etkiliyazilim.com/adnansahin/electron/latest.yml?cb=$RANDOM"
```
İkisi de `200` dönmeli. `?cb=` ile sorulan istek önbelleği atlar — ikisi
farklıysa bayat önbellek var demektir.

### 5. Sahada tek bir doğrulama
Bir panelde **Yardım → Güncellemeyi denetle**. Adres değişmediği için hiçbir
panel/APK yeniden derlenmez; taşıma sahaya görünmez.

### 6. Eski sunucu — HEMEN SİLME
Yayın klasörü eski makinede **en az bir hafta** dursun (geri dönüş yolu: DNS'i
eski IP'ye çevirmek). Bir hafta sonra `tekserp-guncelleme` durdurulur ve klasör
silinir.

### 7. Yedekler kurulur
Yeni sunucuda [`YEDEK-VPS-KURULUM.md`](YEDEK-VPS-KURULUM.md) adım adım
uygulanır. O reçetedeki sshd tuzakları **yeni sunucuda da geçerlidir** —
`AllowUsers` satırı ve `sshd -T` doğrulaması atlanmamalı.

---

## Geri dönüş

Her adımın geri dönüşü tek hamle:

| Adım | Geri alma |
|---|---|
| 3 (kopyalama) | Yeni konteyneri durdur — canlıya hiç dokunulmadı |
| 4 (DNS) | Cloudflare'de IP'yi eski sunucuya çevir; proxy açık kalsın |
| 7 (yedek) | `sshd_config.d/90-tekserp-yedek.conf` sil + `00-hardening.conf.yedek` geri koy, `sshd -t` sonra reload |

## Taşıma sonrası — yol haritası

**Kod imzalama.** Taşıma, saldırganın o klasöre ulaşma ihtimalini düşürdü;
imzalama ulaşsa bile sonucu ortadan kaldırır. Sertifika alındığında
`build.win.certificateFile` + `forceCodeSigning: true` eklenir ve
`electron-updater` imzayı kendiliğinden doğrular. Bu belge o gün güncellenir.
