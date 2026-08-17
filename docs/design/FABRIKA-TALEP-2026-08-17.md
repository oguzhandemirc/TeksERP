# Fabrika Talep Listesi — 2026-08-17

Sahadan gelen 12 maddelik listenin çözüm planı. Sıra ve kararlar kullanıcı ile
birlikte netleştirildi (bkz. her maddedeki **Karar** satırı).

> **Madde 7 (cihaz eşleştirme) bu turda ATLANDI** — kök çözüm mobile yeni bir
> Expo paketi (`expo-application`) gerektiriyor ve gece cihazda doğrulanamayacak
> bir APK riski taşıyordu. Ayrı bir turda ele alınacak.

## Uygulama sırası

| Sıra | Paket | Maddeler | Bedeli |
|---|---|---|---|
| 1 | Canlı hata | 6 | Sadece restart |
| 2 | Panel rahatlığı | 1, 5 | Saf Electron |
| 3 | Parti bilgisi | 2, 4 | Backend + APK |
| 4 | Arama | 3 | Backend (tek dosya) |
| 5 | Sipariş/renk/en ailesi | 8, 10, 11, 12 | Backend + Electron (+APK) |
| 6 | Yarı mamül | 9 | Migration + yeni yetki + APK |

---

## 1 — Sekmeler arası geçişte liste sıfırlanıyor

**Bulgu.** Sekme sistemi zaten tüm sekmeleri mount tutuyor (`TabHost`), yani
gerçekten iki sekme arasında geçişte durum korunuyor. Sorun tıklama
davranışında: `useOpenTarget` varsayılanı `navigateActive` — sol tık **aktif
sekmeyi yerinde** başka sayfaya taşıyor. Liste → detay → sipariş zincirinde
liste sekmeden düşüyor, geri gelindiğinde sıfırdan mount oluyor.

**Karar (kullanıcı).** İkisi birden.

**Yapılacak.**
1. Liste satırı tıklaması detayı **yeni sekmede** açsın (liste sekmesi yerinde kalır).
2. Liste durumu (sayfa/filtre/arama/kaydırma) sekme kapansa bile hatırlansın →
   aynı yola geri dönüldüğünde son durumdan açılır.

**Sınır.** Kalıcılık **oturum boyu** (bellekte) — disk'e yazılmaz; bayat filtre
ertesi gün operatörü şaşırtır.

---

## 2 — İş emri listesinde parti kolonu

**Bulgu.** WO liste servisi (`workorder.service.findAll`) partiyi hiç
seçmiyor; arama zaten `batches.some.batchNumber` üzerinden çalışıyor ama
gösterim yok. Mobil Hızlı İş Emri listesi de yalnız iş emri no gösteriyor
(arama kutusunda "Parti no ara" yazması yanıltıcı).

**Yapılacak.** Liste select'ine ilk 3 parti (`createdAt asc`) + toplam sayı
(`_count.batches`). Electron'da İş Emri No'dan sonraki kolon; 3'ten fazlaysa
`+N` rozeti farklı tonda. Mobil satırında da aynı bilgi.

---

## 3 — Türkçe harf ayrımsız arama

**Bulgu.** Tek merkezî fonksiyon var: `buildTurkishSearch` (query-parser).
Bugün yalnız **büyük/küçük** katlıyor (i↔İ, ı↔I); ç/c, ş/s, ğ/g, ü/u, ö/o
katlamıyor.

**Karar (kullanıcı).** A yolu — terim varyantı.

**Yapılacak.** Terimdeki katlanabilir harfler için varyant üretimi. Varyant
sayısı üst sınırla kırpılır (kombinatorik patlama); sınır aşılırsa bugünkü
davranışa düşülür (sessiz daralma değil, sadece daha az varyant).

---

## 4 — "SON PARTİ: P47"

**Bulgu.** Uç zaten var: `GET /api/batches/number-state` (son kullanılan +
sıradaki). Bugün yalnız Genel Ayarlar'daki `BatchNumberHint` kullanıyor.

**Yapılacak.** Aynı bilgiyi Electron yeni iş emri ekranına ve mobil Hızlı İş
Emri ilk adımına rozet olarak koy. "Sıradaki" değil **son kullanılan** yazılır
(sıradaki rezervasyon değildir).

---

## 5 — Stok kodu alanı

**Bulgu.** `ItemFormDialog`'da Stok Kodu **ilk alan** ve "boş bırakın" diyor.

**Yapılacak.** Alan forma en alta taşınır, varsayılan kapalı bir satıra
dönüşür ("Kod otomatik verilecek · STK-000123") ve yanındaki "Elle gir"
bağlantısı tıklanmadıkça giriş kutusu **hiç çizilmez** (sekme sırasına da
girmez). Düzenlemede bugünkü salt-okunur davranış korunur.

---

## 6 — Tambur ekranı yetkileri

**Bulgu (gerçek hata).** `TamburScreen` renk ve kumaş listelerini çağırıyor
ama:
- `GET /api/colors` → `property:read`, `mobile:hizli-is-emri`, `mobile:siparis`, `mobile:kumas`
- `GET /api/items` → `item:read`, `mobile:kk1`, `mobile:siparis`, `mobile:kumas`

İkisinde de **`mobile:tambur` YOK** → yalnız Tambur yetkisi taşıyan operatör
manuel top / düzeltme akışında sessiz 403 alıyor. Müşteri, hata tipi, kalite ve
etiket uçları doğru bağlanmış.

**Yapılacak.** İki route'a `mobile:tambur` eklenir. Tekrarı önlemek için
mekanik bekçi: mobil ekranın import ettiği servislerin uçları, o ekranın izni
ile açılabiliyor mu?

