# Güncelleyici (Dağıtım v2) — backend Windows hizmeti · Rust güncelleyici · yerel sözleşme

> **Durum:** 2026-09-30, program "Dağıtım v2" (W1). Kullanıcı kararları: güncelleyici BAŞTAN TAMAMEN Rust (uygulama adımında `kur.ps1`/PowerShell YOK) · backend pm2 yerine Windows hizmeti · kendi PostgreSQL örneği · güncelleme politikası kurulum başına (OTOMATİK · ONAYLI · DONDUR).
> **Bölüm sahipliği:** §1–§3 (manifest biçimi · kira `guncelleme` alanı · yayın hattı) **D1**'indir; §4–§13 (fabrika sunucusundaki YEREL sözleşme: dizinler · hizmetler · IPC · güven · durum makinesi · adımlar) **D2**'nindir. Birleştirmede iki dalın bu dosyası üst üste konur: D1'in §1–§3'ü + bu dalın §4–§13'ü.
> **Kod:** `Teks-Erp/native/` Cargo çalışma alanı — `tekserp-dogrulama` (ORTAK doğrulama: lisans çekirdeği ile güncelleyici aynı kodu bağlar) · `tekserp-guncelleyici` (hizmet: `TeksERP-Guncelleyici`) · `tekserp-hizmet` (backend hizmet konağı: `TeksERP-Backend`) · `lisans-cekirdek` (napi `.node`, davranışı değişmedi).

## §1–§3 — D1 (manifest · kira `guncelleme` · yayın hattı)

> D1'in metni buraya girer. D2 bu bölümlere §6'daki denetimlerle bağlanır; D1 dondurunca §6.3–§6.4'teki GEÇİCİ alan adları D1'inkilerle hizalanır (kod: `tekserp-guncelleyici/src/manifest.rs` · `politika.rs`).

## §4 Fabrika sunucusu — dizin düzeni ve hizmetler (YEREL SÖZLEŞME)

### §4.1 Dizin düzeni

Kök `<KOK>` kuruluma özgüdür (varsayılan `C:\TeksERP`; SAHINSRV bugün `C:\Etkili-Yazilim`) — hiçbir ikili kökü koda gömmez, iki hizmet de `--kok <KOK>` argümanıyla kurulur (§4.2).

