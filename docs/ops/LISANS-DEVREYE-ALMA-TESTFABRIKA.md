# Lisans devreye alma — testfabrika (thinkpad-1) runbook'u

> **Durum:** YAZILDI, UYGULANMADI (dilim R2, 2026-09-30). İniş A2 `origin/main`e indikten sonra bir operasyon ajanının ADIM ADIM izleyeceği tek kaynak. Sıra PAZARLIK DIŞIDIR (§1 → §9); bir adım kırmızıysa bir sonrakine geçilmez, §9'a bakılır.
>
> **Neden önce testfabrika:** kullanıcı kuralı — her sunucu işlemi ve lisans devreye alma önce kendi test sunucumuzda (thinkpad-1) uçtan uca ölçülür, kanıtla adnansahin'e taşınır; gözlem kipi → sonra zorlama (Faz 4, kullanıcı cümlesiyle). Takvim kapısı YOK: T4 gözlemi paralel koşar, fazı bekletmez.
>
> **İlgili:** satıcı kurulumu `docs/ops/SATICI-KURULUM.md` (§5 kurulum · §5b iç API · §7 doğrulama · §8 geri alma/sürüm yükseltme · §12 sudo'suz kurulum kaydı) · indirme kapısı `docs/ops/INDIRME-KAPISI-WORKER.md` (Worker kullanıcıda, bu runbook dışı) · korumalı paket `docs/ops/DEPLOY-RUNBOOK.md` §3c + `docs/design/KOD-KORUMA-OLCUM.md` §8 · kurallar `docs/kurallar/lisans.md`, `surum-yayin.md`, `deploy-kurulum.md` · patron bulutu kurulum runbook'u `patron/dagitim` dalında (`PATRON-BULUTU-KURULUM.md`; A2 ile iner — testfabrika'da patron bulutu YOK, §6.5).

## 0. Araçlar ve genel kurallar

| Araç | Ne yapar | Varsayılan |
|---|---|---|
| `node deploy/lisans-devreye/asama-dogrula.mjs --asama=<1..8\|hepsi>` | Her aşamanın SALT-OKUMA ölçümü; üç sonuç ✅ UYUMLU · ❌ IHLAL (DUR) · ⚠️ ÖLÇÜLEMEDİ (araç/erişim yok — uyumlu SAYILMAZ). Çıkış 0 · 1 · 2 (3 = betiğin salt-okuma sözleşmesi bozuk) | **KURU** — ağa çıkmaz, koşacağı ölçümleri basar; gerçek ölçüm `--olc` |
| `node deploy/lisans-devreye/t4-gozlem.mjs` | Senaryo T4 sürekli gözlem (yoklama başarı oranı · parmak izi kararlılığı · yanlış pozitif); `--ozet=<tsv>` ağsız özet | **KURU**; ölçüm `--olc` |
| `Teks-Erp-wt/testfabrika-araclar/tp.sh <betik.ps1>` | thinkpad-1'de PowerShell 5.1; önce Tailscale kimlik kapısı (100.70.47.46), tutmazsa 99 | — |
| `Teks-Erp-wt/vds-dogrula.sh` | adnansahin'e ait her VDS baytı tabanla AYNI mı (0 aynı · 1 fark · 2 ölçülemedi) | salt okuma |
| `node deploy/satici/portal-baglan.mjs` | Portal geri döngü kipinde Mac'ten SSH tüneli → `http://127.0.0.1:14611/portal/` | salt okuma dışı değil — tarayıcı oturumu |

Betik sözleşmesi bekçiyle ölçülür: `node scripts/test_lisans_devreye_kuru.mjs` (kuru kipte sıfır ağ/süreç girişimi; `--olc`ta bile yalnız GET/HEAD ve ssh/PowerShell salt-okuma izin listesi).

- **Her adımın dört satırı:** Komut · Beklenen · Doğrulama (`asama-dogrula` aşama no'su) · Geri alma. Doğrulayıcı ✅ vermeden "tamam" denmez; ⚠️ ÖLÇÜLEMEDİ bir hüküm değildir — nedeni giderilip yeniden ölçülür.
- **SSH hedefleri (ölçüldü 2026-09-30):** VDS = `ssh -p 2222 oguzhan@80.253.255.188` (docker grubunda; `sudo` parola ister ve etkileşimsiz oturumda verilemez → kök sahipli yazımlar tek seferlik yardımcı konteynerle, SATICI-KURULUM §12 kalıbı). Yayın diski = `ssh tekserp-yayin` (`yayinci`). Belgelerdeki `tekserp-vds` yukarıdaki açık hedeftir — `~/.ssh/config`'te bu ad YOK; oradaki `vds`/`vdsc` BAŞKA bir sunucudur (root), bu runbook'ta KULLANILMAZ.
- **Sır hijyeni:** hiçbir sır (kök/portal parolası, TOTP, pepper, iç API belirteci, etkinleştirme kodu, JWT) ekrana, argv'ye, log'a, sohbete yazılmaz; dosyalar 0600; değer yerine dosya YOLU ve ADLAR ölçülür. Sızıntı şüphesi = rotasyon (§9).
- **Yasak:** adnansahin (SAHINSRV, `tekserp_fabrika_*`, adnansahin kanalı) · Traefik'i yeniden başlatmak · başkasının konteyner/imaj/birimine dokunmak · `docker system prune` · `pm2` CLI'ını thinkpad-1'de SSH'tan koşmak (SYSTEM daemon'una bağlanamazsa kendi daemon'unu doğurur; pm2 işleri `uzaktan-kos.ps1` SYSTEM göreviyle).

## 1. Önkoşullar ve kapılar

**Doğrulama:** `node deploy/lisans-devreye/asama-dogrula.mjs --asama=1 --olc` → yedi satır ✅. Mesai dışı gerekmez (testfabrika bizim; adnansahin'e hiçbir yazım yok).

### 1.1 İniş A2 ve önkoşul borçları

- **Komut:** `git fetch && git log --oneline -1 origin/main` ve A2 dallarının indiğini ölç: `git merge-base --is-ancestor <2d ucu> origin/main` (2d modül şifreleme — `satici/sunucu/scripts/modul-anahtari.ts`, göç `20261001090000_modul_anahtari_kasasi`) · 2e-S (`butunluk-liste.txt`) · 3d-1/3d-2 · patron dağıtımı.
- **Beklenen:** hepsi ata ve §11'deki G1–G3 + G5'in kapanışı (iniş A2 I7) ata: `satici/sunucu/src/keys/server-secrets.ts` var (G1), `deploy/satici/Dockerfile` `dist-cli/scripts/modul-anahtari.js`'i `test -f`'ler (G2), `deploy/satici/docker-compose.yml` `/dosyalar` · `/derlemeler:ro` · `/yayin:ro` taşır (G3), `deploy/paketle.ps1` `-Sifrele` taşır (G5). Biri yoksa §2 KOŞULMAZ.
- **Geri alma:** yok (okuma).

### 1.2 vds-dogrula tabanı tazeliği (aşama 1.6 · 1.7)

`vds-dogrula.sh` sabit tabana (`Teks-Erp-wt/vds-taban-{adnansahin,kok,diger}.sha`) karşı ölçer. Taban son adnansahin yayınından ESKİYSE betik o yayını "FARK" diye basar (2026-09-30 ölçümü: taban 09-28 11:08, adnansahin 1.3.7 + OTA 09-28 22:09 → FARK; kurulumla ilgisi yok). Aşama 1.6 bunu ÖLÇÜLEMEDİ olarak ayırır.

- **Komut (yalnız 1.6 ⚠️ ise):** önce `vds-dogrula.sh` çıktısındaki HER farkın bilinen bir yayına ait olduğunu yayın defterinden doğrula (`ssh tekserp-yayin 'tail -3 /opt/stack/apps/tekserp-guncelleme/defter/adnansahin-YAYIN-DEFTERI.tsv'` + OTA dizin adları). Bilinmeyen fark varsa DUR (taban onu yutmasın). Sonra eskiyi kenara al ve aynı ölçümle yeni taban yaz:

  ```bash
  B=/Users/demirci/Documents/Projeler/Teks-Erp-wt; K=/opt/stack/apps/tekserp-guncelleme
  D=$B/vds-taban-$(date +%Y%m%d_%H%M)-onceki && mkdir -p $D && cp -p $B/vds-taban-{adnansahin,kok,diger}.sha $D/
  ssh -n tekserp-yayin "cd $K/html && find adnansahin -type f -print0 | sort -z | xargs -0 sha256sum" | sort -k2 > $B/vds-taban-adnansahin.sha
  ssh -n tekserp-yayin "cd $K/html && find electron -type f -print0 | sort -z | xargs -0 sha256sum" | sort -k2 > $B/vds-taban-kok.sha
  ssh -n tekserp-yayin "sha256sum $K/defter/adnansahin-YAYIN-DEFTERI.tsv $K/nginx/default.conf $K/docker-compose.yml" | sort -k2 > $B/vds-taban-diger.sha
  ```

- **Beklenen:** `vds-dogrula.sh` → `✅ adnansahin AYNI (<n> dosya)`; aşama 1.6 ✅.
- **Geri alma:** `cp -p $D/* $B/` (eski taban geri).

### 1.3 thinkpad-1 prizde, pwsh 7 var (aşama 1.3)

thinkpad-1 bir dizüstü: "Dengeli" planda pilde 60 dk girdisizlikte modern beklemeye girer, ~66 dk sonra ağı keser; SSH/WMI süreçleri güç isteği tutmaz (DEPLOY-RUNBOOK §3c, `lisans/entegrasyon` 2b-D2 notu). **Pilde uzun iş başlatılmaz; güç planı değiştirilmez.** Her uzun işin betiği de kendi başında aynı kapıyı koşar (§4.2).

- **Beklenen:** `guc=True`, `pwsh=True` (2026-09-30: PowerOnline True · pwsh 7.6.6, Store diğer adı `WindowsApps\pwsh.exe` — SYSTEM bağlamında YOKTUR; paketleme kullanıcı `oguzhan` olarak WMI ile koşar).
- **Geri alma:** yok. Pildeyse kullanıcıdan prize takmasını iste, bekle.

### 1.4 Satıcı ve Traefik tabanı (aşama 1.4 · 1.5)

- **Beklenen:** `tekserp-satici-hazirlik`, `-db`, `-yedek` Up/healthy; Traefik `StartedAt 2026-09-01T09:47:37…`, `RestartCount 0` — bu iki değer §2 boyunca DEĞİŞMEZ (değişirse §9 DUR). Farklı bir taban ölçülürse `--traefik-baslangic=<ISO önek>` ile verilir ve kayda yazılır.

### 1.5 Mac'teki kimlik ve sır dosyaları (aşama 1.2)

`~/.tekserp/sirlar/portal-yonetici-hazirlik.txt` (portal `oguzhan` parolası + TOTP sırrı) ve `~/.tekserp/sirlar/hazirlik-kok-parolasi.txt` (hazırlık kökü) var ve 0600. İçerik OKUNMAZ, basılmaz; yalnız ilgili formda elle kullanılır.

## 2. VDS satıcı (`lisans-test`) — A2 imajıyla yeniden kurulum · SATICI FABRİKADAN ÖNCE

**Neden önce satıcı:** fabrika yoklama/etkinleştirme gövdesi KATI şemayla (`PollRequestSchema` · `z.strictObject`) doğrulanır ve A2 fabrikası yeni anahtarlar gönderir (2d `sifrelemeAnahtari` — kurulumun X25519 açık yarısı · 3d-2 `kurulumKayitlari`). Eski satıcı bunları `GOVDE_GECERSIZ` ile reddeder → yeni fabrika eski satıcıya etkinleşemez/yoklayamaz. Ters sıra (yeni satıcı + eski fabrika) güvenlidir: alanlar isteğe bağlıdır.

`K=/opt/stack/apps/tekserp-satici-hazirlik` · VDS komutları `ssh -p 2222 oguzhan@80.253.255.188 '<komut>'` ile · `<sha>` = A2 HEAD'inin 12 haneli kısa sha'sı. **Doğrulama:** `asama-dogrula.mjs --asama=2 --olc --satici-sha=<sha>` → on iki satır ✅.

### 2.1 İmaj (Mac)

- **Komut:** temiz A2 ağacında `deploy/satici/imaj-derle.sh` (varsayılan `linux/amd64`, birkaç dakika).
- **Beklenen:** `~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz` + `.sha256`; betik `SATICI_IMAJ=tekserp-satici:<sha>` ve `SATICI_YEDEK_IMAJ=…` satırlarını basar. Kirli ağaçta RED (imaj HEAD'i temsil etmezdi).
- **Geri alma:** yok (yerel dosya).

### 2.2 Sırlar (Mac → VDS anahtar birimi)

A2 imajı açılışta anahtar birimindeki üç sırrı (`portal-totp.key` · `etkinlestirme-kodu.pepper` F2 kod özeti sırrı · `modul-kasasi.key` 2d modül anahtarı kasası) YALNIZ OKUR; birim konteynerde SALT OKUNUR ve sunucu eksik sırrı YARATMAZ (G1, I7): biri yoksa açılış `Sunucu sırları eksik (…): <adlar>` hatasıyla durur ve `sirlar-uret`i söyler (fail-closed, bekçi `test_sunucu_sirlari`). Üçünün tek üreticisi `anahtar.ts sirlar-uret`tir. 2026-09-30 ölçümü: VDS'te pepper ve kasa anahtarı YOK, Mac'teki hazırlık dizininde de pepper YOK.

- **Komut (Mac):**

  ```bash
  cd satici/sunucu && npx tsx scripts/anahtar.ts sirlar-uret --dizin="$HOME/.tekserp/satici-hazirlik"
  ls -l ~/.tekserp/satici-hazirlik/{etkinlestirme-kodu.pepper,modul-kasasi.key,portal-totp.key}   # üçü -rw-------
  ```

  `sirlar-uret` eksik olanı üretir, VAR olanı korur (`portal-totp.key`in üzerine yazmaz — yazsaydı portal TOTP'leri sıfırlanırdı); çıktı dosya başına `üretildi (0600)` / `vardı, korundu`.
- **Komut (VDS'e kopya — sudo'suz, yardımcı konteyner):**

  ```bash
  ssh -p 2222 oguzhan@80.253.255.188 'install -d -m 700 ~/satici-anahtar-gecici'
  scp -P 2222 -p ~/.tekserp/satici-hazirlik/{etkinlestirme-kodu.pepper,modul-kasasi.key} oguzhan@80.253.255.188:satici-anahtar-gecici/
  ssh -p 2222 oguzhan@80.253.255.188 'docker run --rm --network none --user 0 \
      -v ~/satici-anahtar-gecici:/g:ro -v /opt/stack/apps/tekserp-satici-hazirlik/anahtarlar:/a \
      --entrypoint sh tekserp-satici-yedek:<eski sha> -c "install -m 600 -o 10001 -g 10001 /g/* /a/" \
    && shred -u ~/satici-anahtar-gecici/* && rmdir ~/satici-anahtar-gecici'
  ```

- **Beklenen:** aşama 2.2 (`docker exec tekserp-satici-hazirlik ls -1 /anahtarlar`) altı ad: kök · ALT · İNDİRME · `portal-totp.key` · `etkinlestirme-kodu.pepper` · `modul-kasasi.key`. Eski imaj bu iki fazla dosyayı okumaz (zararsız).
- **Geri alma:** dosyalar kalır (eski imaj yok sayar). Kasa anahtarı KAYBEDİLMEZ: kaybolursa kasa satırları açılamaz → Mac kopyası 0600 kalır ve VDS dışı yedeğe (hazırlık kökü ile aynı yer) girer.

### 2.3 İç API belirteci (SATICI-KURULUM §5b.2, sudo'suz)

- **Komut:** değer hiçbir yere basılmadan satıcı imajının Node'uyla, üzerine YAZMADAN (`wx`):

  ```bash
  ssh -p 2222 oguzhan@80.253.255.188 'docker run --rm --network none --user 0 -v /opt/stack/apps/tekserp-satici-hazirlik/sirlar:/s \
    --entrypoint node tekserp-satici:<eski sha> -e "const f=require(\"fs\");f.writeFileSync(\"/s/ic-api-belirteci\",require(\"crypto\").randomBytes(32).toString(\"hex\"),{mode:0o440,flag:\"wx\"});f.chownSync(\"/s/ic-api-belirteci\",0,61061)"'
  ```

- **Beklenen:** `test -e $K/sirlar/ic-api-belirteci` → var (2026-09-30: YOK). Satıcı açılışında `SATICI_DINLIYOR … ic=4612` (aşama 2.6). Patron bulutu testfabrika için kurulmaz; belirteç satıcının iç API'sini açar, patron compose'u ileride aynı dosyayı okur.
- **Geri alma:** SATICI-KURULUM §5b.7 (dosyayı boşalt + `up -d --force-recreate satici` → `ic=kapali`).

### 2.4 Yedek — geri almanın TEK veri yolu (göç geri alınamaz)

- **Komut:** `cd $K && docker compose exec satici-yedek /arac/yedek-dongusu.sh tek` → sonra sudo'suz çekim (SATICI-KURULUM §7 son paragraf) ile iki `.tkenc`i `~/.tekserp/satici-hazirlik-yedek/`e al ve özel yarıyla aç: `pg_restore --list` dolu (2026-09-29'da 25 tablo).
- **Beklenen:** `satici_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc`; iki uçta `sha256sum` eşit.
- **Geri alma:** yok (okuma + yeni dosya).

### 2.5 Compose + `.env` (S1 iç API · 3d-1 dağıtım)

VDS'teki compose (sha `77a8a7f6…`) S1 ve 3d-1'DEN ÖNCEKİ sürümdür (iç API ağı yok, dağıtım dizinleri yok) ve `.env`'de `IC_*` anahtarları yoktur (ölçüldü 2026-09-30). A2'nin `deploy/satici/docker-compose.yml`'i (G3 kapandıktan sonra) + `.env` ekleri:

```bash
# S1 iç API (SATICI-KURULUM §5b.1 ölçümü 2026-09-30: mevcut köprüler 172.17/18/19/20 + 172.31.252/253 → .254 çakışmaz)
IC_API_AGI=172.31.254.0/28
IC_API_IP=172.31.254.2
PATRON_IC_IP=172.31.254.3
IC_API_DINAMIK_ARALIK=172.31.254.8/29
IC_API_BELIRTEC_DOSYASI_HOST=/opt/stack/apps/tekserp-satici-hazirlik/sirlar/ic-api-belirteci
# 3d-1 dağıtım (A2 compose'u, G3 kapandı — denetim ⑨: /dosyalar yazılır, /derlemeler + /yayin salt okunur)
DOSYA_DIZINI_HOST=/srv/tekserp-satici-dosya/hazirlik        # → /dosyalar (YAZILIR, 10001 0700)
DERLEME_DIZINI_HOST=/opt/stack/apps/tekserp-satici-hazirlik/derlemeler   # → /derlemeler (salt okunur)
YAYIN_DIZINI_HOST=/opt/stack/apps/tekserp-guncelleme        # → /yayin (salt okunur; html/ + defter/)
GENEL_KOK_ADRESI=https://lisans-test.etkiliyazilim.com
```

- **Komut:** Mac'te `node deploy/satici/compose-denetle.mjs --env-file <yeni .env>` → YEŞİL (olmadan geçilmez). VDS'e: `$K` dizini root sahipli (755) → `oguzhan` orada dosya YARATAMAZ (`.env` 0600 `oguzhan` olsa da `cp -p .env .env.yedek-…` düşer); üç dosyanın (`.env` · `docker-compose.yml` · `docker-compose.loopback.yml`) yedeği ve kurulumu tek yardımcı konteynerle: `cp -p /k/<f> /k/<f>.yedek-<damga>` → `install -m 644 -o 0 -g 0 /g/docker-compose*.yml /k/` → `.env` içeriği yerinde (`cat /g/env > /k/.env` — sahip/izin korunur). §2.7'deki etiket değişimi de yerinde yazılır (`sed … .env > ~/env.yeni && cat ~/env.yeni > .env`; `sed -i` aynı dizinde geçici dosya ister). Yeni dizinler aynı konteynerle: `install -d -m 700 -o 10001 -g 10001` (dosya) · `install -d -m 755 -o root -g root` (derleme). Yayın kökü `yayinci` sahipli ve herkese okunur → 10001 okur (ölçüldü: `html/` 755/775).
- **Beklenen:** `docker compose config -q` yeşil (VDS'te, `cd $K`).
- **Geri alma:** iki `.yedek-<damga>` dosyası yerine konur; yeni dizinler boş kalır (silmek kullanıcı kararı).

### 2.6 Traefik — yeniden başlatmasız, yeni etiket YOK

Genel yönlendirici ``Host(`lisans-test.etkiliyazilim.com`)`` kuralıyla TÜM yolları satıcının genel dinleyicisine (4610) verir; `/d` · `/y` · `/yayin/bildirim` o dinleyicinin yollarıdır (`satici/sunucu/src/http/distribution-public.ts`) → etiket değişikliği GEREKMEZ. Kenar ağı bağlantısı 2026-09-29'dan beri dosyada ve canlıda (`traefik` ağları: `tekserp-satici-hazirlik-kenar` · `traefik_socketproxy` · `web`). İç API ağı `internal`dır; Traefik ona KATILMAZ.

- **Doğrulama:** aşama 2.9 — `/d/olmayan-belirtec` yanıtı satıcının `Cache-Control: no-store` başlığını taşır (Traefik'in kendi 404'ü taşımaz; 2026-09-30'da eski imajla ❌ — beklenen). Aşama 2.11: `StartedAt`/`RestartCount` §1.4'teki gibi.

### 2.7 İmaj yükle → göç → yeniden yarat

- **Komut:**

  ```bash
  scp -P 2222 ~/.tekserp/satici-imaj/tekserp-satici-<sha>.tar.gz* oguzhan@80.253.255.188:/tmp/
  ssh -p 2222 oguzhan@80.253.255.188 'cd /tmp && sha256sum -c tekserp-satici-<sha>.tar.gz.sha256 && gunzip -c tekserp-satici-<sha>.tar.gz | docker load && rm tekserp-satici-<sha>.tar.gz*'
  # .env: SATICI_IMAJ / SATICI_YEDEK_IMAJ → <sha>  (eski etiket not edilir: geri alma)
  ssh -p 2222 oguzhan@80.253.255.188 'cd /opt/stack/apps/tekserp-satici-hazirlik && docker compose --profile goc run --rm satici-goc && docker compose up -d'
  ```

- **Beklenen:** göç "All migrations have been successfully applied" — 2026-09-30'daki 3 göçün üstüne A2'nin göçleri (ölçüm anında: `tasima_kodu_kimliksiz` · `kurulum_bulut_ayarlari` · `kurulum_kaydi_destek` · `dagitim_dosya` · `modul_anahtari_kasasi`); `up -d` satıcıyı + yedeği + (geri döngü kipinde) `portal-tunel`i yeniden yaratır, birkaç saniye kesinti (hiçbir fabrika henüz bu satıcıya bağlı değil). Günlük: `SATICI_DINLIYOR genel=4610 tailnet=4611 ic=4612`.
- **Geri alma:** SATICI-KURULUM §8 "Sürüm yükseltme": `.env`'de eski etiket + `docker compose up -d`; göç geri alınamadığından DB §2.4 yedeğinden geri yüklenir (önce `compose stop satici`, `pg_restore --clean` yardımcı konteynerde, sonra eski etiketle `up -d`). Eski imaj bir sürüm boyunca silinmez.

### 2.8 Modül kasası — hazırlık modül anahtarlarının `ice-aktar`ı (2d)

Şifreli modül paketinin AES anahtarı satıcı KASASINA alınır; kira basımında HAK'taki, dondurulmamış ve X25519'u bilinen kuruluma sarılı gider. Mac'te hazır: `~/.tekserp/satici-hazirlik/modul-anahtarlari/depo.multiEnabled.1.json` (0600).

- **Komut (imajda `dist-cli/scripts/modul-anahtari.js` — G2 kapandı, imaj derlemesi `test -f` kapısında; §2.7'den SONRA, çalışan satıcının içinde):** anahtar SSH stdin'iyle konteynerin `/tmp`'ine (tmpfs — VDS diskine düşmez) girer, içe aktarılır, silinir:

  ```bash
  ssh -p 2222 oguzhan@80.253.255.188 'docker exec -i tekserp-satici-hazirlik sh -c "umask 077; cat > /tmp/mk.json"' \
    < ~/.tekserp/satici-hazirlik/modul-anahtarlari/depo.multiEnabled.1.json
  ssh -p 2222 oguzhan@80.253.255.188 'docker exec tekserp-satici-hazirlik satici-baslat node dist-cli/scripts/modul-anahtari.js ice-aktar --dosya=/tmp/mk.json; \
    docker exec tekserp-satici-hazirlik shred -u /tmp/mk.json'
  ```

  `docker compose run satici …` KULLANILMAZ: satıcı servisinin kenar/tailnet/iç API adresleri sabittir, çalışan satıcıyla aynı adresi isteyen `run` konteyneri `Address already in use` ile açılmaz (ölçüldü 2026-09-30).

- **Beklenen:** `✅ kasaya alındı: depo.multiEnabled 1. sürüm · <kid>` (tekrar koşumda `= zaten kasada`). Düz anahtar argv/env/log/denetime girmez.
- **Geri alma:** kasa satırı silinmez/değişmez (defter); modülü kiradan çıkarmak = HAK'tan çıkarmak ya da dondurmak (portal).

### 2.9 Sağlık ve dış ölçüm

- **Komut:** `asama-dogrula.mjs --asama=2 --olc --satici-sha=<sha>` + SATICI-KURULUM §7 tablosu (internet `/saglik` 200 · `/portal/*` 404 · köken portları kapalı · yedek açılır).
- **Beklenen:** on iki ✅; `vds-dogrula.sh` ✅ adnansahin AYNI.
- **Geri alma:** §2.7.

## 3. Yayıncı anahtarı (Mac) — yayın bildirimi ve kenar doğrulaması

Yayın betikleri yayından SONRA satıcı portalına yayıncı imzalı bildirim yollar (`scripts/lib/yayin-bildirim.mjs`; bildirim yayını ASLA durdurmaz) ve kenarı yalnız satıcının indirme belirteciyle okur (`surum-yayin.md` 3c'/3bc kuralları). **Doğrulama:** `asama-dogrula.mjs --asama=3 --olc` → üç ✅ (3.3 ⚠️ = modül anahtarı yok, şifreli modül provası atlanır).

### 3.1 Anahtar + ayar

- **Komut:**

  ```bash
  node scripts/lib/yayin-bildirim.mjs anahtar-uret --kid=yayinci-mac-1      # ~/.tekserp/yayinci/yayinci-mac-1.pem (0600, dizin 0700); açık yarıyı BASAR
  umask 077 && printf '%s\n' '{"adres":"https://lisans-test.etkiliyazilim.com/yayin/bildirim","kid":"yayinci-mac-1","anahtar":"yayinci-mac-1.pem"}' > ~/.tekserp/yayinci/ayar.json
  ```

  Açık yarı sır DEĞİLDİR (portala kaydedilir); özel yarı repo/log/sohbete girmez. `anahtar` ayar dosyasının dizinine göre çözülür.
- **Beklenen:** aşama 3.1 ✅ (`kid yayinci-mac-1`).
- **Geri alma:** `ayar.json`'u kaldır → bildirim "atlandı" (yayın sürer).

### 3.2 Portalda açık anahtar kaydı

- **Komut:** portal (§6.0 tüneli) → **Sürümler → Yayıncılar → Yeni**: kid `yayinci-mac-1` + 3.1'in bastığı açık anahtar (`POST /portal/api/yayincilar`, izin `yayinci:yonet`).
- **Beklenen:** listede aktif; ilk yayında (§5) portalın yayın bildirimleri görünümünde imzası GEÇERLİ satır.
- **Geri alma:** **Yayıncılar → Pasife al** (`/yayincilar/:id/pasif`) — satır silinmez.

### 3.3 İndirme belirteci kaynağı (3bc)

- **Komut:** `umask 077 && printf '%s\n' '{"tur":"yerel","dizin":"~/.tekserp/satici-hazirlik"}' > ~/.tekserp/yayin-belirteci-kaynagi.json`
- **Beklenen:** yayın betikleri her adres öneki için `anahtar.ts indirme-belirteci --kanal=testfabrika --dk=60` ile TAZE belirteç üretir (İNDİRME anahtarı Mac'te); kaynak bozuk/gevşek izinliyse betik DURUR, anonime düşmez. Aşama 3.2 ✅.
- **Geri alma:** dosyayı kaldır → eski `~/.tekserp/yayin-belirteci` düzeni (dosya yoksa betik ilk ssh'tan önce durur).

## 4. testfabrika backend — korumalı paket (thinkpad-1)

`R=C:\ProgramData\testfabrika\klis2` (prova kökü; testfabrika kurulumuna, pm2'ye, görevlere dokunmaz) · tp komutları `Teks-Erp-wt/testfabrika-araclar/tp.sh <betik.ps1>` ile. **Doğrulama:** `asama-dogrula.mjs --asama=4 --olc --backend-surum=<X> --belirtec-dosyasi=~/.tekserp/testfabrika-gozlem.jwt`. 2026-09-30 ölçümünde kurulu olan `2.11.2-lis-prova.771ac50d` Mac'te paketlenmiş KORUMASIZ pakettir (native yok, `dist/*.js`) → 4.3 ❌ beklenir; bu bölüm sonunda ✅ olur.

### 4.1 Native çekirdek (Mac, cargo-xwin)

- **Komut:** `cd Teks-Erp/native/lisans-cekirdek && npm run derle:win:uretim` → `dist-uretim/lisans-cekirdek.win32-x64-msvc.node` (ÜRETİM derlemesi, test çapasız, CRT statik). Sonra kâhin: `cd Teks-Erp && npx tsx scripts/test_lisans_native_kahin.ts` (Mac'te darwin ikilisiyle; Windows ikilisinin Windows'taki ayna ölçümü §4.5'te çekirdek `native` olarak görünür).
- **Beklenen:** `file …node` → `PE32+ … DLL … x86-64`; kâhin yeşil.
- **Geri alma:** yok.

### 4.2 Paketleme — hedefte, ayrık, düşük öncelikli, prizde

Bayt kodu (`.jsc`) OS + mimari + V8'e kilitlidir → korumalı paket HEDEFTE üretilir (DEPLOY-RUNBOOK §3c). Kaynak `git archive` ile taşınır (hedefte yerel `git init` + tek commit, küresel yapılandırmaya yazmadan); iz yalıtımı: `TEMP`/`TMP`/`LOCALAPPDATA`/`APPDATA`/`npm_config_cache`/`KORUMA_ARSIV_DIZINI`/`GIT_CONFIG_GLOBAL` + `GIT_CONFIG_NOSYSTEM=1`/`CHECKPOINT_DISABLE=1` → `$R` altı.

- **Komut:**
  1. Mac: `git archive --format=tar -o /tmp/klis2-kaynak.tar <A2 sha>` · `scp` → `$R/` · native `.node` → `$R/native/`.
  2. thinkpad-1 (tp): PowerOnline kapısı → `tar -xf` (Expand-Archive DEĞİL) → `git init` + tek commit (`-c user.name=… -c user.email=…`).
  3. Sarmalayıcı `$R\paketle-sar.ps1` (ortam değişkenlerini `$R` altına yönlendirir, BAŞINDA yine PowerOnline kapısı, sonra):
     `& "$R\kaynak\deploy\paketle.ps1" -Korumali -Hedef win-x64 -Musteri testfabrika -Prova -Surum <X> -WebPanelHaric -NativeYol "$R\native\lisans-cekirdek.win32-x64-msvc.node" -Cikti "$R\cikti" *> "$R\paketle.log"; "cikis=$LASTEXITCODE" > "$R\paketle.bitti"`
  4. Ayrık başlatma (SSH kapanınca ölmesin; BelowNormal — çocuklar önceliği miras alır, testfabrika etkilenmez):

     ```powershell
     $si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ PriorityClass = [uint32]16384 }
     $pw = (Get-Command pwsh).Source   # Store diğer adı: WindowsApps\pwsh.exe (kullanıcı oguzhan)
     Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "`"$pw`" -NoProfile -NonInteractive -File $R\paketle-sar.ps1"; CurrentDirectory = "$R\kaynak"; ProcessStartupInformation = $si }
     ```

  5. Yoklama (tp, birkaç dakikada bir): `Get-Content $R\paketle.log -Tail 15` · `Test-Path $R\paketle.bitti`.
- **Beklenen (2b-D ölçümü):** ~12 dk; `server.jsc` ~12,7 MB (V8 13.6, runtime Node 24.18) · `schema-engine-windows.exe` MZ ✓ · native kopyalandı ("lisans cekirdegi - zorunlu kip") · zip ~155 MB · sonda "KORUMALI paket IMZASIZ" uyarısı (imza Mac'te, 4.3). `paketle.bitti` → `cikis=0`.
- **Geri alma:** `$R` altı; testfabrika'ya dokunulmadı. Pilde düşerse (Tailscale offline) makine dönünce aynı adım baştan.

### 4.3 İmza — PAKET anahtarı (Mac, `paket-hazirlik`)

- **Komut:** zip'i Mac'e çek (`scp oguzhan@100.70.47.46:C:/ProgramData/testfabrika/klis2/cikti/<zip> ~/.tekserp/testfabrika-paket/`) ve imzala:
  `cd Teks-Erp && npx tsx scripts/build-korumali-imza.ts zip --zip=$HOME/.tekserp/testfabrika-paket/<zip> --anahtar=$HOME/.tekserp/satici-hazirlik/paket-hazirlik.paket.json`
- **Beklenen:** zip'e `butunluk.jws` + `butunluk-liste.txt` eklenir, `PAKET.json` dosya sayısı +2, `butunlukKid` `paket-hazirlik…`. İmza anahtarı Mac'ten çıkmaz. Hazırlık anahtarı yalnız TEST/DEMO içindir (üretim kurulumu reddeder). İmzasız korumalı paketi `kur.ps1` REDDEDER.
- **Geri alma:** yok (yeni dosya).

### 4.4 Kurulum — `kur.ps1`, SYSTEM görevi (`uzaktan-kos.ps1`)

İmzalı zip'i geri taşı (`scp … oguzhan@100.70.47.46:C:/ProgramData/testfabrika/klis2/`), içinden `kur.ps1` + `uzaktan-kos.ps1` + `PAKET.json`'u çıkar (`Teks-Erp-wt/testfabrika-araclar/backend-kurulum-recetesi.md` §5 kalıbı; zip SHA kıyası). `kur.ps1` sunucunun `.env`'ini ve `ecosystem.config.js`'ini BAYT BAYT korur.

- ⚠️ **ÖNKOŞUL (ölçüldü 2026-09-30, O2 — KAPANMADAN kurulum YAPILMAZ):** `kur.ps1` sunucunun `ecosystem.config.js`ini korur; thinkpad-1'dekinde `interpreter`/`RUNTIME_NODE` bağı YOK (0 eşleşme; paketin `.paket` kopyasında 3) → pm2 korumalı paketi SİSTEM Node'uyla (v26) başlatır, yükleyici V8 uyumsuzluğunda reddeder (`KORUMALI PAKET bu Node ile ACILAMAZ`), `[9/9]` düşer — migration eşiği GEÇİLMİŞ olur. Çözüm (ürün kararı, bu runbook'un dışı): ya sunucu ecosystem'ine runtime bağı kurulumdan ÖNCE eklenir (sunucu env değerleri korunarak), ya da `kur.ps1` `runtime\node.exe` taşıyan pakette sunucu ecosystem'inde bağ yoksa `[3/9]`dan ÖNCE durur.
- **Komut:**
  1. Satıcı adresi (2026-09-30: ne `.env`'de ne pm2 env bloğunda `LICENSE_*` var → varsayılan ÜRETİM satıcısıdır; etkinleşmemiş kurulum dışarı çıkmadığından bugün zararsız). Kurulumdan ÖNCE `.env`'e yalnız satır EKLENİR (içerik okunmaz): `if (-not (Select-String -Path C:\TeksERP\app\.env -Pattern '^LICENSE_SERVER_URL=' -Quiet)) { Add-Content -Path C:\TeksERP\app\.env -Value 'LICENSE_SERVER_URL=https://lisans-test.etkiliyazilim.com' }` (SATICI-KURULUM §9; hazırlık satıcısı yalnız TEST/DEMO HAK'ı imzalar).
  2. SYSTEM görevi (SSH kapanınca ölmez): `& "$R\uzaktan-kos.ps1" -Betik "$R\kur.ps1" -ZamanAsimiDakika 45 -Argumanlar '-Kok C:\TeksERP -Paket C:\ProgramData\testfabrika\klis2\<zip> -Zorla -ProvaKabul'` (`powershell -File … -Argumanlar '-…'` biçimi KULLANILMAZ — 5.1 `-` ile başlayan değeri parametre sanabilir).
- **Beklenen:** `C:\TeksERP\logs\uzaktan-<damga>.log`: `[1/9]` sürüm `<X>-prova.<sha7>` · `korumali` · imza ve dosya sayısı kapıları OK · `native lisans cekirdegi` · … `[9/9] KURULUM TAMAM` · `API : UP DB: UP` · `kod : C:\TeksERP\app.eski-<damga>` · `veri: C:\TeksERP\backups\premigrate_<damga>.dump` · kurulum kaydı `kurulum-gecmisi.jsonl`'e bir satır (3d-2). Kesinti ~4–5 dk (kullanıcı panel/tablette deniyorsa önceden haber).
- **Geri alma:** `C:\TeksERP\kur.ps1 -GeriAl` — yine SYSTEM göreviyle (`uzaktan-kos.ps1 -Betik C:\TeksERP\kur.ps1 -Argumanlar '-Kok C:\TeksERP -GeriAl -Zorla'` — `-Zorla`sız uzaktan-kos durur: görevde onay sorusu cevaplanamaz): önceki `app.eski-<damga>` + premigrate dökümü (şifreliyse yedek parolasıyla, `ilk-kurulum` anahtarı). `LICENSE_SERVER_URL` satırı kalabilir (etkinleşmemiş kurulum dışarı çıkmaz) ya da `kapali` yazılır.

### 4.5 İlk açılış — sağlık, lisans motoru gözlemde, bütünlük GECERLI

- **Belirteç dosyası (bir kez):** panelden, yalnız `license:view` + `system:server-status` + `admin:settings` taşıyan bir ölçüm hesabı açılır (kullanıcılar panelden doğar). JWT argv'ye/log'a yazılmadan dosyaya:

  ```bash
  read -rs P && printf '{"username":"%s","password":"%s"}' '<ölçüm hesabı>' "$P" | curl -s -H 'content-type: application/json' --data-binary @- \
    http://100.70.47.46:4000/api/auth/login | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).data.token))' \
    > ~/.tekserp/testfabrika-gozlem.jwt; unset P; chmod 600 ~/.tekserp/testfabrika-gozlem.jwt
  ```

  Süresi dolunca aynı komut; `t4-gozlem.mjs` dosyayı her örnekte yeniden okur.
- **Beklenen (aşama 4):** 4.1 prizde · 4.2 `/health` `<X>-prova.<sha7>` `db: UP` · 4.3 `korumali=True` · `native` · `butunluk.jws` + `butunluk-liste.txt` · `dist\server.jsc` · `butunlukKid paket-hazirlik…` · `LICENSE_SERVER_URL` hazırlık · node süreçleri `SYSTEM` · 4.4 `cekirdek native` · `butunluk GECERLI` · `motor CALISIYOR` · `kip gozlem`. Etkinleşmemiş kurulum satıcıya İSTEK ATMAZ (portal kurulum defterinde bu makineden yoklama yok).
- **Geri alma:** §4.4.

## 5. Panel + tablet — testfabrika kanalına yayın

`testfabrika` kanal kaydında `tur: hazirlik`tır (`deploy/kanallar.json`; ayna `adnansahin`) — terfi etiketi gerekmez; üretim kanalına çıkış bu runbook'un DIŞINDADIR. Müşteri kodu her komutta ARGÜMANDAN; ham `npm run build:win` yasak; manifest EN SON yüklenir. **Doğrulama:** `asama-dogrula.mjs --asama=5 --olc --panel-surum=<P>` (2026-09-30 yayında panel `1.3.7`).

### 5.1 Sürüm notu kapısı

- **Komut:** notu `surum-notlari.json`'a yaz (taslağı Claude yazar; lisans ekranı, etkinleştirme, bütünlük kartı, destek, sürüm görünümü maddeleri) → `node scripts/surum-notlari-kopyala.mjs` → `node scripts/check-surum-notlari.mjs`.
- **Beklenen:** kapı yeşil (paketleme kapısı aynı notu ister).
- **Geri alma:** yok.

### 5.2 Panel

- **Komut:** `./deploy/electron-paketle.sh testfabrika` → `./deploy/electron-yayinla.sh --musteri=testfabrika` (kenar doğrulaması §3.3 kaynağıyla belirteçli; yayın SONRASI §3.1 bildirimi otomatik).
- **Beklenen:** yayın defterine `testfabrika-YAYIN-DEFTERI.tsv` satırı; aşama 5.1 `latest.yml` sürümü `<P>`; portal **Sürümler** görünümünde testfabrika paneli `<P>` (satıcı `YAYIN_DIZINI`'nden okur) ve **Yayın bildirimleri**nde imzası geçerli satır.
- **Geri alma:** electron-updater sürüm DÜŞÜRMEZ → düzeltme ileri yayınla (`<P>+1`); `minVersion`e dokunulmaz.

### 5.3 Tablet

- **Komut:** `cd mobil && npm run yayinla -- --musteri=testfabrika` (paketi ÜRETİR; ERP adresi kanal kaydından) → `node deploy/mobil-yayinla.mjs --musteri=testfabrika --paket=<dizin>` (native değiştiyse `npm run build:apk -- --musteri=testfabrika` + `--apk=`). OTA turunda `versionCode`a dokunulmaz.
- **Beklenen:** testfabrika OTA manifesti yeni `runtimeVersion` altında; yayın bildirimi portalda.
- **Geri alma:** önceki OTA paketini yeniden yayınla (ileri yayın).

### 5.4 adnansahin'e dokunulmadı

- **Komut:** `vds-dogrula.sh` (aşama 1.7 · 8.4).
- **Beklenen:** ✅ AYNI. FARK → §9 DUR.

## 6. Portal — müşteri → tesis → kurulum (TEST) → HAK → etkinleştirme kodu

**Doğrulama:** `asama-dogrula.mjs --asama=6 --olc --belirtec-dosyasi=…` (6.1 tünel açıkken; 6.2 HAK modül listesini verir).

### 6.0 Portal erişimi (geri döngü kipi)

- **Komut:** ayrı terminalde `node deploy/satici/portal-baglan.mjs` → tarayıcıda `http://127.0.0.1:14611/portal/`; giriş `oguzhan` + parola + TOTP (`~/.tekserp/sirlar/portal-yonetici-hazirlik.txt` — değer basılmaz, kopyala-yapıştır geçmişi temizlenir).
- **Beklenen:** aşama 6.1 ✅ (`capa: gomulu` · `altGecerli ≥ 1` · `uyariSayisi 0`).
- **Geri alma:** Ctrl+C (tünel kapanır).

### 6.1 HAK'a girecek modüller = testfabrika'nın AÇIK modülleri

- **Komut:** aşama 6.2 (`GET /api/admin/module-profile`; satırı olmayan `production.enabled` TRUE sayılır).
- **Beklenen:** açık modül listesi (ör. `production.enabled, finance.enabled, …`). HAK tavanı bu listeyle AYNI olur: eksik modül gözlem kipinde sayaç (`reddedilecekModul`) doğurur → T4 yanlış pozitif sayar.
- **`patron-bulut` EKLENMEZ:** patron bulutu yalnız ÜRETİM sınıfı kurulumdan veri kabul eder; TEST sınıfı gönderemez (Senaryo P8) — hak eklemek bir şey açmaz, yalnız yanlış beyan olur.

### 6.2 Müşteri · tesis · kurulum

- **Komut:** **Müşteriler → Yeni müşteri** (ad: `Etkili Yazılım Test Fabrikası` — gerçek müşteri adı kullanılmaz) → **Tesisler → Yeni tesis** (`thinkpad-1`) → **Kurulumlar → Yeni kurulum**: sınıf **TEST**, kanal **testfabrika** (2026-09-29'da kayıtlı), ad `testfabrika-thinkpad-1`, yoklama aralığı varsayılan.
- **Beklenen:** kurulum `BEKLIYOR`/etkin değil; kurulum kimliği (UUID) portalda — fabrika kimliğini etkinleştirme yanıtından öğrenir (D14; DB `installationId` yalnız etiket).
- **Geri alma:** kurulumu iptal/pasif (portal "Kurulumu iptal et"; satır ve defter kalır).

### 6.3 HAK + kök imzası

- **Komut:** kurulum ayrıntısında HAK ekle: modüller = §6.1 listesi · kalıcı: hayır · bakım bitişi: +12 ay (hazırlık) → **HAK sürümü**: sebep `testfabrika devreye alma (R2 runbook)`, **kök parolası** formda (dosyadan elle; imza alt sürecinin stdin'ine gider, sıfırlanır; 5 yanlışta kilit).
- **Beklenen:** HAK sürüm 1, `imzalayanKid hazirlik-2026-1`; imza çapaya karşı doğrulanmadan dönmez.
- **Geri alma:** yeni HAK sürümü (modül çıkarma) ya da dondurma — HAK sürümleri defterdir, silinmez.

### 6.4 Etkinleştirme kodu

- **Komut:** kurulum ayrıntısında etkinleştirme kodu üret.
- **Beklenen:** `TKS-XXXX-XXXX-XXXX-XXXX` (16 karakter, ≈80 bit), 30 gün geçerli (`ETKINLESTIRME_KODU_GUN`), tek kullanımlık; düz metin YALNIZ bu yanıtta görünür (DB'de pepper'lı HMAC). Kod ekrandan doğrudan panele (§7) taşınır — sohbete, dosyaya, ekran görüntüsüne GİRMEZ.
- **Geri alma:** kodu iptal et / yenisini üret (eskisi geçersizleşir).

## 7. testfabrika etkinleştirme — GÖZLEM kipi

**Doğrulama:** `asama-dogrula.mjs --asama=7 --olc --belirtec-dosyasi=…` → iki ✅.

### 7.1 Etkinleştir

- **Komut:** testfabrika kanalının paneli (§5.2 sürümü) → **Sistem → Lisans** (`system/license`; gözlem kipinde yalnız lisans izni olan hesap görür) → **Etkinleştirme** kartı → kod → Etkinleştir. Backend satıcıya ulaşamazsa kart panel aktarmasını önerir (T5, §8).
- **Beklenen:** 200; kart: etkin · HAK TEST · kira bitişi ~30 gün · kip GÖZLEM · kademe NORMAL; `C:\TeksERP\lisans\` altında HAK/kira dosyaları (lisans kimliği `LICENSE_DIR`'de, DB'de değil); portalda kurulum ETKİN, ilk yoklama ve (3d-2) backend kurulum geçmişi satırı; A2 fabrikası X25519 açık yarısını (`sifrelemeAnahtari`) etkinleştirme gövdesinde yollar.
- **Geri alma:** gözlem kipi hiçbir şeyi KISITLAMAZ (yazma yine 201 — Senaryo L5). Kimliği geri almak = portalda kurulumu iptal/pasif; fabrikada `C:\TeksERP\lisans\` SİLİNMEZ. Dışarı çıkışı kesmek: `.env` `LICENSE_SERVER_URL=kapali` + SYSTEM göreviyle pm2 yeniden başlatma.

### 7.2 Durum ölçümü

- **Beklenen (aşama 7):** 7.1 etkin · `hak.sinif TEST` · HAK'ta `patron-bulut` YOK · kira var · satıcı `https://lisans-test.etkiliyazilim.com` · son yoklama başarılı; 7.2 `kip gozlem` · `GECERLI` · `NORMAL` · gözlem sayaçları 0.

### 7.3 T4 gözlemini BAŞLAT (paralel, bekleme kapısı değil)

- **Komut:** `node deploy/lisans-devreye/t4-gozlem.mjs --olc --belirtec-dosyasi=~/.tekserp/testfabrika-gozlem.jwt --aralik-sn=300 --sure-dk=1440` (arka planda; önce KURU koşup planı gör).
- **Beklenen:** her 5 dk bir satır `~/.tekserp/testfabrika-t4/gozlem-<damga>.tsv` (0600); bitişte özet. Faz ilerlemesi bunu BEKLEMEZ (kullanıcı kararı: takvim kapısı yok); Faz 4 (zorlama) kararına ölçüm girdisidir.

### 7.4 Şifreli modül provası (§2.8 koşulduysa)

- **Komut:** §4.2'yi şifreli modülle yeniden üret → §4.3 → §4.4. Anahtar dosyası (`depo.multiEnabled.1.json`, 0600) §2.2'deki gibi geçici olarak `$R\modul-anahtarlari\`e (kaynak ağacının DIŞI) taşınır; sarmalayıcıdaki çağrıya `-Sifrele -ModulAnahtarDizini "$R\modul-anahtarlari"` eklenir (G5, I7; `-SifreliPaketler` verilmezse katalogdaki hepsi). Betik `-Korumali`sız, CI'da ya da repo içindeki anahtar diziniyle DURUR ve `.tkmod` üretilmezse paket çıkmaz. Paketten sonra anahtar kopyası silinir (anahtar pakete girmez, pakete yalnız `dist\moduller\*.tkmod` girer).
- **Beklenen:** `depo.multiEnabled` HAK'ta ise modül açılır (kiradan anahtar, bellekte derleme); HAK'ta değilse `403 LICENSE_MODULE` `neden: ANAHTAR_YOK` — gözlem kipinde bile (anahtar fiziksel olarak yoktur). testfabrika `depo.multiEnabled` kullanıyorsa bu adım HAK doğrulanmadan KOŞULMAZ.
- **Geri alma:** §4.4 `-GeriAl` (şifresiz pakete dönüş).

## 8. Senaryo T (thinkpad-1, gerçek Windows)

**Doğrulama:** `asama-dogrula.mjs --asama=8 --olc --belirtec-dosyasi=… --t4-tsv=<dosya>`.

| # | Ne ölçülür | Nasıl | Beklenen | Kırmızıda |
|---|---|---|---|---|
| **T1** | Beş parmak izi etkeni SYSTEM bağlamında ölçülebilir mi | Aşama 8.1: `/api/license/detay` `parmakIzi.olculen{f1..f5}` + `karar`. Ölçüm backend'in KENDİ toplamasıdır ve backend pm2 altında SYSTEM'dir (aşama 4.3 `nodeSahipleri=SYSTEM`) — ayrı SYSTEM görevi yaratılmaz | f1 MachineGuid · f2 ürün UUID · f3 sistem diski · f4 BIOS/anakart seri · f5 PG küme kimliği → beşi `true`, `karar ESLESTI` | Ölçülemeyen etken adı notta; `PARMAK_IZI_OLCULEMEDI` UYARI'dır (kısıt değil). Kök neden (ör. `Get-Disk` SYSTEM'de boş) ayrı dilime; sonda metni `Teks-Erp/src/lib/license/fingerprint-os.ts` `WINDOWS_PROBE_LINES` (native aynası birebir) |
| **T2** | Saat ileri sıçraması → erken bitiş YOK | **Canlı testfabrika'da YAPILMAZ.** Windows saatini oynatmak Tailscale/TLS'i, zamanlanmış yedeği, Postgres `now()`'ını ve defter kronolojisini (`createdAt`, fabrika günü) bozar; kullanıcının deneme verisini kalıcı etkiler, geri dönüşü veri düzeltmesidir | Yerel Senaryo L kapsar (`Teks-Erp/scripts/senaryo-lisans.ts`, süreç saati `scripts/lib/senaryo-saat.ts` ile duvar/monotonik ayrı): **L9** kira biter → EK_SURE → +30 gün KISITLI → yeni kira NORMAL · **L10** saat geri → `SAAT_GERI` + yüksek su · **L25** saat ileri + başarılı yoklama → kademe düşmez (satıcı `ISTEK_ZAMAN`) | — |
| **T3** | Uygulama rolü `pg_control_system()` çalıştırabiliyor mu | Aşama 8.2: `f5` ölçüldü ⇔ rol EXECUTE yetkili (F5 sorgusu `SELECT system_identifier FROM pg_control_system()`; rol yetkisizse sorgu düşer → ölçülemedi). Sır okunmadan ölçülür | ✅ | Yetki vermek süper kullanıcı işidir (`GRANT EXECUTE ON FUNCTION pg_control_system() TO <rol>`) — bu runbook UYGULAMAZ; kullanıcı kararı. O zamana dek F5 ölçülemedi = UYARI, kısıt yok |
| **T4** | Gözlem kipi sürekli ölçüm: yoklama başarı oranı, parmak izi kararlılığı, yanlış pozitif 0 | §7.3 `t4-gozlem.mjs`; özet `t4-gozlem.mjs --ozet=<tsv>` ya da aşama 8.3 | yanlış pozitif **0** (lisanslı kurulumda `gecerlilik≠GECERLI`, `kademe≠NORMAL`, gözlem sayacı artışı hiç yok) · karar/etken değişimi 0 · yoklama başarı oranı ≈ %100 (örnekler arasında kalan deneme görülmez — oran örneklemdir) | Özet `IHLAL` → hangi örnek, hangi sebep (TSV satırı); Faz 4'e geçilmez, kök neden dilimi açılır. Ölçülemeyen örnek (belirteç süresi, ağ) hüküm değildir |
| **T5** | Panel aktarma + QR gerçek cihazla (kullanıcı destekli) | Kullanıcı: panelde Lisans → yenileme/etkinleştirme aktarma yolu (backend satıcıya çıkamıyorken istek panel üzerinden yalnız yapılandırılmış satıcı ana makinesine gider, kod gövdede) + çok parçalı QR'ı telefonla satıcının `/q` sayfasına okutma. Operatör: panel "Lisans geçmişi" kartı + portal kurulum defteri | İstek/yanıt tamam; kira yenilendi; aktarma satırı geçmişte | Yalnız gözlem; kullanıcı yokken koşulmaz |
| **T6** | Her VDS yazımında adnansahin 0 fark | Aşama 8.4 (`vds-dogrula.sh`) — §2'nin her alt adımından sonra ve bitişte | ✅ AYNI | §9 DUR |

## 9. Genel geri alma planı ve durdurma koşulları

**DUR (bir sonraki adıma geçilmez, kullanıcıya haber):**

1. `vds-dogrula.sh` bilinmeyen FARK (adnansahin'e dokunulmuş olabilir) — taban bayatlığı §1.2 ile ayrılır.
2. Traefik `StartedAt`/`RestartCount` değişti (aşama 1.5 · 2.11).
3. Satıcı 2 dakikadan uzun `healthy` değil ya da `SATICI_DINLIYOR` yok.
4. `asama-dogrula` ❌ (IHLAL) — ⚠️ ÖLÇÜLEMEDİ ise nedeni giderilip yeniden ölçülür, geçilmez.
5. thinkpad-1 pilde (`PowerOnline=False`) ya da Tailscale'de görünmüyor.
6. `kur.ps1` herhangi bir `[n/9]` adımında hata (kendi otomatik geri alması çalışır; günlük okunur).
7. Bütünlük `GECERSIZ`/`OLCULEMEDI`, çekirdek `native` değil.
8. T4 yanlış pozitif > 0.
9. Bir sır ekrana/log'a/sohbete düştü → ilgili sır ROTASYONU (portal parolası/TOTP: portal kullanıcı CLI `parola-sifirla`/`totp-sifirla`; iç API belirteci SATICI-KURULUM §5b.6; etkinleştirme kodu: iptal + yeni kod; JWT: ölçüm hesabının parolası değişir) ve olay notu.

**Geri alma sırası (tersine, FABRİKA ÖNCE):** yeni fabrika eski satıcıya yoklayamaz (katı şema, §2) → satıcı geri alınacaksa önce fabrika.

| Adım | Geri alma | Veri |
|---|---|---|
| 7 etkinleştirme | portalda kurulum iptal/pasif · fabrikada gerekirse `LICENSE_SERVER_URL=kapali` | lisans dosyaları ve satıcı defterleri KALIR |
| 6 portal | kodu iptal · HAK dondur/yeni sürüm · kurulumu iptal | defter satırları silinmez |
| 5 yayın | ileri yayın (panel/OTA sürüm düşürmez) | yayın defteri ekleme-yalnız |
| 4 backend | `kur.ps1 -GeriAl` (SYSTEM görevi) | premigrate dökümü; `app.eski-<damga>` |
| 3 yayıncı | portalda pasif · `ayar.json` kaldır | — |
| 2 satıcı | eski imaj etiketi + `up -d`; göç geri alınamaz → §2.4 yedeğinden DB; compose/`.env` `.yedek-<damga>`; iç API belirteci boşalt | yedek Mac'te açılmış olmalı (§2.4) |

Traefik hiçbir geri almada yeniden başlatılmaz; kenar ağı satırı yerinde kalır (SATICI-KURULUM §8'deki ağ silme yalnız satıcının TAMAMEN kaldırılmasında).

## 10. Ölçüm kaydı — 2026-09-30 (R2, yalnız SALT OKUMA)

- **VDS:** satıcı imajı `tekserp-satici:0ca31403525a` (+ yedek), dört satıcı konteyneri (`portal-tunel` dahil = geri döngü kipi) sağlıklı; satıcı göçleri 3 (`ilk_sema`, `portal_bayi`, `kanal_bayi_tavani`); compose sha `77a8a7f6…` (iç API ağı YOK, 3d-1 dizinleri YOK); `.env`'de `IC_*` YOK; `sirlar/ic-api-belirteci` YOK; anahtar biriminde `etkinlestirme-kodu.pepper` ve `modul-kasasi.key` YOK. Köprüler 172.17/18/19/20 + 172.31.252.0/28 (ip_range .8/29) + 172.31.253.0/28. Bellek kullanılabilir 2211 MB, disk 55 GB boş. Traefik `StartedAt 2026-09-01T09:47:37`, `RestartCount 0`, ağları kenar + socketproxy + web. Güncelleme kökü `/opt/stack/apps/tekserp-guncelleme/{html/{adnansahin,electron,testfabrika},defter}`; testfabrika paneli `1.3.7`.
- **vds-dogrula:** ❌ FARK — taban 2026-09-28 11:08, adnansahin 1.3.7 + OTA sonra yayınlandı (aşama 1.6 bayat taban olarak ayırdı). Kurulumdan önce §1.2.
- **thinkpad-1:** prizde; pwsh 7.6.6 (Store diğer adı); `/health` `2.11.2-lis-prova.771ac50d` (Mac'te paketlenmiş, KORUMASIZ, native yok, 363 göç); `C:\TeksERP\lisans\kurulum-anahtari.json` var (kurulum anahtarı doğmuş, etkinleşmemiş); `.env` anahtarları `DATABASE_URL JWT_SECRET PORT BACKUP_PG_USER BACKUP_PG_PASSWORD` — `LICENSE_*` yok, pm2 env bloğunda da yok; node süreçleri SYSTEM (pm2 daemon 27.09'dan); görevler `TeksERP-Backend-Boot`, `TeksERP-DB-Backup`.
- **Mac:** `~/.tekserp/satici-hazirlik/` kök · ALT · İNDİRME · `portal-totp.key` · `paket-hazirlik.paket.json` · `modul-anahtarlari/depo.multiEnabled.1.json`; pepper YOK; `~/.tekserp/yayinci/` ve `yayin-belirteci*` YOK.
- **Doğrulayıcı gerçek koşumu:** aşama 1 (taban hariç ✅), 2 (A2 öncesi beklenen ❌'ler: anahtarlar, göçler, ortam adları, bağlar, `/d`, yayın kökü), 4 (4.3 ❌ korumasız paket), 5 ✅ — ayrıştırıcılar gerçek çıktıyla sınandı.

## 10b. Uygulama kaydı — 2026-09-30 (O1: §1 → §3)

- **§1:** taban bayattı (51 fark = panel 1.3.7 + OTA `1790619945836` + 1.2.7 rotasyonu + defterde yalnız eklenen 1.3.7 satırı; bilinmeyen fark YOK) → §1.2 ile tazelendi (eski: `Teks-Erp-wt/vds-taban-20260930_0327-onceki/`, yeni kopya `…-yeni/`, 420 dosya). Aşama 1: yedi ✅.
- **§2:** imaj `tekserp-satici:55203d9708ba` (+ yedek); pepper + kasa anahtarı üretildi ve kuruldu (anahtar birimi altı ad); `sirlar/ic-api-belirteci` (64 B, root:61061 0440); yedek `satici_20260930_003005` + `anahtarlar_20260930_003005` (Mac'te açıldı: 25 tablo, anahtar arşivi bayt-eşit); compose/`.env` yedekleri `.yedek-20260930-0335`; göç 3 → 8; `SATICI_DINLIYOR genel=4610 tailnet=4611 ic=4612`; kasaya `depo.multiEnabled` 1. sürüm (§2.8'in yeni komutuyla). Aşama 2: on iki ✅. İç API kapısı §7 tablosundaki gibi (patron adresi: Bearer 404 · Bearer'sız 401; dinamik adres: 404/404). Traefik `StartedAt`/`RestartCount` değişmedi; her VDS yazımının önünde ve arkasında `vds-dogrula` ✅.
- **§3:** yayıncı kid `yayinci-hazirlik-2026` (portalda aktif); belirteç kaynağı `yerel`. Aşama 3: üç ✅.
- **Geri alma noktası:** önceki imaj `0ca31403525a` (VDS'te duruyor) + yukarıdaki DB yedeği + `.yedek-20260930-0335` dosyaları (§9 tablosu, satır 2).

## 10c. Uygulama kaydı — 2026-09-30 (O2: §4 — BAŞARISIZ, GERİ ALINDI)

- **§4.1–4.3 ✅:** native `e2691bc1…7c90` (PE32+ DLL, kâhin 40/0) · paket `tekserp-backend-prova-20260930_043616-*.zip`, sürüm `2.12.0-prova.*` (kaynak: dal `ops/testfabrika-2.12.0` ucunun `git archive`ı, hedefte tek yerel commit — son ek o yerel commit'tir, depoda yoktur; 13384 dosya, `server.jsc` 13157 KB, 367 migration, araç yol yorumu 0) · imza kid `paket-hazirlik`, imzalı SHA256 `2CDDB44F5087FEC287203D58B3B2AEC55D3D92A07DF350370A80E1EA170AD651`. İlk paketleme `paketle.ps1` splat hatasıyla (araçlar karartılmadı) kapıda düştü; düzeltme dal `ops/testfabrika-2.12.0`deki `fix(paket)` commit'i (iniş yöneticide).
- **§4.4 ❌:** `.env`e `LICENSE_SERVER_URL` eklendi; `kur.ps1` `[1/9]`–`[8/9]` yeşil (premigrate `premigrate_20260930_045319.dump.tkenc`, 4 migration 363 → 367), `[9/9]` 120 sn sağlık YOK — kök neden §4.4 önkoşul uyarısı. `-GeriAl -Zorla` (SYSTEM) → `API UP / DB UP / v2.11.2-lis-prova.771ac50d`; DB 367'de kaldı (4 migration yalnız ekler). Kesinti ~7 dk (04:59 → 05:06), bağlı istemci 0; oturumlar (ELECTRON 7 · MOBILE 12 etkin) değişmedi.
- **Duruldu:** kurulum tekrar denenmedi. Bırakılan: `C:\ProgramData\testfabrika\klis2` (imzalı zip dahil) · `C:\TeksERP\app.basarisiz-20260930_050608` · `.env`deki `LICENSE_SERVER_URL` satırı. 4.4 ayrıca belirteç dosyası ister (ölçüm hesabı henüz yok).
- **Araç notları:** WMI `Win32_Process.Create` Store `pwsh` diğer adını (rv 8) ve gerçek `WindowsApps` yolunu (rv 2) başlatamıyor — WMI ile `powershell.exe` 5.1 önyükleyici açılır, o `pwsh` diğer adını çağırır. `tp.sh` 5.1 oturumu `Restricted`: betik `Set-ExecutionPolicy -Scope Process Bypass` ile başlar. `uzaktan-kos.ps1` görev bittikten sonra SSH üzerinden çıkmadı (iki kez); görev kaydı elle silindi.

## 11. A2 önkoşul borçları (ölçüldü 2026-09-30 · G1–G3 + G5 iniş A2 I7'de KAPANDI)

| # | Borç | Etki | Durum |
|---|---|---|---|
| **G1** | Satıcı açılışı `etkinlestirme-kodu.pepper` + `modul-kasasi.key`'i `create: true` ile yüklüyordu; VDS anahtar birimi SALT OKUNUR ve ikisi de yok | A2 imajı VDS'te açılmazdı (EROFS) | **KAPANDI (I7):** sunucu + `portal-kullanici` + `modul-anahtari` üç sırrı yalnız OKUR (`src/keys/server-secrets.ts`), eksikse açık TR hata + komut; `anahtar.ts sirlar-uret` üçünü üretir, var olanı ezmez; bekçi `test_sunucu_sirlari` |
| **G2** | İmajın `dist-cli`'ında `modul-anahtari` CLI'ı yoktu (yalnız `portal-kullanici` + `anahtar`) | `ice-aktar` VDS'te koşamazdı | **KAPANDI (I7):** `deploy/satici/Dockerfile` derleme listesinde + `test -f dist-cli/scripts/modul-anahtari.js`; bekçi `test_docker_hijyeni` §6 (her satıcı CLI'ı derlenir + kapıda) |
| **G3** | Compose satıcı servisinde 3d-1 ortamı (`DOSYA_DIZINI`, `DERLEME_DIZINI`, `YAYIN_DIZINI`, `GENEL_KOK_ADRESI`) ve bağları yoktu; kök FS salt okunur | `/y` yükleme ve dosya gövdeleri EROFS; sürüm görünümü "ölçülemedi"; portal bağlantısı göreli | **KAPANDI (I7):** ortam + üç bağ (`/dosyalar` yazılır · `/derlemeler` + `/yayin` salt okunur; `/yayin` = güncelleme kökü `html/` + `defter/`), `ornek.env`, `compose-denetle.mjs` ⑨a–f + `test_docker_hijyeni` §6 docker'sız ikizi |
| **G4** | `vds-dogrula.sh` tabanı bayat (09-28) ve betik taban yolu almıyor | her koşum FARK basar, gerçek farkı gizler | §1.2 tazeleme; betiğe taban dizini argümanı (repo dışı araç — yönetici) |
| **G5** | `paketle.ps1` şifreli modül (`build-korumali.mjs --sifrele`) seçeneği taşımıyordu | şifreli modül provası (§7.4) yapılamazdı | **KAPANDI (I7):** `-Sifrele` [`-SifreliPaketler`] [`-ModulAnahtarDizini`]; varsayılan ŞİFRESİZ; yalnız `-Korumali` ile, CI'da ve repo içi anahtar dizininde durur; bekçi `test_sunucu_betikleri` §18 |
