# SABAH BRİEFİNGİ — 2026-08-29

## 1. Tek cümlede

Denetim bitti (243 bulgu, rapor + paylaşılabilir sayfa hazır) ve düzeltme turunun
ilk altı commit'i `denetim-duzeltme` dalında duruyor; **veritabanı gece 05:00'ten
beri erişilemez olduğu için DB'ye dokunan hiçbir doğrulama koşturulamadı.**

## 2. İlk yapılacak iş (5 dakika)

Postgres.app `trust` bağlantıları için oturum açmış kullanıcıya onay diyaloğu
göstermek zorunda; ekran kilitliyken gösteremiyor ve **psql dahil her bağlantı**
reddediliyor:

```
FATAL: Postgres.app failed to verify "trust" authentication
DETAIL: Postgres.app failed to show a dialog...
```

Çözüm (Postgres.app'in kendi önerisi): sunucuyu yeniden başlat (menü çubuğu →
Stop/Start) ya da kalıcı çözüm için `pg_hba.conf`'u parola isteyecek biçimde
değiştir. Sonra:

```bash
cd Teks-Erp && npx tsx scripts/run-all-tests.ts        # tam bekçi paketi (366)
```

## 3. Doğrulama SONUÇLARI (2026-08-29 sabah, DB açıldıktan sonra koşuldu)