| Yol | İçerik | Yazan | Not |
|---|---|---|---|
| `<KOK>\surumler\<surum>\` | Backend paketinin AÇILMIŞ hâli (zip kökü = bu dizin): `dist\` · `runtime\node.exe` · `runtime\tekserp-hizmet.exe` · `runtime\tekserp-guncelleyici.exe` · `native\` · `node_modules\` · `prisma\` · `public\` · `assets\` · `package.json` · `butunluk.jws` · `butunluk-liste.txt` · `PAKET.json` | yalnız güncelleyici | Açıldıktan sonra DEĞİŞMEZ; imzalı kapsamın içine dosya eklenmez (bütünlük `FAZLA` verir). |
| `<KOK>\surumler\.hazirlik-<surum>\` | Açılmakta olan sürüm | güncelleyici | Bütünlük GEÇERLİ olunca `surumler\<surum>`e yeniden adlandırılır; yarım kalanı açılışta silinir. |
| `<KOK>\current` | **Dizin bağlantısı (junction)** → `surumler\<surum>` | yalnız güncelleyici | Backend hizmeti YALNIZ bu yoldan koşar. Backend DURMUŞKEN değiştirilir. |
| `<KOK>\ayar\backend.env` | Backend ortamı (`KEY=VALUE`; bugünkü `app\.env` + ecosystem `env` bloğunun birleşimi) | kurulum (D5) · geçiş (D6) · yönetici | Sır taşır. Konak okur ve node'a ortam olarak verir; güncelleyici `DATABASE_URL` · `PORT` · `BACKUP_KEY_DIR` · `PG_BIN_DIR` · `LICENSE_DIR` okur. Sürüm dizinine `.env` KONMAZ. |
| `<KOK>\guncelleyici\` | `tekserp-guncelleyici.exe` (+ kendini güncellemede `.yeni.exe` / `.eski.exe`) · `ayar.json` | kurulum · güncelleyici | Hizmetin ImagePath'i buradadır (`current`in DIŞINDA — geri dönüş güncelleyiciyi değiştirmez). |
| `<KOK>\lisans\` | `LICENSE_DIR` (kira, HAK, kurulum anahtarı, `durum.json`) | backend | Güncelleyici YALNIZ OKUR (kira + kök zinciri, §6.2). |
| `<KOK>\veri\` | Backend'in yazdığı kalıcı dosyalar (yükleme, belge önbelleği…) | backend | |
| `<KOK>\gunluk\backend\` | Konağın yakaladığı node stdout/stderr (`backend.log`, 10 × 20 MB döner) + `hizmet.log` | konak (backend hesabı) | |
| `<KOK>\gunluk\guncelleyici\` | `guncelleyici.log` (10 × 10 MB döner) | güncelleyici | |
| `<KOK>\yedek\` | Gece yedekleri (bugünkü `backups\`; geçiş D6) | backend / zamanlanmış görev | |
| `<KOK>\yedek\guncelleme\<islemId>\` | Güncelleme öncesi şifreli yedek `db.dump.tkenc` | güncelleyici | Son 3 işlemin yedeği tutulur; daha eskisi silinir (yalnız bu dizin). |
| `<KOK>\yedek-anahtar\` | `*.tkpub` alıcılar (+ `yerel.tkkey`) — bugünkü düzen; `BACKUP_KEY_DIR` varsa o | kurulum | Güncelleyici yalnız `*.tkpub` okur. |
| `<KOK>\pgsql\<surum>-<derleme>\` | PostgreSQL ikilileri, sürüm başına YAN YANA (D4 `KENDI-POSTGRESQL.md` §0) — ör. `pgsql\16.15-4` | kurulum · güncelleyici | Bir önceki sürüm geri dönüş için kalır, daha eskisi silinir (D4 §5 U11). |
| `<KOK>\pgsql\bin` | **junction** → etkin sürümün `bin`'i | kurulum · güncelleyici | `PG_BIN_DIR` bu yoldur; yedekleme, bakım betikleri ve backend bu yolu okur — sözleşme KORUNUR (D4). |
| `<KOK>\pgsql\ornek.json` | Örnek kaydı (D4 §6): `{bicim, kip: kendi\|harici, hizmet, surum, derleme, ikiliDizin, oncekiIkiliDizin, veriDizini, port, kuruldu, guncellendi}` | kurulum · güncelleyici (SYSTEM/Administrators) | `kip: harici` ⇒ güncelleyici PG'ye HİÇ dokunmaz (§9). |
| `<KOK>\pgveri\` | `PGDATA` (D4; başka sabit NTFS sürücü seçilebilir — yol `ornek.json`da) | PG hizmeti | Güncelleyici veri dizinine DOKUNMAZ (küçük sürüm aynı disk biçimi). |
| `<KOK>\kurulum-gecmisi.jsonl` | Kurulum/geri alma kayıtları (`InstallRecordSchema`, `dirname(LICENSE_DIR)`) | güncelleyici | Backend son 10 satırı yoklamada satıcıya taşır — biçim bugünkü `kur.ps1` ile BİREBİR (§8.8). |
| `%ProgramData%\TeksERP\guncelleme\niyet\niyet.json` | NİYET (§5.1) | backend | |
| `%ProgramData%\TeksERP\guncelleme\durum\durum.json` · `gecmis.jsonl` | DURUM (§5.2) · işlem geçmişi (§5.3) | güncelleyici | |
| `%ProgramData%\TeksERP\guncelleme\is\` | Güncelleyicinin özel alanı: işlem günlüğü `islem.jsonl`, indirmeler, doğrulanmış manifest, geçici yedek anahtarı (DPAPI) | güncelleyici | Backend hesabına KAPALI. |

`<KOK>\current` junction'dır, sembolik bağ değildir: yerel ve ayrıcalık istemez. Backend'in çalışma dizini `<KOK>\current` (ÇÖZÜLMEMİŞ yol) — `LICENSE_DIR`/`MOBILE_UPDATE_DIR` varsayılanları `cwd\..` üzerinden `<KOK>`e iner; `backend.env` bu dizinleri ayrıca açık verir. ⚠ Node ana modülün yolunu ÇÖZER: `__dirname` = `surumler\<surum>\dist` — `__dirname`den iki üst dizine çıkan kod `surumler\` altına düşer (D3 tarar).

### §4.2 Hizmetler (SCM)

| Hizmet | İkili (ImagePath) | Hesap | Başlatma | Bağımlılık | Kurtarma |
|---|---|---|---|---|---|
| `TeksERP-PostgreSQL` | `<KOK>\pgsql\<surum>-<derleme>\bin\pg_ctl.exe runservice -N TeksERP-PostgreSQL -D "<PGDATA>" -w` (D4 §4.9; küçük sürümde güncelleyici sürüm dizinini değiştirir) | `NT SERVICE\TeksERP-PostgreSQL` | otomatik | — | 60 sn · 60 sn · 300 sn (D4) |
| `TeksERP-Backend` | `"<KOK>\current\runtime\tekserp-hizmet.exe" hizmet --kok "<KOK>"` | `NT SERVICE\TeksERP-Backend` (sanal hesap, parolasız) | otomatik (gecikmeli) | `TeksERP-PostgreSQL` | 5 sn · 15 sn · 60 sn sonra yeniden başlat; sayaç 1 günde sıfırlanır; çökmesiz hata çıkışında da uygulanır |
| `TeksERP-Guncelleyici` | `"<KOK>\guncelleyici\tekserp-guncelleyici.exe" hizmet --kok "<KOK>"` | `LocalSystem` | otomatik (gecikmeli) | — | 10 sn · 30 sn · 60 sn; çökmesiz hata çıkışında da |

- Kayıt TEK YERDE, ikililerin kendi alt komutuyla: `tekserp-hizmet.exe hizmet-kur --kok <KOK>` · `tekserp-guncelleyici.exe hizmet-kur --kok <KOK>` (ve `hizmet-kaldir`). Kurulum (D5), geçiş (D6) ve CI dumanı bu komutları çağırır; `sc.exe create` elle YAZILMAZ — hesap, bağımlılık, kurtarma ve olay günlüğü kaynağı (§11) tek kaynaktan gelsin.
- Backend ImagePath'i `current` ÜZERİNDENDİR: konak sürümle birlikte gelir, geri dönüşte eskisine döner; ayrı bir kendini güncelleme yolu yoktur.
- "Tek backend süreci" kuralı: konak node'u bir **Windows iş nesnesine** (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) koyar — konak ölürse node da ölür; SCM yeniden başlattığında yetim node portu tutmaz.

### §4.3 Backend hizmet konağı (`tekserp-hizmet`) sözleşmesi

- **Başlatma:** `<KOK>\ayar\backend.env` okunur (yoksa ya da biçimsizse node BAŞLATILMAZ, çıkış 12). Ortam = sistem ortamı + `backend.env` + sabitler: `NODE_ENV=production` · `TEKSERP_KOK=<KOK>` · `TEKSERP_HIZMET_KONAGI=1`. Süreç: `<KOK>\current\runtime\node.exe dist\server.js`, çalışma dizini `<KOK>\current`, stdin = boru, stdout/stderr → `gunluk\backend\backend.log` (döner). Ortam DEĞERLERİ hiçbir günlüğe yazılmaz (yalnız anahtar adları).
- **Doğrulama kipi:** hizmet `--dogrulama` başlatma argümanıyla başlatılırsa (güncelleyici §8.6'da böyle başlatır) ortama `HOST=127.0.0.1` ve `TEKSERP_DOGRULAMA_KIPI=1` eklenir. **D3:** bu kipte backend yalnız döngü arayüzünde dinler, arka plan işlerini (bulut eşitleme, zamanlanmış yedek, mDNS keşfi, dış yoklama) BAŞLATMAZ — geri dönüşte DB yedekten geri yüklenebilsin diye istemci yazısı kabul edilmez.
- **Durdurma:** SCM `STOP`/`SHUTDOWN`/`PRESHUTDOWN` → konak node'un stdin'ine `kapat\n` yazar ve stdin'i kapatır; 25 sn bekler (SCM'e `STOP_PENDING` + bekleme ipucu bildirir); süre dolarsa iş nesnesini sonlandırır. **D3:** `TEKSERP_HIZMET_KONAGI=1` iken backend stdin'de `kapat` satırı ya da EOF görünce bugünkü düzgün kapanış yolunu (pm2 `shutdown` mesajının yaptığı) koşar ve 0 ile çıkar.
- **Çıkış kodları (hizmete özgü, SCM kurtarmasını tetikler):** `0` istenen durdurma · `10` node beklenmedik çıktı (çökme) · `11` node başlatılamadı (`runtime\node.exe` ya da `dist\server.js` yok) · `12` ortam dosyası yok/biçimsiz · `13` iş nesnesi kurulamadı. Node'un kendi kodu (ör. korumalı yükleyicinin `78`i) `hizmet.log`a ve olay günlüğüne yazılır.

### §4.4 Erişim denetimi (ACL) — D3 uygular

| Yol | SYSTEM · Administrators | `NT SERVICE\TeksERP-Backend` | Diğer |
|---|---|---|---|
| `surumler\` (+ `current` üzerinden) | Tam | Okuma + Yürütme | — |
| `guncelleyici\` | Tam | — | — |
| `ayar\` · `ayar\backend.env` | Tam | Okuma | — |
| `lisans\` · `veri\` · `gunluk\backend\` · `yedek\` (gece yedeği backend'in işiyse) · `mobil-guncelleme\` | Tam | Değiştirme | — |
| `gunluk\guncelleyici\` · `yedek\guncelleme\` | Tam | — | — |
| `%ProgramData%\TeksERP\guncelleme\niyet\` | Tam | Değiştirme | — |
| `%ProgramData%\TeksERP\guncelleme\durum\` | Tam | Okuma | — |
| `%ProgramData%\TeksERP\guncelleme\is\` | Tam | — | — |
| `pgsql\` · `pgveri\` | D4 | — | — |

İki IPC dosyası AYRI dizinlerdedir: her tarafın kendi dizininde "geçici dosyaya yaz + yeniden adlandır" hakkı vardır ve öbürünün dosyasını silemez/değiştiremez (dosya düzeyi ACL'le aynı dizinde bu sağlanamaz).

## §5 IPC — niyet · durum · geçmiş

Genel: UTF-8 (BOM'suz) JSON; yazan taraf `<ad>.tmp`e yazar, diske boşaltır (`FlushFileBuffers`) ve `<ad>`ın üstüne yeniden adlandırır — okuyan yarım dosya görmez. Okuyan biçimsiz dosyayı YOK sayar (durum `hataKodu: NIYET_BICIMSIZ`). Zaman damgaları UTC ISO-8601 (`Z`). Alan adları Türkçe; tanınmayan alan yok sayılır (ileri uyum).

### §5.1 `niyet\niyet.json` — backend yazar, güncelleyici okur

```json
{
  "v": 1,
  "niyetId": "6f0c…-uuid",
  "yazildi": "2026-09-30T20:00:00Z",
  "urun": "backend",
  "surum": "2.13.0",
  "manifestYolu": "/adnansahin/backend/2.13.0/manifest.jws",
  "indirme": { "belirtec": "<JWS tekserp-indirme>", "bitis": "2026-09-30T21:05:00Z" },
  "saatDilimi": "Europe/Istanbul",
  "onay": { "kullaniciId": "…uuid", "ad": "Ayşe Y.", "zaman": "2026-09-30T19:58:00Z", "planlanan": null }
}
```

- `niyetId`: backend her YENİ niyette (yeni sürüm ya da yeni onay) yenisini üretir; güncelleyici bir niyeti bir kez SONUÇLANDIRIR: `GERI_DONDU`/`HATA` ile biten `niyetId` kendiliğinden yeniden denenmez (her gece dur-yedekle-geri dön döngüsü olmasın) — yeniden deneme yeni niyettir (panelde yeniden onay ya da yeni sürüm). Belirteç tazelemesi aynı `niyetId`yi korur.
- `urun`: `backend` (bu sürüm) — `pg` ve `guncelleyici` kendi başına niyet almaz; PG küçük sürümü backend manifestinin `pgSurum` alanından (§9), güncelleyicinin kendisi başarılı backend işleminin paketinden (§10) gelir.
- `manifestYolu`: güncelleme sunucusundaki YOL (adres değil). Biçim `/<kanal>/backend/…`, `[A-Za-z0-9._/-]`, `..`/`//`/`\`/`%` YOK, ≤ 200. Sunucu kökü güncelleyicinin kendi `ayar.json`undadır (§6.1) — niyet başka bir sunucuya yönlendiremez.
- `indirme`: kiranın yoklamasıyla gelen İNDİRME belirteci (`X-TKL-Indirme` başlığıyla sunulur, Worker doğrular; ömrü ≤ 70 dk). Süresi dolmuşsa güncelleyici indirmeyi askıya alır (`BELIRTEC_SURESI_DOLDU`); backend bir sonraki yoklamada taze belirteçle niyeti yeniden yazar (aynı `niyetId` korunabilir).
- `saatDilimi`: fabrikanın BUGÜNKÜ IANA dilimi (tek kaynak `src/constants/time.ts`); yoksa `Europe/Istanbul`. Yalnız pencere hesabında kullanılır.
- `onay`: yalnız ONAYLI kipte anlamlıdır; panelde onaylayan kullanıcı (backend kimliği doğrular). `planlanan`: `null` = hazır olunca hemen · ISO zaman = o andan önce değil (panelin "bu gece kur"u pencerenin başlangıcını yazar). Onay, niyetteki `surum` İÇİNDİR.

