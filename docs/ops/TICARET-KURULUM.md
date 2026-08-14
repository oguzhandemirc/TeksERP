# TeksERP — TİCARET (alım-satım) Kurulum Reçetesi

> **Bu doküman kimin için:** kumaş ÜRETMEYEN, **alıp satan** bir firmanın kurulumunu yapan kişi.
> Akış: satın al → **mal kabul** → depo → **sevk** → **fatura** → **tahsilat** → rapor.
> Üretim (KK1 · Kurşun/KK2 · Tambur · fason) bu kurulumda **kullanılmaz**.
>
> **Bu doküman NE DEĞİL:** sunucu/PostgreSQL/pm2/Electron/tablet kurulumu. Onlar
> `docs/ops/KURULUM.md` (A–F bölümleri) ve `docs/ops/DEPLOY-RUNBOOK.md`'dedir ve **önce**
> yapılır. Burası, ayakta duran bir TeksERP'i "ticaret rejimine" almanın reçetesidir.
>
> **Neden ayrı bir doküman:** bu adımlar bugüne kadar üç yere dağınıktı — bayraklar
> `system-setting.service.ts` yorumlarında, rol `role-template-catalog.ts` yorumunda, kur/devir
> ise hiçbir yerde. Demo verisi üreten `npm run seed:ticaret-demo` **DB adı kapılıdır** (adında
> `demo`/`ticaret` geçmeyen veritabanında başlamadan çıkar) ve bu **doğrudur** — gerçek müşteri
> DB'sinde demo müşteri/fatura doğurmamalı. Yani gerçek kurulumda koşacak bir şey yoktu.

---

## 0. Ön koşullar (bunlar bitmeden aşağı inme)

| # | Koşul | Nasıl doğrulanır |
|---|---|---|
| 0.1 | Backend ayakta, şema güncel | `curl -s http://<sunucu>:4000/health` → `200` + `db:"UP"` |
| 0.2 | Backend **en az bir kez** açıldı | Boot log'unda `[permission-catalog]` **ve** rol uzlaştırma satırları var |
| 0.3 | `admin` ile panele girilebiliyor | `KURULUM.md` B13 |
| 0.4 | Firma adı + künye girildi | Genel Ayarlar → Şirket Bilgileri (`KURULUM.md` B15–B16) |

> ⚠️ **0.2 pazarlık dışı.** `WEB_TRADE` yetki şablonu ve `goods-receipt:*`, `finance:*`,
> `warehouse:*`, `purchase-order:*`, `price:write`, `report:finance` izinleri DB'ye **boot
> uzlaştırmasıyla** gelir (`jobs/permission-catalog.job.ts` → `jobs/role-template-catalog.job.ts`;
> kural: *kodu deploy etmek = katalogu getirmek*). Backend hiç açılmadıysa şablon YOKTUR ve
> aşağıdaki 2. adım yapılamaz. Bootstrap betiği bu durumda **hiçbir şey yazmadan** durur ve
> sebebini söyler.

**Master data:** Ticaret kurulumunda üretim master-data'sının çoğu (istasyon, makine, rota,
fason kategori) **gereksizdir**. Zorunlu olan minimum: en az **1 Kumaş/Ürün kartı (Item)** ve
**1 cari kart**. `KURULUM.md` C-bölümündeki ADIM 6–11 (istasyon/makine/cihaz/rota/reçete) bu
kurulumda **atlanır**; ADIM 2 (renk/özellik) ve ADIM 3 (ürün) yapılır.

---

## 1. Rejim bayrakları — `finance.enabled` + `finance.pricingEnabled`

**Panel yolu:** Yönetim → **Sistem** → **Genel Ayarlar** (`/system/settings`) → soldaki
**Muhasebe** sekmesi. (Fiyat bayrağı **Siparişler** sekmesindedir — ikisi ayrı sekmede, ayrı
soru cevapladıkları için.)

