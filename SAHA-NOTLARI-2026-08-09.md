> # ⏱ DURUM (gece koşumu, 2026-08-09)
> **Yapılanlar aşağıda madde madde işaretli. Özet ve deploy reçetesi için dosyanın
> SONUNDAKİ "GECE KOŞUMU RAPORU" bölümüne bak.**
>
> ⚠️ **HİÇBİR ŞEY COMMIT EDİLMEDİ.** Ağaçta eşzamanlı başka bir oturumun işi de
> var (Raporlar / Kalite Karnesi + `20260809090000` migration); commit etmek onu
> benim commit'ime süpürürdü (`paylasimli-agac-git-add-tuzagi`). Dosya dosya
> commit kararı sana ait.

# Saha Gözlem Notları — 2026-08-09

Fabrikada personel izlenerek çıkarılan 11 madde. Her madde için karar verildi; bu dosya
kararların kaydı + iş listesidir. **İş bitince silinecek.**

Sıralama **deploy penceresine göre** kuruldu (kullanıcı kararı): önce saf panel işleri,
sonra backend+panel, en sona APK gerektirenler.

> ⚠️ **Bekleyen deploy borcu (bu işlerden ÖNCE):** sahada 3 migration + 7 iznin elle
> ataması + yeni APK zaten bekliyor (`agac-tamami-main-e-gonderildi`). Aşağıdaki işlerin
> bir kısmı aynı pencereye girer — ayrı pencere açma.

---

## 0. Önce ölçüm — koda bakmadan karar verilmeyecek 4 nokta

Bunlar iş değil, **tespit**. Yanlış varsayımla kod yazmamak için önce koşulacak.

- [ ] **T1 — A5 dikey ortalama kök nedeni.** Kullanıcı "içerik dikey ortalanmış" dedi.
      Kodda dikey ortalayan bir kural **bulunamadı**: `.sheet` yalnız `min-height` +
      yatay `margin: 0 auto` taşıyor (`traveler-card.html.ts:611-617`), `@page` payları
      dört yandan eşit (varsayılan 8mm). Yani ortalama ya **yazıcı sürücüsünden**
      ("sayfaya sığdır" / A4 tepsiye A5 içerik) ya **Electron print yolundan** geliyor.
      → Gerçek veriyle A5 çıktı üret, `Electron/src/lib/print.ts` ve `printHtml.ts`
      yollarını ölç, fiziksel kâğıtla karşılaştır. **Kök neden bulunmadan CSS'e dokunma.**
- [ ] **T2 — `tambur.overQuantityEnabled` canlıda açık mı?** Madde 8'in "kalan 0'a inse
      bile kesmeye devam" isteği bu bayrağa bağlı. Backend desteği **var**
      (`tambur.service.ts:707, 1910, 2445`), ama bayrak kapalıysa 400 döner.
      → Canlı `SystemSetting` değerini oku. Kapalıysa açma **ayrı bir karar** —
      istemci düzeltmesiyle aynı pencerede olmalı, yoksa operatör yeni "Bitir" tuşunu
      görür ama kesemez.
- [ ] **T3 — Hangi liste ucu renk/özellik/en/kat döndürüyor?** Madde 1/4/5 üç ayrı
      yüzeye aynı bilgiyi koyuyor. Emsal uyarı (`refakat-karti-otomatik-revizyon` dersi):
      *alanı eklemek yetmez, hangi YANITTA döndüğünü doğrula.* "Ekleme Nedeni" özelliği
      tam bu yüzden yazıldı, test edildi, commit edildi ve kullanıcıya hiç ulaşmadı.
      → `getReceipt` · Hızlı İş Emri geçmiş listesi · fason kabul geçmişi: üçünün de
      `select`/`include` şeklini kontrol et.
- [ ] **T4 — `lastLabelSnapshot` içindeki müşteri niyetinin kapsamı.** Madde 11'in geri
      doldurma script'i buna dayanacak. Canlıda kaç topun snapshot'ı var, kaçında
      `customerId` dolu, kaçı stok niyetli → `Roll.labelCustomerId` backfill'inin
      gerçek kapsamını verir.

---

## A. Saf Electron — APK yok, migration yok

Sahaya en ucuz inen grup. **Bu grup tek başına deploy edilebilir.**

### A1 · Kişisel tercih: fason firma varsayılanı

Bugün iş emri açarken fason firma **kategorinin favorisi** ile geliyor
(`useDesignerSteps.ts:36-43,174-217`). İstenen: **açılır-kapanır kişisel tercih** —
"favori mi gelsin, son seçtiğim mi".

- [ ] Electron Ayarlar altına **"Kişisel Tercihler"** sayfası aç (yeni bölüm).
- [ ] Tercih `UserPreference`'ta saklanır — kişisel UI blob'u, audit'ten muaf
      (kök CLAUDE.md istisnası). Sistem geneli ayar **değil**.
- [ ] Varsayılan: **favori** (bugünkü davranış). Kimsenin alışkanlığı habersiz değişmez.
- [ ] "Son seçilen" kaynağı: kategori bazında, o kullanıcının en son onayladığı iş
      emrindeki firma. Seçim geçmişi yoksa favoriye düşer.
- [ ] ⚠️ Favori kavramı **kaldırılmıyor** — yıldız listede kalır, sıralamayı etkiler.

*(Aynı tercihin mobil karşılığı → D3.)*

### A2 · Çuval/top uyuşmazlık uyarıları — Electron yüzeyleri

Kullanıcı önceliği: *"sevkiyatçılar Electron ve barkod tabanca kullanıyor."*
**Dört sinyal, hepsi bildirim — hiçbiri sevki ENGELLEMEZ.**

| Sinyal | Renk | Kural |
|---|---|---|
| Etiket bu müşteri için farklı çıkardı | 🔴 kırmızı | Aksiyon gerek: etiketi yenile |
| Başka müşteri için üretilmişti | ⚪ gri | Bilgi, aksiyon gerekmez |
| 2. kalite (A1) top müşteri çuvalında | 🔴 kırmızı | Çoğu zaman kaza |
| Şube uyuşmazlığı · sipariş spec'i tutmuyor | 🔴 kırmızı | Sevk anında sessizce tahsissiz kalırdı |

**Kırmızı etiket kuralı — kimlik değil İÇERİK karşılaştırması.** Soru şu:
*"bu top, hedef müşteriyle bugün basılsaydı etiket içeriği farklı çıkar mıydı?"*
Şablonu (`CustomerTemplateRoute`), kumaş/renk alias'ını **ve** etikette yazan müşteri
adını birlikte kapsar. ⚠️ Yalnız "şablon aynı mı" diye sormak yetmez: X ve Y ikisi de
standart şablon kullansa bile şablonda müşteri adı alanı varsa etikette "X" yazar ve
mal Y'ye gider.

