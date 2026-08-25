# `SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md` düzeltmeleri — dev'de yapılacaklar

> ✅ **UYGULANDI — 2026-08-25.** 12 maddenin tamamı `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md`'e
> işlendi (seçenek A: damga + yerinde düzeltme), `DEPLOY-RUNBOOK.md` §3/§9 paket akışına
> çevrildi, CSV'ye 4 eksik grup eklendi (V-1430 hariç — kalan kayıt yazılmamış), `kur.ps1`
> bonusu ayrı işte (`deploy/`). **Notun ölçümle düzeltilen tarafları:**
> - §12 "swagger uyarısını not zaten söylüyor" → **söylemiyordu**; satır eklendi.
> - §1 yalnız `DEPLOY-RUNBOOK` diyordu; aynı bayat `git pull` akışı **üç dosyada daha** vardı
>   (`MIGRATION-DEPLOY.md`, `URETIM-KONTROL-LISTESI.md`, `PM2-GECIS-DEVIR-NOTU.md`) → tarihsel bandı.
> - Runbook'un "migration öncesi otomatik yedek YOK" paragrafı da bayattı (`kur.ps1` adım 3
>   `premigrate_` alıyor) → düzeltildi.
> - §10 dersi dokümana değil **script'e** kondu: `find_fold_duplicates` artık iki keskin
>   taramayı da basar (dev'de 3 harf-duyarsız kod çakışması buldu).

**Kaynak:** 2.9.0'ın fabrikaya gerçekten kurulduğu oturum (2026-08-24 18:18–18:24, commit `935f180`).
Aşağıdaki her rakam **canlıda ölçüldü**, prova kopyasından değil.

**Prod'a dokunma gerekmez** — bunların hepsi doküman/script düzeltmesi, dev'de yapılıp
GitHub'a atılacak. Not `docs/ops/` altında, `Teks-Erp/` dışında.

---

## 0) Önce kararı ver: bu not artık geçmiş kaydı

2.9.0 sahaya indi. İki seçenek:

- **(A) Notu "uygulandı" olarak damgala** — başına şu bloğu ekle, gövdeyi olduğu gibi bırak
  ama aşağıdaki yanlış rakamları düzelt. Gelecekte "ne yaptık" diye bakılacak dosya bu.
- **(B) `docs/history/` altına taşı**, `docs/ops/` içinde yalnız runbook kalsın.

Hangisi olursa olsun başa şu düşmeli:

```markdown
> ✅ **SAHADA UYGULANDI — 2026-08-24 18:18, commit `935f180`, paket 114.5 MB.**
> 24 migration uygulandı (toplam 189), kesinti ~3 dk, geri dönüş noktaları:
> `app.eski-20260824_181800` + `backups/premigrate_20260824_181800.dump`.
> Aşağıdaki rakamlar CANLIDA ölçülenlerle güncellendi; prova (kopya) rakamları
> nerede farklıysa ayrıca belirtildi.
```

---

## 1) 🔴 EN ÖNEMLİ — §3 yanlış deploy yöntemini anlatıyor

Not şunu diyor:

```powershell
cd C:\...\Teks-Erp
pm2 stop <süreç-adı>
git pull
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run build
pm2 start <süreç-adı>
```

**Fabrika böyle deploy edilmiyor.** Gerçek yol paket tabanlı:

1. Repo kökünde `.\paketle.ps1 -Cikti C:\Etkili-Yazilim` → `tekserp-backend-<damga>-<commit>.zip`
2. `C:\Etkili-Yazilim\kur.ps1 -Paket <zip> -Zorla`

`kur.ps1` sırayı kendisi yapıyor: paket doğrulama → **premigrate yedeği (pg_restore ile
doğrulanır)** → pm2 delete → eskisini `app.eski-<damga>` olarak kenara alma → yeni sürümü
yerleştirme + `.env` taşıma → `migrate deploy` → `pm2 start` + `pm2 save` → `/health`.

Notun §3'ü bu akışla değiştirilmeli. Ayrıca üç saha tuzağı eklenmeli:

- **`-Zorla` şart** — script `Read-Host` ile onay soruyor; otomasyon/oturum içinde asılı kalır.
- **Çalışma dizini `app\` İÇİNDE OLMAMALI.** `kur.ps1:174` geri alma yolunda
  `Remove-Item $appDir` var ve geri koyacağı `app.eski-*` henüz oluşmadıysa **çalışan
  kurulum yedeksiz siliniyor**. Tetikleyici: `app\` üzerinde açık dosya kilidi.
  (2026-08-24'te buna karşı elle `app.guvenlik-<damga>` kopyası alındı — bu adım nota girmeli
  ya da daha iyisi `kur.ps1` onarılmalı, bkz. §7.)
- **`npm ci` internet ister** — paket `node_modules` ile geliyorsa atlanıyor, gelmiyorsa değil.

> `kur.ps1` başlığındaki "Sunucuda artık KAYNAK KOD ve .git YOK" ifadesi de artık doğru değil:
> sunucuda **iki** klon var (`C:\Etkili-Yazilim\tekserp` — dar refspec + sparse-checkout,
> ve `D:\tekserp-build\tekserp` — tam). 2.9.0 paketi birincisinden üretildi.

---

## 2) Migration sayıları yanlış

| Yer | Notta yazan | Gerçek (canlı, 2026-08-24) |
|---|---|---|
| §0 başlık | "31 migration, on altı iş" | **24 bekleyen** (165 uygulanmıştı, toplam 189 oldu) |
| §0 gövde | "fabrikanın 14 Ağustos hâline göre 31 bekleyen" | 14 Ağustos referansı bayat — fabrikada 17 Ağustos migration'ları da uygulanmıştı |
| §1 ön-tarama | `npx prisma migrate status # 19 bekleyen görmelisin` | **24 bekleyen** |
| §5 prova tablosu | "19 migration hatasız, ~1 sn" | canlıda **24 migration**, hatasız |

**Sabit sayı yazmak yerine** §1'e şunu koy — bayatlamaz:

```powershell
npx prisma migrate status   # bekleyen sayısını NOT AL; §0 tablosundaki iş sayısıyla karşılaştır
```

## 3) §0 tablosunda 4 migration hiç yok

Şu dördü tabloda geçmiyor ama deploy'da uygulandı (20 Ağustos, "fire" işi):

- `20260820020000_quality_grade_skip_label`
- `20260820030000_fire_grade_targets_scrap`
- `20260820040000_fire_label_marking`
- `20260820050000_fire_label_dedup`

Tabloya satır ekle; "on altı iş" ifadesi de buna göre güncellenmeli.

## 4) `import_runs` kolon sayısı

§4 doğrulama tablosu **"17 kolon + 5 index"** diyor. Migration'ın kendisi (`20260819120000_import_runs`)
**16 kolon** tanımlıyor ve canlıda da 16 var. `17` → **`16`**.

## 5) §4'teki `*_nameFold_key` beklentisi kendi içinde çelişkili

§4 tablosu: *"Prod'da bugün **0 satır BEKLENİR** (üç tabloda da mükerrer var → migration atladı)"*
§5c ise: *"`customers` TEMİZ → index KURULUR"*

İkisi aynı anda doğru olamaz. **Canlıda ölçülen: 1 satır** — `customers_nameFold_key` kuruldu,
`items` ve `subcontractors` NOTICE ile atlandı. §4 satırını buna göre düzelt.

## 6) Boot uzlaştırma log'u yanlış izinleri sayıyor

Notta beklenen (§7):

```
[permission-catalog] 2 EKSİK izin DB'ye yazıldı: data:import, mobile:kk1-yari-mamul
[role-templates] 'ADMIN_FULL' şablonuna 2 eksik izin eklendi: data:import, mobile:kk1-yari-mamul
[role-templates] 'WEB_SYSTEM_ADMIN' şablonuna 1 eksik izin eklendi: data:import
[role-templates] 'MOBILE_PRODUCTION_OPERATOR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
[role-templates] 'MOBILE_TAMBUR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
```

Canlıda gerçekten basılan:

```
[permission-catalog] 2 EKSİK izin DB'ye yazıldı: data:import, master-data:merge
[role-templates] 'ADMIN_FULL' şablonuna 2 eksik izin eklendi: data:import, master-data:merge
[role-templates] 'WEB_SALES' şablonuna 1 eksik izin eklendi: master-data:merge
[role-templates] 'WEB_SYSTEM_ADMIN' şablonuna 1 eksik izin eklendi: data:import
[role-templates] 'MOBILE_PRODUCTION_OPERATOR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
[role-templates] 'MOBILE_TAMBUR' şablonuna 2 eksik izin eklendi: customer-alias:write, label:edit
```

İki fark: **`mobile:kk1-yari-mamul` fabrikada ZATEN VARDI** (eksik olan `master-data:merge`'dü),
ve notta hiç geçmeyen bir **`WEB_SALES`** satırı var.

§7'nin doğrulama SQL'i de güncellenmeli — üç izin de sorulmalı:

```sql
SELECT code FROM permissions WHERE code IN ('data:import','master-data:merge','mobile:kk1-yari-mamul');
```

## 7) 🔴 §7b'deki `/health` doğrulaması ÇALIŞMIYOR

Notta:

```powershell
curl -s http://localhost:4000/health | findstr auditGuard
#    Beklenen: "auditGuard":"on"
```

`auditGuard` alanı **`/health`'te yok** — o uç yalnız `status/api/db/version/time` döner.
Alan `buildRichHealth()` içinde ve **`GET /api/admin/health`** ile servis ediliyor
(`app.js:376` → `verifyToken` + `requirePermission("admin:settings")`).

Doğrusu:

```powershell
curl -s -H "Authorization: Bearer <token>" http://localhost:4000/api/admin/health | findstr auditGuard
```

Token'sız kalınacaksa üçüncü yüzey olarak **backend log'u** kullanılsın — kurulumda bu çalıştı:

```
[audit-guard] koruma AÇIK — audit kayıtları salt-yazılır.
```

> §7b'nin ilk iki doğrulaması (`SHOW teks.audit_guard` ve 0 satırlık `DELETE`'in reddi)
> **olduğu gibi çalıştı**, onlara dokunma.

## 8) Backfill rakamları — prova ≠ canlı

Notta parantez içindeki sayılar prova kopyasından. Canlıda ölçülenler:

| Script | Notta (prova) | Canlıda (2026-08-24) |
|---|---|---|
| `backfill_roll_production_timestamps` | finalizedAt 53 · statusChangedAt 752 | **0 · 0** (+4 kapsam dışı) → uygulanacak bir şey yok |
| `backfill-record-provenance` | oluşturan 781 · değiştiren 797 | **1208 · 1208** |
| `backfill_roll_entry_station` | SESSION 113 · RECEIPT 3 · PRODUCED_STEP 10 | **birebir aynı**, 126 kayıt yazıldı |
| `backfill_roll_label_customer` | (sayı yok) | **46 kayıt** |
| `backfill_roll_fold_and_reason` | 8 topun sebebi yok | **0 yazıldı**, 12 top kapsam dışı |

Prova sayılarını silme — "prova / canlı" iki sütun olarak dursun, mertebe farkını görmek işe yarıyor.

## 9) §5b — iş emri tipi düzeltmesi 13 değil 35

Not: *"2026-08-21 10:33 yedeğinde **13 iş emri**"*. Canlıda `--apply` **35/35** yazdı
(aradan geçen günlerde eski backend aynı hatayı üretmeye devam etmiş; 24 Ağustos'ta açılanlar dahil).
İdempotens doğrulandı — ikinci koşum `Tutarsız iş emri yok` dedi.

Sayıyı sabitleme; şöyle yaz: *"yedekte 13 ölçüldü; canlıda 35 çıktı — kök neden bu sürümde
kapandığı için sayı deploy gününe kadar artmaya devam eder."*

## 10) §5c — mükerrer karar dosyası eksikti

`docs/ops/mukerrer-kararlari-2026-08-22.csv` **9 karar** içeriyor. Canlıda katlanmış ada göre
**11 grup** vardı ve daha keskin taramalarla (noktalama/boşluk atınca aynı olanlar + harf-duyarsız
kod çakışması) **4 grup daha** çıktı. Toplam **15 birleştirme** uygulandı.

Karar dosyasında **olmayan** ama canlıda gerçek olanlar:

| Varlık | Kalan | Eriyen | Neden dosyada yoktu |
|---|---|---|---|
| fason | `Boyer Tekstil` [FSN-260716-6733] | [BOYER] | 22 Ağustos dump'ında yoktu |
| kumaş | `BAYRO FLAM` [BAYROFLAM] | `FLAM` [bayroflam] | adlar farklı, kodlar harf farkıyla aynı |
| kumaş | `MİKRO CANVAS` | `MIKROCANVAS` | **tek fark boşluk** — katlanmış ad taraması KAÇIRIR |
| renk | `292-7791-GRİ` | `GRİ-(292-7791)` | parantez; uygulama kuralı da kaçırıyor |

**Nota eklenecek en değerli ders:** `find_fold_duplicates.ts` yalnız **birebir katlanmış ada**
bakar. Gerçek mükerrerlerin bir kısmı ondan kaçıyor. §5c'ye şu iki taramayı ekle:

```sql
-- (a) noktalama/boşluk atılınca aynı olanlar
SELECT regexp_replace("nameFold",'[^a-z0-9]','','g') AS s, count(*), string_agg(name||' ['||code||']','  ||  ')
FROM items WHERE "mergedIntoId" IS NULL GROUP BY 1 HAVING count(*)>1;

-- (b) harf-duyarsız kod çakışması (code UNIQUE'i BÜYÜK/küçük harf DUYARLI!)
SELECT lower(code), count(*), string_agg(name||' ['||code||']','  ||  ')
FROM items WHERE "mergedIntoId" IS NULL GROUP BY 1 HAVING count(*)>1;
```

(b) fabrikada 8 çakışma buldu — `MC155`/`mc155`/`Mc155` gibi üçlüler dahil.

## 11) §6 bekçi sonuçları — canlı rakamlar

| Bekçi | Notta | Deploy anında | Temizlik sonrası |
|---|---|---|---|
| `test_db_invariants` | 86/2 → 87/1 | **86/2** ✓ | **88/0** |
| `test_consistency` | 19/22 → 20/22 | **19/22** ✓ | **20/22** ✓ |
| `test_schema_drift` | 2 bilinen fark | **4 ifade** (2 kalıcı + 2 tolere) ✓ | 2 kalıcı |

Not "87/1" diyor çünkü `items` seddinin `V-1430` yüzünden açık kalacağını varsaymış.
Canlıda V-1430 çifti de birleştirildi → **88/0**, üç tabloda da sed kurulu.
§5c'nin "10 grup → 1 (yalnız V-1430)" cümlesi **"11+ grup → 0"** olmalı.

## 12) Küçük düzeltmeler

- §4 `pg_extension` beklentisi (`plpgsql`, `pg_trgm`) **doğru çıktı** — pg_trgm kuruldu,
  9 trigram index'i sorunsuz. "pg_trgm yoksa" bölümü sahada gerekmedi; **silme**, ileride lazım.
- §0'daki ICU uyarısı gereksizdi: fabrikada **784 ICU collation** var, `tr_sort` provider `i`.
  Bunu "ölçüldü, sorun çıkmadı" diye işaretle.
- `[swagger] OpenAPI spec BOŞ` uyarısı çıktı ve **zararsız** — not bunu zaten söylüyor, doğru.
- `[offsite] BACKUP_RCLONE_REMOTE boş` uyarısı saatte bir düşüyor. Deploy'la ilgisi yok ama
  **hâlâ açık bir risk**: tüm yedekler DB ile aynı diskte. Nota "kapatılmamış borç" olarak geç.

---

## Bonus — `kur.ps1`'deki gerçek açık (ayrı iş, ayrı commit)

`kur.ps1:168-184` `GeriAlOtomatik()`:

```powershell
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $eskiAd) { Move-Item $eskiAd $appDir -Force }
```

`$eskiAd` (satır 191'deki `Move-Item`) oluşmadan bir hata olursa: **`app\` silinir, geri
konacak bir şey yoktur.** Yani "otomatik geri alma" tam da en kötü anda çalışan kurulumu yok eder.

Önerilen onarım — silmeden önce hedefin varlığını şart koş:

```powershell
if (-not (Test-Path $eskiAd)) {
  Uyar "Geri alma İPTAL: $eskiAd yok — mevcut app\ klasörüne DOKUNULMUYOR."
  exit 1
}
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue }
Move-Item $eskiAd $appDir -Force
```

---

## Özet — dokunulacak dosyalar

| Dosya | Ne |
|---|---|
| `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md` | §0,1,3,4,5,5b,5c,6,7,7b — yukarıdaki 12 madde |
| `docs/ops/mukerrer-kararlari-2026-08-22.csv` | 4 eksik grubu ekle ya da "uygulandı, geçmiş kayıt" damgası vur |
| `docs/ops/DEPLOY-RUNBOOK.md` | paket tabanlı akış + `-Zorla` + cwd kilidi tuzağı |
| `kur.ps1` | geri alma açığı (bonus, ayrı commit) |
```
