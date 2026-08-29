# SABAH BRİEFİNGİ — 2026-08-29

## 1. Tek cümlede

Denetim bitti (243 bulgu, rapor + paylaşılabilir sayfa hazır) ve **ACİL paketinin
tamamı düzeltildi, ölçüldü ve `denetim-duzeltme` dalına commit edildi**: altı S1
bulgusu kapandı, her biri kırmızı verdiği KANITLANMIŞ bekçilerle korunuyor.
Tam bekçi paketi **364/369** — kırmızı kalan 5'in tamamı denetim öncesinden geliyor.

## 1b. Akşam turu — şema kısıtları + S2 paketi

**Şema kısıtları:** sekiz taslak, fabrika verisinin BİREBİR kopyasında (33 MB)
gerçekten kuruldu. **Beşi uygulandı** (K1 metraj üst sınırı · K5 iş emri↔sipariş
bağı · K6 audit değiştirilemezliği · K7 rapor indeksleri · K8 kart basım tarihi),
**üçü gerekçeli dışarıda**: K2/K3 fabrika verisinde mükerrer olduğu için kurulmuyor
(aşağıda), K4 ise repoda 2026-08-19'da alınmış gerekçeli bir kararı geçersiz
kılacağı ve okunaklı hata üretemeyeceği için uygulanmadı.

⚠️ **K2/K3'ü açan tek şey fabrikanın yapacağı temizlik:**
| Ne | Kayıtlar | Ne gerekiyor |
|---|---|---|
| Aynı ad | `v-1430` → `BGR150` + `MC155` (ikisi de pasif) | mükerrer panelinden birleştirme |
| Aynı kod (harf farkı) | `MC155`(3) · `BGR150`(2) | birleştirme |
| Aynı kod (harf farkı) | **`SANTUK` ↔ `santuk` — İKİSİ DE AKTİF ve FARKLI kumaş** (BORANCIK ↔ ŞANTUK) | birleştirme DEĞİL, **yeniden adlandırma** (iş kararı) |

**S2 paketi — dört bulgu daha kapandı:**
| Bulgu | Neydi |
|---|---|
| T1-006 | İptal edilmiş kaydın token'ı "başarılı" dönüyordu (sahada 227 canlı token) |
| T2-005 | İptal edilmiş iş emrine bağlı sipariş HİÇ iptal edilemiyordu (2 sipariş kilitli) |
| T2-013 | `admin:users` taşıyan hesap kendine `admin:*` yazabiliyordu |
| T1-039 | Depo kesiminde tükenen kaynak 0 m'lik hayalet olarak depoda kalıyordu |

## 2. Bugün kapanan ACİL kalemler (hepsi ölçüldü)