| # | Kontrol | Sonuç |
|---|---|---|
| 1 | `test_manual_props_claim_pin.ts` (yeni bekçi) | ✅ **7/7** — araya kesim girince 409, kesimin metrajı korunuyor |
| 2 | `audit_repro_D-A-01.ts` (hatanın ilk kanıtı) | ❌ **hâlâ kırmızı** — sebebi aşağıda; benim düzeltmemin kapsamı dışında |
| 3 | `run-all-tests.ts` (tam paket) | **361/367 dosya yeşil**, 326 sn. Kırmızı 6'nın 5'i bilinen kalem, 1'i düzeltildi (aşağı) |
| 4 | `test_timestamptz_contract.ts` | ✅ 13/13 (denetimin kendi sonda script'i sözleşmeyi ihlal ediyordu — `d1df0af2`) |
| 5 | Mobil paket (`npx jest src/offline`) | ✅ 132/132 |

### 3.1 Repro neden hâlâ kırmızı — ve bu ne demek

İki AYRI kusur varmış, ben birincisini kapattım:

1. **Bayat okuma (kapandı, `4035b411`):** ekran 100 m okur, arada kesim olur,
   düzeltme kesimi ezer. Artık 409.
2. **İş kuralının kör olması (AÇIK):** depo kesimi `currentQty` **ve**
   `initialQty`'yi birlikte düşürüyor (`tambur.service.ts:2245-2246`). Bu yüzden
   kesimden sonra da "top bütün" görünüyor ve "yalnız bütün toplarda metraj
   düzeltilir" kuralı kesilmiş topu da geçiriyor — okuma TAZE olsa bile operatör
   eski değeri yazarsa 100 m'lik fiziksel toptan sistemde 140,5 m oluyor.

İkincisinin düzeltmesi raporun **K-3** kalemi: kesim yalnız `currentQty` düşürsün.
⚠️ Bu, rapor rakamlarını etkiler — bugün kesilmiş topun ana+çocuk `initialQty`
toplamı 100 çıkıyor, değişiklikten sonra 140 çıkar. `initialQty` okuyan her rapor
yolunun tek tek çıkarılması gerekir. **Karar bekliyor.**

### 3.2 Kırmızı kalan 5 bekçi — hepsi ÖNCEDEN kırmızıydı

| Bekçi | Sebep | Sınıf |
|---|---|---|
| `test_consistency` (§1,§11,§15,§16,§19,§20) | dev DB'de fixture kalıntıları ve bilinen drift | bilinen (rapor §8) |
| `test_consistency_derived` §21 | 2 fixture iş emri | bilinen |
| `test_db_invariants` | dev'de `colors_nameFoldColor_key` yok — "yumuşak kapı", temizlik sonrası enforce | bilinen/bilinçli |
| `test_master_data_name_dup` | yukarıdakinin ikizi (sed olmayınca P2002 doğmuyor) | bilinen/bilinçli |
| `test_check_violation_mapping` | Prisma 7.9 CHECK ihlalini artık `PrismaClientKnownRequestError` sarmalıyor; bekçinin beklentisi bayat (kod tarafı İYİLEŞMİŞ) | yeni gözlem — küçük iş |

## 4. Dalda ne var (`denetim-duzeltme`, 7 commit)

| Commit | Ne | Doğrulama |
|---|---|---|
| `c6161d48` | Denetim artefaktları (rapor, 243 bulgu, haritalar, 41 repro scripti) | — |
| `c0d87ea3` | Rota kimlik bekçisi: tam yol anahtarı + client-policy muafiyeti | ✅ 15/15 + negatif sonda |
| `4035b411` | **"Düzelt" claim'i metrajı/statüyü pinliyor** (S1) | ⏳ DB bekliyor (tip ✅) |
| `c75f71d0` | **kur.ps1 sunucunun ecosystem'ini ezmiyor** (S1) | ⏳ pwsh yok (elle okundu) |
| `df1ad374` | **Yedek bayatlığı gece yedeğinden ölçülüyor + hüküm** (S1) | ⏳ DB bekliyor (tip ✅, statik bekçi ✅) |
| `e5dff1ad` | CI sahaya çıkan dalda da koşuyor | ⏳ push gerekiyor |
| `29eba6e6` | **Ekransız çakışma duyuruluyor** (S1, mobil) | ✅ 132/132 + iki negatif sonda |
| `4f0636da` | 8 şema kısıt taslağı + veri onarım aracı (kuru koşum) | ⏳ DB bekliyor |

Dal **push edilmedi** ve hiçbir şey `adnansahin`e merge edilmedi.

## 5. Senden beklenen iki karar

1. **Şema kısıtları** (`Teks-Erp/prisma/migration-taslaklari/`, K1-K8): hangileri
   sahaya, hangi vardiya penceresinde? Her dosya kilit süresini ve geri alma
   yolunu yazıyor. K1 (metraj üst sınırı) ön koşullu — açıklaması dosyada.
2. **Veri onarımı** (rapor §11, 16 kalem): 6'sı iş kararı ister — özellikle
   sipariş defterine yazılmamış **7.200,6 m**'nin hangi siparişlere yazılacağı
   (satış + muhasebe onayı) ve yönetici hesaplarındaki PIN'in kaldırılması.

## 6. Bugün fabrikanın koşabileceği kontrol

Rapor §7.6'da 12 salt-okunur SQL var (her biri eşiğiyle). En acili:

```sql
-- Sipariş defterine hiç yazılmamış sevkiyat — kopyada 5 çıkıyordu, canlıda?
SELECT s."shipmentNumber", s."dispatchedAt"
FROM shipments s
WHERE s.status = 'DISPATCHED'
  AND NOT EXISTS (SELECT 1 FROM sack_allocations a WHERE a."shipmentId" = s.id);
```

## 7. Denetimin çıktıları nerede

- **Rapor:** `audit/RAPOR-2026-08-29.md` (14 bölüm, 611 KB)
- **Paylaşılabilir sayfa:** https://claude.ai/code/artifact/c2d36aea-0d6d-4d15-a106-2ffc94cbd584
- **Makine okunur bulgular:** `audit/findings.json` (243)
- **Ölçüm sorguları / repro logları:** `audit/data/`, `audit/repro/`
- **Haritalar:** `audit/00-map/` (22 dosya)
- **Düzeltme kuralları:** `audit/DUZELTME-PLANI.md`
