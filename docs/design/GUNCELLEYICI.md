# Güncelleyici (Dağıtım v2) — backend Windows hizmeti · Rust güncelleyici · yerel sözleşme

> **Durum:** 2026-10-01, program "Dağıtım v2". Kullanıcı kararları (2026-09-30): güncelleyici BAŞTAN TAMAMEN Rust (uygulama adımında `kur.ps1`/PowerShell YOK) · backend pm2 yerine Windows hizmeti · kendi PostgreSQL örneği · güncelleme politikası kurulum başına (OTOMATİK · ONAYLI · DONDUR).
> **Bölüm sahipliği:** §0–§3 (roller · sürüm bildirimi · kira `guncelleme` · karar · rapor · fabrika API'si) **D1**'indir ve DONMUŞTUR (sözleşme sürümü 3, dal `dagitim/d1-hat`); §4–§13 (fabrika sunucusundaki YEREL sözleşme) **D2**'nindir. Birleştirmede iki dalın bu dosyası üst üste konur: D1'in §0–§3'ü + bu dalın §4–§13'ü (D1'in "4+." yer tutucusu yerine).
> **Kod:** `Teks-Erp/native/` Cargo çalışma alanı — `tekserp-dogrulama` (ORTAK doğrulama; kiranın `guncelleme` şeması dahil — lisans çekirdeği ile güncelleyici aynı kodu bağlar) · `tekserp-guncelleyici` (hizmet `TeksERP-Guncelleyici`; sözleşmenin Rust aynası `release.rs` + `decision.rs`, D1 vektörleriyle ölçülür) · `tekserp-hizmet` (backend hizmet konağı `TeksERP-Backend`) · `lisans-cekirdek` (napi `.node`).

## §0–§3 — D1 (roller · sürüm bildirimi · kira `guncelleme` · karar · rapor · fabrika API'si)

> D1'in DONMUŞ metni buraya girer (dal `dagitim/d1-hat`, sözleşme sürümü 3). Bu dalın Rust aynası o metnin tek kaynağı olan TS koduna karşı yazıldı ve D1'in ortak vektörleriyle (`Teks-Erp/native/test-vektorleri/guncelleme-*.json`, D1 dalıyla BAYT-EŞİT) ölçülür.

## §4 Fabrika sunucusu — dizin düzeni ve hizmetler (YEREL SÖZLEŞME)

### §4.1 Dizin düzeni

Kök `<KOK>` kuruluma özgüdür (varsayılan `C:\TeksERP`; SAHINSRV bugün `C:\Etkili-Yazilim`) — hiçbir ikili kökü koda gömmez, iki hizmet de `--kok <KOK>` argümanıyla kurulur (§4.2). Dizin adları backend'in `hizmet-duzeni.ts` `SERVICE_DIRS`iyle AYNIDIR (D3, dal `dagitim/d3-hizmet`; Rust tarafı `tekserp-hizmet/src/contract.rs`).

| Yol | İçerik | Yazan | Not |
|---|---|---|---|
| `<KOK>\surumler\<surum>\` | Backend paketinin AÇILMIŞ hâli (zip kökü = bu dizin): `dist\` · `runtime\node.exe` · `runtime\tekserp-hizmet.exe` · `runtime\tekserp-guncelleyici.exe` · `native\` · `node_modules\` · `prisma\` · `public\` · `assets\` · `package.json` · `butunluk.jws` · `butunluk-liste.txt` · `PAKET.json` | yalnız güncelleyici | Açıldıktan sonra DEĞİŞMEZ; imzalı kapsamın içine dosya eklenmez (bütünlük `FAZLA` verir). |
| `<KOK>\surumler\.hazirlik-<surum>\` | Açılmakta olan sürüm | güncelleyici | Bütünlük GEÇERLİ olunca `surumler\<surum>`e yeniden adlandırılır; yarım kalanı sonraki tur siler. |
| `<KOK>\current` | **Dizin bağlantısı (junction)** → `surumler\<surum>` | yalnız güncelleyici | Backend hizmeti YALNIZ bu yoldan koşar. Backend DURMUŞKEN değiştirilir. |
| `<KOK>\yapilandirma\.env` | Backend ortamı (bugünkü `app\.env` + ecosystem `env` bloğu; D6 taşır) | kurulum (D5) · geçiş (D6) · yönetici | Sır. Backend kendisi okur (`TEKSERP_KOK` → `resolveEnvFilePath`); konak OKUMAZ; güncelleyici yalnız `DATABASE_URL` · `PORT` · `BACKUP_*` · `PG_BIN_DIR` · `LICENSE_DIR` için okur (§6.5). |
| `<KOK>\guncelleyici\` | `tekserp-guncelleyici.exe` (+ kendini güncellemede `.yeni.exe` / `.eski.exe`) · `ayar.json` · `gunluk\guncelleyici.log` | kurulum · güncelleyici | Hizmetin ImagePath'i buradadır (`current`in DIŞINDA — geri dönüş güncelleyiciyi değiştirmez). Günlük BURADA: backend'in yazabildiği `logs\` altında olsaydı önceden konan bir bağlantı SYSTEM'in yazısını yönlendirebilirdi. |
| `<KOK>\lisans\` | `LICENSE_DIR` (kira, HAK, kurulum anahtarı, `durum.json`) | backend | Güncelleyici YALNIZ OKUR, güvenilmez girdi olarak (§6.5). |
| `<KOK>\logs\` | Konak: `backend-out.log` · `backend-err.log` (satır başı yerel saat + ofset, 10 MB × 14, eskiler gzip) · `hizmet.log` | konak (backend hesabı) | D3 düzeni. |
| `<KOK>\backups\` | Gece yedekleri (SYSTEM görevi `yedekle.ps1`, D3/D5) | zamanlanmış görev | Güncelleme öncesi yedek burada DEĞİL (aşağıda `is\yedek\`). |
| `<KOK>\yedek-anahtar\` | `*.tkpub` alıcılar (+ `yerel.tkkey`) — `BACKUP_KEY_DIR` varsa o | kurulum | Güncelleyici yalnız `*.tkpub` okur. |
| `<KOK>\veri\` · `mobil-guncelleme\` · `rclone\` · `pg-setup\` | D3 `SERVICE_DIRS` | backend / kurulum | Güncelleyici dokunmaz. |
| `<KOK>\pgsql\<surum>-<derleme>\` | PostgreSQL ikilileri, sürüm başına YAN YANA (D4 `KENDI-POSTGRESQL.md` §0) — ör. `pgsql\16.15-4` | kurulum · güncelleyici | Bir önceki sürüm geri dönüş için kalır, daha eskisi silinir (D4 §5 U11). |
| `<KOK>\pgsql\bin` | **junction** → etkin sürümün `bin`'i | kurulum · güncelleyici | `PG_BIN_DIR` bu yoldur; yedekleme, bakım betikleri ve backend bu yolu okur — sözleşme KORUNUR (D4). |
| `<KOK>\pgsql\ornek.json` | Örnek kaydı (D4 §6): `{bicim, kip: kendi\|harici, hizmet, surum, derleme, ikiliDizin, oncekiIkiliDizin, veriDizini, port, kuruldu, guncellendi}` | kurulum · güncelleyici (SYSTEM/Administrators) | `kip: harici` ⇒ güncelleyici PG'ye HİÇ dokunmaz (§9). |
| `<KOK>\pgveri\` | `PGDATA` (D4; başka sabit NTFS sürücü seçilebilir — yol `ornek.json`da) | PG hizmeti | Güncelleyici veri dizinine DOKUNMAZ (küçük sürüm aynı disk biçimi). |
| `<KOK>\kurulum-gecmisi.jsonl` | Kurulum/geri alma kayıtları (`InstallRecordSchema`, `dirname(LICENSE_DIR)`) | güncelleyici | Backend son 10 satırı yoklamada satıcıya taşır — biçim bugünkü `kur.ps1` ile BİREBİR (§8.8). Dosya bir bağlantıysa YAZILMAZ. |
| `%ProgramData%\TeksERP\guncelleme\niyet\niyet.json` | NİYET (§5.1) | backend | Güncelleyici bu dizinde hiçbir şeyi yazmaz/silmez. |
| `%ProgramData%\TeksERP\guncelleme\durum\durum.json` · `gecmis.jsonl` | DURUM (§5.2) · işlem geçmişi (§5.3) | güncelleyici | |
| `%ProgramData%\TeksERP\guncelleme\is\` | Güncelleyicinin ÖZEL alanı: işlem günlüğü `islem.jsonl`, `indirme\`, `hazir\` (paket hazır işaretleri), `ertele.json` (kesin paket hatası aralığı), `kendi.json` (kendini güncelleme), `anahtar\<islemId>\` (geçici yedek anahtarı, DPAPI), **`yedek\<islemId>\`** (güncelleme öncesi şifreli yedek) | güncelleyici | Backend ERİŞEMEZ: güncelleyici her turda korumalı DACL'i (SYSTEM + Administrators, miras kesik) KENDİSİ uygular; `is\` ya da üstü bağlantıysa hiçbir şey yapmaz (fail-closed). |

Konak açılışta `<KOK>\current`i ÇÖZER (bağlantı `<KOK>\surumler\<ad>` dışını gösteriyorsa node başlatılmaz, çıkış 14): çalışma dizini SÜRÜM dizinidir; backend bütün yollarını `TEKSERP_KOK`tan türetir (D3), `cwd\..` varsayımı yoktur.

### §4.2 Hizmetler (SCM)

| Hizmet | İkili (ImagePath) | Hesap | Başlatma | Bağımlılık | Kurtarma |
|---|---|---|---|---|---|
| `TeksERP-PostgreSQL` | `<KOK>\pgsql\<surum>-<derleme>\bin\pg_ctl.exe runservice -N TeksERP-PostgreSQL -D "<PGDATA>" -w` (D4 §4.9; küçük sürümde güncelleyici sürüm dizinini değiştirir) | `NT SERVICE\TeksERP-PostgreSQL` | otomatik | — | 60 sn · 60 sn · 300 sn (D4) |
| `TeksERP-Backend` | `"<KOK>\current\runtime\tekserp-hizmet.exe" hizmet --kok "<KOK>"` | `NT SERVICE\TeksERP-Backend` (sanal hesap, parolasız; SID türü unrestricted; ayrıcalıklar YALNIZ `SeChangeNotifyPrivilege` + `SeCreateGlobalPrivilege` — SeImpersonate düşer, D3) | gecikmeli otomatik | `TeksERP-PostgreSQL` (varsa; harici PG'de `--pg-hizmeti <ad>`) | 5 sn · 5 sn · 30 sn; sayaç 1 günde sıfırlanır; çökmesiz hata çıkışında da (D3) |
| `TeksERP-Guncelleyici` | `"<KOK>\guncelleyici\tekserp-guncelleyici.exe" hizmet --kok "<KOK>"` | `LocalSystem` | gecikmeli otomatik | — | 10 sn · 30 sn · 60 sn; çökmesiz hata çıkışında da |

- Kayıt ikililerin kendi alt komutuyla, TEK kaynaktan: `tekserp-hizmet.exe hizmet-kur --kok <KOK> [--pg-hizmeti <ad> | --pg-yok]` · `tekserp-guncelleyici.exe hizmet-kur --kok <KOK>` (ve `hizmet-kaldir`). Hesap, SID türü, ayrıcalıklar, bağımlılık, kurtarma, açıklama ve olay günlüğü kaynağı buradan gelir; D3'ün `deploy/hizmet/backend-hizmeti.ps1`i dizin İZİNLERİNİ uygular ve kayıt için bu komutu çağırır (iki yerde kayıt yazılmaz — ayrışma riski).
- **Kurulum sırası BAĞLAYICIDIR (ölçüldü: thinkpad-1, Windows 11 26200):** ① dizin iskeleti → ② `hizmet-kur` (sanal hesap `NT SERVICE\TeksERP-Backend` ANCAK hizmet kaydıyla doğar) → ③ ACL'ler (sanal hesaba verilen izin kayıttan ÖNCE `icacls` 1332 "hesap adlarıyla SID'ler eşlenmedi" ile düşer) → ④ başlat. Aynı sıra PG hizmeti için de geçerlidir (D4 §4.9–§4.10). Güncelleyicinin kendi özel alanı (`guncelleme\is\`) yalnız iyi bilinen SID'leri (SYSTEM, Administrators) kullandığından bu sıraya bağlı değildir.
- Konak `current` ÜZERİNDEN koşar (`<KOK>\hizmet\` KULLANILMAZ): konak sürümle birlikte imzalı gelir, geri dönüşte eskisine döner; ayrı bir kendini güncelleme yolu yoktur.
- "Tek backend süreci": konak KENDİNİ `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` işine koyar, node işe kendiliğinden girer — konak ölürse node da ölür; SCM yeniden başlattığında yetim node portu tutmaz. Güncelleyici de kendini ve araç çocuklarını aynı yolla bağlar (yarım `pg_dump`/`migrate` yaşamaz); her aracın ağacı ayrıca kendi işinde (zaman aşımında bütün ağaç sonlanır).

### §4.3 Backend hizmet konağı (`tekserp-hizmet`) sözleşmesi — D3 ile kesinleşti

- **Başlatma:** `<KOK>\current` çözülür → `<sürüm>\runtime\node.exe <sürüm>\dist\server.js`, çalışma dizini `<sürüm>`. `<KOK>\yapilandirma\.env` yoksa node BAŞLATILMAZ (çıkış 12; konak dosyayı OKUMAZ, yalnız varlığını ölçer). Ortam = hizmet ortamı + `TEKSERP_KOK=<KOK>` · `TEKSERP_HIZMET_ADI=TeksERP-Backend` · `TEKSERP_KAPANIS=stdin` · `NODE_ENV=production` · `NODE_USE_SYSTEM_CA=1` (Node açılışta okur, `.env`den gelirse etkisiz); **`NODE_OPTIONS` SİLİNİR** (yükleyici enjeksiyonu). stdin = boru; stdout → `logs\backend-out.log`, stderr → `logs\backend-err.log` (satır başı RFC 3339 yerel saat + ofset, ms; 10 MB × 14, eskiler gzip; yazım hatası çocuğu bloklamaz — satır düşer, sayılır). Ortam DEĞERİ günlüğe yazılmaz (yalnız anahtar adları).
- **Doğrulama kipi:** hizmet `--dogrulama` başlatma argümanıyla başlatılırsa (güncelleyici §8.6'da böyle başlatır) ortama `HOST=127.0.0.1` ve `TEKSERP_DOGRULAMA_KIPI=1` eklenir (`.env` bunları ezmez: dotenv var olanı değiştirmez). **D3 (açık):** bu kipte backend arka plan işlerini (bulut eşitleme, zamanlanmış yedek, mDNS keşfi, dış yoklama) BAŞLATMAZ — geri dönüşte DB yedekten geri yüklenebilsin diye istemci yazısı kabul edilmez.
- **Durdurma:** SCM `STOP`/`PRESHUTDOWN` → stdin'e `kapat\n` + boru kapanır; backend `gracefulShutdown` yolunu koşar (D3: ≤ 5,3 sn); konak 15 sn bekler (SCM'e `STOP_PENDING` + bekleme ipucu), çıkmazsa sonlandırır.
- **Çıkış kodları (hizmete özgü, SCM kurtarmasını tetikler; konak döngü KURMAZ):** `0` istenen durdurma · `10` node beklenmedik çıktı · `11` node başlatılamadı (`runtime\node.exe`/`dist\server.js` yok) · `12` `.env` yok · `13` iş nesnesi kurulamadı · `14` `current` çözülemedi ya da sürümler dışını gösteriyor. Node'un kendi kodu (ör. korumalı yükleyicinin `78`i) `logs\hizmet.log`a ve olay günlüğüne yazılır.

### §4.4 Erişim denetimi (ACL) ve güvenilmez dizinler — D3 uygular

| Yol | SYSTEM · Administrators | `NT SERVICE\TeksERP-Backend` |
|---|---|---|
| `<KOK>` (kök) · `surumler\` (+ `current` üzerinden) · `mobil-guncelleme\` · `rclone\` | Tam | Okuma + Yürütme |
| `yapilandirma\` · `yedek-anahtar\` | Tam | Okuma |
| `lisans\` · `backups\` · `logs\` · `veri\` | Tam | Değiştirme |
| `guncelleyici\` · `pg-setup\` · `pgsql\` · `pgveri\` | Tam (PG dizinleri D4) | — |
| `%ProgramData%\TeksERP\guncelleme\niyet\` | Tam | Değiştirme |
| `%ProgramData%\TeksERP\guncelleme\durum\` | Tam | Okuma |
| `%ProgramData%\TeksERP\guncelleme\is\` | Tam — korumalı DACL'i güncelleyici her turda kendisi uygular | — |

İki IPC dosyası AYRI dizinlerdedir: aynı dizinde "niyet yazılabilir / durum salt okunur" atomik yeniden adlandırmayla kurulamaz (yeni dosya dizinin mirasını alır). **Güvenilmez dizin kuralı (D3):** backend'in yazabildiği dizinler (`lisans\` · `backups\` · `logs\` · `veri\` · `guncelleme\niyet\`) SYSTEM'in gözünde güvenilmez girdidir — güncelleyici oralara YAZMAZ, oradan okurken bağlantı izlemez ve boyu sınırlar (§6.5); kendi günlüğü, yedeği ve anahtarı backend'in erişemediği dizinlerdedir.

## §5 IPC — niyet · durum · geçmiş

Genel: UTF-8 (BOM'suz) JSON; yazan taraf `<ad>.tmp`e yazar, diske boşaltır (`FlushFileBuffers`) ve `<ad>`ın üstüne yeniden adlandırır — okuyan yarım dosya görmez. Zaman damgaları UTC ISO-8601 (`Z`). Alan adları Türkçe; tanınmayan alan yok sayılır (ileri uyum).

### §5.1 `niyet\niyet.json` — backend yazar, güncelleyici okur (YETKİ DEĞİL, sözleşme §3 madde 2)

```json
{
  "v": 1,
  "yazildi": "2026-10-01T20:00:00Z",
  "indirme": { "belirtec": "<JWS tekserp-indirme, yolOneki /<kanal>/backend/>", "bitis": "2026-10-01T21:05:00Z" },
  "onay": { "onayId": "…uuid", "surum": "2.13.0", "zamanlama": "HEMEN", "kullaniciId": "…uuid", "ad": "Ayşe Y.", "zaman": "2026-10-01T19:58:00Z" }
}
```

- `indirme`: kiranın yoklamasıyla gelen İNDİRME belirteci (`X-TKL-Indirme` başlığıyla sunulur, Worker doğrular). Aday (`son.json` · `<hedef>/surum.json`), paket ve PG künyesi/paketi bu belirteçle iner — OTOMATİK kipte de gereklidir: backend belirteci süresi dolmadan tazeleyip niyeti yeniden yazar. Yoksa `BELIRTEC_YOK`, süresi geçmişse `BELIRTEC_SURESI_DOLDU` (güncelleyici bekler).
- `onay`: panel "Şimdi kur" (`HEMEN`) · "Pencerede kur" (`PENCERE`); izin ve denetim satırı backend'de. Karar girdisi yalnız `{surum, zamanlama}`dır (sözleşme §3 madde 3): onay yalnız AYNI sürüm için sayılır, DONDUR'u ve K1'i açamaz. `onayId` her yeni insan kararında YENİDİR (backend'in onay kaydı kimliği); `kullaniciId` · `ad` · `zaman` yalnız geçmiş satırına geçer.
- **Yeniden deneme kuralı:** `GERI_DONDU` ile biten sürüm kendiliğinden yeniden denenmez (her gece dur-yedekle-geri dön döngüsü olmasın); aynı sürüme `onayId`si farklı bir onay gelirse denenir. `HATA` (geri alınamadı) sonrası YENİ bir onay gelene dek hiçbir işlem başlatılmaz (`durum: HATA`, `hataKodu: INSAN_GEREKIYOR`).
- Biçimsiz ya da bağlantı olan niyet yok sayılır (belirteç ve onay yokmuş gibi; belirteç gerekince `NIYET_BICIMSIZ`).

### §5.2 `durum\durum.json` — güncelleyici yazar (her turda), backend okur

```json
{
  "v": 1, "zaman": "2026-10-01T23:05:12.000Z", "turSn": 60, "guncelleyiciSurum": "0.1.0",
  "kuruluSurum": "2.12.4", "durum": "HAZIR",
  "surum": "2.13.0", "kaynakSurum": "2.12.4", "urun": null, "islemId": null, "adim": null,
  "hataKodu": null, "mesaj": "2.13.0 hazır; PENCERE_BEKLIYOR", "ilerleme": null, "planlanan": "2026-10-01T23:00:00Z",
  "politika": { "kip": "OTOMATIK", "izin": true, "neden": null, "kaynak": "KIRA", "hedefSurum": null, "donuk": false },
  "karar": { "karar": "PENCERE_BEKLIYOR", "neden": null, "aralik": { "baslangic": "…", "bitis": "…" }, "pgGuncellemesi": false },
  "bekleyen": { "surum": "2.13.0", "karar": "PENCERE_BEKLIYOR", "neden": null, "aralik": { … }, "pgGuncellemesi": false, "zorunlu": false, "ozet": "…" },
  "son": { "kayitId": "…uuid", "hedefSurum": "2.12.4", "kaynakSurum": "2.12.3", "sonuc": "BASARILI", "kod": null, "baslangic": "…", "bitis": "…", "veriGeriYuklendi": false },
  "sonAyrinti": { "urun": "backend", "hataKodu": null, "mesaj": null }
}
```

- **Kesin alanlar (tek kaynak — TS aynası):** `karar` = `decideUpdate`in çıktısı (aday olsun olmasın: `DONDURULDU/KIRA_YOK` gibi adaysız kararlar da); `bekleyen` = en yeni adayın kararı (yoklama raporunun `bekleyen`i `{surum, karar, neden}` buradan AYNEN); `son` = son TAMAMLANAN deneme, `UpdateResultSchema` ile BİREBİR (KATI; rapora aynen gider — başarısız PG adımı da bir denemenin sonucudur: `hedefSurum` = backend adayı, `kod: PG_GUNCELLEME_HATASI`); `sonAyrinti` = iç kod + ileti (panel/destek).
- **Geriye uyumlu alanlar** (backend okuyucusu `updater-ipc.ts` `UpdaterStatusDocSchema`, sözleşme sürümü 3): `durum` · `surum` (aday ya da süren işlemin hedefi; PG adımında backend adayı) · `kaynakSurum` · `kuruluSurum` · `adim` (`GERI_DON:<adım>` geri almada) · `hataKodu` · `mesaj` (≤ 400 karakter; okuyucu 500'den uzununu dosyayla birlikte reddeder) · `ilerleme` · `planlanan` · `politika{kip, izin, neden}` (karar DONDURULDU/UYGUN_DEGIL ise `izin: false`, `neden` okuyucunun sözlüğünden: `POLITIKA_DONDUR` · `YAPTIRIM_DONUK` · `KIRA_YOK` · UYGUN_DEGIL'de nedenin kendisi) · `guncelleyiciSurum` · `zaman`. Backend eşlemesi `bekleyen`/`son`u doğrudan okuyabilir (§13 D1).
- `hataKodu`/`mesaj` ŞU ANKİ sorundur (indirme · doğrulama · kira · ayar); sonuçların kodu `son`da. `mesaj` Türkçe, insan içindir, sır taşımaz.

| `durum` | Anlamı |
|---|---|
| `BEKLIYOR` | İş yok ya da karar engelliyor (`karar`), ya da bir sorun var (`hataKodu`) |
| `INDIRILIYOR` | Aday doğrulandı, paket iniyor (`ilerleme`) ya da ağ hatasıyla sürdürülecek |
| `HAZIR` | Paket(ler) doğrulandı ve açıldı; karar `ONAY_BEKLIYOR` ya da `PENCERE_BEKLIYOR` (`planlanan` = sıradaki aralığın başı) |
| `UYGULANIYOR` | İşlem sürüyor (`urun` · `islemId` · `adim`) |
| `BASARILI` | Son deneme bu kurulumun sürümüne başarıyla geçti ve yeni iş yok |
| `GERI_DONDU` | Aday, geri dönmüş sürümdür ve yeni onay bekler (`son`) |
| `HATA` | Geri dönüş de TAMAMLANAMADI — İNSAN gerekir (`INSAN_GEREKIYOR`); olay günlüğüne hata düşer |

### §5.3 `durum\gecmis.jsonl` — güncelleyici ekler (panelin "geçmiş"i)

Her SONUÇLANAN işlem için bir satır: `{v:1, islemId, onayId, urun: backend|pg, hedefBackend? (PG satırında), kaynakSurum, surum, sonuc: BASARILI|GERI_DONDU|HATA, hataKodu (raporun belgeli kodu), ayrintiKodu (iç kod), veriGeriYuklendi, basladi, bitti, gocSayisi: {once, sonra}, yedek, onay}`. 1000 satırı aşınca en eskisi atılır (kopya + yeniden adlandırma).

## §6 Güven modeli — güncelleyici neye güvenir

Güncelleyici SYSTEM'dir; backend düşük yetkilidir. Yetki yalnız satıcı imzalı veriden gelir (sözleşme §3 madde 1); her doğrulama lisans çekirdeğiyle AYNI koddur (`tekserp-dogrulama`) ve sözleşmenin TS aynası `tekserp-guncelleyici/src/{release,decision}.rs` D1'in vektörleriyle ölçülür (`tests/sozlesme_vektorleri.rs`; kiranın `guncelleme` şeması `tekserp-dogrulama/tests/guncelleme_kira.rs`).

### §6.1 Kendi ayarı — `<KOK>\guncelleyici\ayar.json` (yalnız SYSTEM/Administrators yazar)

`{v:1, guncellemeSunucusu: "https://…", vekil: null | "http://host:port", saglikZamanAsimiSn: 180, durdurmaZamanAsimiSn: 60, turSn: 60}`. `guncellemeSunucusu` ZORUNLU ve yalnız `https://` (test derlemesinde `http://127.0.0.1`); niyet başka bir sunucuya yönlendiremez.

### §6.2 Kira ve HAK (yetki kaynağı)

`LICENSE_DIR`deki `kira.jws` gömülü kök çapasıyla zincirden doğrulanır (`chain::verify_lease`); kira şeması `guncelleme` politikasını da ölçer (TS `LeaseSchema` aynası: biçimsiz politika = bozuk kira). Etkin politika sözleşme §2'dir: kira yoksa ya da `bitis + 10 dk` geçtiyse YETKİ YOK (`DONDURULDU/KIRA_YOK`; lisans ek süresi güncelleme açmaz), alan yoksa `ONAYLI`; `yaptirim.guncellemeDonuk` her kipi ve onayı ezer. Kira silinerek dondurma atlatılamaz (kira yoksa güncelleme yok). `hak.jws` doğrulanıp kiraya bağlanırsa `bakimBitis` (`BAKIM_DISI` · `HAK_YOK`) ve `sinif` (§6.3 anahtar süzgeci) ondan gelir.

### §6.3 Aday — işaretçi → sürüm bildirimi (sözleşme §1.2–§1.4)

- Yol: sabitleme yoksa `/<kanal>/backend/son.json`, varsa `/<kanal>/backend/<hedefSurum>/surum.json`; kanal kiranın `kanal.kod`u. İşaretçinin kendisine güvenilmez: KATI `{v, bildirim}`, ≤ 64 KB.
- Doğrulama sırası TS ile aynı: JWS (typ `tekserp-surum` · kid · imza) → şema (`BELGE_SURUM` · `BELGE_SEMA`) → imzalayan = `paketImzaKid` (`SURUM_ANAHTAR`) → kanal (`SURUM_KANAL`). Hata kodu `durum.hataKodu`na olduğu gibi yazılır.
- **Anahtar kümesi:** gömülü PAKET anahtarları, hazırlık anahtarı (`paket-hazirlik*`) yalnız HAK sınıfı TEST/DEMO iken; sınıf bilinmiyorsa dışarıda (`JWS_KID`). Aynı küme bütünlük listesi ve PG künyesi için de kullanılır.
- Doğrulanmış aday 5 dk bellekte tutulur; uygulamadan hemen önce (1 dk'dan eskiyse) yeniden indirilip doğrulanır ve karar yeniden verilir — aday değiştiyse uygulama o turda başlamaz.

### §6.4 Paket (sözleşme §1.5)

Önce boş disk (≥ paket × 3 + 2 GB, `DISK_DOLU`), sonra `/<kanal>/backend/<surum>/<paket.ad>` sürdürülebilir iner; boy + sha256 (küçük harf hex) bildirimle EŞİT olmadan zip AÇILMAZ (`PAKET_OZETI`, parça silinir). Açma yalnız `surumler\.hazirlik-<surum>`e ve yalnız göreli yollarla (`PAKET_YOL`; sembolik bağ girdisi RED). `butunluk.jws` aynı anahtar kümesiyle ve dosya listesi GEÇERLİ olmalı (`BUTUNLUK_GECERSIZ`); künye bildirimle BAĞLANMALI (`checkPackageBinding`: imzalayan · `paketId` · `urun` · `surum` · `derlemeTarihi` · müşteri null ya da kanal — `PAKET_BAGI`). Kesin paket hatasında (özet · yol · bütünlük · bağ) aynı paket 15 dk × 4ⁿ (≤ 24 sa) yeniden indirilmez (`is\ertele.json`, `INDIRME_ERTELENDI`).

### §6.5 Güvenilmez girdi (D3 güvenlik kuralı)

Backend'in yazabildiği ya da okuyabildiği dizinlerden okunan her dosya (`lisans\kira.jws` · `hak.jws` · `guncelleme\niyet\niyet.json` · `yapilandirma\.env` · `<PGDATA>\PG_VERSION`) şöyle okunur: dosya da üst dizini de bağlantı (junction/sembolik bağ) OLAMAZ, düz dosya olmalı, boy tavanı var (JWS/niyet 64 KB, `.env` 256 KB), Windows'ta tutamaç `FILE_FLAG_OPEN_REPARSE_POINT` ile açılır ve açılan tutamaç yeniden ölçülür; hata iletisi içerikten beslenmez. SYSTEM yazdığı hiçbir dosyayı backend'in yazabildiği dizine koymaz; ekleme yaptığı `kurulum-gecmisi.jsonl` bir bağlantıysa yazmaz. Çocuk araçların ortamından `NODE_OPTIONS` silinir; göç ve araçlar `.env`i `DOTENV_CONFIG_PATH`ten okur (sırlar ortama kopyalanmaz).

**Bilinen sınır:** kira kurulum kimliğine (parmak izi) güncelleyicide bağlanmaz — başka bir kurulumun kirası ancak aynı kanalın belirteciyle birlikte işe yarar ve yalnız o kanalın imzalı sürümünü kurdurur.

## §7 Durum makinesi ve çökme güvenliği

- **İşlem günlüğü** `is\islem.jsonl`: her adımın BAŞLADI satırı adım ÇALIŞMADAN önce, BİTTİ satırı adım bittikten sonra yazılır; her satır `FlushFileBuffers` ile diske iner. Satır: `{sira, islemId, adim, olay: ISLEM|BASLADI|BITTI|HATA|TELAFI_BASLADI|TELAFI_BITTI|SONUC, zaman, veri}`. ISLEM satırı PLANI taşır (önceki `current` hedefi, göç sayısı öncesi, lisans görüntüsü, onay…) ki yeniden başlayan süreç yeniden HESAPLAMASIN; `TELAFI_BITTI` telafinin sonucunu taşır (`GOC`: `geriYuklendi`).
- **Açılış:** son işlem SONUÇ satırı taşımıyorsa YARIM işlemdir → §8'deki "yarımda" sütunu: DEVAM (adım yeniden koşulur — her adım tekrarlanabilir) ya da GERİ AL (telafiler ters sırada; her telafi tekrarlanabilir). Geri alma da yarım kalabilir; açılış onu da sürdürür. Yarım satır (yırtık yazım) okunurken atılır.
- **Değişmez:** her son durumda (`BASARILI` · `GERI_DONDU`) backend TEK süreçtir ve `current`in gösterdiği sürümle DB şeması uyumludur: `BASARILI` ⇒ `current` → yeni + göç uygulandı; `GERI_DONDU` ⇒ `current` → eski + DB işlem öncesi hâlinde (göç başladıysa yedekten geri yüklendi). Bunu sağlayamayan tek son durum `HATA`dır (insan).
- **Kilit:** tek güncelleyici süreci — `is\kilit` dosyası paylaşımsız açık tutulur; ikinci süreç (elle koşulan CLI dahil) `KILIT_DOLU` ile çıkar.

## §8 Tur ve backend güncellemesinin adımları

**§8.0 Tur** (`turSn`, varsayılan 60 sn): yarım işlem varsa ÖNCE o sürdürülür → kira + HAK (§6.2) → adaysız karar (`DONDURULDU` · `KURULU_SURUM_BICIMSIZ` · `HEDEF_ULASILDI` ağa çıkmadan biter) → aday (§6.3) → karar (PG yalnız karar ona gelirse ölçülür) → `KUR` · `ONAY_BEKLIYOR` · `PENCERE_BEKLIYOR` ise disk + hazırlık (§6.4; PG gerekiyorsa §9 hazırlığı) → `HAZIR` → karar `KUR` ise aday tazelenir ve uygulanır (önce PG, sonra backend). Başlamış uygulama pencere kapansa da biter ya da geri döner (sözleşme §3 madde 5).

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda (açılış) |
|---|---|---|---|---|
| 1 | `BACKEND_DURDUR` | `TeksERP-Backend` durdur (≤ `durdurmaZamanAsimiSn`); plan (önceki hedef, göç sayısı, lisans görüntüsü) backend ÇALIŞIRKEN ölçülüp ISLEM satırına yazılmıştır | backend'i ESKİ `current` ile başlat + sağlık | DEVAM |
| 2 | `YEDEK` | backend DURMUŞKEN `pg_dump -Fc` → `pg_restore --list` → `yedek-sifrele sifrele` (alıcılar: `yedek-anahtar\*.tkpub` + işleme özgü GEÇİCİ anahtar, §8.3) → düz döküm silinir; sonuç `is\yedek\<islemId>\db.dump.tkenc` | — | DEVAM (yeniden al) |
| 3 | `GECIS` | `current` → `surumler\<yeni>` | `current` → önceki hedef | DEVAM |
| 4 | `GOC` | `<yeni>\runtime\node.exe node_modules\prisma\build\index.js migrate deploy` (çalışma dizini `<yeni>`; ortam `DOTENV_CONFIG_PATH=<KOK>\yapilandirma\.env` + `NODE_ENV=production`) → göç sayısı (sonra) | göç DB'yi değiştirdiyse (bitmiş ya da toplam satır sayısı farklı; ölçülemezse değiştirmiş sayılır): yedek aracıyla geçici anahtardan çöz → `public` şeması sıfırlanır → `pg_restore` → göç sayısı = önceki | GERİ AL |
| 5 | `DOGRULAMA` | backend'i `--dogrulama` ile başlat (yalnız 127.0.0.1) → sağlık (§8.7) | backend'i durdur | DEVAM (yeniden doğrula) |
| 6 | `BASLAT` | durdur → normal başlat → sağlık (sürüm + DB) | backend'i durdur | DEVAM |
| 7 | `ONAY` | SONUÇ=BASARILI · `kurulum-gecmisi.jsonl` · `gecmis.jsonl` · eski sürüm dizinlerini buda (`current` + bir önceki kalır) · eski yedekleri buda (son 3) · kendini güncelleme denetimi (§10) | — | DEVAM |

- **§8.3 Geçici yedek anahtarı (yer: `is\anahtar\<islemId>\`, yedek: `is\yedek\<islemId>\` — backend ERİŞEMEZ):** mevcut `.tkenc` yerel anahtarı YEDEK PAROLASIYLA sarılıdır — sunucu kendi yedeğini gözetimsiz ÇÖZEMEZ. Otomatik geri dönüş için güncelleyici her işlemde paketteki araçla (`yedek-sifrele anahtar-uret --ad guncelleme --dizin <is> --ozel-cikti <dosya>`) bir X25519 çifti üretir, özel yarıyı DPAPI (SYSTEM kapsamı) ile sarar ve düzünü siler; yedek hem kurulumun kendi alıcılarına hem bu anahtara şifrelenir (`--alici` tekrarlı). Müşteri anahtarı yedeği her zaman açar; geçici anahtar yalnız bu sunucuda ve bir sonraki başarılı işleme kadar yaşar. `yedek-anahtar\` boşsa yedek yalnız geçici anahtara şifrelenir.
- **§8.5 Göç:** SİSTEM node'u DEĞİL, sürümün kendi `runtime\node.exe`si. Göç sayısı iki değerle ölçülür (`<PG_BIN_DIR>\psql.exe`): bitmiş (bugünkü `kur.ps1` sorgusu: `finished_at IS NOT NULL AND rolled_back_at IS NULL`) + TOPLAM satır (başlamış ama bitmemiş göç de görünsün); ölçülemezse "göç BAŞLADI ve bilinmiyor" sayılır (geri dönüşte DB geri yüklenir). `migrate deploy` 30 dk'dan uzun sürerse süreç ağacı sonlandırılır → geri dönüş. Geri yükleme veritabanını ve DB düzeyi ayarlarını (`teks.*`) KORUR: yalnız `public` şeması sıfırlanıp döküm aynı rolle geri yüklenir (`pg_restore`un bilinen zararsız hataları — `schema "public" already exists`, `must be owner of extension plpgsql` — yok sayılır, başarının ölçüsü göç sayısıdır). Rol DB sahibi olmalı (D4: `tekserp` sahip; `BACKUP_PG_USER` = bakım rolü `tekserp` üyesi).
- **§8.6 İki aşamalı başlatma:** doğrulama başlatması (5) istemcilere kapalıdır; bu yüzden sağlık düşerse DB'yi yedekten geri yüklemek istemci yazısı KAYBETTİRMEZ. Normal başlatmadan (6) sonra geri dönüş gerekirse aradaki kısa pencerenin yazısı kaybolabilir — adım 6 yalnız "sürüm + DB" bakar ve doğrulamadan geçmiş aynı ikiliyle koşar.
- **§8.7 Sağlık:** `GET http://127.0.0.1:<PORT>/health` (5 sn istek zaman aşımı, 2 sn aralık, toplam `saglikZamanAsimiSn`): HTTP 200 · `status = UP` · `db = UP` · `version = <yeni surum>`. Lisans: **D3** `/health`e YALNIZ döngü adresinden gelen istekte `lisans: {kip, butunluk, cekirdek}` ekler; güncelleyici yeni sürümde bu alanı ZORUNLU sayar (yoksa `SAGLIK_LISANS_OLCULEMEDI`) ve işlem öncesi görüntüden KÖTÜ olamaz: `butunluk` önce `GECERLI` idiyse sonra da `GECERLI`, `cekirdek` önce `native` idiyse sonra da `native`, `kip` önce `KISITLI`/`DURDURULMUS` değilken sonra o olamaz.
- **§8.8 Kurulum kaydı:** `<KOK>\kurulum-gecmisi.jsonl`e `kur.ps1` ile birebir biçim (`InstallRecordSchema`): `tur` KURULUM (başarı) · GERI_ALMA (geri dönüş sonrası, `oncekiSurum` yeni, `yeniSurum` eski) · `damga` = işlem başlangıcı `yyyyMMdd_HHmmss` · `paketOzeti` = bildirimin `paket.sha256`sı · `commit` = bildirimin `commit`i · `geriDonus {kod: true, veri: true, veriSifreli: true}` · `kayitId` işlemden türetilir (yeniden koşulan ONAY aynı kaydı yazar).

## §9 PostgreSQL küçük sürümü (sözleşme §1.6 · D4 `KENDI-POSTGRESQL.md` §5 U0–U11)

**Koşul — karardan:** `pgGuncellemesi: true` (kendi örnek, bildirimin `pg.hedef` (sürüm, derleme) kuruludan yeni). Kurulu PG: kip `pgsql\ornek.json`dan (`kendi` · `harici`; dosya YOKSA harici sayılır — bugünkü kurulumlar), sürüm her koşumda `SHOW server_version`dan (`ana.küçük`), kendi kipte derleme `ornek.json`dan; ölçülemezse `UYGUN_DEGIL/PG_OLCULEMEDI`. Ana sürüm bildirimin `cizgi`si değilse `UYGUN_DEGIL/PG_ANA_SURUM` (hiçbir kipte otomatik değil; ayrıca veri dizini `PG_VERSION` ≠ çizgi ⇒ `PG_BUYUK_SURUM`). Harici kipte PG'ye DOKUNULMAZ; yalnız `enAz` (altındaysa `UYGUN_DEGIL/PG_SURUMU_ESKI`). Aynı koşuda PG adımı backend'den ÖNCE gelir; PG işlemi `GERI_DONDU`/`HATA` ise backend'e dokunulmaz.

- **Hazırlık (canlı sisteme dokunmaz — U0–U2):** künye `/<kanal>/backend/pg/<surum>-<derleme>/pg.json` (işaretçi `{v, bildirim}`) → `tekserp-pg` doğrulaması (aynı anahtar kümesi) → `checkPgBinding(bildirim.pg, künye)` (`PG_BAGI`) → aynı dizindeki `<paket.ad>` boy + sha256 (hex) ile iner → `pgsql\.hazirlik-<surum>-<derleme>`e açılır → her dosya `TEKSERP-ICERIK.sha256`ya, o da künyenin `icerikSha256`sına karşı ölçülür, listede olmayan dosya RED → `bin\icuuc<N>.dll` = künyenin `icuSurum`u → `bin\postgres.exe --version` = hedef sürüm → `pgsql\<surum>-<derleme>`e yeniden adlandırılır. Hata `PG_PAKET` (ertelemeli, §6.4).
- **Uygulama (işlem günlüğüyle, `urun: pg`, plan `hedefBackend` = backend adayı):**

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda |
|---|---|---|---|---|
| U3 | `PG_YEDEK` | §8.3'teki şifreli yedek, ESKİ `bin` ile | — | DEVAM |
| U4 | `BACKEND_DURDUR` | backend'i durdur | backend'i başlat + sağlık | DEVAM |
| U5 | `PG_DURDUR` | `TeksERP-PostgreSQL` durdur; `postmaster.pid` kalmadığını ölç | PG'yi (eski yolla) başlat → `SHOW server_version` = eski → ICU adımı başlamışsa eski ikililerle U9 | DEVAM |
| U6 | `PG_YOL` | hizmetin ImagePath'indeki `<eski>` dizini → `<yeni>` (geri okunur) | ImagePath → `<eski>` | DEVAM |
| U7 | `PG_BAGLANTI` | `pgsql\bin` junction → `<yeni>\bin` (hedef ölçülür) | junction → `<eski>\bin` | DEVAM |
| U8 | `PG_BASLAT` | başlat → hazır → `SHOW server_version` = yeni | PG'yi durdur | DEVAM |
| U9 | `PG_ICU` | ICU sürümü değiştiyse (`icuuc<N>.dll` eski ≠ yeni): ICU collation'a bağlı index'ler katalogdan bulunur → `REINDEX INDEX` → `ALTER COLLATION … REFRESH VERSION` | (U5'in telafisinde yeniden) | DEVAM |
| U10 | `BACKEND_BASLAT` | backend'i başlat → sağlık (§8.7) | backend'i durdur | DEVAM |
| U11 | `ONAY` | `ornek.json`: yeni sürüm + `oncekiIkiliDizin = <eski>`; bir önceki dizin KALIR, daha eskiler silinir | — | DEVAM |

Küçük sürüm veri dizinini değiştirmez: telafide DB geri yüklemesi YOKTUR (yalnız veri bozulması şüphesinde, insan kararı). Büyük sürüm geçişi OTOMATİK DEĞİLDİR (D4 runbook'u).

## §10 Kendini güncelleme

Paket `runtime\tekserp-guncelleyici.exe` taşır. Backend işlemi `BASARILI` olunca, paketteki ikilinin sürümü çalışanınkinden büyükse: `guncelleyici\tekserp-guncelleyici.yeni.exe`ye kopyalanır → `.yeni.exe kunye` çalıştırılır (0 ve beklenen ad/sürüm dönmeli) → çalışan ikili `.eski.exe`ye, `.yeni.exe` asıl ada yeniden adlandırılır (çalışan exe yeniden adlandırılabilir) → hizmet `KENDI_GUNCELLEME` koduyla (20) çıkar, SCM kurtarması yeni ikiliyle başlatır. Yeni ikili İLK iş olarak bir açılış sayacı tutar (`is\kendi.json`): doğrulanmadan 3 açılışı aşarsa `.eski.exe`yi geri koyar ve çıkar (A/B); ilk sağlıklı turdan sonra `.eski.exe`yi siler. İki yeniden adlandırma arasında ölüm: eski ikili asıl adda kalır, yarım `.yeni.exe` sonraki açılışta silinir.

## §11 Günlük

- **Olay günlüğü** (Uygulama): kaynaklar `TeksERP-Guncelleyici` · `TeksERP-Backend`; `hizmet-kur` kaydeder. Bilgi: işlem başladı/bitti, sürüm; Uyarı: geri dönüş; Hata: `HATA` durumu, özel alan kurulamadı, konağın beklenmedik node çıkışı.
- **Dosya:** güncelleyici `<KOK>\guncelleyici\gunluk\guncelleyici.log` (UTC, 10 MB × 10) · konak `<KOK>\logs\hizmet.log` · node çıktısı `<KOK>\logs\backend-out.log` + `backend-err.log` (yerel saat + ofset, 10 MB × 14, gzip). Satır: `<zaman> <DÜZEY> <ileti>`; sır YOK (`.env` değerleri, belirteç, parolalar yazılmaz; araç çıktısındaki `şema://kullanıcı:parola@` maskelenir).

## §12 Kodlar

**`durum.hataKodu` (şu anki sorun):** `NIYET_BICIMSIZ` · `BELIRTEC_YOK` · `BELIRTEC_SURESI_DOLDU` · `KILIT_DOLU` · `AYAR_BICIMSIZ` · `KURULU_SURUM_YOK` · `KIRA_YOK` · `KIRA_GECERSIZ` · `INSAN_GEREKIYOR` · `MANIFEST_INDIRILEMEDI` · `INDIRME_REDDEDILDI` · `INDIRME_HATASI` · `INDIRME_ERTELENDI` · `DISK_DOLU` · `PAKET_OZETI` · `PAKET_YOL` · `BUTUNLUK_GECERSIZ` · `PG_BUYUK_SURUM` · `PG_PAKET` · sözleşmenin kodları olduğu gibi (`SURUM_ISARETCI` · `SURUM_KANAL` · `SURUM_ANAHTAR` · `PAKET_BAGI` · `PG_BAGI` · `JWS_*` · `BELGE_SURUM` · `BELGE_SEMA`) · işlem sonrası o işlemin iç kodu. Karar nedenleri `karar.neden`de (sözleşme §3 madde 3), `hataKodu`na girmez.

**İşlem iç kodları (`sonAyrinti.hataKodu` · `gecmis.ayrintiKodu`) → rapor kodu (`son.kod` · `gecmis.hataKodu`, TS `UPDATE_RESULT_CODES`):**

| İç kod | Rapor kodu |
|---|---|
| `HIZMET_YOK` · `HIZMET_DURMADI` | `DURDURMA_HATASI` |
| `YEDEK_HATASI` | `YEDEK_HATASI` |
| `GECIS_HATASI` | `DOSYA_KILITLI` |
| `GOC_HATASI` · `GOC_ZAMAN_ASIMI` | `GOC_HATASI` |
| `HIZMET_BASLAMADI` | `BASLATMA_HATASI` |
| `SAGLIK_ZAMAN_ASIMI` · `SAGLIK_SURUM` · `SAGLIK_DB` · `SAGLIK_LISANS` · `SAGLIK_LISANS_OLCULEMEDI` | `SAGLIK_HATASI` |
| `PG_DURMADI` · `PG_BASLAMADI` · `PG_SURUM_UYUSMAZ` · `PG_ICU_HATASI` · `PG_YOL_HATASI` · `PG_PAKET` · `PG_BUYUK_SURUM` | `PG_GUNCELLEME_HATASI` |
| `GERI_YUKLEME_HATASI` · `GERI_DONUS_SAGLIKSIZ` | `GERI_DONUS_HATASI` |
| `KESINTI` (yarım göç açılışta geri alındı) | `KESINTI` |
| `DISK_DOLU` · `PAKET_OZETI` · `BUTUNLUK_GECERSIZ`/`PAKET_YOL` · `PAKET_BAGI`/`PG_BAGI` · imza/şema kodları · indirme kodları | aynı adlı ya da `BUTUNLUK_GECERSIZ` · `PAKET_BAGI` · `IMZA_GECERSIZ` · `INDIRME_HATASI` |
| `IC_HATA` ve tanınmayan | `BILINMEYEN` |

## §13 Diğer dilimlerin bu sözleşmeden işi

- **D1:** CEVAPLANDI — sözleşme sürüm 1–3 bu belgenin §0–§3'ü; güncelleyici onun Rust aynasıdır (vektörler D1 dalıyla BAYT-EŞİT kopya; D1 yeniden üretirse aynı dosya D2'nin cargo testinden de geçmeli — iniş sırası D1 → D2, kâhin §0h D1'in `belgeler.ts` desenlerini ister). AÇIK: backend eşlemesi (`update-status.service.ts`) `bekleyen`/`son`u `durum.json`dan doğrudan okuyabilir (kesin; PG denemesi dahil) — geriye uyumlu alanların sezgisel çevirisi o zaman gereksizleşir; onay ucu `POST /api/guncelleme/onay` §5.1 biçimini yazar (`onayId` = onay kaydı kimliği); paket `runtime\`e iki Rust ikilisini (`tekserp-hizmet.exe` · `tekserp-guncelleyici.exe`) koyar — `runtime` imzalı kapsamdadır.
- **D3:** CEVAPLANDI (dal `dagitim/d3-hizmet`: `hizmet-duzeni.ts` · stdin kapanışı · `backend-hizmeti.ps1`) — bu sözleşmeye alındı (§4.1–§4.4, §6.5). AÇIK: `TEKSERP_DOGRULAMA_KIPI` (arka plan işleri başlamaz) · `/health` döngü adresine `lisans{kip,butunluk,cekirdek}` · niyet yazıcısı (belirteç tazeleme + onay, §5.1) · `backend-hizmeti.ps1`: `-Uygula` sırası bugün izinler → kayıt (TERS: önce `tekserp-hizmet.exe hizmet-kur`, sonra izinler — §4.2) · kaydı `hizmet-kur`a bırakması · `durum.json`u `guncelleme\durum\` altında ölçmesi · `guncelleme\is\`i yasak sınıfa alması · `hizmet\` dizininin (konak `current\runtime\`de) düşmesi.
- **D4:** CEVAPLANDI (şartname `KENDI-POSTGRESQL.md`, dal `dagitim/d4-pg`): `pgsql\<surum>-<derleme>` + `pgsql\bin` junction + `ornek.json` bu sözleşmeye alındı (§4.1, §9); `PG_BIN_DIR = <KOK>\pgsql\bin`.
- **D5:** `yapilandirma\.env` · `guncelleyici\ayar.json` (`guncellemeSunucusu` ZORUNLU — yoksa güncelleyici `AYAR_BICIMSIZ` ile bekler) · iki `hizmet-kur` çağrısı, ACL'lerden (D3'ün betiği) ÖNCE (§4.2 kurulum sırası).
- **D6:** `app\` + pm2 + `.env` + ecosystem `env` → `surumler\<surum>` + `current` + `yapilandirma\.env` (D3 düzeni); `backups\` ve `logs\` yerinde kalır; mevcut harici PG için `pgsql\ornek.json` `kip: "harici"` (yoksa güncelleyici zaten harici sayar).
- **D7:** panel `GET /api/guncelleme/durum` (D1) üzerinden `durum.json` + `gecmis.jsonl`i gösterir; onayı backend'e yazdırır (§5.1).