| Anahtar | Sekme | Varsayılan | Ticarette |
|---|---|---|---|
| `finance.enabled` | Muhasebe → "Ön muhasebe modülünü aç" | **KAPALI** | **AÇ** |
| `finance.pricingEnabled` | Siparişler → "Sipariş para birimi ve fiyat alanlarını göster" | **KAPALI** | **AÇ** |

**İkisi bağımsızdır ve karıştırılmamalıdır:**
`pricingEnabled` **operasyon** ekranlarındaki fiyat/para birimi alanlarını açar (sipariş satırı,
alış siparişi, mal kabul satırı). `finance.enabled` ayrı bir **muhasebe modülünü** açar
(cari · fatura · tahsilat · kasa/banka). Fiyatı sipariş ekranında gösteren bir fabrikanın cari
defteri tutması gerekmez — bu yüzden tek bayrağa indirilmedi.

### Bayrak açıldıktan sonra ne GÖRÜNÜR olur

| Yüzey | Nerede | Ek koşul |
|---|---|---|
| **Muhasebe** menü satırı | Sol menü (`/finance`) | `finance:read` izni |
| Cari Hesaplar · Faturalar · Tahsilat/Ödeme · Kasa & Banka · **Kasa Hareketleri** · Çek/Senet · Fatura Kapama · Dönem Kapanışı · **Kurlar** | Muhasebe hub karoları | `finance:read` |
| **Ön Muhasebe** rapor karosu (cari yaşlandırma · kasa & banka defteri · ekstre) | Raporlar (`/reports/finance`) | `report:finance` |
| **İplik Kg-Stok** · **Alış Siparişleri** karoları | Operasyon (`/operations`) | `warehouse:read` / `purchase-order:read` |
| Sevkiyat satırında **Faturala** düğmesi | Operasyon → Sevkiyatlar (Muhasebe) (`/operations/accounting-dispatch`) | `finance:write` |
| **TCMB kur işi** (saatte bir) | Sunucu arka planı | — (bayrak kapalıyken dış HTTP isteği bile atılmaz) |

> ⚠️ **Bayrak REJİM, izin KİŞİ kapısıdır.** Bayrak açık + izin yok → menüde satır **var**, ekran
> `/forbidden`. Bayrak kapalı + izin var → satır **hiç çizilmez** ve backend de `403` döner
> (`requireFinanceEnabled`). "Ekranı göremiyorum" şikâyetinde **önce bayrağa, sonra izne** bak.

> ⚠️ **`production.enabled`'a DOKUNMA gerekmez.** Varsayılanı **AÇIK** ve `finance.enabled`'dan
> bağımsızdır. Ticaret firmasında üretim sekmeleri boş kalır ama zararsızdır; kapatmak isteğe
> bağlı bir sadeleştirmedir (Genel Ayarlar → Muhasebe → "Üretim modülünü aç"), **kurulumun
> koşulu değildir** ve iş emri verisine dokunmaz.

---

## 2. `WEB_TRADE` rolünü KULLANICIYA ata

> **Kural: katalog koda, atama panele.** Boot uzlaştırması rolü ve izinleri **DB'ye getirir**;
> kimseye **ATAMAZ**. Bu bilinçlidir (kim hangi rolü alacak ortama özgü bir karardır) ve tam da
> bu yüzden en sık atlanan adımdır: 2026-08-06 denetiminde canlı kurulumda **7 izin hiçbir
> kullanıcıda yoktu** — ekranlar deploy edilmişti, `admin` dahil kimse açamıyordu.

**Rol:** `WEB_TRADE` — "Ticaret (Depo + Satış + Muhasebe)". 39 izin; mal kabul, depo/transfer,
stok, alış siparişi, fiyatlama, sipariş, sevkiyat, iade ve ön muhasebeyi kapsar. **Üretim ve
mobil izni içermez.**

