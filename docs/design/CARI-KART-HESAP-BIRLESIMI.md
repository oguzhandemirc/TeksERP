# CARİ KART ↔ CARİ HESAP BİRLEŞİMİ — hızlı tasarım

> **Durum:** TASARIM (uygulama dilimleri Z-A backend / Z-B panel). Yazım 2026-09-18, ölçümler aynı gün
> çalışma ağacında (`origin/main 23cbce69`) yapıldı. Kardeş belgeler: [IS-ORTAGI-ROL-MODELI.md](IS-ORTAGI-ROL-MODELI.md)
> (kart = kimlik, roller, fason profili) ve [../standart/MASTER-VERI-TASARIMI.md](../standart/MASTER-VERI-TASARIMI.md)
> (MV-01…MV-05 kapıları). Bu belge o fazın **devamıdır**, alternatifi değil.

## 1. Sorun — bugün ne kaybediliyor

Rol modeli fazı "bir firma = bir kart" sorununu çözdü. Geriye kartın **finans yüzünün** ayrı bir
yaşam döngüsü taşıması kaldı:

1. **Hesap kartla doğmuyor, İLK FATURAYLA doğuyor.** `ensureCariAccountTx`
   (`Teks-Erp/src/services/helpers/finance.helper.ts:255`) hesabı yalnız `kind` + taraf ile yaratır;
   vade ve para birimi **varsayılanlarıyla** doğar (`defaultCurrency = TRY`, `paymentTermDays = null`).
   ⇒ Kartı açan kişi vadeyi giremez; vade ancak biri "Cari Hesaplar"a gidip hesabı bulup düzenlerse
   dolar. Kartı açan ile hesabı düzenleyen aynı kişi değil ve aradaki ilk fatura **vadesiz** kesilir
   (`deriveInvoiceDueDate` `null` döner — vade UYDURULMAZ, doğru davranış, ama sebep bir veri eksiği).
2. **`kind`in adı ile taşıdığı şey ayrışmış.** `CariKind = {CUSTOMER, SUBCONTRACTOR}` (schema 8231);
   bu alan ticari YÖNÜ (müşteri mi tedarikçi mi) değil, "hesap karta mı yoksa eski fason profiline mi
   bağlı" sorusunu cevaplar. Yalnız tedarikçi rolü olan bir kartın hesabı da `kind = CUSTOMER`tur.
   Ad "müşteri" dediği için her okuyucu onu ticari yön sanma riskini taşır.
   ⚠️ **Düzeltilmiş öncül:** formlardaki *"Cari türü: Müşteri / Fason firma"* SEÇİMİ **zaten kalktı**
   (rol modeli dilim F; bekçi `Electron/src/pages/Finance/InvoiceFormDialog.test.tsx` — ekranda
   "Cari türü" metninin YOKLUĞUNU ölçüyor). Kalan artık iki yerde: `GET /api/finance/cari`in `kind`
   süzgeci ve panelin fatura formunda o süzgeci kullanması (`InvoiceFormDialog.tsx:183`).
3. **Aynı sorunun üç cevabı var:** `Customer.type` (türetilmiş) · üç rol bayrağı (gerçek) ·
   `CariAccount.kind` (taraf bağının aynası). Üçü de "bu firma nedir" sorusuna cevap veriyor gibi
   görünür; yalnız ikincisi doğrudur.
4. **Hesap KODLA aranıyor.** Fatura formu tarafın vade bilgisini `listCari({ search: code })` ile
   çekip `r.kind === party && r.code === code` diye eşleştiriyor (`InvoiceFormDialog.tsx:181-188`) —
   yani ilişki bir ID bağıyla değil, **ad/kod araması** ile kuruluyor. Kod değişirse ya da iki kayıt
   aynı kodla dönerse vade sessizce yanlış/boş gelir.

**Bugünkü ayrımın GEREKÇESİ şemada yazılı** (schema 8236-8245) ve sessizce geçilmiyor: *(a)* muhasebe
alanlarını (vergi dairesi, vade, risk limiti) operasyon kartına koymak onları operasyon ekranlarına
sızdırırdı, *(b)* hesap lazy açıldığı için "200 müşterinin çoğunun hareketi yok, hepsine boş hesap
açmak listeyi şişirir". §2'deki hedef bu iki gerekçeyi de **karşılar**, iptal etmez.

## 2. Sektör ölçütü — SAP Business Partner

SAP'de iş ortağı TEK kayıttır (BP) ve üç katman taşır: **General data** (ad, adres, vergi no) ·
**Roles** (müşteri / tedarikçi / …) · **Company-code view** (finans görünümü: mutabakat hesabı,
**ödeme koşulu**, ödeme yolu, para birimi). Bu fazın iki dersi:

