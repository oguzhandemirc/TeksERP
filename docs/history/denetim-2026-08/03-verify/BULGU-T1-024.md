# BULGU-T1-024 — DOĞRULAMA (③ sonrası, TUR 1)

**Başlık:** Gece yedeğinin başarısız olduğunu gören hiçbir mekanizma yok; üstelik bayatlık sayacı deploy yedeğiyle sıfırlanıyor
**Modül:** OPS · **Kategori:** I.4 · **Giriş şiddeti:** S1 · **Giriş kanıt seviyesi:** K2

| Sonuç | Değer |
|---|---|
| **Karar** | **doğrulandı** |
| **Ulaşılan kanıt seviyesi** | **K3** (yarış-dışı sınıf → *tek koşumla davranışsal kanıt*; üretim kaynağı BİREBİR çalıştırıldı) + K2 (saha + dev veri ölçümü) |
| **Şiddet (doğrulama sonrası)** | **S1 — DEĞİŞMEDİ** (aşağıda gerekçe; enflasyon yapılmadı) |
| Repro | `Teks-Erp/scripts/audit_repro_BULGU-T1-024.ts` → `audit/repro/BULGU-T1-024.log` |
| K2 sorgusu / sonucu | `audit/data/BULGU-T1-024.sql` / `audit/data/BULGU-T1-024.txt` |
| Bozulma | **3/3 senaryoda gözlendi, 10 tekrarın 10'unda aynı** (deterministik) |

---

## 1. Kod teyidi (bulgunun iddiası ↔ ölçüm)

### 1.1 Tür süzgeci gerçekten YOK — `Teks-Erp/src/app.ts:194-219`
```ts
let backupCache: { name: string; time: string } | null = null;      // 194
...
function latestBackupInfo(): { name: string; time: string } | null { // 197
  if (!backupDir) return null;
  ...
    for (const f of fs.readdirSync(backupDir)) {
      if (!f.toLowerCase().endsWith(".dump")) continue;              // 207 ← TEK süzgeç
      const st = fs.statSync(path.join(backupDir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { name: f, mtimeMs: st.mtimeMs };
    }
  ...
  } catch {
    backupCache = null;                                              // 215 ← okunamadı = "yedek yok"
  }
```
Blokta `backupKind` / `NIGHTLY_PREFIX` / `tekserp_` **hiç geçmiyor** (repro §① mekanik olarak doğruladı). Tek tüketici: `app.ts:432` `lastBackup: latestBackupInfo()` → yalnız `GET /api/admin/health`.

### 1.2 "Guard yok" iddiası — altı kaynak çözüldü (beceri §7.8)
| Olası koruma | Ölçüm | Sonuç |
|---|---|---|
| Aynı dosyada ikinci süzgeç | `app.ts:194-219` tam blok okundu | yok |
| Sunucu tarafında bayatlık alarmı | `grep -rn "ageH\|backupAge\|24 \* 60 \* 60" src` → yalnız archive-scheduler/retention/oturum | **yok** |
| `BACKUP_FAILED` audit'i | `backup.service.ts:193` — YALNIZ `runBackupJob` içinden; sahada gece yedeğini backend almıyor | kapsamıyor |
| `reportJobFailure` (`JOB_FAILED:*`) | `jobs/job-failure.ts:34`, çağıranlar archive/offsite/backup **scheduler'ları** | harici Windows görevini kapsamıyor |
| Offsite süpürücü | `helpers/offsite-backup.helper.ts:263` `lastSweep` **bellekte**, `configured:false` iken sessiz | kapsamıyor |
| İstemci alarmı | `Electron/.../serverHealth.ts:208-211`; `evaluateAlerts` **tek tüketici** `ServerStatusPage.tsx:65` | pull-only |

### 1.3 Alarm ters sıralaması — `Electron/src/pages/System/ServerStatus/serverHealth.ts:208-211`
```ts
const ageH = d.lastBackup ? (Date.now() - new Date(d.lastBackup.time).getTime()) / 3_600_000 : null;
if (ageH == null) out.push({ level: "warn", message: "Henüz yedek alınmamış." });      // okunamayan klasör = WARN
else if (ageH >= 48) out.push({ level: "crit", message: `Son yedek ... gün önce.` });  // 48 sa = CRIT
```
`null` ("klasörü okuyamıyorum" **veya** "hiç yedek yok") 48 saatlik yedeksizlikten **daha hafif** işaretleniyor.

