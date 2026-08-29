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

## 3. Doğrulama bekleyen komutlar (sırayla)

| # | Komut | Beklenen |
|---|---|---|
| 1 | `npx tsx scripts/test_manual_props_claim_pin.ts` | 4/4 yeşil (yeni bekçi) |
| 2 | `npx tsx scripts/audit_repro_D-A-01.ts` | Artık **409** vermeli; önce 10/10 bozuluyordu |
| 3 | `npx tsx scripts/run-all-tests.ts` | Kırmızı kalan varsa listesi — düzeltmelerin komşu etkisi burada görünür |
| 4 | `npx tsx scripts/fix_denetim_onarim.ts` | Kuru koşum: 8 onarım kaleminin güncel sayıları |
| 5 | `curl -s localhost:4000/api/admin/health -H "Authorization: Bearer <token>" \| jq .backupHealth` | `verdict` + `ageHours` gerçek gece yedeğinden |

⚠️ 3. adımda kırmızı çıkarsa: her düzeltme ayrı commit'te, tek tek geri alınabilir
(`git revert <sha>`). Hiçbiri sahaya gitmedi.

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
