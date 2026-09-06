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

✅ **K2/K3 AÇILDI (2026-08-30).** Kullanıcı kararı: birleştirme değil SİLME.
Dev'de zincir uçtan uca koşuldu — 7 kullanılmamış kumaş silindi, bir renk ikizi
birleştirildi, iki kısıt migration olarak uygulandı, renk seddi de enforce edildi.
Fabrika verisine karşı simülasyon: **6 kayıt silinince kalan çakışma 0/0.**

⚠️ Prod sırası pazarlık dışı: ① `scripts/fix_kumas_kod_cakismasi.ts` (kuru koşum
→ listeyi oku → `--kod=santuk --apply`) ② `migrate deploy` (vardiya dışında).

⚠️ Ölçüm bir varsayımı düzeltti: **renk seddinin prod'da kurulmasına engel YOK**
(çakışma sıfır). "Dev'de eksik" kırmızısı dev'e özgüymüş.

**İkinci paket — on beş bulgu kapandı (3 S1 + 12 S2):**
| Bulgu | Neydi |
|---|---|
| T1-006 | İptal edilmiş kaydın token'ı "başarılı" dönüyordu (sahada 227 canlı token) |
| T2-005 | İptal edilmiş iş emrine bağlı sipariş HİÇ iptal edilemiyordu (2 sipariş kilitli) |
| T2-013 | `admin:users` taşıyan hesap kendine `admin:*` yazabiliyordu |
| T1-039 | Depo kesiminde tükenen kaynak 0 m'lik hayalet olarak depoda kalıyordu |
| T1-002 | İki eşzamanlı aşım kesimi 100 m'lik toptan 240 m çocuk üretiyordu (defter 40 m yazıyordu) |
| T1-045 | İçe aktarımın 10 MB'lık limiti hiç koşmuyordu — 2 MB'lık CSV 413 alıyor, mesaj yanlış sınırı söylüyordu |
| **T1-011** (S1) | Geri almayla iptal edilen kesim parçası diriltilebiliyordu — aynı metraj iki yerde. ⚠️ Denetimin sayısı EKSİKMİŞ: 50 değil **80 top / 3.317,2 m** |
| **T1-008** (S1) | İçe aktarımda zaman aşımından sonra "Tekrar Dene" dosyayı ikinci kez yazıyordu (900 satır → 1.800 sipariş) |
| **T1-003 + T1-004** | İş emri iptal edilirken canlı top bağlanıyordu — kilitsiz yarış. Repro: kilitsiz 7/16 ihlal, kilitli 0 |
| T2-011 | Birleştirme audit'i fiziksel tablo adına yazılıyordu → Denetim Raporu'nda hiç görünmüyordu (13/13) |
| T2-003 | Sevk defterine hiç audit yazılmıyordu — "bu mal neden siparişten düşmedi" cevapsızdı |
| T3-004 | T1-003 ile AYNI kök neden; aynı kilitle kapandı (repro 10/10 temiz, ölçüm kardeş repro'da) |
| — | `test_wip_scorecard` §4 ortam verisine bağımlıydı (ürün kusuru değil); kalıcı olarak ayrıldı |
| — | İki birleştirme bekçisi kusurla AYNI kör noktayı paylaşıyordu; ikisi de düzeltildi |

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
| 3 | `run-all-tests.ts` (tam paket) | **372/375 dosya yeşil** (2026-08-30) (K-3 sonrası tekrar koşuldu). Kırmızı 5'inin tamamı ÖNCEDEN kırmızıydı |
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

## 4. Dalda ne var (`denetim-duzeltme`, 36 commit)

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
| `c2af089d` | **Eşzamanlı aşım kesimi yoktan kumaş üretiyordu** (S2) | ✅ 15/15 + 3 sonda |
| `3877d956` | **İçe aktarım gövde limiti + WIP bekçisi onarımı** (S2) | ✅ 9/9 + 3 sonda |
| `94b937c0` | **Geri almayla iptal edilen parça diriltilemiyor** (S1) | ✅ 63/63 + 2 sonda |
| `56ccf218` | **İçe aktarım idempotency'si** (S1, + migration) | ✅ 16/16 + 3 sonda |
| `d12f4abb` | **Fason kalanı: sert engel → AÇIK KARAR** (yön düzeltmesi) | ✅ 25/25 + 3 sonda |
| `c4c9fde5` | İptal diyaloğu kalanı önden soruyor (Electron) | ✅ tip yeşil |
| `69376d70` | **İş emri terminale düşerken yarış** (T1-003+T1-004) | ✅ repro: 7 ihlal → 0 |

✅ **Başkasının commit'i taşındı:** "araca yüklenen çuval adedi" özelliği
`adnansahin`e alındı (`50c320ef`) ve dal onun üzerine kuruldu — `adnansahin..HEAD`
artık YALNIZ denetim commit'lerini gösteriyor. Migration paylaşımlı dev DB'ye
uygulanmış olduğu için commit SİLİNMEDİ, taşındı (silseydik migration dosyası
ağaçtan kalkar, DB'de kalır ve iki bekçi boşuna kırmızıya dönerdi).

Dal **push edilmedi** ve hiçbir şey `adnansahin`e merge edilmedi.

## 4b. Prod'da koşulacak onarım araçları (ikisi de KURU KOŞUM varsayılan)

| Araç | Ne yapar | Ölçüm |
|---|---|---|
| `fix_tambur_undo_cancel_marker.ts` | Geri almayla iptal edilmiş eski parçalara iz damgalar (diriltilmelerini engeller) | saha kopyasında **80 kayıt / 3.317,2 m** |
| `fix_denetim_onarim.ts` | Denetimin veri onarım kalemleri | rapor §11 |

⚠️ İkisi de `--apply` istiyor ve etkilenen HER kaydı somut listeliyor.

## 4c. ⚠️ Bir yön düzeltmesi — okuman gereken tek şey buysa bu

Sabah T1-009'u çözerken kısmi kabullü iş emrinin iptalini **sert engelle**
durdurmuştum. Bu, 2026-08-17'de SAHA ŞİKÂYETİ üzerine kaldırılan engeli geri
getiriyordu ("bir iş emrini iptal etmek çok zor"). Akşam **geri aldım** ve
reponun kendi desenine çevirdim: engelleme yok, **açık karar** var — modal
"49 m fasonda kaldı, ne olacak?" diye soruyor, "gelmeyecek, fire yaz" tek tıkla
akışı sürdürüyor. Adım sayısı artmıyor, metraj da buharlaşmıyor (sebebiyle
deftere yazılıyor).

Bundan sonra saha kararıyla çakışan bir daraltma çıkarsa **durup soracağım**;
sen yokken çıkarsa esnekliği koruyan tasarımı seçip işaretleyeceğim.

## 4d. Kabul edilen riskler (kullanıcı kararı, 2026-08-30)

| Konu | Karar |
|---|---|
| Tablet PIN'i tek başına kimlik (T1-014) | **Böyle kalsın** — fabrika ağı kapalı |
| Sipariş defterine yazılmamış 7.200,6 m (T2-001) | **Siparişsiz sevkti** — dokunulmuyor |
| Yedekler yalnız fabrika sunucusunda (T1-022) | **Şimdilik risk kabul** — ileride dış sunucu |
| `.env` git geçmişinde (T1-053) | **Depo özel, sorun değil** |
| Yedekten geri yükleme tatbikatı (T1-023) | **Yapılacak** — reçete hazırlanacak |

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