### 1.4 Alarm PULL-ONLY (push kanalı yok)
`useServerHealth` (`serverHealth.ts:71-96`) `refetchInterval: isTabActive ? 5000 : false` — **yalnız Sunucu Durumu sekmesi açık ve aktifken** yoklar; `evaluateAlerts` başka hiçbir yerde çağrılmıyor (`grep`: 1 üretim tüketicisi). Electron'da `Tray`/`new Notification` **0 vuruş**. Uç ayrıca `admin:settings` arkasında (`app.ts:563-566`).

### 1.5 "Aynı soruya iki cevap" — düzeltmenin şekli zaten repoda var
- `deploy/kur.ps1:354` gece yedeğini ararken **türe bakıyor**: `Get-ChildItem $backupDir -Filter "tekserp_*.dump"`, bulunamazsa sarı uyarı basıyor.
- `backup.service.ts:479-486` `listBackups()` her dosyaya `kind: backupKind(name)` yazıyor.
- `helpers/backup-naming.helper.ts:198-203` `backupKind()` — saf, bağımlılıksız.
Yani sınıflandırıcı **var ve iki yerde kullanılıyor**; eksik olan yalnız `latestBackupInfo`'nun onu çağırması. (`backup.service.ts:232-234` yorumu "dosya listeleyen dört yol da `.dump` şartını korur" derken tam da bu ayrımı gözden kaçırıyor: `.dump` şartı ortak, **tür** şartı değil.)

### 1.6 Deploy yedeği gerçekten aynı klasöre düşüyor
`deploy/kur.ps1:47` `$backupDir = "$kok\backups"` (= `C:\Etkili-Yazilim\backups`) ↔ `Teks-Erp/ecosystem.config.js:113` `BACKUP_DIR: "C:/Etkili-Yazilim/backups"` → **aynı klasör**; `kur.ps1:179` `premigrate_$damga.dump` oraya yazılıyor ve rotasyon dışı (`backup-naming.helper.ts:11-15`) olduğu için **kalıcı**.

---

## 2. K2 — veride fiili ölçüm

Sorgu: `audit/data/BULGU-T1-024.sql` · Ham çıktı: `audit/data/BULGU-T1-024.txt`

### 2.1 Saha (prod kopyası `tekserp_saha_0825`, pencere **2026-07-16 → 2026-08-25, 41 gün**)
| Ölçüm | Değer | Yorum |
|---|---|---|
| `BACKUP_COMPLETED / manual` | **7** | panelden elle |
| `BACKUP_COMPLETED / nightly` | **1** (2026-08-25 03:05) | 41 günün **1**'i |
| Gece yedeği kaydı olan gün sayısı | **1 / 41** | defter 40 gece için **hiçbir şey bilmiyor** |
| `BACKUP_FAILED` | **0** | |
| `JOB_FAILED:*` (tümü) | **0** | başarısızlık izi hiç doğmamış |
| `system_settings.backup.lastNightlyAt` | değer `2026-08-25T00:05:07Z`, **`createdAt` = 2026-08-25 03:05:07** | backend zamanlayıcısı sahada **ilk kez o gece** koşmuş |
| Deploy günü (`_prisma_migrations.finished_at`) | **10 ayrı gün** (07-16, 07-31, 08-01, 08-03, 08-05, 08-06, 08-15, 08-17, 08-24, 08-25) | **bayatlık sayacının sıfırlandığı 10 gün**; ortalama ~4 günde bir |

**Okuma:** Sahada gece yedeğini backend almıyor (`ecosystem.config.js:107` `BACKUP_SCHEDULE_ENABLED:"false"`, harici `TeksERP-DB-Backup` görevi alıyor) → o yedeğin **başarısı da başarısızlığı da backend defterine hiç düşmüyor**. `BACKUP_FAILED = 0` bir sağlık işareti DEĞİL, **ölçüm yokluğudur**: bu sistemde harici gece yedeğinin başarısızlığı yazılabilecek bir yer bile yok. Buna karşılık **kâğıt üstünde çalışan tek görsel kapı (48 sa CRIT), 41 günde 10 kez deploy dosyasıyla sıfırlanıyor**.