### §5.2 `durum\durum.json` — güncelleyici yazar, backend okur

```json
{
  "v": 1,
  "durum": "HAZIR",
  "urun": "backend",
  "surum": "2.13.0",
  "kaynakSurum": "2.12.4",
  "kuruluSurum": "2.12.4",
  "adim": null,
  "hataKodu": null,
  "mesaj": "Paket doğrulandı; pencere bekleniyor (02:00–05:00).",
  "niyetId": "6f0c…",
  "islemId": null,
  "ilerleme": { "indirilen": 184549376, "toplam": 184549376 },
  "planlanan": "2026-09-30T23:00:00Z",
  "politika": { "kip": "OTOMATIK", "izin": true, "neden": null },
  "guncelleyiciSurum": "0.1.0",
  "zaman": "2026-09-30T20:07:12Z"
}
```

| `durum` | Anlamı | Geçiş |
|---|---|---|
| `BEKLIYOR` | İş yok ya da politika/niyet beklemede (`politika.izin=false` + `neden`) | → `INDIRILIYOR` |
| `INDIRILIYOR` | Manifest doğrulandı, paket iniyor (`ilerleme`) | → `HAZIR` · `HATA` |
| `HAZIR` | Paket sha256 + PAKET imzası + bütünlük listesi doğrulandı, `surumler\<surum>` açıldı; pencere/onay bekleniyor (`planlanan`) | → `UYGULANIYOR` |
| `UYGULANIYOR` | Uygulama adımları (`adim`: §8) | → `BASARILI` · `GERI_DONDU` · `HATA` |
| `BASARILI` | Yeni sürüm sağlıklı; `kuruluSurum` = `surum` | → `BEKLIYOR` (yeni niyette) |
| `GERI_DONDU` | Sorun çıktı, önceki sürüme (ve gerekirse yedekten DB'ye) dönüldü; `hataKodu` sebebi | → `BEKLIYOR` |
| `HATA` | Geri dönüş de TAMAMLANAMADI ya da sürdürülemeyen hata — İNSAN gerekir; olay günlüğüne hata düşer | yalnız elle (`tekserp-guncelleyici.exe onar`) |

`adim` değerleri §8'deki adım adlarıdır; `GERI_DON:<adım>` geri dönüşün hangi telafide olduğunu söyler. `mesaj` Türkçe, insan içindir ve sır taşımaz.

### §5.3 `durum\gecmis.jsonl` — güncelleyici ekler (panelin "geçmiş"i)

Her SONUÇLANAN işlem için bir satır: `{v:1, islemId, niyetId, urun, kaynakSurum, surum, sonuc: BASARILI|GERI_DONDU|HATA, hataKodu, basladi, bitti, gocSayisi: {once, sonra}, yedek: "<islemId>" | null, onay: {…} | null}`. Dosya 1000 satırı aşınca en eskisi atılır (yeni dosyaya kopya + yeniden adlandırma).

## §6 Güven modeli — güncelleyici neye güvenir

Güncelleyici SYSTEM'dir; backend düşük yetkilidir. **Niyet dosyası yetki DEĞİLDİR**: yalnız "ne zaman bakılacağını" ve "belirteci" taşır. Kurulabilecek şeyi SATICI İMZASI belirler; güncelleyici her şeyi kendisi doğrular (tek doğrulama kodu: `tekserp-dogrulama`, lisans çekirdeğiyle aynı).

### §6.1 Kendi ayarı — `<KOK>\guncelleyici\ayar.json` (yalnız SYSTEM/Administrators yazar)

`{v:1, guncellemeSunucusu: "https://…", vekil: null | "http://host:port", pgVeriDizini: "<KOK>\\pgveri", saglikZamanAsimiSn: 180, durdurmaZamanAsimiSn: 60}`. Yoksa derlemedeki varsayılanlar. Sunucu yalnız `https://` (test derlemesinde `http://127.0.0.1`).

### §6.2 Kira (yetki kaynağı)

`LICENSE_DIR`deki (`backend.env`deki `LICENSE_DIR`, yoksa `<KOK>\lisans`) kira dosyası, derlemeye GÖMÜLÜ kök çapasıyla (`tekserp_dogrulama::anchor`) zincirden doğrulanır (`chain::verify_lease`). Geçersiz/okunamaz/süresi dolmuş (`bitis + ekSureGun` + saat toleransı) kira ⇒ güncelleme YOK (`KIRA_GECERSIZ` · `KIRA_SURESI_DOLDU`). Kira silinerek dondurma atlatılamaz: kira yoksa güncelleme de yoktur (fail-closed). Politika:

- `yaptirim.guncellemeDonuk` ya da `yaptirim.kademe = K1` ⇒ DONDUR (indirme dahil hiçbir şey) — `LISANS-PROTOKOLU.md` §7 (sunucunun imzalı kararı, madde 5).
- `guncelleme` alanı (D1, §1–§3): `kip` OTOMATİK · ONAYLI · DONDUR, `pencere` (fabrika saatiyle `HH:MM–HH:MM`, gece yarısını geçebilir), `hedefSurum?`, `dondur`. Alan yoksa ⇒ ONAYLI (bugünkü davranış: kimse sormadan kurulmaz).
- Kurulabilir sürüm üst sınırı: `min(kanal.guncelSurumler.backend, guncelleme.hedefSurum?)`; alt sınır: kurulu sürümden BÜYÜK (sürüm geriye götürülmez — göçler tek yönlü; geri dönüş yalnız yerel önceki sürüme).

### §6.3 Manifest (GEÇİCİ tip — D1 dondurunca hizalanır)

JWS, PAKET anahtarıyla imzalı (`kid` `paket-*`, gömülü `BUILTIN_PACKAGE_KEYS`). Güncelleyicinin denetimi: imza · `urun = backend` · `kanal = kira.kanal.kod` · `surum = niyet.surum` ve §6.2 sınırları içinde · kurulu sürüm ≥ `enAzKaynakSurum` (varsa) · `paket.yol` aynı kanal öneki altında · `paket.sha256` + `paket.boyut` · `gocSayisi` · `pgSurum?`.

### §6.4 Paket

İndirilen zip'in sha256'sı ve boyu manifestteki değere EŞİT olmadan zip AÇILMAZ (imzasız veri zip ayrıştırıcısına girmez). Açma: yalnız göreli yollar (`..`, sürücü harfi, mutlak yol, ters eğik çizgi → RED `PAKET_YOL`), sembolik bağ girdisi RED. Açıldıktan sonra `butunluk.jws` gömülü PAKET anahtarlarıyla ve `butunluk-liste.txt`e karşı doğrulanır (`integrity::verify`): `GECERLI` değilse sürüm dizini silinir (`PAKET_BUTUNLUK`). Ek olarak `butunluk.jws`nin `surum`u = manifest `surum`, `urun` = `tekserp-backend` ailesi, `musteri` null ya da kanal kodu.

## §7 Durum makinesi ve çökme güvenliği

- **İşlem günlüğü** `is\islem.jsonl`: her adımın BAŞLADI satırı adım ÇALIŞMADAN önce, BİTTİ satırı adım bittikten sonra yazılır; her satır `FlushFileBuffers` ile diske iner. Satır: `{sira, islemId, adim, olay: BASLADI|BITTI|TELAFI_BASLADI|TELAFI_BITTI|SONUC, zaman, veri}`. `veri` kararlaştırılmış değerleri taşır (önceki `current` hedefi, göç sayısı öncesi, yedek yolu…) ki yeniden başlayan süreç yeniden HESAPLAMASIN.
- **Açılış:** son işlem SONUÇ satırı taşımıyorsa YARIM işlemdir → §8'deki adım tablosunun "yarımda" sütunu uygulanır: DEVAM (adım yeniden koşulur — her adım tekrarlanabilir yazılmıştır) ya da GERİ AL (telafiler ters sırada; her telafi tekrarlanabilir). Geri alma da yarım kalabilir; açılış onu da sürdürür.
- **Değişmez:** her son durumda (`BASARILI` · `GERI_DONDU`) backend TEK süreçtir ve `current`in gösterdiği sürümle DB şeması uyumludur: `BASARILI` ⇒ `current` → yeni + göç uygulandı; `GERI_DONDU` ⇒ `current` → eski + DB işlem öncesi hâlinde (göç başladıysa yedekten geri yüklendi). Bunu sağlayamayan tek son durum `HATA`dır (insan).
- **Kilit:** tek güncelleyici süreci — `is\kilit` dosyası paylaşımsız açık tutulur; ikinci süreç (elle koşulan CLI dahil) `KILIT_DOLU` ile çıkar.

## §8 Backend güncellemesinin adımları

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda (açılış) |
|---|---|---|---|---|
| 1 | `ON_KOSUL` | kira + politika + pencere/onay + manifest + `surumler\<surum>` bütünlüğü (HAZIR'dakiyle aynı denetim) + boş disk (≥ paket×3 + 2 GB) + kurulu sürüm/göç sayısı ölçümü + ÖNCEKİ sağlık görüntüsü (`/health`, §8.7) | — | DEVAM |
| 2 | `BACKEND_DURDUR` | `TeksERP-Backend` durdur (≤ `durdurmaZamanAsimiSn`) | backend'i ESKİ `current` ile başlat + sağlık | DEVAM |
| 3 | `YEDEK` | backend DURMUŞKEN `pg_dump -Fc` → `yedek-sifrele sifrele` (alıcılar: `yedek-anahtar\*.tkpub` + işleme özgü GEÇİCİ anahtar, §8.3) → `pg_restore --list` | — | DEVAM (yeniden al) |
| 4 | `GECIS` | `current` → `surumler\<yeni>` (önceki hedef günlüğe) | `current` → önceki hedef | DEVAM |
| 5 | `GOC` | göç sayısı (önce) → `current\runtime\node.exe node_modules\prisma\build\index.js migrate deploy` (ortam `backend.env`; çalışma dizini `current`) → göç sayısı (sonra) | göç BAŞLADIYSA: eski sürümün aracıyla yedek çöz → `pg_restore --clean --if-exists` → göç sayısı = önceki | GERİ AL |
| 6 | `DOGRULAMA` | backend'i `--dogrulama` ile başlat (yalnız 127.0.0.1) → sağlık (§8.7) | backend'i durdur | DEVAM (yeniden doğrula) |
| 7 | `BASLAT` | durdur → normal başlat → sağlık (sürüm + DB) | backend'i durdur | DEVAM |
| 8 | `ONAY` | SONUÇ=BASARILI · `kurulum-gecmisi.jsonl` · `gecmis.jsonl` · eski sürüm dizinlerini buda (son 2 sürüm + `current` kalır) · eski yedekleri buda · kendini güncelleme denetimi (§10) | — | DEVAM |

- **§8.3 Geçici yedek anahtarı:** mevcut `.tkenc` yerel anahtarı YEDEK PAROLASIYLA sarılıdır — sunucu kendi yedeğini gözetimsiz ÇÖZEMEZ. Otomatik geri dönüş için güncelleyici her işlemde paketteki araçla (`yedek-sifrele anahtar-uret --ad guncelleme --dizin <is> --ozel-cikti <dosya>`) bir X25519 çifti üretir, özel yarıyı DPAPI (SYSTEM kapsamı) ile sarar ve düzünü siler; yedek hem kurulumun kendi alıcılarına hem bu anahtara şifrelenir (`--alici` tekrarlı). Müşteri anahtarı yedeği her zaman açar; geçici anahtar yalnız bu sunucuda ve bir sonraki başarılı işleme kadar yaşar. `yedek-anahtar\` boşsa yedek yalnız geçici anahtara şifrelenir.
- **§8.5 Göç:** SİSTEM node'u DEĞİL, sürümün kendi `runtime\node.exe`si. Göç sayısı bugünkü sorguyla (`_prisma_migrations`: `finished_at IS NOT NULL AND rolled_back_at IS NULL`) `<PG_BIN_DIR>\psql.exe` ile ölçülür; ölçülemezse "göç BAŞLADI ve bilinmiyor" sayılır (geri dönüşte DB geri yüklenir). `migrate deploy` 30 dk'dan uzun sürerse süreç ağacı sonlandırılır → geri dönüş.
- **§8.6 İki aşamalı başlatma:** doğrulama başlatması (6) istemcilere kapalıdır; bu yüzden sağlık düşerse DB'yi yedekten geri yüklemek istemci yazısı KAYBETTİRMEZ. Normal başlatmadan (7) sonra geri dönüş gerekirse aradaki kısa pencerenin yazısı kaybolabilir — adım 7 yalnız "sürüm + DB" bakar ve doğrulamadan geçmiş aynı ikiliyle koşar.
- **§8.7 Sağlık:** `GET http://127.0.0.1:<PORT>/health` (5 sn istek zaman aşımı, 2 sn aralık, toplam `saglikZamanAsimiSn`): HTTP 200 · `status = UP` · `db = UP` · `version = <yeni surum>`. Lisans: **D3** `/health`e YALNIZ döngü adresinden gelen istekte `lisans: {kip, butunluk, cekirdek}` ekler; güncelleyici yeni sürümde bu alanı ZORUNLU sayar (yoksa `SAGLIK_LISANS_OLCULEMEDI`) ve işlem öncesi görüntüden KÖTÜ olamaz: `butunluk` önce `GECERLI` idiyse sonra da `GECERLI`, `cekirdek` önce `native` idiyse sonra da `native`, `kip` önce `KISITLI`/`DURDURULMUS` değilken sonra o olamaz.
- **§8.8 Kurulum kaydı:** `<KOK>\kurulum-gecmisi.jsonl`e `kur.ps1` ile birebir biçim (`InstallRecordSchema`): `tur` KURULUM (başarı) · GERI_ALMA (geri dönüş sonrası, `oncekiSurum` yeni, `yeniSurum` eski) · `damga` = işlem başlangıcı `yyyyMMdd_HHmmss` · `paketOzeti` zip'in hex sha256'sı · `commit` `PAKET.json`dan · `geriDonus {kod: true, veri: true, veriSifreli: true}`.

## §9 PostgreSQL küçük sürümü (D4 `KENDI-POSTGRESQL.md` §5 U0–U11)

**Koşul:** `pgsql\ornek.json` `kip: "kendi"` · manifestin `pg.hedef` (sürüm, derleme) kuruludan farklı · aynı çizgi (`<PGDATA>\PG_VERSION` = `pg.cizgi`; değilse RED `PG_BUYUK_SURUM` → büyük sürüm runbook'u). **`kip: "harici"`** (bugünkü kurulumlar) ⇒ güncelleyici PG hizmetine, ikililerine, yapılandırmasına DOKUNMAZ; yalnız `pg.enAz` denetlenir: harici sunucu (`SHOW server_version`) altındaysa backend güncellemesi REDDEDİLİR (`PG_SURUM_ESKI`, fail-closed). Aynı koşuda PG adımı backend'den ÖNCE gelir; PG işlemi `GERI_DONDU`/`HATA` ise backend'e dokunulmaz.

- **Hazırlık (HAZIR'dan önce, canlı sisteme dokunmaz — U0–U2):** PG paketi (kanalda AYRI dosya, D1) manifestteki boyut + sha256'yla indirilir; `pgsql\.hazirlik-<surum>-<derleme>`e açılır, her dosya `TEKSERP-ICERIK.sha256` manifestosuna karşı ölçülür (+ özeti manifestin `icerikSha256`sına eşit), `bin\postgres.exe --version` yeni sürümü söyler, `pg_controldata <PGDATA>` okunur; sonra `pgsql\<surum>-<derleme>`e yeniden adlandırılır.
- **Uygulama (işlem günlüğüyle, `urun: pg`):**

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda |
|---|---|---|---|---|
| U3 | `PG_YEDEK` | §8.3'teki şifreli yedek, ESKİ `bin` ile | — | DEVAM |
| U4 | `BACKEND_DURDUR` | backend'i durdur | backend'i başlat + sağlık | DEVAM |
| U5 | `PG_DURDUR` | `TeksERP-PostgreSQL` durdur; `postmaster.pid` kalmadığını ölç | PG'yi (eski yolla) başlat → `SHOW server_version` = eski → ICU farklıysa U9 | DEVAM |
| U6 | `PG_YOL` | hizmetin ImagePath'indeki `<eski>` dizini → `<yeni>` (geri okunur) | ImagePath → `<eski>` | DEVAM |
| U7 | `PG_BAGLANTI` | `pgsql\bin` junction → `<yeni>\bin` (hedef ölçülür) | junction → `<eski>\bin` | DEVAM |
| U8 | `PG_BASLAT` | başlat → hazır → `SHOW server_version` = yeni | PG'yi durdur | DEVAM |
| U9 | `PG_ICU` | ICU sürümü değiştiyse (`icuuc<N>.dll`) ya da manifest `reindex-icu` diyorsa: ICU collation'a bağlı index'ler katalogdan bulunur → `REINDEX INDEX` → `ALTER COLLATION … REFRESH VERSION` (uygulama rolüyle) | (U5'in telafisinde yeniden) | DEVAM |
| U10 | `BACKEND_BASLAT` | backend'i başlat → sağlık (§8.7) | backend'i durdur | DEVAM |
| U11 | `ONAY` | `ornek.json`: yeni sürüm + `oncekiIkiliDizin = <eski>`; bir önceki dizin KALIR, daha eskiler silinir | — | DEVAM |

Küçük sürüm veri dizinini değiştirmez: telafide DB geri yüklemesi YOKTUR (yalnız veri bozulması şüphesinde, insan kararı). Büyük sürüm geçişi OTOMATİK DEĞİLDİR (D4 runbook'u `PG-BUYUK-SURUM-GECISI.md`).

## §10 Kendini güncelleme

Paket `runtime\tekserp-guncelleyici.exe` taşır. Backend işlemi `BASARILI` olunca, paketteki ikilinin sürümü çalışanınkinden büyükse: `guncelleyici\tekserp-guncelleyici.yeni.exe`ye kopyalanır → `.yeni.exe kunye` çalıştırılır (0 ve beklenen sürüm dönmeli) → günlüğe `KENDI_GUNCELLEME` → çalışan ikili `.eski.exe`ye, `.yeni.exe` asıl ada yeniden adlandırılır (çalışan exe yeniden adlandırılabilir) → hizmet `KENDI_GUNCELLEME` koduyla çıkar, SCM kurtarması yeni ikiliyle başlatır. Yeni ikili İLK iş olarak bir açılış sayacı tutar: doğrulanmadan 3. açılışa gelirse `.eski.exe`yi geri koyar ve çıkar (A/B açılış sayacı); açılışı tamamlarsa `.eski.exe`yi siler.

## §11 Günlük

- **Olay günlüğü** (Uygulama): kaynaklar `TeksERP-Guncelleyici` · `TeksERP-Backend`; `hizmet-kur` kaydeder. Bilgi: işlem başladı/bitti, sürüm; Uyarı: geri dönüş; Hata: `HATA` durumu, konağın beklenmedik node çıkışı.
- **Dosya:** `gunluk\guncelleyici\guncelleyici.log` · `gunluk\backend\hizmet.log` · `gunluk\backend\backend.log` (node çıktısı). Satır: `<ISO zaman> <DÜZEY> <ileti>`; sır YOK (`backend.env` değerleri, belirteç, parolalar yazılmaz — belirteç yalnız ilk 8 karakteriyle).

## §12 Hata kodları (`durum.json` `hataKodu`)

`NIYET_YOK` · `NIYET_BICIMSIZ` · `KILIT_DOLU` · `AYAR_BICIMSIZ` · `KIRA_YOK` · `KIRA_GECERSIZ` · `KIRA_SURESI_DOLDU` · `POLITIKA_DONDUR` · `YAPTIRIM_DONUK` · `SURUM_IZINSIZ` · `SURUM_ESKI` · `KAYNAK_SURUM_ESKI` · `PG_SURUM_ESKI` · `PG_BUYUK_SURUM` · `PG_DURMADI` · `PG_BASLAMADI` · `PG_SURUM_UYUSMAZ` · `PG_ICU_HATASI` · `PG_YOL_HATASI` · `MANIFEST_INDIRILEMEDI` · `MANIFEST_GECERSIZ` · `BELIRTEC_SURESI_DOLDU` · `INDIRME_REDDEDILDI` · `INDIRME_HATASI` · `PAKET_OZET` · `PAKET_YOL` · `PAKET_BUTUNLUK` · `DISK_DOLU` · `HIZMET_DURMADI` · `YEDEK_HATASI` · `GECIS_HATASI` · `GOC_HATASI` · `GOC_ZAMAN_ASIMI` · `SAGLIK_ZAMAN_ASIMI` · `SAGLIK_SURUM` · `SAGLIK_DB` · `SAGLIK_LISANS` · `SAGLIK_LISANS_OLCULEMEDI` · `GERI_YUKLEME_HATASI` · `KESINTI` (yarım işlem açılışta geri alındı) · `IC_HATA`.

## §13 Diğer dilimlerin bu sözleşmeden işi

- **D1:** manifest (`surum` = `package.json` `version` = `butunluk.jws` `surum`; `kanal`; `paket{yol, sha256, boyut}`; `enAzKaynakSurum?`; `gocSayisi`; `pg?: {cizgi, enAz, hedef: {surum, derleme, paket, boyut, sha256, icerikSha256, icuSurum}}` — D4 §8) · kira `guncelleme{kip, pencere, hedefSurum?, dondur}` · İNDİRME belirtecinin `yolOneki`ne `/<kanal>/backend/` · paket `runtime\`e iki Rust ikilisi (`tekserp-hizmet.exe`, `tekserp-guncelleyici.exe`) — `runtime` imzalı kapsamdadır.
- **D3:** stdin `kapat`/EOF kapanışı · `TEKSERP_DOGRULAMA_KIPI` · `/health` döngü adresine `lisans{kip,butunluk,cekirdek}` · `niyet.json` yazıcısı (yoklama sonrası; ONAYLI onayı panelden) · `durum.json`/`gecmis.jsonl` okuyucusu (panel, D7) · §4.4 ACL'leri · `__dirname` üst dizin taraması · pm2 sökümü.
- **D4:** CEVAPLANDI (şartname `KENDI-POSTGRESQL.md`, dal `dagitim/d4-pg`): `pgsql\<surum>-<derleme>` + `pgsql\bin` junction + `ornek.json` bu sözleşmeye alındı (§4.1, §9); `PG_BIN_DIR = <KOK>\pgsql\bin`.
- **D5:** `ayar\backend.env` · `guncelleyici\ayar.json` · iki `hizmet-kur` çağrısı · ACL'ler (D3'ün betiği).
- **D6:** `app\` + pm2 + `.env` + ecosystem `env` → `surumler\<surum>` + `current` + `ayar\backend.env`; `backups\` → `yedek\`.
- **D7:** panel `durum.json` + `gecmis.jsonl` okur, onayı `niyet.json`a yazdırır.
