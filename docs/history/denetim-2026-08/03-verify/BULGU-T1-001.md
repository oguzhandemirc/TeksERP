# BULGU-T1-001 — DOĞRULAMA (③ sonrası, TUR 1)

**Başlık:** "Düzelt" ekranının mutlak metraj yazımı, eşzamanlı Tambur kesimini sessizce eziyor — 100 m'lik top sistemde 140,5 m oluyor
**Modül:** Envanter / Tambur · **Kategori:** A.2 · **Dosya:** `Teks-Erp/src/services/inventory.service.ts:3685, 3783, 3865-3868, 3931-3934`

| | Giriş (③'ten) | Doğrulama sonrası |
|---|---|---|
| Kanıt seviyesi | K3 (iddia) | **K3 — bağımsız yeniden koşumla TEYİT** (K2 arandı, **0**) |
| Şiddet | S1 | **S1 — DEĞİŞMEDİ** (gerekçe §5) |
| Karar | — | **DOĞRULANDI** |

---

## 1. Kod kanıtı — yeniden okundu (④ iddialarının hepsi tutuyor)

Dört satırın da ③'te yazıldığı gibi olduğu bu turda koddan teyit edildi:

| Satır | Gözlem | Teyit |
|---|---|---|
| `inventory.service.ts:3685` | `const roll = await prisma.roll.findUnique({ where: { id: rollId }, … })` — karar verilecek satır **tx DIŞINDA** okunuyor | ✔ |
| `:3783` | `const rollWhole = roll.initialQty.equals(roll.currentQty);` → `if (!rollWhole) throw AppError.conflict("Bu top kısmen tüketilmiş …")` — guard **bayat okumadan** hesaplanıyor | ✔ |
| `:3865-3868` | `const m = new Prisma.Decimal(data.currentQty); rollData.currentQty = m; rollData.initialQty = m;` — **MUTLAK** yazım, `decrement` değil | ✔ |
| `:3929-3934` | `tx.roll.updateMany({ where: { id: rollId, shipmentId: null, sackId: cur.sackId }, data: rollData })` — claim yalnız **üyelik** pinliyor; `currentQty` / `initialQty` / `status` WHERE'de **YOK** | ✔ |

**Guard'ı öldüren ikinci taş** (`tambur.service.ts:2243-2247`) da teyit edildi — depo kesimi ikisini **birlikte** düşürüyor:

```ts
where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null, currentQty: { gte: data.cutLength } },
data: { currentQty: { decrement: data.cutLength }, initialQty: { decrement: data.cutLength } },
```

→ Kesimden **sonra da** `initialQty == currentQty`, yani `rollWhole` TRUE. Bu, ④'ün en önemli tespitini
doğruluyor: **guard'ı tx içine taşımak tek başına bu yarışı kapatmaz** — kör kalır.

### 1b. Doğru kalıp AYNI DOSYA AİLESİNDE zaten var (fix shape kanıtı)

`tambur.service.ts:976-988` — Tambur finalize'da tam da bu tehlike için yazılmış, **adıyla anan** bir guard var:

```ts
// BAYAT METRAJ GUARD'I: cuts validasyonu ve segment hesabı tx DIŞINDA
// okunan currentQty ile yapıldı. Okuma ile claim arasına bir kesim
// (cutOpenFabric/cutWarehouseRoll) commit ettiyse bayat toplamla fazla
// metraj üretirdik. Claim satır kilidini aldı; taze değer artık sabit —
const freshQtyRow = await tx.roll.findUnique({ where: { id: data.rollId }, select: { currentQty: true } });
if (!freshQtyRow || !new Prisma.Decimal(freshQtyRow.currentQty).equals(totalQtyD)) throw AppError.conflict(…);
```

Yani ekip bu yarışı **biliyor ve bir yolda kapatmış**; `applyManualProperties` o kalıbı almamış.
Bulgu "bilinmeyen bir risk" değil, **bilinen bir korumanın eksik uygulanması**.

### 1c. Koruma kontrolü (altı kaynak — beceri §7.8 / §9.1 disiplini)
| Koruma | Durum |
|---|---|
| Claim WHERE'inde metraj/statü pini | **YOK** (`:3931`) |
| `pg_advisory_xact_lock` | **YOK** — `inventory.service.ts`te tek advisory kullanımı `:844` (KK1 mükerrer guard'ı), bu yolda değil |
| `FOR UPDATE` / satır kilidi | **YOK** (`touchWorkOrderTx` grep 0) |
| DB CHECK (`currentQty ≤ initialQty`) | **YOK** — K10 INV-STK-02 "DB seddi YOK" diyor; mevcut CHECK'ler yalnız `≥ 0` |
| Trigger | **YOK** |
| Feature-flag arkasında mı | **HAYIR** — yol her zaman açık |

---

## 2. K2 — veride fiili ihlal araması: **ARANDI, 0 BULUNDU** (dürüst negatif)

Sorgu: `audit/data/BULGU-T1-001.sql` · Sonuç: `audit/data/BULGU-T1-001.txt`
Koşum: `sql-saha.sh` (prod kopyası `tekserp_saha_0825`, 2026-08-25) **ve** `sql-dev.sh`.

| Sorgu | Saha (prod kopyası) | Dev |
|---|---|---|
| **Q1** `ROLL_MANUAL_OVERRIDE` toplam log | **4** (2026-07-16 → 08-03) | 1.947 (test kalıntısı) |
| Q1 · bunların **metraj yazanı** | **0** | 166 |
| Q1 · `event=MANUAL_ATTRIBUTE` (süpervizör) | **0** | 0 |
| **Q2** metrajı fiilen değiştiren satır | **0 satır** | 20+ (hepsi `RELABEL`, 100→250 fixture deseni) |
| **Q3/Q3b** kesilmiş (çocuklu) topa **kesimden SONRA** metraj yazımı | **0** | **0** |
| **Q4** maruz nüfus: FREE_STOCK + kesilmiş parent | WAREHOUSE **3** | WAREHOUSE 1 |
| **Q6** kesilmiş parent'ta `cur == init` | 9 / 125 (%7,2) | 3 / 12 (%25) |

**Yorum:** mekanizma **canlıda henüz tetiklenmemiş**. Sebebi kapasitede değil kullanımda:
sahada metraj düzeltme yolu **hiç kullanılmamış** (4 override'ın 0'ı metraj yazmış) ve
kesilmiş-ve-serbest-stokta duran top sayısı **3**. Yani bu bir "veri şu an bozuk" bulgusu değil,
**yol açık ve bekçisiz** bulgusudur.

### 2b. Mevcut mutabakat kapısı bu bozulmayı GÖRMEZ (kör nokta ölçüldü)
**Q5:** `consistency-check.sql` §13 (`currentQty > initialQty`) → saha **2**, dev **0**.
**Q5b** o 2 satırın kimliğini çözdü:

| id | status | initialQty | currentQty | çocuk |
|---|---|---|---|---|
| `95c15daf-…360e3` | IN_PRODUCTION | 492,000 | 698,900 | 9 |
| `92d0ef12-…3ab944` | IN_PRODUCTION | 500,000 | 520,500 | 15 |

İkisi de **barkodsuz IN_PRODUCTION** — yani CLAUDE.md 2026-08-22'de "bilerek düzeltilmedi" denen
`tambur-undo` kaynaklı eski satırlar; **bu bulgunun ürünü DEĞİL** (çakışma/çift sayım yok).

Asıl önemlisi: bu bulgunun ürettiği bozulma §13'e **hiç düşmez**. Kesim ikisini birlikte düşürdüğü,
düzeltme de ikisini birlikte yazdığı için `currentQty == initialQty` **her zaman korunur**.
Repro'da üretilen `parent 100,5/100,5 + çocuk 40` satırı §13'te temiz görünür.
→ **Sessiz + alarmsız + mevcut mutabakat kapısına görünmez.**

---

## 3. K3 — repro BAĞIMSIZ OLARAK YENİDEN KOŞTURULDU ✔

③'ün işaret ettiği iki script bu turda **yeniden** koşuldu (yeni fixture damgaları — önceki koşumun
kalıntısı değil). Birleşik log: `audit/repro/BULGU-T1-001.log`.

### 3a. `Teks-Erp/scripts/audit_repro_D-A-01.ts` (damga `AUDITREPRO-D-A-01-rex0ev`)
```
kesim sonrası:     parent 60/60,     çocuk 40 m, TOPLAM 100
düzeltme sonrası:  parent 100.5/100.5, çocuk 40 m, TOPLAM 140.5
❌ FAZ1: bayat düzeltme KABUL EDİLDİ → 100 m'lik fiziksel top için sistemde 140.5 m
✅ FAZ1b: kesim initialQty'yi de düşürdüğü için rollWhole guard'ı kesimden SONRA da TRUE
❌ FAZ2 (N=2):  2/2 turda TOPLAM > 100 m  (iki yazım da başarılı: 2/2)
❌ FAZ2 (N=5):  5/5 turda TOPLAM > 100 m  (5/5)
❌ FAZ2 (N=10): 10/10 turda TOPLAM > 100 m (10/10)
=== SONUÇ: 4 kırmızı ===
```
Önceki koşumla (damga `91qxcg`) **birebir aynı**: N=2/5/10 → **2/2, 5/5, 10/10 bozulma**.

### 3b. `Teks-Erp/scripts/audit_repro_KYY-2-32.ts` (damga `AUDITREPRO-KYY-2-32-mmyvub`)
```
[SIRALI] KESİM:OK | DÜZELT:OK → parent 720/720 · çocuk=[100] · TOPLAM=820 ⚠️ init'i AŞIYOR
[P#1..P#10] hepsi → parent 620/620 · çocuk=[100] · TOPLAM=720 ⚠️ init'i AŞIYOR
10 paralel turun 10 tanesinde parent+çocuk toplamı initialQty'yi AŞTI.  bozulan = 10/10
Mutabakat: metraj yoktan var olan top sayısı = 11
=== Sonuç: 0 geçti, 3 başarısız ===   [temizlik] 22 top silindi.
```

**Tekrar/bozulma:** 10 tekrar → **10 bozulma (%100)**. Zamanlamaya bağlı değil — bayat payload
sunucuya ulaştığı **her** durumda kabul ediliyor.

**Yan etki sınırı:** iki script de dev DB guard'lı, damgalı fixture kullanıyor, `finally`'de temizliyor
(22 top silindi); global ayar/feature-flag değiştirilmedi, yazıcı/pg_dump/rclone çağrılmadı.

---

## 4. İstemci ayağı — olasılığı DARALTAN düzeltme (④'e ek, dürüstlük notu)

`Electron/src/pages/Operations/RelabelStation/RelabelSpecForm.tsx:94-95`:
```ts
currentQty: metraj.trim() !== "" && Number(metraj) !== ctx.currentQty ? Number(metraj) : undefined,
```
→ İstemci `currentQty`'yi **yalnız kullanıcı diyalogda yüklenen değerden FARKLI bir sayı yazarsa**
gönderiyor. Yani "sadece rengi düzelttim" senaryosunda metraj payload'a **girmez** ve bozulma olmaz.

**Bu, bulguyu çürütmez, olasılığını daraltır.** Gerçek tetikleyici şudur ve tamamen makul:
süpervizör diyaloğu topun metrajı 100 iken açar, fiziksel ölçümü 100,5 yazar; bu iki eylem
arasında Tambur/depo kesimi commit eder. Payload 100,5 olarak gider ve kabul edilir.
③'ün `failure_mode`'u **birebir bu**; senaryo değişmedi.

Aynı sebeple **`KYY-2-32`'nin SIRALI kolu bir "yarışsız hata" DEĞİLDİR**: script kesimden sonra
bilerek bayat değeri gönderiyor. Gerçek hayatta diyalog kesimden sonra açılırsa `ctx.currentQty=60`
gelir, kullanıcı 60,5 yazar ve sonuç **doğrudur**. Bu ayrımı raporda açıkça yazıyorum ki
2. tur bulguyu "her düzeltme bozar" diye abartmasın. Sınıf: **stale-write / lost update**, düz mantık hatası değil.

---

## 5. Şiddet — S1'de KALIYOR (enflasyon yok, deflasyon da yok)

| Eksen | Değerlendirme |
|---|---|
| Etki | **Yüksek** — tutarsız envanter: fiziksel 100 m için sistemde 140,5 m. Ham/bitmiş stok, ürün dengesi, sipariş karşılama ve stok karnesi aynı sayıdan beslenir |
| Olasılık | **Düşük (bugün)** — sahada yol hiç kullanılmamış (metraj yazan override 0), maruz nüfus 3 top. Yükselir: yol yeni yayınlandı, kesim + düzeltme farklı kişilerde (depo ↔ Tambur), FREE_STOCK'ta ek yetki/sebep aranmıyor |
| Düzeltici | **Sessiz ve alarmsız** → matris gereği **bir kademe YÜKSELT**: hata/uyarı yok, `RollVariance` satırı yok, `consistency-check` §13 görmez (§2b'de ölçüldü) |
| Sonuç | **S1** — S0 değil çünkü **K2 boş** (canlıda fiili ihlal yok, brief: "S0 için K2/K3 şart"; K3 var ama veride ihlal yok ve nüfus 3 top). S2'ye de inmez çünkü sessizlik + mutabakat körlüğü bir kademe yükseltiyor |

---

## 6. Sonuç

**DOĞRULANDI · K3 · S1.** Dört kod iddiası da koddan teyit edildi; iki repro scripti bağımsız
fixture'larla yeniden koşuldu ve **10/10 turda** değişmezi bozdu. Veride fiili ihlal **arandı ve
bulunamadı** (saha 0, dev 0) — mekanizma canlıda henüz tetiklenmemiş, çünkü metraj düzeltme yolu
sahada hiç kullanılmamış. Bulgunun ağırlığı "veri şu an bozuk"tan değil, **korumanın yokluğu +
bozulmanın mevcut mutabakat kapısına görünmez olması**ndan geliyor.

**2. tur için düzeltmenin ŞEKLİ** (uygulanmadı — bu tur salt-okunur):
`applyManualProperties` claim'ine metrajı **pinle** (`where: { …, currentQty: roll.currentQty, initialQty: roll.initialQty }`)
ya da `tambur.service.ts:981` kalıbını birebir taşı (claim sonrası taze okuma + uyuşmazlıkta 409
"metraj bu sırada değişti, yenileyin"). `rollWhole` guard'ını tx içine taşımak **tek başına YETMEZ**
(§1: kesim `initialQty`'yi de düşürüyor). Migration/`CHECK` gerekmiyor; salt kod.
**Kabul kriteri:** `audit_repro_D-A-01.ts` FAZ1 ve FAZ2 (N=10) yeşile döner, `audit_repro_KYY-2-32.ts` drift=0.

## KAPSANMAYAN / ERİŞİLEMEYEN
- **Canlı prod'a erişim yok** — K2 prod'un 2026-08-25 kopyasında koştu; 25 Ağustos'tan bugüne (28 Ağustos) sahada metraj düzeltmesi yapılmış olabilir, ölçülemedi.
- Saha kopyasında son 5 migration yok; bu bulgunun dokunduğu kolonların (`rolls.currentQty/initialQty/parentRollId`, `system_logs`) hepsi mevcut, sorgular etkilenmedi.
- `workorder-link.service.ts:786` aynı motoru **toplu** çağırıyor (`apply-attribute-to-rolls`); o yolun metraj gönderip göndermediği bu turda incelenmedi — sınır ötesi not.

## SINIR ÖTESİ NOTLAR
- **URE alanına:** `workorder-link.service.ts:715-786` `applyManualProperties`'i toplu çağırıyor. Aynı bayat-okuma/mutlak-yazım motoru N top için tek hamlede koşuyor; toplu yolda kısmi başarı sessiz mi, metraj alanı payload'a giriyor mu — ayrıca bakılmalı.
- **K10/mutabakat sahibine:** `consistency-check.sql` §13 (`currentQty > initialQty`) bu bozulma sınıfını **yapısal olarak göremez**. Eksik olan değişmez: *kesilmiş parent için* `parent.currentQty + Σ child.initialQty ≤ parent'ın kesim öncesi initialQty`'si. Bugün hiçbir yerde ölçülmüyor; `audit_repro_KYY-2-32.ts`'in "C1 mutabakat" sorgusu bunun hazır taslağı.