### 2.2 Dev (`adnansahin_db`, karşı-ölçüm — mekanizmanın *çalıştığı* hâl)
| Ölçüm | Değer |
|---|---|
| `BACKUP_COMPLETED / nightly` | 20 (2026-08-02 → 2026-08-27) |
| `BACKUP_FAILED / nightly` | **1** (2026-08-24 03:27:18, `file` = boş) |
| Gece yedeği kaydı olan gün | 19 / 44 |

Yani **backend kendi aldığında başarısızlık defterde görünüyor** (dev'de 1 kayıt). Sahada bu yolun kapalı olması, sessizliği açıklıyor.

### 2.3 Gerçek yedek klasörü ölçümü (dev makinesi, salt-okunur; repro §5)
`/Users/oad/tekserp-backups` → 37 `.dump` (35 nightly, 2 pre-restore). Kronolojik yürüyüş: **2 pencerede**, toplam **23,0 saat** boyunca "en yeni `.dump`" bir gece yedeği DEĞİLDİ (en uzunu 23,0 sa: `pre-restore_adnansahin_db_20260802_before_dedup.dump`). Bu makinede `kur.ps1` koşmadığı için `premigrate_` yok — sahadaki maruziyet (deploy başına bir dosya, rotasyon dışı) **daha yüksektir**.

---

## 3. K3 yerine geçen davranışsal kanıt (yarış-dışı sınıf)

**Script:** `Teks-Erp/scripts/audit_repro_BULGU-T1-024.ts` — **DB'ye hiç dokunmaz** (ne okur ne yazar; `devDbGuard` yine de koşar). Yöntem, yeniden yazım değil: denetlenen iki kod parçası **satır aralığıyla dosyadan BİREBİR okunur**, TypeScript derleyicisiyle JS'e çevrilip çalıştırılır (`src/app.ts:194-219` ve `Electron/.../serverHealth.ts:208-211`; her ikisinin kaynağı loga aynen basılır). Geçici klasör `finally`'de silinir; yazıcı/pg_dump/rclone çağrılmaz; feature-flag/SystemSetting değiştirilmez.

| Senaryo | Klasör | `lastBackup` | Panel alarmı | Sonuç |
|---|---|---|---|---|
| S1 referans | nightly 20 sa | `tekserp_…` (nightly) | — yok — | ✅ doğru |
| S2 **deploysuz** 10 gün yedeksizlik | nightly 240 sa | `tekserp_…` 240 sa | **CRIT: "Son yedek 10 gün önce."** | ✅ kapı çalışıyor |
| **S3 aynı 10 gün + bugün deploy** | + `premigrate_` 0,2 sa | **`premigrate_…` 0,2 sa** | **— HİÇ ALARM YOK —** | ❌ **BOZULMA** |
| **S4 aynı + geri-yükleme yedeği** | + `pre-restore_` 0,2 sa | **`pre-restore_…`** | **— HİÇ ALARM YOK —** | ❌ **BOZULMA** |
| **S5 klasör okunamıyor** | — | `null` | **WARN** ("Henüz yedek alınmamış.") | ❌ **BOZULMA** (S2 CRIT iken) |
| S6 bilgi zaten var | — | `backupKind`: nightly / premigrate / pre-restore | — | ✅ eksik olan yalnız çağrı |

**10 tekrarın 10'unda aynı sonuç** (`SONUÇ: 6 geçti / 3 kaldı — BOZULMA 3/3`) — deterministik, zamanlamaya bağlı değil.
Bekçi semantiği: **❌ = bulgu canlı, düzeltmeden sonra üçünün de ✅ olması beklenir** → script olduğu gibi regresyon bekçisi olarak kalabilir.

---

## 4. failure_mode (doğrulanmış hâli)

`yedekle.ps1` (Windows Görev Zamanlayıcı, 02:00) disk dolduğu / PGPASSWORD döndüğü / `pg_dump` sürümü uyuşmadığı için 10 gece üst üste düşer; `C:\Etkili-Yazilim\backups` içine yeni `tekserp_*.dump` doğmaz.
① Backend bu görevi hiç görmediği için ne `BACKUP_FAILED` ne `JOB_FAILED` yazılır (**saha ölçümü: 41 günde 0**) — hiçbir defterde iz yoktur.
② 3. gün bir sürüm çıkılır; `kur.ps1:179` aynı klasöre `premigrate_<damga>.dump` yazar; `app.ts:207` yalnız `.dump` uzantısına baktığı için bu dosya "son yedek" olur → **`ageH` 0'a döner, CRIT alarmı kaybolur** (repro S3, ölçüldü). Saha penceresinde bu sıfırlama fırsatı **41 günde 10 kez** doğmuştur.
③ Alarm zaten yalnız `admin:settings` yetkili biri Sunucu Durumu sekmesini **açık ve aktif** tutarken hesaplanır; push kanalı yoktur.
④ 10. gün diskteki en taze gerçek yedek 7 gün öncesinin `premigrate_` dosyasıdır. Bir donanım arızasında **RPO ≈ 7 gün** (yaklaşık 1.400 top hareketi / 35 iş emri mertebesinde kayıt — saha hacmine göre).

---

## 5. Şiddet gerekçesi (S1'de bırakıldı)

- **Etki:** kritik sınıfa yakın (veri kaybı penceresi), **ama kusur veriyi kendisi bozmuyor** — bir *tespit katmanını* siliyor. Zarar ancak ikinci bir olayla (yedek görevinin düşmesi + donanım arızası) gerçekleşir.
- **Olasılık:** orta — sıfırlama fırsatı ölçüldü (41 günde 10 deploy), ama gece yedeğinin fiilen düştüğüne dair **saha kanıtı yok** (2026-08-25'te taze bir dump üretilmiş).
- **Düzeltici:** sessiz ve alarmsız → bir kademe **yükseltildi** (S2 → S1). Bu artış **zaten fiyatlandırıldı**; ikinci kez S0'a çekmek enflasyon olur ve `_FINDER-BRIEF` §Şiddet'e aykırıdır.
- Not: S0 için gereken K2/K3 kanıtı **mevcut**; S1'de kalması kanıt eksikliğinden değil, etki zincirinin koşullu olmasındandır.

---

## 6. Öneri (2. tur için — düzeltmenin ŞEKLİ)

1. **`latestBackupInfo` türe baksın.** `helpers/backup-naming.helper.backupKind(f) === "nightly"` süzgeci + yanıtta **iki alan**: `lastBackup` (son gece yedeği) ve `lastAnyBackup` (her tür). Panelde ikisi de görünür; alarm **yalnız** `lastBackup`'tan hesaplanır. `deploy/kur.ps1:354` ile aynı kural olur (tek doğru, iki yerde tekrar etmesin diye ön ekler zaten tek kaynakta).
2. **`catch` dalını ayır.** `null` yerine `{ error: true }` benzeri üçüncü bir durum; `evaluateAlerts`'te "yedek klasörü okunamıyor" → **CRIT** (48 sa yedeksizlikten hafif olamaz). Aynı yerde `ageH == null` (hiç yedek yok) da CRIT'e çekilmeli — "henüz yedek alınmamış" bir kurulum hatasıdır, uyarı değil.
3. **Harici gece yedeğini defterin görebileceği hâle getir** (asıl boşluk): backend'de günde bir kez koşan hafif bir *gözlemci* — BACKUP_DIR'de son 26 saatte `tekserp_*.dump` doğmuş mu? Doğmadıysa `reportJobFailure("nightly-backup-missing", …)` → `SystemLog` + `/health` sayacı. Yeni bir yedek ALMAZ, yalnız bakar; sahadaki "yedeği backend almasın" kararını bozmaz.
4. **Push kanalı** (D-I-02 ile ortak): kritik alarm için Sunucu Durumu sekmesinden bağımsız bir yüzey (tepsi bildirimi / açılışta modal). Pull-only alarm, "kimse bakmazsa yok" demektir.
5. Bekçi: `scripts/audit_repro_BULGU-T1-024.ts` olduğu gibi `test_backup_staleness.ts` adıyla `run-all-tests.ts`'e alınabilir (üç ❌ düzeltmeden sonra ✅ olur; negatif sonda hazır).
6. **Migration / veri dokunuşu YOK** → `prod_risk: dusuk`. Geri alma: değişiklikler saf okuma yolunda, tek commit revert.

**Kabul kriteri:** repro script'i 3 senaryoda ✅ verir · `premigrate_`/`pre-restore_` dosyası alarmı sıfırlamaz · okunamayan klasör CRIT üretir · 26 saat `tekserp_*.dump` doğmazsa `SystemLog`'da `JOB_FAILED:nightly-backup-missing` satırı oluşur (dev'de dosya adı damgalanarak ölçülebilir).
**Efor:** ~1 gün (1-2: 2 sa · 3: 3 sa · 5: 1 sa · 4 ayrı iş).

---

## 7. Önceki defter

- `F-OPS-VER-003` (**HÂLÂ AÇIK**, `K12:126`) — offsite kod hazır, yapılandırma boş. Bu bulgu onun **ikizi değil**: orada "ikinci kopya yok", burada "birinci kopyanın alınmadığını gören yok".
- `F-CORE-OPS-004` (`K12:80`, kapanmış) — `reportJobFailure` mekanizması. Defterdeki "DB: `JOB_FAILED*` dev 0 / saha 0" ölçümü bu koşumda **teyit edildi**; mekanizma doğru ama **harici gece yedeğine bağlı değil**.
- `F-CORE-OPS-001` (`K12:77`, kapanmış) — yarım `.dump` taze görünüyordu. Aynı fonksiyonun aynı satırı; o düzeltme **uzantı** şartını sağlamlaştırdı, **tür** şartını hiç sormadı.
- Reddedilmiş hiçbir bulgu yeniden açılmadı.

---

## SINIR ÖTESİ NOTLAR

1. **(J / OPS)** Saha env'i repo ile ayrışmış görünüyor: `system_settings.backup.lastNightlyAt` **2026-08-25 03:05'te YARATILMIŞ** (o tarihten önce satır yok) → backend zamanlayıcısı sahada o gece koşmuş, oysa `ecosystem.config.js:107` `BACKUP_SCHEDULE_ENABLED:"false"`. Aynı gecenin `BACKUP_COMPLETED` mesajında **"OFFSITE YEDEK AYARLANMADI" uyarısı YOK** (7 önceki manuel yedekte VAR) → `backup.service.ts:324` gereği o an `BACKUP_OFFSITE_DIR` **doluydu**. İki sonuç: (a) `F-OPS-VER-003` sahada kısmen kapanmış olabilir — repodan doğrulanamaz; (b) Windows görevi + backend zamanlayıcısı **ikisi birden** açıksa `ecosystem.config.js:100-106`'nın uyardığı **her gece iki dump** durumu oluşur ve "gece yedeğinden kim sorumlu" sorusunun tek cevabı kalmaz. [VARSAYIM — canlıya erişim yok]
2. **(J / OPS)** `yedekle.ps1` **repoda yok** (yalnız docker'a bakan `Teks-Erp/yedekle.sh` var). Sahadaki gece yedeğini alan script sürüm kontrolü altında değil → adlandırma kuralı, saklama, hata davranışı denetlenemiyor. Bu, 3. maddedeki "gözlemci" önerisini daha da gerekli kılıyor.
3. **(G)** `/api/admin/health` `lastBackup.name`'i olduğu gibi döndürüyor; `admin:settings` arkasında olduğu için sorun değil, ancak yeni bir yüzeye taşınırsa dosya adı sunucu yol/politika bilgisi sızdırır (`app.ts:326-337` uyarısıyla aynı sınıf).
4. **(H)** `latestBackupInfo` senkron `readdirSync`+`statSync` kullanıyor (30 sn cache ile hafifletilmiş); `listBackups` aynı işi async yapıyor (`backup.service.ts:470`). Tür süzgeci eklenirken async'e çevirmek doğal fırsat.

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod sunucusuna (SAHINSRV) erişim yok.** `C:\Etkili-Yazilim\backups` klasörünün gerçek içeriği, Görev Zamanlayıcı'nın "Son Çalışma Sonucu" kodu, `yedekle.ps1`'in metni ve sahadaki gerçek env değerleri **ölçülemedi**. Elde olan prod **kopyasıdır** (2026-08-25, 190/195 migration) ve dosya sistemi taşımaz.
- Gece yedeğinin sahada **fiilen** düşüp düşmediği doğrulanamadı; bulgu "düşerse görülmez" iddiasıdır, "düştü" iddiası değildir.
- `evaluateAlerts`'in tamamı değil, yalnız yedek bloğu (208-211) çalıştırıldı; diğer alarm dalları bu bulgunun kapsamı dışında.
- Electron tarafında vitest paketi koşturulmadı (salt-okunur kural + kapsam); mevcut `serverHealth.test.ts` incelendi: fixture'ı `lastBackup: { name: "tekserp_x.dump" }` (nightly ad) kullanıyor ve **`premigrate_`/`pre-restore_` adı için hiç senaryo yok** → bekçinin kör noktası hatanın kendisiyle aynı yerde (`K11` "kör nokta" sınıfı).