| Bulgu | Neydi | Commit |
|---|---|---|
| T1-005 (S1/K3) | Fason kabulde aynı fiş İKİ KEZ düşülüyordu (yanıltıcı barkod-409'u → operatör elle yeniden giriyor) | `15030ea6` |
| T1-009 (S1/K3) | İş emri iptali, fason sevki kapatılamadığında da devam ediyor → boyahanedeki mal Ham Stok'ta | `705ca353` |
| T1-010 (S2/K3) | Aynı talep İKİ KEZ sevk edilebiliyordu (planlı tahsis kapasiteden düşülmüyordu) | `811a6f2c` |
| T3-003 (S1) | Sevkiyat İPTAL edilmiş siparişe yazılabiliyordu (durum hiçbir katmanda okunmuyordu) | `811a6f2c` |
| T3-002 (S1) | Tabletten çıkan sevkiyat sipariş defterine hiç yazılmıyor + sonradan bağlamanın yolu yok | `78fb552b` |
| D-A-01 + K-3 (S1) | "Düzelt" kesimi eziyordu · depo kesimi `initialQty`yi düşürüyordu | `4035b411` `31f2a945` |

Her düzeltme için **negatif sonda** koşuldu (düzeltme geri alınınca bekçi kırmızı
veriyor mu). Toplam 12 sonda; ikisi bekçinin KÖR olduğunu gösterdi ve bekçi
düzeltildi (biri yorumdaki bir kelimeyi ölçüyordu).

## 3. Doğrulama SONUÇLARI (2026-08-29 sabah, DB açıldıktan sonra koşuldu)

| # | Kontrol | Sonuç |
|---|---|---|
| 1 | `test_manual_props_claim_pin.ts` (yeni bekçi) | ✅ **7/7** — araya kesim girince 409, kesimin metrajı korunuyor |
| 2 | `audit_repro_D-A-01.ts` (hatanın ilk kanıtı) | ✅ **"değişmez korundu"** — K-3 ile kapandı (bkz. 3.1) |
| 3 | `run-all-tests.ts` (tam paket) | **366/371 dosya yeşil** (akşam turu sonrası) (K-3 sonrası tekrar koşuldu). Kırmızı 5'inin tamamı ÖNCEDEN kırmızıydı |
| 4 | `test_timestamptz_contract.ts` | ✅ 13/13 (denetimin kendi sonda script'i sözleşmeyi ihlal ediyordu — `d1df0af2`) |
| 5 | Mobil paket (`npx jest src/offline`) | ✅ 132/132 |

### 3.1 Repro KAPANDI — iki kusurdu, ikisi de düzeltildi

1. **Bayat okuma (`4035b411`):** ekran 100 m okur, arada kesim olur, düzeltme
   kesimi ezerdi. Claim artık okunan metrajı ve statüyü pinliyor → 409.
2. **İş kuralının körlüğü (`31f2a945`, K-3):** depo kesimi `initialQty`yi de
   düşürdüğü için kesilmiş top "bütün" görünüyor ve metraj düzeltmesinden
   geçiyordu. Artık `initialQty` giriş metrajı olarak korunuyor.

`audit_repro_D-A-01` → **"değişmez korundu"** (FAZ1 + N=2/5/10 temiz).
K-3 ayrıca iki bulguyu daha kapattı: üretilen metrajın geriye dönük eksilmesi
(T2-016, saha kopyasında 120 top) ve "Tümden Geri Al"ın olmayan aşım yazması
(T2-002). `prisma/migration-taslaklari/K1` kısıtının ön koşulu da sağlandı.

⚠️ Operatöre yansıması: **kesilmiş topun metrajı artık "Düzelt"ten
değiştirilemiyor.** Yanlış ölçümde kesim geri alınıp yeniden yapılır.

### 3.2 Kırmızı kalan 5 bekçi — hepsi ÖNCEDEN kırmızıydı

| Bekçi | Sebep | Sınıf |
|---|---|---|
| `test_consistency` (§1,§11,§15,§16,§19,§20) | dev DB'de fixture kalıntıları ve bilinen drift | bilinen (rapor §8) |
| `test_consistency_derived` §21 | 2 fixture iş emri | bilinen |
| `test_db_invariants` | dev'de `colors_nameFoldColor_key` yok — "yumuşak kapı", temizlik sonrası enforce | bilinen/bilinçli |
| `test_master_data_name_dup` | yukarıdakinin ikizi (sed olmayınca P2002 doğmuyor) | bilinen/bilinçli |
| `test_check_violation_mapping` | Prisma 7.9 CHECK ihlalini artık `PrismaClientKnownRequestError` sarmalıyor; bekçinin beklentisi bayat (kod tarafı İYİLEŞMİŞ) | yeni gözlem — küçük iş |

## 4. Dalda ne var (`denetim-duzeltme`, 23 commit)

Tümü ayrı commit; her biri ne yaptığını ve NEDEN o yolu seçtiğini yazıyor.

| Commit | Ne | Doğrulama |
|---|---|---|
| `c6161d48` | Denetim artefaktları (rapor, 243 bulgu, haritalar, 41 repro scripti) | — |
| `c0d87ea3` | Rota kimlik bekçisi: tam yol anahtarı + client-policy muafiyeti | ✅ 15/15 + negatif sonda |
| `4035b411` | **"Düzelt" claim'i metrajı/statüyü pinliyor** (S1) | ✅ 7/7 |
| `c75f71d0` | **kur.ps1 sunucunun ecosystem'ini ezmiyor** (S1) | pwsh yok — elle okundu |
| `df1ad374` | **Yedek bayatlığı gece yedeğinden ölçülüyor + hüküm** (S1) | ✅ |
| `e5dff1ad` | CI sahaya çıkan dalda da koşuyor | push gerekiyor |
| `29eba6e6` | **Ekransız çakışma duyuruluyor** (S1, mobil) | ✅ 132/132 + 2 sonda |
| `4f0636da` | 8 şema kısıt taslağı + veri onarım aracı (kuru koşum) | ✅ kuru koşum |
| `31f2a945` | **Depo kesimi `initialQty`ye dokunmuyor** (S1, 3 bulgu birden) | ✅ + sonda |
| `15030ea6` | **Fason kabul idempotency'si** (S1) | ✅ 19/19 + sonda + 26 komşu bekçi |
| `705ca353` | **İptal, fason sevki kapatılamazsa DURUR** (S1) | ✅ 20/20 + 2 sonda + §24c |
| `811a6f2c` | **Aşırı sevk + iptal siparişe tahsis** (S1+S2) | ✅ 16/16 + 4 sonda |
| `78fb552b` | **Tahsissiz sevk uyarısı + onarım ucu** (S1) | ✅ 29/29 + 2 sonda |
| `288a1d6a` | **Şema kısıtları K1·K5·K6·K7·K8** (+ migration) | ✅ fabrika kopyasında kuruldu |
| `aa6f1d93` | **İptal edilmiş token replay'i** (S2) | ✅ 16/16 + sonda |
| `c087b82f` | **Sipariş iptali çıkmazı · kendine tam yetki · hayalet top** (3×S2) | ✅ 16/16 + 3 sonda |

✅ **Başkasının commit'i taşındı:** "araca yüklenen çuval adedi" özelliği
`adnansahin`e alındı (`50c320ef`) ve dal onun üzerine kuruldu — `adnansahin..HEAD`
artık YALNIZ denetim commit'lerini gösteriyor. Migration paylaşımlı dev DB'ye
uygulanmış olduğu için commit SİLİNMEDİ, taşındı (silseydik migration dosyası
ağaçtan kalkar, DB'de kalır ve iki bekçi boşuna kırmızıya dönerdi).

Dal **push edilmedi** ve hiçbir şey `adnansahin`e merge edilmedi.

## 5. Senden beklenen iki karar

1. **Şema kısıtları** (`Teks-Erp/prisma/migration-taslaklari/`, K1-K8): hangileri
   sahaya, hangi vardiya penceresinde? Her dosya kilit süresini ve geri alma
   yolunu yazıyor. K1 (metraj üst sınırı) ön koşullu — açıklaması dosyada.
2. **Veri onarımı** (rapor §11, 16 kalem): 6'sı iş kararı ister — özellikle
   sipariş defterine yazılmamış **7.200,6 m**'nin hangi siparişlere yazılacağı
   (satış + muhasebe onayı) ve yönetici hesaplarındaki PIN'in kaldırılması.

## 6. Bugün fabrikanın koşabileceği kontrol

Rapor §7.6'da 12 salt-okunur SQL var (her biri eşiğiyle). Bugün **bir tane daha**
eklendi — mutabakat kapısı §24c ("açık fason kalemi ama top fasonda değil");
`consistency-check-derived.sql` ile birlikte koşar ve `npm test`'te de ölçülür.
En acili hâlâ bu:

```sql
-- Sipariş defterine hiç yazılmamış sevkiyat — kopyada 5 çıkıyordu, canlıda?
SELECT s."shipmentNumber", s."dispatchedAt"
FROM shipments s
WHERE s.status = 'DISPATCHED'
  AND NOT EXISTS (SELECT 1 FROM sack_allocations a WHERE a."shipmentId" = s.id);
```

Çıkan her satır artık **onarılabilir**: `POST /api/shipping/shipments/:id/orders`
(izin `shipping:write`) sevkiyatı doğru siparişe bağlar, defteri günceller ve
irsaliyeyi v+1 olarak yeniden dondurur. Hangi sevkiyatın hangi siparişe
yazılacağı hâlâ **satış + muhasebe kararıdır** (bkz. §5).

## 7. Denetimin çıktıları nerede

- **Rapor:** `audit/RAPOR-2026-08-29.md` (14 bölüm, 611 KB)
- **Paylaşılabilir sayfa:** https://claude.ai/code/artifact/c2d36aea-0d6d-4d15-a106-2ffc94cbd584
- **Makine okunur bulgular:** `audit/findings.json` (243)
- **Ölçüm sorguları / repro logları:** `audit/data/`, `audit/repro/`
- **Haritalar:** `audit/00-map/` (22 dosya)
- **Düzeltme kuralları:** `audit/DUZELTME-PLANI.md`