---

## 7 — Cihaz eşleştirme — **BU TURDA ATLANDI**

Teşhis kayda geçsin: cihaz kimliği uygulamanın kendi deposunda üretiliyor
(`mobil/src/utils/deviceId.ts` → SecureStore; Electron `src/lib/deviceId.ts`).
Uygulama kaldırılıp kurulunca ya da verisi temizlenince kimlik siliniyor →
sistem yeni cihaz sanıyor. **APK imza anahtarı sabit** (şablon debug keystore,
SHA256 `FA:C6:17:45…`), yani `adb install -r` ile üzerine kurulumda kimlik
korunur.

Kalıcı çözüm (sonraki tur): platform başına kalıcı kimlik —
Android `ANDROID_ID` (`expo-application`), iOS **zaten doğru** (Keychain
uygulama silinse de kalır), Windows `MachineGuid` — + panelde "cihazı devret"
düğmesi.

---

## 8 — "Sipariş Bağla" butonu

**Bulgu.** Ayrı uç YOK; sipariş bağlama yalnız `PATCH/PUT /work-orders/:id`
üzerinden yapılıyor — yani kullanıcı "Düzenle" ekranını açmak zorunda ve orada
başka her şeyi de değiştirebiliyor.

**Yapılacak.**
- `GET /work-orders/:id/linkable-order-lines` — kumaş/renk/en'e göre süzülmüş,
  açık miktarı ile aday sipariş satırları.
- `POST /work-orders/:id/order-links` — **yalnız bağ kurar/kaldırır**; rota,
  renk, kumaş, metraj, hedef özelliklere **dokunmaz**.
- Electron: yan panelde ve detay sayfasında "Sipariş Bağla" butonu.

---

## 9 — Dışarıdan yarı mamül alımı

**Karar (kullanıcı).** İzlenebilirlik = sadece stok girişi (tedarikçi/irsaliye
izi tutulmaz). Giriş iki kapıdan: KK1 (yeni yetkiyle) + Electron manuel.

**Depo kararı.** Ayrı depo AÇILMAZ. Sektör standardı ayrı ambar değil ayrı
**stok türü** (SAP'de HALB). Yarı mamül **ham stoğa** düşer, üzerinde ayırt
edici işaret taşır, Ham Stok listesinde filtreyle süzülür.

**Yapılacak.**
- `RollEntrySource.SEMI_FINISHED` (yeni enum değeri, migration).
- Yeni yetki: KK1 içinde yarı mamül kabulü. Yetki yoksa ekran **bugünkü gibi**
  kalır (renk seçimi çizilmez).
- Electron manuel giriş: barkodsuz açık kumaş olarak (fason dönüşü toplarıyla
  aynı mekanizma) → sonra iş emrine bağlanır.
- Rota şablonu: "Yarı Mamül" (Kurşun+Tambur) ve "Yarı Mamül — Sadece Tambur".
- **En mantığı:** girişte en opsiyonel. İş emrine bağlarken uyuşmazlık
  **uyarı** (engel değil). İş bitiminde top iş emrinin enine kavuşur — ama
  Tambur'da ölçülmüş bir en varsa **ölçüm kazanır**.
- **Barkod:** girişte basılmaz; Tambur kesiminde çocuk toplar barkodunu alır.
- **Kalite:** girişte sorulmaz, ham stoğa düşer; karar Tambur'da.

---

## 10 — Sonradan sipariş bağlayınca kalıtım

**Bulgu.** `update`/`replace` yolunda sipariş satırları bağlanınca hedef
kumaş/renk sipariş satırından **yeniden çözülüyor**; renk açıkça
gönderilmezse siparişinki yazılıyor → boyahanedeki mavi iş emri ekruya
dönebiliyor.

**Yapılacak.** Yeni "Sipariş Bağla" ucu **hiçbir şey miras almaz**.
Uyuşmazlıkta: kumaş/renk → **sert engel** (net mesajla: "İş emri MAVİ, sipariş
EKRU"); metraj/en → **uyarı**.

Renk değişikliği ayrı bir işlem olur: **"Rengi Değiştir"** (sebep zorunlu, iz
bırakır, refakat kartı yeni sürüme geçer).

---

## 11 — Ekru / boyahaneye renksiz gitme

**Karar (kullanıcı).** A yolu — rota adımında işaret.

**Gerekçe.** Kural rengin kendisinde değil, o iş emrinin o adımında yaşıyor:
aynı renk bir işte gerçekten boyanır, başkasında kimyasal işlemle çıkar.

**Yapılacak.** Rota adımına "fasona renksiz gitsin" işareti. Çeki/kâğıtta renk
boş çıkar (`resolveStepDyeColor` bu işareti de dikkate alır), iş emrinin rengi
EKRU kalır (planlama ve sipariş karşılama bozulmaz), kabulde personel beyan
eder — fason kabul ekranında renk alanı zaten var.

---

## 12 — En (cm) değişimi

**Bulgu.** Fason kabulde en **zaten beyan edilebiliyor** ve doğan topa
yazılıyor (`bornWidth`), ama **iş emrinin eni güncellenmiyor** → sonraki çeki
eski eni basıyor.

**Karar (kullanıcı).** Kısa yol + kabulde beyan doğrudan iş emrine yansısın
(onay sorulmaz).

**Yapılacak.**
- İş emrinde **"Eni Değiştir"** kısa yolu (sebep zorunlu, iz bırakır) —
  "Rengi Değiştir" ile aynı aile.
- Fason kabulde beyan edilen en iş emrine de yazılır; yalnız **iş emri açıkken**
  (kapanmış/iptal WO'da yalnız topa yazılır) ve iz kaydı düşer.