- Finans görünümü **rolle birlikte doğar** — BP'ye müşteri rolü verilirken company-code view'ı da
  kurulur; "ilk faturada doğsun" diye bekletilmez.
- **Ödeme koşulu genel veride değil, FİNANS GÖRÜNÜMÜNDE yaşar.** Yani sektör kalıbı "vadeyi kimlik
  kartına yaz" demiyor; "vadeyi, kartla birlikte doğan finans kaydında tut" diyor.

Bizdeki karşılık: `Customer` = general data + roles, `CariAccount` = company-code view.

## 3. Hedef model

### 3.1 Değişmezler (hangi yol seçilirse seçilsin)

1. **Kart varsa hesabı vardır** — hesap kartın yaratıldığı TX'te doğar (`ensureCariAccountTx` kart
   yaratma yolundan çağrılır). "Hesap yok" bir durum olmaktan çıkar.
2. **Terimlerin (vade · para birimi · vergi dairesi · risk limiti) TEK kaynağı vardır**; ikinci bir
   yerde override yaşamaz.
3. **Kart formu terimleri düzenleyebilir** — kullanıcı vadeyi kart açarken girer.
4. **Hesap kartsız doğamaz.** Yeni hesabın tarafı yalnız karttır (fason bacağı `resolvePartyToCardTx`
   ile çözülür — dilim E'de indi, `helpers/party-card.helper.ts`).
5. **Terim okuyucuları ID bağıyla okur**, kod/ad aramasıyla değil (§1.4).

### 3.2 Terimler nerede yaşasın — ÖLÇÜLMÜŞ iki yol

| | **A — hesapta kalır (SEÇİLDİ)** | **B — karta taşınır (reddedildi)** |
|---|---|---|
| Şema | değişiklik YOK | `Customer`a 3 yeni nullable kolon + veri göçü + eski kolonların kaldırma borcu |
| Okuyucu | dokunulmaz (4 yer) | 4 okuyucu taşınır: `deriveInvoiceDueDate` (`finance.helper.ts:190`) · mal kabul taslağı (`invoice.service.ts:770`) · sevk otomatik taslağı (`shipment-auto-draft.helper.ts:364`) · `cari.service` yazma yolu |
| "Tek kaynak" | sağlanır — hesap kartla 1:1 | sağlanır, ama geçiş penceresinde İKİ yer dolu olur |
| Sektör kalıbı | birebir (company-code view) | ödeme koşulunu general data'ya çeker |
| Kullanıcının gördüğü | **aynı**: kart formunda "Finans" bölümü | aynı |

> ### ⛳ KARAR: **A** — 1e, 2026-09-18 11:40
> Terimler `CariAccount`ta KALIR; hesap kartla 1:1 doğar; kart formundaki "Finans" bölümü onları
> `finance:read`/`finance:write` ile düzenler. **B yolu REDDEDİLDİ** — getirisi §3.1(1) değişmezi
> kurulduğu anda sıfırlanıyor, geriye yalnız veri göçü ve dört okuyucunun taşınması kalıyordu.
> §6.2 bu yüzden **uygulanmaz**; belgede karşılaştırma kaydı olarak duruyor.

⇒ **Öneri A.** §3.1(1) sağlandığı anda "vade kartta doğmuyor" kusurunun sebebi ortadan kalkar; terimi
fiziksel olarak taşımak aynı kazancı getirmez, yalnız göç ve okuyucu değişimi ekler. Şemadaki
*(a)* gerekçesi de korunur: alanlar operasyon kartına sızmaz, yalnız kart formunda **ayrı bir bölüm**
olarak ve finans yetkisiyle görünür (§5).
B seçilirse §6.2'deki göç adımı bağlayıcıdır; belgenin geri kalanı iki yolda da aynen geçerlidir.

### 3.3 `kind`in geleceği

Bu fazda **kaldırılmaz** — [§7 sınıfı](IS-ORTAGI-ROL-MODELI.md) borcudur. Bu fazda:
- yeni yazılan her hesapta `kind` taraf bağının **aynası** olarak kalır (bugünkü davranış);
- **hiçbir yeni okuyucu `kind`i ticari yön olarak okumaz**; ticari yön kartın rol bayraklarından gelir;
- panelin `listCari({ kind })` süzgeci yerini kartın rol süzgecine bırakır (`filter[role]`, dilim F'de
  indi) — `kind` parametresi **eski istemci için kalır** (§7.1b tablosu satır 1b).

### 3.4 Hesabın erken doğmasının bedeli ve karşılığı

- **Bedel:** hareketi olmayan hesap satırları. **Karşılık:** Cari Hesaplar listesi varsayılan
  **"Durum: Hareketli"** süzgeciyle açılır (Tümü seçilebilir) — lazy açılışın tek gerçek kazancı
  (liste şişmesin) süzgeçle korunur, veri modeli sadeleşir. *(1e kararı 2026-09-18.)*
- **Açılış bakiyesi** ile çakışma yok: hesap boş doğar, `OpeningBalanceDialog` yolu değişmez.
- `CariBalance` PK `(cariId, currency)` — hesap boş doğduğunda bakiye satırı YARATILMAZ; ilk hareket
  yaratır (bugünkü davranış, dokunulmaz).

## 4. MV kapıları — bu tasarım nereye oturuyor

| Kapı | Bu tasarımdaki cevap |
|---|---|
| **MV-01** kimlik ≠ rol | Kart kimlik, roller bayrak; hesap kimliğin FİNANS GÖRÜNÜMÜ, ayrı kimlik değil. `kind` yeni kod için rol/yön kaynağı DEĞİLDİR. |
| **MV-02** finans kimliği tek | Hesap yalnız karta bağlanır; XOR bacağı yeni yazımda kapalı (dilim A/E indi), kaldırma §7. Hesap 1:1 doğduğu için "aynı firmanın iki hesabı" yapısal olarak imkânsızlaşır. |
| **MV-03** operasyon verisi profile | Fason sevk/kabul geçmişi `Subcontractor.id`de kalır; bu belge ona dokunmaz. |
| **MV-04** çapraz tekillik | Hesap kartla 1:1 ⇒ `customerId @unique` zaten tekilliği verir; ek kod üretimi yok (hesabın kendi kodu yok, kartın kodu okunur). |
| **MV-05** geriye dönüklük | §6. |

## 5. Ekran sözleşmesi (Z-B, 9b)

1. **Cari kartı formunda "Finans" bölümü** — vade (gün) · para birimi · vergi dairesi · risk limiti
   (yazılabilir) + açık bakiye (salt-okunur, varsa). Bölüm `finance:read` ile ÇİZİLİR, `finance:write`
   ile yazılır; yetkisi olmayan kullanıcı bölümü görmez (kart formunun geri kalanı değişmez) ⇒ şemadaki
   "muhasebe alanı operasyona sızmasın" gerekçesi yetki düzeyinde korunur.
2. **Modül kapalıysa** (`finance.enabled` kapalı) bölüm hiç çizilmez.
3. **Cari Hesaplar listesi KALIR** (ekstre, dönem kapanışı, risk limiti raporu oradan) ama:
   - varsayılan süzgeç **Durum: Hareketli**; "Tümü" seçilebilir,
   - "tür" kolonu kartın **rollerinden** yazılır (kartsız eski fason hesabı için "Eski fason hesabı"),
   - listeden **yeni hesap açma** yolu kalkar: hesap kartla doğar (kartsız hesap üretme yolu kapanır).
4. **Fatura/tahsilat formu vadeyi ID ile okur** — `cariId` üstünden tek uçtan (§6.1), kod aramasıyla
   değil. Kullanıcıya görünen davranış aynı; kayıp/yanlış vade ihtimali kalkar.

## 6. Uygulama dilimleri

### 6.1 Z-A — backend (01)

1. `ensureCariAccountTx` **kart yaratma yolundan** çağrılır (müşteri/cari create servisi, aynı TX).
   Fason profili bağlama yolu da aynı çözücüden geçer (bugünkü davranış).
2. **Terim okuma tek helper**: `getCariTermsByCariId(cariId)` — vade + para birimi tek yerden döner;
   `InvoiceFormDialog`in kod-aramalı yolu bu uca bağlanır (§1.4). Bellek-içi ikinci bir kopya yasak.
3. `cari.service.create` (elle hesap açma, `POST /api/finance/cari`) **kartsız taraf kabul etmez**;
   kart zaten hesapla doğduğu için bu uç yalnız eski kayıtların onarımı için kalır (ya da kapatılır —
   01'in ölçümü: uç bugün panelde kullanılıyor mu).
4. **Göç script'i** `scripts/migrate_cari_accounts_backfill.ts` (1e adı; dry-run varsayılan, `--apply`, `_test` dışı hedefe `--canli-onay` fail-closed), idempotent
   (ikinci koşum 0 değişiklik), etkilenen her kartı listeler: hesabı olmayan aktif kartlara hesap açar.
   Fabrika kopyasında prova; **koşan kullanıcıdır** (canlı veri kuralı).
5. Bekçi: hesapsız aktif kart = 0 · kartsız yeni hesap = 0 · vade iki kaynaktan okunmuyor (kaynak
   taraması: `paymentTermDays` okuyan her yer tek helper'dan geçiyor) · negatif sonda her üçü için.

⚠️ **ÖLÇÜLEMEDİ (bu belgede bilinçli boşluk):** "bugün kaç aktif kartın hesabı yok" ve "kaç hesap
kartsız" sayıları **DB ölçümüdür** ve bu oturum canlı/yedek veritabanına koşmaz. Sayıyı Z-A'nın göç
adımı dry-run çıktısından verir; belgeye o çıktı eklenir. 1e'nin "kartsız hesap 0 (rol modeli
göçünden sonra)" bilgisi burada **alıntıdır, bu belgenin ölçümü değildir**.

### 6.2 B yolu — REDDEDİLDİ (karar A, §3.2); kayıt olarak durur

`Customer`a `paymentTermDays` · `defaultCurrency` · `taxOffice` (+ `riskLimit`) nullable eklenir →
mevcut hesaplardan karta kopyalanır → dört okuyucu karta çevrilir → hesaptaki kolonlar
**aynı sürümde kaldırılmaz** (okuma geriye dönük kalır, kaldırma §7 sınıfı).

### 6.3 Z-B — panel (9b)

§5'teki dört madde. "Finans" bölümü kart formunun mevcut sekme/bölüm düzenine eklenir; yeni ekran yok.

## 7. Eski istemci ne yapar (MV-05)

| Değişiklik | Eski panel/tablet |
|---|---|
| Hesap kartla doğar | **Etkilenmez** — istemci hesabı `cariId` ile okur; erken doğan hesap yalnız "zaten var" demektir. Eski panel Cari Hesaplar listesinde hareketsiz hesapları da görür (süzgeci göndermez) — veri doğru, yalnız liste uzun. |
| Terim okuma tek uca taşınır | Eski panel eski yoldan (kod araması) okumaya devam eder; uç kaldırılmaz. |
| Kart formunda "Finans" bölümü | Eski panelde bölüm yok; kullanıcı vadeyi eskisi gibi Cari Hesaplar'dan düzenler. |
| `listCari({ kind })` | **Kalır** — eski istemci süzgeci göndermeye devam eder ve doğru sonuç alır. |
| Elle hesap açma ucu | Eski panel kullanıyorsa 400 GÖRMEZ (uç davranışı korunur); yalnız kartsız taraf reddedilir ve sahada kartsız taraf kalmadığı ÖLÇÜLDÜKTEN sonra sıkılaştırılır. |

**Bayrak gerekmiyor:** davranış değişikliği kullanıcıya görünen bir seçim değil, bir veri
değişmezinin (kart ⇒ hesap) kurulmasıdır; varsayılan = bugünkü sonuç (aynı hesap, aynı bakiye, aynı
ekstre). Mevcut kayıtlar için karşılık bayrak değil **göç script'idir** (§6.1/4).

## 8. Bu belgenin ölçüm künyesi

| İddia | Nereden |
|---|---|
| Hesap lazy doğuyor, terimler varsayılanla başlıyor | `services/helpers/finance.helper.ts:255-285` (create yalnız `kind` + taraf) |
| Terimler hesapta yaşıyor | `prisma/schema.prisma:8246-8267` (`taxOffice` · `defaultCurrency` · `paymentTermDays` · `riskLimit`) |
| Ayrımın gerekçesi | `prisma/schema.prisma:8236-8245` (şema yorumu) |
| `CariKind` yön taşımıyor | `prisma/schema.prisma:8231-8234` (`CUSTOMER` · `SUBCONTRACTOR`) |
| "Cari türü" seçimi kalkmış | `Electron/src/pages/Finance/InvoiceFormDialog.test.tsx:203,262` |
| Vade kod aramasıyla bulunuyor | `Electron/src/pages/Finance/InvoiceFormDialog.tsx:181-188` |
| Vade okuyucuları (4) | `finance.helper.ts:190` · `invoice.service.ts:770` · `shipment-auto-draft.helper.ts:364` · `cari.service.ts:262,317` |
| Çağrı yerleri (3) | `cheque.service.ts:349` · `invoice.service.ts:371` · `payment.service.ts:199` |
| Kart/hesap SAYILARI | Z-A dry-run (`scripts/migrate_cari_accounts_backfill.ts`, 2026-09-18) — **01 test DB'si**: hesapsız aktif kart 7 (hepsi bekçi kalıntısı), hesapsız pasif 27, kartsız hesap 0, çift hesap 0. **Fabrika kopyası/canlı sayısı KULLANICININ dry-run koşumundan** yazılır (canlı veriye bu oturum koşmaz) |