⚠️ **Bu kural kendiliğinden sessizdir** ve öyle kalmalı — etiket müşteriye özel hiçbir
şey basmıyorsa fark yok, uyarı yok. Düz "basıldığı müşteri ≠ gideceği müşteri"
karşılaştırması çoğu meşru gönderimde de yanar ve operatörü **körleştirir**. Bu tam
olarak `Sack.labelDirty` notundaki yazılı kuralın aynısı (*"tetikleyici 'müşteri
değişti' DEĞİL"*) — oradaki gerekçeyi okumadan gevşetme.

- [ ] Uyarı motoru backend'de tek fonksiyon (üç istemci de aynı cevabı görsün).
- [ ] Electron **Çuval Deposu / Çuval İçerik Düzenleme** — top okutulurken anında + çuval kartında kalıcı rozet.
- [ ] Electron **Sevkiyat kurma (çuval seçimi)** — toplu özet.
- [ ] Müşterisiz çuval meşru kalır (`Sack.customerId` opsiyonel) — uyarı üretmez.

---

## B. Backend + Electron — APK yok

Mobil aynı backend HTML'ini bastığı için belge işleri APK istemez.

### B1 · Ayarlanabilir boş grid bloğu (tüm belgeler, opt-in)

Not "kurşuncular için tablo" diye başladı ama istenen **genel bir yapı**: satır sayısı,
sütun sayısı ve sütun genişlikleri kullanıcı tarafından belirlenen **boş** grid.

- [ ] **Tüm belgelerde** kullanılabilir, ama **opsiyonel — bayrak açıksa var.**
- [ ] Ayarlanabilir: satır sayısı · sütun sayısı · sütun genişlikleri.
- [ ] Başlık **yazılabilir** (boş bırakılırsa hiç basılmaz).
- [ ] İlk satırda sütun başlıkları **isteğe bağlı** — istenirse tamamı boş.
- [ ] ⚠️ **DÖRT KAPI BİRLİKTE** güncellenir, yoksa ayar sessizce kaybolur (yazılı kural):
      ① `system-setting.DocumentConfig` tipi · ② `sanitizeDocumentsConfig` kayıt kapısı ·
      ③ `printed-document.controller.docConfigSchema` (**bu atlanırsa ayar gerçek baskıda
      görünür ama canlı önizlemede GÖRÜNMEZ**) · ④ Electron `documentConfig.ts` aynası.
- [ ] ⚠️ **Donmuş belge parmak izi:** grid kapalıyken **tek bayt CSS/HTML basılmaz**.
      Ayara dokunmamış belgelerin çıktısı bayt-bayt korunmalı (`${…}` kendi satırında
      boş satır sokar — mevcut kuralı izle).
- [ ] ⚠️ Şablon literali içinde **backtick kullanma** (CSS yorumunda bile) — dosya derlenmez.
- [ ] Bekçi: yeni `DocumentConfig` alanı için §17 (önizleme şeması) + §18 (kayıt kapısı)
      ikisi de genişletilir.

### B2 · Refakat kartı A5 — üstten başlasın

- [ ] **T1'in sonucuna bağlı.** Kök neden bulunmadan CSS'e dokunma.
- [ ] Sahada kayıtlı ayarın gerçekten A5 olduğunu doğrula
      (`refakat-karti-a5-parti` notu: kayıtlı ayar A4'tü, panelden A5 seçilmesi gerekiyordu).
- [ ] Düzeltme sonrası A4 çıktısının **bayt-bayt aynı** kaldığını doğrula.

### B3 · "Son Çıkan Toplar" filtreleri — backend

Bugün uç yalnız `workOrderId · limit · cursor · search · withTotal` alıyor
(`tambur.service.ts:1246-1257`). **Tarih süzgeci YOK.**

- [ ] Hızlı tarih: **Bugün · Son 2 gün · Son 7 gün** — gün sınırı `factoryDayStart()`
      ile çözülür (gece vardiyası doğru güne düşsün).
- [ ] Serbest tarih aralığı (başlangıç–bitiş).
- [ ] İş emri (backend süzgeci **zaten var**, yalnız arayüzü yok).
- [ ] Müşteri (→ B4'e bağlı) + kalite.
- [ ] ⚠️ Cursor sözleşmesi bozulmayacak; filtre `where`'e girer, `orderBy` değişmez.

### B4 · `Roll.labelCustomerId` — migration

**Ne olduğu adında yazılı: "etiketinde yazan müşteri", tahsis DEĞİL.**

- [ ] Nullable FK → `Customer`. Etiket niyetiyle **aynı transaction'da** yazılır;
      tek yazma noktası etiket servisi.
- [ ] ⚠️ **`Roll.customerId` DEĞİL, ve bu isim load-bearing.** Kök kural: *"Top→sipariş
      bağı yok"* — çuval havuzu modelinde tahsis çuval bazında ve **sevk anında** yapılır
      (`SackAllocation`); `packedQty`/`rebalanceCustomerPool` bilinçli kaldırılmıştı.
      Kullanıcının kendi ifadesi: *"top gerçekten birine tahsis edilemez, her an her şey
      olabilir."* Düz `customerId` deseydik altı ay sonra biri üstüne tahsis mantığı yazardı.
- [ ] Nullable kolon → PG11+'ta **metadata-only**, tablo yeniden yazılmaz.
- [ ] `rolls` zaten 18+ index taşıyor → index ekleme kararını ölçümle ver.
- [ ] Geri doldurma script'i: **dry-run varsayılan**, `--apply` öncesi kapsam listelenir
      (T4 ölçümü bunu besler).
- [ ] Bekçi: kolon ile `lastLabelSnapshot.customerId` drift etmiyor.

### B5 · Sapma kaydı — fire / kayıt düzeltmesi / aşım

**Sektör dayanağı (SAP PP):** ayrım tek soruya dayanır — *bu metraj fiziksel olarak var mıydı?*

| Karar | Gerçek | Muhasebesi |
|---|---|---|
| **Fire** | Mal **vardı**, kullanılamaz | Üretim kaybı — fire/verim KPI'sına girer, sebep kodu zorunlu (SAP 551) |
| **Kayıt Düzeltmesi** | Mal **hiç yoktu**, kayıt yanlıştı | Fire **değil** — stok/ölçüm düzeltmesi, ayrı belge türü (SAP 701/702) |

İkisini tek kovaya atmak fire oranını **sistematik olarak şişirir**. Bu ayrım projede
zaten yazılı: `softDelete` (`qtyOut=0`, kayıt hatalıydı) ↔ WO-kapanış dispozisyonu
(`qtyOut=qtyIn`, mal vardı ve çıktı).

**Bugünkü durum (ölçüldü):**
- `scrap` → gerçek **FIRE topu doğurur** (envanterde durur, sayılabilir). ✅
- `discard` → **hiçbir kayıt doğmaz**; iz yalnız `RollOperation.metadata` JSON'unda
  (`tambur.service.ts:2935`). Arşivlenmiyor (audit değil) ama **indekslenemez**.
- **Aşım (fazla kesim) hiçbir yere yazılmıyor.** Bayrak açıkken kesim kabul ediliyor,
  parent `TAMBUR_CONSUMED` oluyor, "40 m fazla çıktı" bilgisi buharlaşıyor. Yani
  sapmanın **eksi yönü** iz bırakıyor, **artı yönü** bırakmıyor.

- [ ] **"At (kayıp)" → "Kayıt Düzeltmesi — bu metraj fiziksel olarak yoktu"** olarak
      yeniden adlandır. Yanıltan şey seçeneğin adıydı; "kayıp" fire çağrıştırıyor.
- [ ] Fire ve kayıt düzeltmesi için **hazır sebep kataloğu** (emsal:
      `mobil/src/constants/manualReasons.ts` — iki ekran ortak). Serbest yazım kaldırılmaz,
      "Diğer"in altına alınır.
      ⚠️ Sahada sürekli "Diğer" seçiliyorsa **katalog yanlıştır**; listeyi büyütme,
      gerçek serbest metinlere bakıp seçenekleri güncelle.
- [ ] **Aşım da sapma olarak kayda geçsin** (artı yön). Rapor tek yönlü kalmasın.
- [ ] Üçü de **sorgulanabilir alanda** dursun — JSON blob'da değil. Rapor ileride yazılır
      ama veri bugünden doğru birikir; geriye dönük doldurulamaz.
- [ ] ⚠️ **Manuel metraj düzeltme alanı EKLENMEYECEK** (bilinçli): (1) "Düzelt"
      (`RollEditDialog`) zaten metraj düzeltiyor ve `roll:manual-adjust` ile korunuyor —
      ikinci yol iki kaynak demek; (2) sapmayı düzeltme olarak yazmak **sapmayı yok eder**,
      oysa rapor için değerli olan tam da sapmanın kendisidir.

### B6 · Uyuşmazlık motoru (A2'nin backend'i)

- [ ] Tek fonksiyon: `(rollId, hedefMüşteri) → { etiketFarklı, gerekçe[] }`.
      Okuma yolu (önizleme) ve yazma yolu aynı fonksiyonu çağırır — ayrışırsa ekran
      "uygun" derken uç başka şey söyler.
- [ ] Kalite · şube · sipariş spec kontrolleri aynı yanıtta döner.

---

## C. Mobil (APK) — bekleyen APK ile aynı pakete girer

### C1 · Tambur: otomatik bitiş kalkıyor, "Bitir" tuşu geliyor ⭐ en kritik

**Bugünkü sorun (ölçüldü):** ana açık kumaş kesim akışında **"Bitir" tuşu YOK**
(`TamburScreen.tsx:1085-1095`). Kalan `< 0.1 m` olunca iş **otomatik** kapanıyor ve
`remainingAction: 'discard'` gönderiliyor. Fiziksel kumaş kalmışsa kesilemiyor.
(*"Top Kesme" modalında zaten Bitir + 4 seçenekli karar penceresi var —
`CutActionBar.tsx:83-85`, `FinalizeRemainingModal`. Ana akış onu paylaşacak.*)

- [ ] **Otomatik bitiş tamamen kalkar**, "Bitir" tuşu gelir.
- [ ] **Kalan 0'a inse bile kesime devam edilebilir** (T2: bayrak açık olmalı).
      Saha gerekçesi: sistemde 40 m eksik girilmiş olabilir, gerçekte 2×20 m daha var.
- [ ] **"Bitir" HER ZAMAN açık.** Kalan 0 ise tek dokunuşla biter; kalan > 0 ise
      **karar penceresi zorunlu** (1.Kalite / A1 / Fire / Kayıt Düzeltmesi + sebep).
      ⚠️ Kullanıcının ilk önerisi "kalan > 0 iken Bitir kapalı" idi; **tersi vaka**
      (sistemde 40 m görünürken fiziksel kumaş bitmiş) o kuralda çıkmaza düşerdi —
      iş emri sonsuza dek açık kalır, top "üretimde" görünürdü. Bu yüzden vazgeçildi.
- [ ] Karar penceresi B5'in yeni adlandırması + sebep kataloğuyla çalışır.

### C2 · Tambur: "bu iş emrinden çıkan toplar" paneli (YENİ)

Sağdaki "iş emri içindeki toplar" bölümünün birkaç satır altına.
**Backend hazır — `recentOutputRolls` zaten `workOrderId` süzgeci alıyor.**

- [ ] Kapsam: **aktif iş emrinin tüm çıkan topları** (vardiya/oturum fark etmez).
- [ ] Gösterilecek: **bastığım toplam metraj** (kalan değil) · top sayısı · barkodlar ·
      **saat:dk**.
- [ ] Aksiyonlar: **yazdır** · **geri al**.
- [ ] Geri alma → geri alınan metraj **kalana geri eklenir**. `TamburUndoService` SINGLE
      modu bunu zaten yapıyor; yeniden yazma.
- [ ] ⚠️ Geri alma ANA EKRANI da değiştirir — `onUndone` deseniyle ekranı tazele
      (`RecentOutputModal`'daki 2026-08-04 saha bulgusunun aynısı; tazelemezsen operatör
      elle "yenile"ye basmak zorunda kalır).
- [ ] UI: klavyenin altında kalması **sorun değil** — metre input'u otomatik
      kullanıldığında klavye kalkıyor (kullanıcı onayı).

### C3 · Tambur: "Son Çıkan Toplar" — tarih sütunu + toplu işlem + arşiv koruması

- [ ] **Tarih sütunu: üretim anı, gün + saat** (`createdAt`). Envanter kuralı: listede
      **tek** tarih kolonu görünür ve **sıralanan kolonla aynıdır**. Vardiya içi ayırt
      etmek için saat şart.
- [ ] **Toplu seçim → "Kime?" sor → hepsine yaz + hepsini bas.** Kuşağı değişen ürünlerin
      toplu yenilenmesi senaryosu. Tek akış (ayrı "müşteri değiştir" butonu yok —
      "değiştirdim ama basmayı unuttum" durumu doğmasın).
- [ ] ⚠️ Toplu sonuç **parçalı** olabilir: atlanan her satır **somut sebebiyle** dönmeli
      ve arayüzde gösterilmeli. *"42 basıldı"* deyip 8'inin neden atlandığını yutmak en
      kötü davranıştır (`test_kursun_bulk` emsali).
- [ ] **Arşiv topu okutulunca HİÇ AÇMA — "Bu top arşivde" hatası ver.** Bugün liste
      arşivi gizliyor (`status: notIn K18_DEAD_STATUSES`) ama **tarama yolunda süzgeç yok**
      (`resolveScanned` → `rollService.getByBarcode`), yani arşiv topunun önizlemesi
      açılıyor ve etiketi basılabiliyor.
- [ ] B3'teki filtreler için arayüz.

### C4 · Üç geçmiş yüzeyine renk + özellik + en + kat

Aynı bilgi, üç yerde. **T3 ölçümü önce.**

- [ ] **Mal kabul detayı** (`mobil/src/components/receipt/ReceiptDetailModal.tsx`) —
      bugün fason/iş emri/istasyon/irsaliye/zaman/kişi + iki top listesi var, **üretim
      bilgisi hiç yok**.
- [ ] **Hızlı İş Emri geçmişi.**
- [ ] **Fason kabul ekranı geçmişi.**
- [ ] ⚠️ Backend yanıtta bu alanları **gerçekten döndürüyor mu** doğrula — alanı eklemek
      yetmez (T3'teki "Ekleme Nedeni" dersi).

### C5 · Kişisel tercih — mobil ayağı

- [ ] A1'deki tercihin mobil karşılığı. Ayarlar **menü + alt sayfa** deseni
      (`screens/Common/settings/`, `SettingsPage`) — ana ekrana açık halde gömme.
- [ ] Aynı tercih Electron ile paylaşılır (`UserPreference`).

### C6 · Uyuşmazlık uyarısı — mobil "Sevkiyat" (çuval doldurma)

- [ ] A2'nin mobil yüzeyi. **Electron'dan sonra** (kullanıcı önceliği).
- [ ] Okutma geri bildirimi **ortak kaynaktan** gelir (`useScanFeedback` + `signalScan`);
      `Haptics`i doğrudan çağırma, üç sonucun ayrımı kayar. Sarı "uyarı" tonu eklenir.
- [ ] Çuval kartında kalıcı rozet.

---

## Deploy sırası

| Sıra | Paket | Gerektirdiği |
|---|---|---|
| 1 | **A1 + A2** (saf Electron) | Yalnız panel |
| 2 | **B1 + B2 + B3 + B6** | Backend + Electron aynı pencerede |
| 3 | **B4 + B5** | Migration + backend + Electron |
| 4 | **C1–C6** | Yeni APK — bekleyen APK ile **tek pakette** |

⚠️ **Backend ÖNCE, panel SONRA** (yazılı kural). Tersi çalışır; kabul edilemez olan
"panel önde, backend geride" hâlidir.

⚠️ C1/C3 backend sözleşmesi değiştirirse **backend + Electron + APK aynı pencerede**
gitmeli — eski APK yeni alanı görmez.

---

## Karar kaydı — yeniden tartışılmayacaklar

1. **Barkodun erken doğması sorun değil.** Bu sistemde barkod "bitmiş ürün işareti"
   değil topun **kimliği**dir. Riskler statüyle kapatılmıştır, barkodun varlığıyla değil.
   *(Kök CLAUDE.md'de yazılı — soru üçüncü kez sorulmasın.)*
2. **Uyarıların hiçbiri engel değil.** Sevk yolu hiçbir koşulda kapanmaz; müşterisiz
   çuval meşrudur.
3. **Yeni "hatalı metraj" karar seçeneği eklenmeyecek** — "At" zaten odur, sorun adıydı.
4. **Bitirme penceresine manuel metraj düzeltme eklenmeyecek** — bkz. B5.
5. **Favori kavramı kaldırılmayacak** — kişisel tercihle seçilebilir hale gelecek.
6. **`Roll.customerId` eklenmeyecek** — `labelCustomerId` eklenecek; ayrım load-bearing.

---

---

# İkinci tur — 2026-08-09 yedeği üzerinden

## Ortam

Sunucunun 09.08 02:00 yedeği (`tekserp_20260809_020001.dump`, 870 KB) yerelde
**`tekserp_saha`** veritabanına kuruldu (86 tablo). Paylaşımlı `adnansahin_db`'ye
DOKUNULMADI — eşzamanlı oturumlar bozulmasın. Analiz bu kopya üzerinde yapılıyor.

Kapsam: 452 top · 53 iş emri · 36 `TAMBUR_SPLIT` · 1 `TAMBUR_MANUAL`.

---

## 12 · Tambur geri alma — "iş emri hiç işlenmemiş gibi doğuyor" ⭐ EN KRİTİK

### Gerçek olay (yedekten yeniden kuruldu, teori değil)

**İş emri IE0808260001** — fason boyahane dönüşü barkodsuz açık kumaş, 500 m kayıtlı.
Rota: Boyahane (Fason) → Kurşun+KK2 → Tambur.

| Saat (08.08) | Olay |
|---|---|
| 15:02–15:11 | **15 top kesildi, toplam 545 m** — kayıtlı 500 m'yi 45 m aşıyor (`tambur.overQuantityEnabled` AÇIK; fiziksel kumaş kayıttan fazlaymış) |
| 15:05:22 | **Osman** T080826F0008'i (24,5 m) tek tek geri aldı → `TAMBUR_UNDO_SINGLE`, doğru çalıştı |
| ~15:11 | İş bitti, finalize, iş emri COMPLETED |
| **15:37:50** | **admin** bir topa "Geri Al" dedi → `TAMBUR_UNDO_FULL`: **14 top birden iptal**, 520,5 m kaynak topa geri yazıldı, `woRevived: true`, Tambur adımı ACTIVE'e döndü |

**Kalıcı hasar:** kaynak top (`92d0ef12…`) şu an `initialQty = 500` iken
`currentQty = 520,5` taşıyor. **Tüm veritabanında bu ihlali taşıyan tek satır bu** —
nedensellik tartışmasız.

### Kök nedenler (dört ayrı kusur)

1. ⭐ **Mod operatörün NİYETİNDEN değil SİSTEM DURUMUNDAN türetiliyor.**
   `resolveContext`: parent yaşıyorsa SINGLE, tüketilmişse FULL. Operatör iki
   durumda da aynı butona basıp aynı şeyi istiyor ("şu topu iptal et") — ama
   finalize'dan sonra 14 topu iptal eden bir diyalog alıyor. **Asıl kusur budur.**
2. **İşlem izi SİLİNİYOR.** `applyFull` adım 5: `rollOperation.deleteMany(TAMBUR_PROCESSED)`.
   Belge yok oluyor → "bu iş emri işlendi, sonra geri alındı" kaydı kalmıyor.
3. **Metraj ÜZERİNE YAZILIYOR, artırılmıyor** (`currentQty: restored`). Aşımlı kesimde
   çocukların toplamı giriş metrajını geçtiği için imkânsız satır doğuyor.
   `rolls_currentQty_nonneg` CHECK'i var ama **`currentQty <= initialQty` seddi YOK**.
4. **Depo kesimi ÇIKMAZI.** `finalizeWarehouseCut` kalıcı iz yazmadığı için FULL
   bloklanıyor; parent `TAMBUR_CONSUMED` olduğu için SINGLE de imkânsız.
   → **ne tekil ne toplu geri alma**. Ölçüm: 9 tüketilmiş kaynak topun **6'sı** bu
   durumda, yani en sık akış. Ekran görüntüsündeki vaka (T080826F0019 → T080826F0017,
   `TAMBUR_MANUAL` zinciri) tam olarak budur.

### Sektör standardı — storno bir OLAYDIR, geri sarma değil

SAP PP: onay (Rückmeldung) bir **belgedir**; iptali (CO13) o belgeyi ters çeviren
**yeni** bir belgedir. Üç kural:
1. **Tersleme belgeyi silmez** — sipariş asla "hiç başlanmamış" hâle dönmez.
2. **Kısmi tersleme yoktur** — bir belge ya tümden ters çevrilir ya hiç.
   (Koddaki *"ya hepsi ya hiçbiri"* yorumu DOĞRU, orayı bozma.)
3. **Tersleme ayrı bir yetkidir**, genelde döneme bağlıdır.

⚠️ **İş emrinin yeniden açılması aslında YANLIŞ DEĞİL** — meşru bir terslemede o adımda
gerçekten iş kalmıştır ve WO durumu zaten kalan gerçeklerden türetiliyor
(`recomputeStepStatus`). Kusur açılması değil, **operatörün onu istememiş olması**.

### Kararlar

- [ ] **Mod SORULSUN, türetilmesin.** Diyalogda iki seçenek: *"Yalnız bu topu iptal et"*
      ↔ *"Tüm işlemi geri al (N top)"*. **Varsayılan TEKİL.**
- [ ] **Finalize'dan sonra TEKİL iptal açılsın** — bugün eksik olan asıl şey.
      Metraj arşivdeki kaynak topa geri DÖNMEZ; **sapma olarak kaydedilir**
      (B5'teki "Kayıt Düzeltmesi" motorunun aynısı, sebep zorunlu). Fiziksel gerçek
      zaten bu: o top yanlış kaydedilmişti. Kaynak top arşivde, iş emri kapalı kalır.
- [ ] **FULL korunur ama sertleşir:** `roll:manual-adjust` yetkisi + **zorunlu sebep** +
      `TAMBUR_PROCESSED` izi **silinmez, iptal işaretlenir**.
      Süre sınırı (**aynı fabrika günü**) **bayrakla, varsayılan KAPALI** — asıl koruma
      zaten çocuk guard'larında (çuval/sevk/yeniden kesim); sert süre sınırı tam da
      düzelttiğimiz cinsten yeni bir çıkmaz üretir. Emsal: `shipping.undoDispatchSameDayOnly`.
- [ ] **Depo kesimi de kalıcı iz yazsın** (`finalizeWarehouseCut` → `TAMBUR_PROCESSED`
      benzeri). Bugünkü "iz yok, metraj güvenilir türetilemiyor" gerekçesi ortadan kalkar,
      6 topluk çıkmaz kapanır.
- [ ] **Metraj artırılsın, üzerine yazılmasın** — ve `restored > initialQty` ise
      `initialQty` **sapma kaydıyla** yükseltilsin (aşım kaydı, B5'e bağlı).
- [ ] **`currentQty <= initialQty` seddi: B5'ten SONRA.** Önce eklenirse meşru aşımlı
      kesimde veri hatasını gece yarısı 500'e çevirir.

### Ekran hatası (gönderilen fotoğraf) — ayrı ve daha küçük

Diyalog aynı anda üç çelişkili şey söylüyor:
*"İşlem TÜMDEN geri alınacak — tüm parçalar iptal olur"* → *"İPTAL EDİLECEK PARÇALAR (0)"*
→ *"geri alınamaz"*. Sebep: engelli erken-dönüş `children: []` / `restoredQty: 0`
döndürüyor ama istemci mod açıklamasını `canApply`'a bakmadan basıyor.

- [ ] `canApply === false` iken **yalnız sebep** gösterilsin; mod açıklaması, kaynak top
      metrajı ve parça sayacı çizilmesin. Yapmayacağı işi ilan eden diyalog en kötüsüdür.

---

## 13 · Canlıdaki hasarın onarımı — SAHA CEVABI BEKLİYOR 🔴

⚠️ **Asıl sorun sayı değil, envanter gerçeği:** sistem *"Tambur'da 520,5 m'lik tek parça
kesilmemiş açık kumaş var"* diyor; sahada ise **14 ayrı kesilmiş top, üzerlerinde basılı
etiketle** duruyor. Kumaş geri birleştirilemez.

- [ ] 🔴 **SAHAYA SORULACAK:** `T080826F0002` … `T080826F0016` barkodlu **14 top fiziksel
      olarak duruyor mu?** Cevap gelmeden hiçbir şey yazılmaz.
- [ ] **Duruyorsa → "geri almayı geri al"**: 14 topu iptalden çıkar, kaynağı tekrar
      `TAMBUR_CONSUMED` yap, işlem izini geri yaz, iş emrini kapat. Meşru, çünkü asıl
      hatalı işlem geri almanın kendisiydi.
- [ ] **Duruyor ama etiketleri imha edildiyse** → mevcut durum gerçeğe daha yakın;
      `initialQty` 520,5'e yükseltilir + aşım kaydı yazılır.
- [ ] İki yön için de **dry-run varsayılan** script (uygulama öncesi her kaydı listeler).
      *Uygulama turunda yazılacak — şu an yazılmadı.*
- [ ] **İş emri IE0808260001 şu an IN_PROGRESS / Tambur ACTIVE** ve kimse üzerinde
      çalışmıyor olabilir — planlamacıya sorulmalı.

---

---
---

# 🌙 GECE KOŞUMU RAPORU (2026-08-09)

## Test durumu

| Paket | Sonuç |
|---|---|
| Backend (`npm test`) | **280/280 dosya** · 239 sn |
| Mobil (`npx jest`) | **50 paket / 420 test** |
| Backend typecheck (`src` + `scripts`) | temiz |
| Mobil typecheck | temiz |
| Şema drift | temiz (yalnız bilinen 2 composite FK) |
| DB invariants | 68/68 |

---

## ✅ BİTEN

### B5 · Sapma defteri — fire / kayıt düzeltmesi / aşım
Yeni `RollVariance` tablosu (append-only) + `RollVarianceKind` enum
(`SCRAP` · `RECORD_CORRECTION` · `OVERAGE`) + `qty > 0` CHECK seddi.

- **"At (kayıp)" → "Kayıt Düzeltmesi"** olarak yeniden adlandırıldı (arayüz + tip yorumları).
- **Hazır sebep kataloğu** — backend `constants/variance-reasons.ts`, mobil aynası
  `constants/varianceReasons.ts`; ikisinin birebirliği **mekanik bekçili**.
- **Aşım artık kayda geçiyor** — üç kesim yolunun üçünde de (2026-08-09 öncesi
  sapmanın artı yönü hiçbir yere yazılmıyordu).
- ⚠️ **Eski APK KIRILMIYOR:** sebepsiz çağrı reddedilmez, görünür `BELIRTILMEDI`
  kovasına yazılır. Reddetseydi backend deploy edildiği an sahadaki her tablette
  "Bitir" 400'e düşerdi.
- Bekçi: `test_roll_variance.ts` **36 kontrol** · 4 negatif sonda kırmızı verdi.

### B7 · Tambur geri alma — dört kök nedenin dördü de kapandı
1. **Mod artık SORULUYOR.** Uç `options[]` + `defaultMode` döner; varsayılan
   **en dar** olan. Mod göndermeyen eski APK tek-parça iptaline düşer — yani
   kazara 14 top iptal edemez.
2. **Finalize sonrası tekil iptal AÇILDI** (asıl eksik oydu). Metraj arşivdeki
   kaynağa dönmez, **sapma** olarak yazılır; iş emri **kapalı kalır**.
3. **FULL sertleşti:** `roll:manual-adjust` + **zorunlu sebep** + yeni bayrak
   `tambur.undoFullSameDayOnly` (varsayılan **KAPALI**).
4. **Depo kesimi çıkmazı kapandı** — 9 tüketilmiş kaynağın 6'sı geri alınamıyordu.
5. **Metraj artık TÜRETİLMİYOR:** `Roll.preTamburCloseQty` / `preTamburCloseStatus`
   kapanışta kaydedilir, geri almada aynen geri konur. Aşımda `initialQty` yukarı
   çekilir → **`currentQty > initialQty` yapısal olarak imkânsız**.
6. **Sapma satırları terslenir** (`reversedAt`) — silinmez; hayalet fire kalmaz.
   ⚠️ Kesim aşımı terslenmez (kesimler gerçekten yapıldı).
- Bekçi: `test_tambur_undo.ts` **28 kontrol** · 4 negatif sonda kırmızı verdi;
  biri **saha hasarını birebir yeniden üretti** (`cur=130 init=0`).

### C1 · Tambur "Bitir" tuşu — otomatik bitiş kalktı
Her iki akışta da (açık kumaş + Top Kesme) otomatik kapanış **kaldırıldı**.
Kalan 0'a inse bile iş açık kalır ve **kesime devam edilebilir**
(backend zaten izin veriyordu — tek tıkaç bu istemci satırıydı).
"Bitir" **her zaman açık**; kalan > 0 ise **karar penceresi + sebep** zorunlu.

### C2 · "Bu işten çıkanlar" paneli (YENİ)
`WorkOrderOutputPanel.tsx` — top sayısı · **basılan** toplam metraj · barkodlar ·
saat:dk · yazdır · geri al. Backend süzgeci zaten vardı, yeni uç yazılmadı.

### C3 · Tarih sütunu + arşiv koruması
- **Üretim anı sütunu** (gün + saat, `createdAt`).
- **Arşiv topu okutulunca HİÇ AÇILMIYOR** — somut sebeple reddediliyor
  ("kesilerek tüketildi" / "fasona gitti" / "iptal edildi").

### B3 · "Son Çıkan Toplar" filtreleri (backend)
Hızlı tarih (bugün / son 2 / son 7 gün, **fabrika günü** sınırıyla) · serbest
aralık · iş emri · kalite · müşteri. Cursor sözleşmesi korundu.
- Bekçi: `test_recent_output_filters.ts` **15 kontrol** · gece vardiyası sondası
  kırmızı verdi.

### B4 · `Roll.labelCustomerId` (kısmi)
Kolon + partial index + etiket servisinde yazım + kesim yollarında yazım +
**dry-run geri doldurma script'i**. Uyuşmazlık motoru (B6) henüz yazılmadı.

### C4 · Mal kabul detayına üretim bilgisi (kısmi)
`getReceipt` **hedef renk + özellikler**le genişletildi (`workOrder: true`
ilişkileri getirmiyordu), `bornRolls`a `foldType` eklendi; mobil detay ekranına
mor "Üretim" bloğu kondu. **Hızlı İş Emri geçmişi ve fason kabul geçmişi
YAPILMADI.**

---

## ⏳ YAPILMADI

| # | İş | Neden |
|---|---|---|
| C3 | Toplu seçim + toplu müşteri değiştirme | Zaman |
| B6+A2 | Uyuşmazlık motoru + Electron uyarı yüzeyleri | Zaman (temeli `labelCustomerId` ile atıldı) |
| B1 | Ayarlanabilir boş grid bloğu | Zaman (dört kapı + 6 belge) |
| A1+C5 | Kişisel tercih (fasoncu varsayılanı) | Zaman |
| C4 | Diğer iki geçmiş yüzeyi | Zaman |
| T1+B2 | A5 dikey ortalama | **Ölçüm gerekiyordu, yapılamadı** — kodda dikey ortalayan kural YOK; kaynak yazıcı sürücüsü ya da print yolu. Kök neden bulunmadan CSS'e dokunmadım. |

---

## 📐 Ölçümler

- **T2 — `tambur.overQuantityEnabled` canlıda AÇIK** (kayıt yok → varsayılan
  `true`, `system-setting.service.ts:2057`). C1 için ek ayar gerekmiyor.
- **T3 — `getReceipt` ilişkileri GETİRMİYORDU.** `workOrder: true` yalnız skaler
  alan döner; hedef renk adı ve özellikler gelmiyordu → genişletildi.
- **T4 — Sahada 63 topun snapshot'ı var; 16'sı müşterili, 47'si stok etiketi.**
  Geri doldurma küçük ve güvenli (dry-run çıktısı doğrulandı).

---

## ⚠️ Yolda bulunan ve düzeltilen yan hasar

Yeni `roll_variances` FK'sı **RESTRICT** olduğu için **9 mevcut testin temizliği
kilitlendi** — toplar silinemiyor, dev DB'de birikiyor ve `test_consistency` §10
kırmızıya dönüyordu. Dokuz testin `cleanup`'ına `rollVariance.deleteMany`
eklendi, biriken 13 yetim fixture temizlendi, sızıntı **0**.

> Bu, tam da "yeni tablo eklerken görülmeyen" sınıftan bir hata: kendi testim
> yeşildi, kırılan başkalarının temizliğiydi. Tam paket koşulmasaydı sahaya
> kadar sessiz giderdi.

---

## 🚀 Deploy reçetesi

**Sıra:** migration → backend → Electron → APK.

### 1. Migration (4 yeni)
```
20260809015353_roll_variance_ledger
20260809020429_roll_pre_tambur_close
20260809021552_roll_variance_reversal
20260809023731_roll_label_customer
```
Hepsi **nullable kolon / yeni tablo** → metadata-only, tablo yeniden yazılmaz.
⚠️ Ağaçta bir de **başka oturuma ait** `20260809090000_roll_production_timestamps`
var (Kalite Karnesi işi) — o ayrı bir karar.

### 2. Yeni izin YOK
FULL geri alma **mevcut** `roll:manual-adjust` iznini kullanır.
⚠️ Bu izin sahada kimseye atanmamışsa **tümden geri alma hiç yapılamaz** —
Yetki Kataloğu ekranından kontrol et.

### 3. Yeni bayrak: `tambur.undoFullSameDayOnly`
Varsayılan **KAPALI** (davranış değişmez). Panelden açılabilir/kapatılabilir
(dört kapının dördü de bağlı, `test_feature_flag_contract` 15/15).

### 4. APK **ZORUNLU**
Mobil sözleşme değişti (sapma sebebi + geri alma modu). Eski APK **çalışır**
ama: sebep gönderemez (`BELIRTILMEDI` yazılır) ve otomatik bitiş hâlâ eski
davranışta kalır. **Backend + Electron + APK aynı pencerede.**

### 5. Geri doldurma (opsiyonel, sonra)
```
npx tsx scripts/backfill_roll_label_customer.ts          # kuru anlatım
npx tsx scripts/backfill_roll_label_customer.ts --apply
```

---

---

# 🌤 İKİNCİ TUR (backend + Electron grubu)

## C8 · Mobilde kâğıt boyu seçimi (A4/A5) + cihaz hafızası

Saha sorusu: *"mobilden belge çıkarırken A5 mi A4 mü seçebiliyor muyum?"*
Cevap **hayırdı** ve iki farklı sebeple:

| Belge | Önceki durum |
|---|---|
| Refakat kartı | Uç 2026-08-03'ten beri `?pageSize=` destekliyor — **mobil hiç göndermiyordu** |
| Fason çeki | Baskı-anı ezmesi **hiçbir istemcide yoktu**; boy yalnız kalıcı `DocumentConfig`'ten |

- **Backend:** `GET /printed-documents/:docType/:sourceId/html?pageSize=A4|A5`.
  Sözleşme refakat kartındakinin AYNISI — kalıcı ayarı **ve** donmuş snapshot'ın
  kendi boyunu ezer, **hiçbir yere yazılmaz**, yeni versiyon doğurmaz. Geçersiz
  değer sessizce yok sayılır (yazım hatası sahayı kâğıtsız bırakmasın).
- ⚠️ Ezme `style`i KOMPLE değiştirmez, **yayarak** yazar: aksi hâlde "A5 seç"
  demek belgenin kayıtlı kenar boşluğunu ve punto ölçeğini de sıfırlardı.
- ⚠️ Ezme **"güncel şablonla bas" dalından SONRA** uygulanır — taze config
  gelse bile operatörün bu baskı için seçtiği boy kazanmalı. TASLAK yolunda da
  geçerli (yoksa "taslakta A5 seçemiyorum" gibi açıklanamaz bir asimetri doğardı).
- **Mobil:** hafıza `deviceSettingsStore.docPageSize` — **BELGE TİPİ BAŞINA**.
  Kart doğal olarak A5, çeki grid'i A4; tek ortak hafıza ikisini birbirine
  ezdirir ve operatör her baskıda anahtar çevirirdi (`kk1ManualEntry`i cihaza
  taşıma gerekçesinin aynısı). **CİHAZDA** kalıcı, kullanıcıda değil: boy o
  istasyona bağlı YAZICININ özelliğidir, vardiya değişince yazıcı değişmez.
- ⚠️ **Rozet ÜÇ durumlu: `Ayar → A4 → A5 → Ayar`.** "Ayar" durumu load-bearing:
  mobil sunucudaki kalıcı ayarın ne olduğunu **bilmiyor**, dolayısıyla varsayılan
  olarak "A4" göstermek ayar A5 iken ekranın **yalan söylemesi** olurdu. Üçüncü
  durum hem dürüst hem geri dönülebilir. İki durumlu yapılırsa "kalıcı ayarı
  kullan" hâline bir daha ulaşılamaz.
- Kayıt yoksa istemci parametreyi **hiç göndermez** → bugünkü davranış birebir.
- Rozetin dokunma hedefi ≥44dp: eldivenli operatör ıskalarsa kartın baskı
  `onPress`'i tetiklenir ve **yanlışlıkla basar**.
- **Kapsam dışı (bilinçli):** Electron'un çeki önizlemesine seçici konmadı —
  kullanıcı kararı mobil odaklıydı; uç hazır olduğu için sonradan tek satırla eklenir.
- Bekçiler: `test_doc_pagesize_override.ts` (8 kontrol, negatif sonda kırmızı) ·
  mobil `docPageSize.test.ts` (6 kontrol, negatif sonda kırmızı).
- **Backend ÖNCE deploy, sonra APK.** Eski backend + yeni APK = `pageSize`
  sessizce yok sayılır (400 değil) — yani kırılmaz, sadece özellik çalışmaz.

## Kod incelemesi (2026-08-09, commit ÖNCESİ)

Kendi yazdığım koda, bekçilerin **göremediği** sınıflara odaklanarak bakıldı:
önizleme↔uygulama mutabakatı, izin geçitleri, N+1, Decimal, sözleşme kayması.
**Altı hata bulundu, altısı da düzeltildi ve bekçiye bağlandı.** Hepsi ölçümle
doğrulandı — hiçbiri akıl yürütmeyle bırakılmadı.

### Tambur geri alma (`tambur-undo.service.ts`) — üçü de aynı sınıf

Üçü de **"operatöre söylenen ≠ yapılan"**, yani bu dosyanın var olma sebebi olan
saha vakasının küçük kopyaları.

| # | Bulgu | Ölçüm |
|---|---|---|
| 1 | Önizleme ile uygulama **ayrı formül** kullanıyordu | diyalog "200 m", kod 500 m geri koydu |
| 2 | Yetkisiz kullanıcıya önizleme "yapılabilir" diyordu | uç 403 veriyordu |
| 3 | Uygulanamayan mod açıkça istenince **sessizce** diğerine düşülüyordu | "tümünü geri al" → bir parça iptal edildi |

- **Kök neden (1):** `preTamburCloseQty` **"kapanış anındaki `currentQty`"**dir —
  parçalı kesim akışında bu *kalan*dır, toplam değil. Önizleme onu "toplam"
  sanıyordu. Tek kaynak `computeRestoredQty` (önizleme + uygulama aynı fonksiyon).
- ⚠️ (2)'yi düzeltmek **403 → 409 kaymasına** yol açtı (yetki bloğu artık genel
  `canApply` dalına da yansıdığı için). Sıra düzeltildi: FULL'ün yetki kapısı
  genel daldan ÖNCE koşar. İstemci interceptor'ları 403'ü ayrı ele alıyor.
- **Yetki kapısı önizlemede, SEBEP kapısı yalnız uygulamada** koşar: yetki
  kullanıcının değiştiremeyeceği bir gerçektir, sebep aynı diyalogda doldurulur.
- Bekçi: `test_tambur_undo.ts` §8 (28 → **36 kontrol**); **üç negatif sonda** ile
  kırmızı verdiği doğrulandı.

### Uyuşmazlık motoru (`sack-content-mismatch.helper.ts`)

| # | Bulgu |
|---|---|
| 4 | Müşteri adı görünürlüğü **global bayraktı** → yanlış kırmızı |
| 5 | Çuval başına 5 seri sorgu (uç tavanı **200 çuval** = 1000 gidiş-dönüş) |
| 6 | `lastLabelSnapshot` JSON'u çekiliyor ama hiç kullanılmıyor (perf kuralı 13) |

- **(4) tam da motorun engellemek için var olduğu körleşmeydi:** karışık çuvalda
  bir müşterinin özel şablonu bayrağı açıyor, sonra **standart↔standart**
  karşılaştırma da "müşteri adı farklı" diye kırmızı yanıyordu — oysa o iki
  etiket birebir aynı çıkar. Görünürlük artık **şablon başına** çözülür.
- ⚠️ **İki taraf da varsayılan şablondaysa ad KARŞILAŞTIRILMAZ** (bilinçli
  muhafazakâr sınır): varsayılan şablonun elemanlarına bakmıyoruz, bilmediğimiz
  yerde susmak yanlış kırmızıdan iyidir.
- Ölçüm: sevkiyat başına en fazla **2 çuval** (ortalama 1,5) → (5) bugün acıtmıyor;
  tavan 200 olduğu sürece yine de kapatılmış bir açıktır.
- Bekçi: `test_sack_mismatch.ts` §7 (12 → **14 kontrol**).

> ⚠️ **§7'nin ilk hâli KÖRDÜ ve bunu yalnız negatif sonda gösterdi.** Fixture
> `labelTemplate.findFirst()` ile ortamdan şablon çözüyordu; bulunan şablon
> `customerName` basmadığı için eski (hatalı) ve yeni davranış **aynı** sonucu
> veriyordu → sonda kırmızı vermedi, test "doğru ama boşuna" yeşildi. Şablon
> artık testin kendisi tarafından üretiliyor. Ders (yazılı kuralın tekrarı):
> *ortamdaki veriye bağımlı fixture, bekçiyi sessizce süse çevirir.*

### Temiz çıkanlar

`roll-variance.helper` · toplu etiket ucu (izin/parçalı sonuç/arşiv reddi) ·
boş grid (dört kapı + kapalıyken tek bayt basılmıyor) · A5 punto ölçeği (A4
parmak izi korunuyor) · dört migration (hepsi metadata-only; `DropForeignKey`
satırları silinmiş, şema-dışı nesneler envantere yazılmış; `rolls` 452 satır →
index kurulumu ms, `statement_timeout` riski yok).

---

**Test:** backend **291/291 dosya** · Electron **73/73 (666 test)** · mobil
**50/50 (420 test)** · üç typecheck de temiz. (Backend 288 → 291: inceleme
sonrası, diğer oturumun rapor bekçileriyle birlikte.)

Kapsam: T1+B2 (A5) · B6+A2 (uyuşmazlık) · B1 (boş grid) · C3 (toplu etiket) ·
A1+C5 (kişisel tercih). **13 MADDENİN TAMAMI KAPANDI.**

> ⚠️ Bir kez `test_backup.ts` kırmızı verdi; tek başına 92/92 geçiyor ve yüksüz
> paket koşumu 288/288 temiz — Electron paketiyle eşzamanlı koşarken `pg_dump`
> alt süreçlerinin zaman aşımına uğramasından kaynaklı flake.

## T1+B2 · A5 — ölçüldü, kök neden bulundu, düzeltildi

**Dikey ortalama YOK.** Gerçek veriyle üretilen A5 PDF **420×595 pt = tam A5**,
tek sayfa, içerik tepe payından başlıyor (`firstTop` = body 14px + sheet 30,2px).
Ekran ve baskı yollarının ikisi de `display:block`, hizalama `normal`.
**Belge doğru** — fiziksel baskıda ortalanıyorsa kaynak yazıcı sürücüsü ya da
kâğıt uyuşmazlığıdır (A5 sayfa A4 kâğıda basılırken sürücü ortalar).

**Ama ölçerken GERÇEK bir A5 hatası çıktı ve düzeltildi:** panelde elle girilen
**sayısal punto yoğunluk profilini ATLIYORDU**. Sahadaki kayıtlı ayar
(`batchNumber: px 27` + `fontScale 1.15`) A4'te 31,05px — bilinçli ve okunur;
A5'te de **aynı 31,05px** kalıyor, 132mm alanda uzun parti no üç satıra sarıp
sayfanın dörtte birini yiyordu.

⚠️ Kod yorumu bu tuzağı **kademe** (sm/md/lg) sistemi için yazmış:
*"A5'te taban 8px iken 'lg' hücrenin A4'ün 14px'i olması kartı taşırırdı."*
2026-08-05'te panel sayısal px'e geçince o koruma delinmiş.

- Düzeltme: `PX_SCALE` (A4 = 1, A5 = 8/9,5 ≈ 0,842) → 27px A5'te 22,74px.
- **A4 çıktısı BAYT-BAYT aynı** (gerçek veriyle diff'lendi).
- Bekçi: `test_traveler_card_a5_batches.ts` §PX (45 kontrol) · negatif sonda kırmızı verdi.

## B6+A2 · Çuval içeriği uyuşmazlık uyarıları

Motor: `services/helpers/sack-content-mismatch.helper.ts` (salt-okunur, **hiçbir
şeyi engellemez**). Uç: `POST /api/shipping/sacks/mismatch-check` (READ izni).

**Kural — düz müşteri karşılaştırması YAPILMAZ.** Sorulan şey:
*"bu topun etiketi, gideceği müşteri için bugün basılsaydı İÇERİĞİ farklı çıkar
mıydı?"* → şablon rotası · kumaş/renk alias'ı · (etikette basılıyorsa) müşteri adı.

⚠️ **Bekçi kendi motorumun tasarım hatasını yakaladı:** ilk yazımda müşteri adını
koşulsuz karşılaştırıyordum ve adlar tanım gereği hep farklı olduğu için **her
farklı-müşteri topunda kırmızı yanıyordu** — tam da önlenmek istenen körleşme.
Düzeltme: ad yalnız şablon onu gerçekten **basıyorsa** sayılır
(`collectBoundKeys`). Bu, ekrandaki mevcut `StaleLabelsBanner`'ın yazılı
gerekçesiyle de birebir aynı: *"Etikete müşteri adı basılmadığı için 'müşteri
değişti' tek başına etiketi geçersiz kılmaz."*

Dört sinyal: 🔴 etiket farklı çıkardı · ⚪ başka müşteri için üretilmişti (bilgi) ·
🔴 2. kalite (A1) müşteri çuvalında.
Yüzeyler: **Çuval İçerik Düzenleme** bandı + **Sevkiyat Kurma** özeti.
Bekçi: `test_sack_mismatch.ts` (12 kontrol) · iki negatif sonda kırmızı verdi.

## B1 · Ayarlanabilir boş grid — TÜM belgelerde, opt-in

Saha isteği "kurşuncular için tablo koy" diye başladı; istenen **genel bir yapı**
çıktı: satır/sütun sayısı, sütun genişlikleri, başlık ve sütun başlıkları — hepsi
ayrı ayrı opsiyonel, tamamı boş bırakılabilir.

- **Sekiz belge renderer'ının hepsinde** (`docBlocksHtml` deseniyle, iki çıpa:
  başlıktan sonra / imzalardan önce).
- ⚠️ **Kapalıyken TEK BAYT basılmaz** (ne HTML ne CSS) — ayarına dokunulmamış ve
  donmuş belgelerin çıktısı bayt-bayt korunur.
- ⚠️ **DÖRT KAPI da bağlandı:** `DocumentConfig` tipi · `sanitizeDocumentsConfig`
  kayıt kapısı · `docConfigSchema` önizleme şeması · Electron aynası + panel.
  Üçü için **ayrı ayrı negatif sonda** koşuldu, üçü de kırmızı verdi.
- Sınır sözleşmesi fason çekiyle aynı: aralık dışı **kırpılır**, sayı olmayan
  değer **varsayılana düşer** (baskı yolu yazım hatası yüzünden düşmez).
- Gerçek belgeye basılıp **PDF'te görsel doğrulandı** (sevk irsaliyesi, "KURŞUN
  KAYDI" 4 sütun 40/20/20/20, imzaların üstünde).
- Bekçi: `test_blank_grid.ts` (31 kontrol).

## C3 · Toplu seçim + toplu müşteri değiştirme

*"Son çıkan etiketleri toplu seçim yapıp etiketleri çıkarabilelim, istersek toplu
müşteri de değişebilelim."* Akış (kullanıcı kararı): **seç → "Kime?" sor →
hepsine yaz → hepsini bas.** Ayrı "müşteri değiştir" butonu YOK — "değiştirdim
ama basmayı unuttum" durumu doğmasın.

- Yeni uç: `POST /api/labels/rolls/seed-snapshot-bulk` (tavan `bulk-html` ile aynı).
- ⚠️ **Sonuç PARÇALIDIR ve atlanan YUTULMAZ:** her atlanan top **barkodu ve somut
  sebebiyle** döner, ekran toast'ta gösterir. Tek transaction DEĞİL — hepsi-ya-hiç
  yanlış semantiktir (`kursun-bypass.assignBulk` ile aynı gerekçe).
- Arşiv topu reddedilir (tarama yolundaki korumayla aynı kural).
- ⚠️ **Karışık spec'li seçimde SİPARİŞ KALEMİ hedefi kapatılır** — kalem tek bir
  spec'e aittir; farklı spec'li toplara yazmak sessizce yanlış tahsis üretirdi.
  O durumda yalnız müşteri/stok seçilir ve sebebi ekranda yazar.
- Baskı için **yeni toplu yol yazılmadı** — ekranın kanıtlanmış tekil baskı
  kuyruğu (`pendingPrintRolls`) kullanılıyor.
- Bekçi: `test_label_bulk_seed.ts` (12 kontrol) · iki negatif sonda kırmızı verdi.

## A1+C5 · Kişisel tercih: fasoncu varsayılanı

*"Son seçilen fasoncu otomatik gelsin; favori geliyor şu an da."* Kullanıcı
kararı: **açılır-kapanır KİŞİSEL tercih** (Ayarlar → Çalışma Tercihleri).

- Electron **ve** mobil AYNI tercih blob'unu (`UserPreference.workOrders`) okur —
  kullanıcı hangi cihazdan bakarsa baksın aynı davranışı görür.
- ⚠️ **Varsayılan `favorite` = bugünkü davranış.** Yeni davranışı varsayılan
  yapmak sahadaki herkesin alışkanlığını habersiz değiştirirdi.
- ⚠️ `lastUsed` seçiliyken geçmiş YOKSA **favoriye düşülür** — yeni bir
  kategoride "hiçbir şey gelmiyor" olmasın.
- ⚠️ Hafıza **tercih kapalıyken de yazılır**: anahtarı sonra çeviren kullanıcı
  boş bir geçmişle karşılaşmasın. Kategori bazında tutulur (rota bazında değil —
  aynı boyahane farklı rotalarda kullanılıyor).
- Favori kavramı **kaldırılmadı**; yıldız listede ve sıralamada duruyor.
- Bekçi: `subcontractorDefault.test.ts` (7 kontrol).

---

## 🔴 Hâlâ senden bekleyen

~~**Saha sorusu:** 14 top fiziksel olarak duruyor mu?~~ → **KAPANDI (2026-08-09):**
kullanıcı *"sahadaki hasar şu an önemli değil, o test verisiydi"* dedi.
**Bölüm 13 (hasar onarımı) DÜŞÜRÜLDÜ.**

⚠️ **Ama KOD HATASI gerçekti** ve düzeltmeleri yerinde duruyor: aynı kod canlı bir
topa da `currentQty > initialQty` yazardı, aynı tek dokunuşla 14 top iptal ederdi
ve depo kesimlerinde operatörü aynı çıkmazda bırakırdı. Hasarın test verisinde
oluşmuş olması, hatanın gerçekliğini değiştirmez.