> ⚠️ **`admin:settings` bu rolde YOKTUR** — yani ticaret kullanıcısı **Genel Ayarlar'ı açamaz**
> ve §1'deki bayrakları kendisi çeviremez. Bayraklar bir **yöneticinin** işidir ve §2'den
> **ÖNCE** yapılır. Aynı gerekçeyle rolde olmayan diğer ikisi bilinçlidir:
> `shipping:undo-dispatch` (resmi çıkış belgesini iptal) ve `roll:manual-adjust`
> (metraj/kayıt düzeltme) — ikisi de süpervizör yetkisidir, günlük iş değil; gerekiyorsa
> panelden tek kişiye verilir.

**Panel yolu:** Yönetim → **Yetkilendirme** → **Kullanıcılar** (`/access/users`) → kullanıcı →
**Yetkiler** sekmesi → **Şablon Uygula** → *Ticaret (Depo + Satış + Muhasebe)* → **Ekle (merge)**.

- **merge** = mevcut yetkilere ekler (varsayılan tercih).
- **replace** = kullanıcının tüm yetkilerini şablonla değiştirir — mevcut bir kullanıcıyı
  daraltmak istemiyorsan kullanma.
- Uygulama sonrası kullanıcı **yeniden giriş yapmalı**: JWT'deki izin listesi bayat olabilir.
  (Merge dalı `tokenVersion`'ı artırdığı için oturum zaten düşer; yine de "çıkış→giriş" söyle.)

**Alternatif (elle 39 kutu işaretlemeden):** `npx tsx scripts/setup-ticaret.ts --user <kullanıcı>`
— bkz. §9.

### Doğrulama — "N yetki hiçbir kullanıcıda yok" bandı

Yönetim → Yetkilendirme → **Yetki Kataloğu** (`/access/permissions`). Üstteki uyarı bandı
*"N yetki hiçbir kullanıcıda yok"* diyorsa **listeye bak**: aşağıdakilerden biri oradaysa ticaret
akışının bir parçası kimsede değildir ve o ekran kimseye açılmaz.

| İzin | Açılmayan yüzey |
|---|---|
| `goods-receipt:read/write` | Mal Kabul (`/operations/goods-receipts`) |
| `warehouse:read` | Depolar · İplik Kg-Stok |
| `warehouse:transfer` | Depo Transferi (yalnız 2+ depoda görünür) |
| `purchase-order:read/write` | Alış Siparişleri |
| `price:write` | Fiyat kartı yazma (satış/alış fiyatı ön-dolumu) |
| `finance:read` | Muhasebe menüsünün TAMAMI |
| `finance:invoice` | Fatura onay/iptal **ve cari devri girme** |
| `finance:payment` | Tahsilat/ödeme **ve kasa açılış/masraf/virman** |
| `finance:cheque` | Çek/senet |
| `finance:close` | Dönem kapanışı |
| `report:finance` | Ön Muhasebe raporları |

### Görev ayrılığı (SoD) — isteğe bağlı daraltma

`WEB_TRADE` **tek kişilik ekip** varsayar: aynı kişi hem satıyor hem tahsil ediyor hem dönem
kapatıyor. Ayrı çalışanlar varsa şunlar **panelden sökülür** (rolü değiştirme, kullanıcıdan kaldır):

- `finance:close` → yalnız muhasebeciye,
- `finance:payment` / `finance:cheque` → yalnız kasa/çek sorumlusuna,
- `shipping:invoice` (dış muhasebe fatura izi) ile `shipping:write` (sevk) ayrı kişilere,
- `shipping:undo-dispatch` (resmi çıkış belgesini iptal) **`WEB_TRADE`'de zaten YOK** — gerekiyorsa
  bilinçli olarak tek kişiye verilir.

---

## 3. Depo(lar) + varsayılan depo

**Varsayılan depo kendiliğinden doğar.** Backend açılışında `ensureDefaultWarehouse` koşar:
depo yoksa **"Merkez Depo" (`DP-MERKEZ`)** yaratır; depo var ama hiçbiri varsayılan değilse **en
eskisini** varsayılan yapar. Yani bu adım çoğu kurulumda **doğrulamadan ibarettir**.

**Panel yolu:** Tanımlar → **Depolar** (`/definitions/warehouses`) — `warehouse:read` izni.

1. Varsayılan deponun adını firmanın gerçek deposuna göre **yeniden adlandır** (kod `DP-MERKEZ`
   kalabilir; kod kimliktir, ad görüntüdür).
2. İkinci/üçüncü depo varsa **şimdi aç**. Yeni depo kodu backend üretir (`DP+GGAAYY+NNNN`).
3. **Tam olarak bir** depo `isDefault` olmalıdır. Depo parametresi göndermeyen her yol
   (kesim, iade, üretim yolları) oraya yazar.

> ⚠️ **Depo yüzeyleri VERİDEN türer, bayraktan değil.** `Depo Transferi` karosu ve satır/liste
> depo kolonları yalnız **2+ depo** varken çizilir (`useMultiWarehouse`). Tek depolu kurulumda
> "transfer ekranı yok" **arıza değil tasarımdır**; ikinci depoyu açtığın gün kendiliğinden belirir.

> ⚠️ **Yeni depo açmak `warehouse:write` ister** ve o izin `WEB_TRADE`'de **VARDIR**; sistem
> yöneticisi rolünde de vardır. Depo *tanımı* bir kurulum kararıdır, günlük iş değil.

---

## 4. Kasa / banka hesapları + **AÇILIŞ bakiyeleri**

**Panel yolu:** Muhasebe → **Kasa & Banka** (`/finance/accounts`) → *Kasa Ekle* / *Banka Hesabı Ekle*.

- **Her hesap TEK para birimlidir** (TRY · USD · EUR · GBP · RUB). Dövizli işi olan firma o döviz
  için **ayrı hesap** açar; tek hesabı çok para birimli kullanmaya çalışma.
- **Bakiye elle yazılmaz** — hareketten türetilir. Formda bakiye alanı yoktur (uç düzeyinde de
  `stripBalance` ile ayıklanır).
- Hesap adları **işletme kararıdır** ("Merkez Kasa", "Ziraat TL", "Garanti USD"). Bootstrap betiği
  bu yüzden kasa/banka **AÇMAZ** — uydurulmuş bir ad, sonradan düzeltilse bile ekstre ve fişlerde
  geçmişe doğru kalır.

### Açılış (devir) bakiyesi

**Panel yolu:** Muhasebe → **Kasa Hareketleri** (`/finance/cash-transactions`) → *Fiş Ekle* →
tür **Açılış**.

- Açılış hesap başına **TEK** girilir (ikincisi reddedilir).
- Açılış yönü **IN**'dir: sistemin devraldığı mevcut nakit.
- Kasada gerçekte para yoksa açılış **girme** — 0 doğru cevaptır.

> ⚠️⚠️ **SIRA LOAD-BEARING: açılış ÖNCE, `blockNegativeCash` SONRA.**
> `finance.blockNegativeCashEnabled` açıkken kasadan para çıkaran dört yol (ödeme · masraf fişi ·
> virmanın çıkan bacağı · çek ödemesi) kasayı eksiye düşürecekse **409** ile reddedilir. Bakiyesi
> 0 görünen **dolu** bir kasadan **tek işlem bile yapılamaz** — ve o gün ilk masraf fişini kesen
> kişi sebebini anlamaz. Doğru sıra: (1) hesapları aç → (2) açılışları gir → (3) bayrağı aç.
> Ters gidildiyse acil çıkış yolu bayrağı **kapatmaktır** (Genel Ayarlar → Muhasebe).

> **Banka muaftır.** Guard yalnız fiziksel nakit (kasa) içindir; kredili mevduat meşrudur.
> İptal/storno yolları da muaftır — yanlış bir tahsilat "kasa yetmez" diye iptal edilemez kalmasın.

---

## 5. Kur girişi (dövizli belge 400 vermesin)

**Panel yolu:** Muhasebe → **Kurlar** (`/finance/rates`).

- **Otomatik:** `finance.enabled` açıkken sunucu **saatte bir** TCMB `today.xml`'i kontrol eder
  (USD · EUR · GBP · RUB, **döviz alış / ForexBuying** — VUK md. 280). Bülten iş günü ~15:30'da
  yayınlanır. Bayrak kapalıyken **dış HTTP isteği bile atılmaz**.
- **Elle:** aynı ekranda tarih + para birimi + kur ile satır eklenir.
- **Elle giren KAZANIR:** aynı (tarih, para birimi) için operatörün yazdığı satıra TCMB işi
  **dokunmaz**. Bülten gün içinde revize edilirse yalnız TCMB kaynaklı satır güncellenir.
- **"TCMB'den Çek"** düğmesi (`finance:write`) beklemeden manuel tetikler.

> ⚠️ **Kuru olmayan günde dövizli belge KESİLEMEZ** (400 + "elle girin"). Bu bilinçli: TL
> karşılığı uydurulmuş bir fatura sessizce yanlış olur. **Sunucunun interneti yoksa** (kapalı ağ)
> TCMB işi hiçbir zaman başarılı olmaz — o kurulumda dövizli çalışılacaksa kur **her iş günü elle
> girilmelidir**; girilmiyorsa firmayı TRY-only çalıştır.
> **TRY kur tablosuna girmez** — kendi para biriminin kendine kuru 1'dir ve koda gömülüdür.

---

## 6. Cari kartlar + **devir bakiyeleri**

**Kartlar:** Tanımlar → **Cariler** (`/definitions/cariler`) — müşteri · tedarikçi · fason tek
listede, rol rozetiyle. (Birleşik **görünüm**tür; kartlar kendi tablolarında yaşamaya devam eder.)

**Mali alanlar:** Muhasebe → **Cari Hesaplar** (`/finance/cari`) → satır → **düzenle** —
vade günü (`paymentTermDays`) · risk limiti · vergi dairesi · varsayılan para birimi · not.

> ⚠️ **Vade günü girilmezse yaşlandırma raporu çalışmaz.** Efektif vade şu sırayla çözülür:
> ① faturanın kendi `dueDate`'i → ② `fatura tarihi + carinin vade günü` → ③ ikisi de yoksa satır
> **"Vadesiz"** kovasına düşer. Yani faturada vade boş bırakıldığında raporun TEK dayanağı bu
> alandır. **Boş ≠ 0:** boş = "vade kararlaştırılmadı", `0` = "peşin" (ertesi gün gecikmiş sayılır).
> **Risk limitinde binlik ayracı REDDEDİLİR** ("50.000" hem elli bin hem elli okunabilirdi).

**Devir (sisteme geçiş anındaki mevcut borç/alacak):**
Muhasebe → **Cari Hesaplar** (`/finance/cari`) → cari → **Ekstre** → **Devir Gir**
(izin: `finance:invoice`).

- Devir cari başına **TEK**tir; ikincisi `409` ile reddedilir. Yanlış girildiyse aynı ekranda
  **Devri İptal Et** → sonra doğrusunu gir.
- **Yön işaretle değil SEÇENEKLE sorulur** (Borç / Alacak). Tutarı **pozitif** yaz, yönü seç —
  eksi işaretiyle giriş, iki yönlü hataların en sessizidir.
- Devri **olmayan** cariye devir girme; 0 bakiye "devir yok" demektir, "devir 0" değil.

> **Sırası:** cari kartlar → devirler → ilk fatura. Devir sonradan girilirse ekstrenin ilk satırı
> değişir ve o güne kadar basılmış ekstre çıktılarıyla ayrışır.

---

## 7. Opsiyonel bayraklar — varsayılanlar ve ne zaman açılır

Hepsi: Genel Ayarlar (`/system/settings`).

| Bayrak | Sekme | Varsayılan | Ne yapar / ne zaman aç |
|---|---|---|---|
| `finance.blockNegativeCashEnabled` | Muhasebe | **KAPALI** | Kasayı eksiye düşürecek 4 çıkış yolunu **409** ile keser (banka ve iptal/storno **muaf**). **Yalnız §4'teki açılışlar girildikten SONRA aç.** Sahada yanlış pozitif üretirse tek geri dönüş yolu bu anahtardır. |
| `finance.defaultVatRate` | Muhasebe (sayı, %) | **20** | Fatura formundaki yeni satır + mal kabulden üretilen alış taslağı bu oranla açılır. **Yalnız ön-dolum** — satırda değiştirilebilir, mevcut faturalara dokunmaz. Firmanın ağırlıklı oranı farklıysa (örn. 10) burada değiştir; satır bazlı istisna yine elle girilir. |
| `shipping.confirmationEnabled` | Sevkiyat & İade | **KAPALI** | Kapalıyken "Sevk Et" → **doğrudan DISPATCHED** (tek adım). Açıkken sevkiyat `PLANNED` kalır ve çıkış ayrıca **Sevk Kapısı**'ndan onaylanır. Depoyu hazırlayan ile malı çıkaran **farklı kişiyse** aç; tek kişilik ekipte kapalı bırak (her sevk ikinci bir tıklama ister). |

**Bu kurulumda DOKUNULMAYACAKLAR** (üretim tarafı; ticaret firmasında karşılığı yok):
`kk1.*` · `tambur.*` · `production.kursunBypassEnabled` · `batch.shortNumberEnabled` ·
`workorder.targetQuantityEnabled` · `devicePairingRequired` (tablet yoksa).

---

## 8. Doğrulama turu — persona senaryosu (uçtan uca)

Kurulumu bitiren kişi bunu **kendi elleriyle** bir kez koşturur. Her adımın sonunda beklenen
sonuç yazılıdır; biri tutmuyorsa sağdaki bölüme dön.

| # | Adım | Yol | Beklenen | Tutmuyorsa |
|---|---|---|---|---|
| 1 | `WEB_TRADE` kullanıcısıyla **gir** (admin ile DEĞİL) | — | Sol menüde **Muhasebe** satırı var | §1, §2 |
| 2 | **Mal kabul** fişi: tedarikçi + kumaş + 2 top + birim fiyat | Operasyon → Mal Kabul | Fiş oluştu, toplar **envanterde** ve **doğru depoda** | §1 (pricing), §2, §3 |
| 3 | Envanterde topları gör | Operasyon → Envanter | 2 top, statü depo, kaynak = mal kabul | §3 |
| 4 | **Sevkiyat** kur: müşteri + o toplar | Operasyon → Sevkiyatlar | Sevkiyat `DISPATCHED` (onay bayrağı açıksa `PLANNED` → Sevk Kapısı'ndan onayla) | §7 |
| 5 | Sevkiyattan **Faturala** | Operasyon → Sevkiyatlar (Muhasebe) → satır → *Faturala* | Satış faturası **taslağı** açıldı, satırlar ve KDV oranı dolu | §1, §7 (`defaultVatRate`) |
| 6 | Faturayı **onayla** | Muhasebe → Faturalar | Statü `CONFIRMED`; **cari bakiye** arttı | §2 (`finance:invoice`) |
| 7 | **Tahsilat** gir (kasa, kısmi tutar) | Muhasebe → Tahsilat/Ödeme | Kasa bakiyesi arttı; fatura **KISMİ** rozeti aldı | §4, §2 (`finance:payment`) |
| 8 | **Cari ekstre** aç | Muhasebe → Cari Hesaplar → Ekstre | Devir + fatura + tahsilat **kronolojik**, yürüyen bakiye doğru | §6 |
| 9 | **Kasa & Banka Defteri** raporu | Raporlar → Ön Muhasebe | Açılış + tahsilat satırları; yürüyen bakiye kasadaki parayla **birebir** | §4, §2 (`report:finance`) |
| 10 | Dövizli çalışacaksan: **USD faturası** kes | Muhasebe → Faturalar | Kur bulundu, TL karşılığı yazıldı (400 gelirse kur yok) | §5 |

> ⚠️ **Turu ADMIN ile koşma.** `admin` her şeyi görür ve tam da bu yüzden eksik izni **gizler**;
> senaryonun ölçtüğü şeylerden biri de "gerçek kullanıcı bu ekranı açabiliyor mu"dur.

> **Turda üretilen kayıtlar gerçektir.** Deneme sevkiyatı/faturası bırakmak istemiyorsan
> **ters yoldan** kapat (fatura storno · sevk geri al · tahsilat iptal) — kayıt **silinmez**,
> ters kayıtla kapanır. Bu bilinçlidir; append-only defterin tanımı budur.

---

## 9. Bootstrap betiği — `scripts/setup-ticaret.ts`

Yukarıdaki **§1 · §2 · §3**'ün mekanik kısmını tek komutta yapar. **VERİ ÜRETMEZ:** fatura,
tahsilat, çek, top, cari kart, **kasa/banka hesabı** oluşturmaz.

```bash
cd Teks-Erp

# 1) KURU ANLATIM (varsayılan) — hiçbir şey yazmaz, ne yapacağını listeler
npx tsx scripts/setup-ticaret.ts --user muhasebe

# 2) UYGULA — önce aynı listeyi basar, sonra onay ister ("evet")
npx tsx scripts/setup-ticaret.ts --user muhasebe --apply

# 3) Etkileşimsiz ortam (CI / uzak oturum): onayı bayrakla ver
npx tsx scripts/setup-ticaret.ts --user muhasebe --apply --yes
```

**Yaptıkları:** `finance.enabled` + `finance.pricingEnabled` bayraklarını açar · `WEB_TRADE`
şablonunu verilen kullanıcıya **merge** eder · varsayılan depoyu garantiler.
**Yapmadıkları:** hiçbir bayrağı KAPATMAZ, hiçbir izni GERİ ALMAZ, hiçbir kaydı SİLMEZ.

- **İdempotent:** ikinci koşum her adım için "atlandı" der.
- **DB adı kapısı YOKTUR** (gerçek müşteri DB'sinde koşacak) — koruma `--apply` + onay
  adımındadır ve betik zaten yıkıcı bir iş yapmaz.
- **Ön kontroller yazma ÖNCESİ koşar:** kullanıcı yoksa/pasifse ya da `WEB_TRADE` şablonu DB'de
  yoksa **hiçbir şey yazılmaz** ve sebep söylenir (şablon yoksa: "backend en az bir kez açılmalı",
  yani §0.2). Yarım uygulanmış bir kurulum — bayraklar açık ama kullanıcı yetkisiz — tam da bu
  reçetenin önlemeye çalıştığı sessiz hâldir.

**Betikten SONRA hâlâ elle yapılacaklar:** kasa/banka hesapları + açılış bakiyeleri (§4) ·
kur (§5) · cari kartlar + devirler (§6) · opsiyonel bayraklar (§7) · doğrulama turu (§8).

---

## ⚠️ KRİTİK TUZAKLAR (özet)

- **Boot uzlaştırması koşmadan rol atanamaz** — backend bir kez açılmış olmalı (§0.2).
- **Katalog koda, atama panele**: izinler DB'ye gelir, **kimseye verilmez**. Kontrol yüzeyi
  Yetki Kataloğu'ndaki *"N yetki hiçbir kullanıcıda yok"* bandıdır (§2).
- **Açılış bakiyesi → sonra `blockNegativeCash`** (§4). Ters sıra ilk masraf fişini 409'a düşürür.
- **Kuru olmayan günde dövizli belge kesilemez** (§5). İnternetsiz sunucuda kur elle girilir.
- **Devir cari başına TEK**; düzeltme = önce iptal, sonra yeniden gir (§6).
- **Bayrak ≠ izin**: "ekran yok" şikâyetinde önce bayrağa, sonra izne, sonra "yeniden giriş
  yaptı mı"ya bak (§1).
- **Doğrulama turunu admin ile koşma** (§8) — admin eksik izni gizler.
- **Demo seed'i gerçek müşteride koşma**: `npm run seed:ticaret-demo` DB adı kapılıdır ve
  bilerek öyledir; zorlama bayrağı YOKTUR.
