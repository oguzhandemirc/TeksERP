# Backend `2.16.7`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip). Öncü/genel gruba çıkış ayrı karar (terfi etiketi). Kullanıcı onayı (deneme
dağıtımı): 2026-11-18 ("sürüm çıkar, canlıdan göreyim").
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.6 (etiket `backend-v2.16.6` →
`b77e5a746`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Fason devere baştan sona: çok iplikli çözgü kartı, Çözgü Hesabı ekranı, Fason Devere Siparişi (iplik sevki, iade,
siparişler arası aktarma, devere talimatı, dönen levent kabulü, kapanış ve yeniden açma), Fasondaki İplik ekranı ve mal
kabulde ipliği tedarikçiden doğrudan devereciye gönderme. Web panelinde lisansta kapalı modüller artık menüde, kutucukta
ve adres çubuğunda görünmez. **8 göç** (yeni tablolar, mevcut tablolara boş kolon; tek geri doldurma yeni tabloya).

## 2. Ne değişti

Ölçüm: `backend-v2.16.6` (`b77e5a746`) → `origin/main` @ `9bf382636`, ilk ebeveyn hattında 24 PR (#739–#762).
Alt proje farkı: `Teks-Erp/src` · `Teks-Erp/prisma` (8 göç) · `Teks-Erp/scripts` (bekçiler) · `Electron` (web paneli
imajın `/app/dist-web` dizinine girer) · `mobil` (tablet; ayrı paket, bu yayına girmez) · `patron/uygulama` (ayrı
dağıtım) · belge.

**Çok iplikli çözgü kartı (#746, #748, #749)** — Çözgü kartına birden çok iplik satırı (iplik + tel adedi) girilir;
kartın ana ipliği ve toplam teli satırlardan türer. İsteğe bağlı dizilim notu (`sequenceNote`, en çok 160 karakter).
Mevcut her kart göçte tek satırlı karta dönüşür (ana iplik, toplam tel). Levent doğumunda iplik kırılımı (tel, denye,
kuramsal kg) satır satır kaydedilir.

**Çözgü Hesabı (#746, #751)** — Kart, levent sayısı ve boyundan iplik başına kg ihtiyacını hesaplayan ekran (fire
payı dahil). Ayarlar: sabit çözgü firesi (m).

**Fason Devere Siparişi (#747, #750, #752, #754, #755, #756, #757, #758, #760, #761, #762)** — Yeni ekran
(Operasyon → Fason Devere Siparişleri):
- Sipariş: devereci, kart(lar), levent satırları (adet × boy), ücret birimi (metre / kg / tel·metre), müşteri siparişi
  bağı. İptal ayrı yetki.
- İplik sevki: siparişe iplik gönderilir; iptal son sevkten geriye (ters kayıt). Lot karışımı kuralı ayarlanır
  (serbest / uyar / tek lot).
- İade ve aktarma: deverecideki ipliğin geri alınması, bir siparişten ötekine aktarma; kalan iplik sonraki siparişe
  devreder.
- Devere talimatı: sipariş için yazdırılabilir talimat.
- Levent kabulü: dönen leventler irsaliye numarasıyla kabul edilir; iplik kullanımı leventlere dağılır; kabul geri
  alınabilir; kabul ↔ sevk mutabakatı görünür.
- Kapanış: kalan iplik iade / fire / deverecide kalır seçenekleriyle kapatılır; fire defteri tutulur; fire toleransı
  ayarlanır (0 = denetim yok); yeniden açma ters kayıtla, ayrı yetki.

**Fasondaki İplik (#759)** — Deverecilerde hangi iplikten ne kadar durduğunu gösteren ekran; kartlarda özet.

**Mal kabulde doğrudan devere (#753)** — Mal kabul sırasında iplik tedarikçiden doğrudan bir Fason Devere
Siparişine gönderilir; depoya girmeden devereci hesabına yazılır.

**Lisansta kapalı modüller (#745)** — Web panelinde lisansın kapattığı modüller menüden, ana sayfa kutucuklarından ve
doğrudan adresten gizlenir.

**Tablet (#743, #744; ayrı paket — bu yayına GİRMEZ, bilgi için)** — Telefonda/dikey girişte harfli parola yazılabiliyor;
yalnız tablete özel ekrandan çıkınca yatay kilit bırakılıyor.

**Patron uygulaması (#739, #741, #742; ayrı dağıtım)** — bildirim girişi tek kompakt kart, cihaz denemesi düzeltmeleri,
ray animasyonunda içerik bozulmaması. Bulut kaydı #740 (§13i).

Yeni izinler: `warping-order:read`, `warping-order:write`, `warping-order:cancel`, `warping-order:settle` (atama
panelde; mevcut rollere göç yazmaz). Ekranlar `devereEnabled` modülünün arkasında.

`tekserp-guncelleyici`, `tekserp-hizmet`, `Teks-Erp/native`, `Teks-Erp/docker`, `deploy/pg`, `deploy/node-surumu.json`,
`deploy/dagitim.json`, `deploy/kanallar.json` DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.6..9bf382636`).
  - Uçlar yalnız EKLENDİ (`/api/warp-plan`, `/api/warping-orders` ailesi); kaldırılan uç yok.
  - Çözgü kartı yanıtı `yarns` satırlarını EK taşır; `yarnItem`, `yarnItemId`, `endsCount` korunur. Gövdede `yarns`
    verilirse satır kümesini değiştirir; verilmezse eski tek iplikli yazım aynen çalışır.
  - Mal kabul gövdesine isteğe bağlı doğrudan devere alanı eklendi; verilmezse davranış aynı.
  - Buluta giden tel ve projeksiyonlar değişmedi; bulut önce şartı YOK.
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): yeni ekranları bilmez; çözgü kartını tek iplikli gösterir ve yazar. Web paneli imajla
    birlikte yenilenir.
  - Tablet: etkilenmez.
  - Patron uygulaması: etkilenmez.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni ayarlar (`devereWarpFixedWasteM`, `devereFasonWasteTolerancePct`,
  `devereFasonLotPolicy`) varsayılanla bugünkü davranışı korur.

## 4. Migration

- **Var mı:** EVET, 8:
  - `20261117161624_warp_spec_yarns` — yeni tablo `warp_spec_yarns` + `warp_specs.sequenceNote` (boş kolon); her mevcut
    karttan TEK satır geri doldurma (`WHERE NOT EXISTS`, yeniden koşulabilir).
  - `20261117172259_warping_orders` — `warping_orders` ve alt tabloları, iki enum.
  - `20261117190000_warp_beam_event_yarns` — levent doğum kırılımı tablosu + geçmiş doğumlardan geri doldurma (yeni
    tabloya).
  - `20261117233000_warping_dispatch_header` — `subcontractor_dispatches.clientToken` (boş) + başlık CHECK'i genişletildi.
  - `20261118010000_goods_receipt_direct_warping` — `goods_receipts.directWarpingOrderId`,
    `subcontractor_dispatches.goodsReceiptId` (boş kolonlar) + CHECK.
  - `20261118010000_warping_yarn_transfers` — aktarma defteri tablosu. (Önceki göçle AYNI zaman damgası; ikisi de
    uygulanır, sıra ada göre.)
  - `20261118030000_warping_receive` — `warp_beam_events.deliveryNoteNo`, `warp_beams.warpingOrderId` (boş) +
    `warp_beam_yarn_allocations`.
  - `20261118050000_warping_settlement` — `warping_order_settlements`, `warping_yarn_wastes`.
- Mevcut satırların değeri değişmez; geri doldurmalar yalnız YENİ tablolara yazar.
- **Toplam migration:** 527 (2.16.6: 519). Değiştirilen/silinen eski göç yok; veri değiştiren betik yok.
- **Geri alınabilir mi:** göç geri alınmaz; 2.16.6 imajı yeni tablo/kolonları okumaz, aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend (web paneli imajla birlikte) → masaüstü panel ve tablet bağımsız. Bulut önce şartı yok.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Yeni ekranlar için rolde
  `warping-order:*` izinleri ve `devereEnabled` modülü gerekir.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: Fason Devere ekranları kullanılmazsa hiçbir kayıt doğmaz; kapalı modül menüsü lisanstan yönetilir. Sürüm:
güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür
(`GERI_DONDU`). Göçler ekleme olduğundan 2.16.6 imajı aynı şemayla açılır; yine de grupta geri inme yok, düzeltme
ileri sürümle. Etiket `backend-v2.16.7` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.7; güncelleyici durumu `BASARILI`.
- Veritabanı: 527 migration bitmiş, yarım/geri alınmış 0; aynı damgalı iki göç (`20261118010000_*`) ikisi de var.
- `GET /api/feature-flags` 200; `GET /api/warping-orders?limit=1` 200 (izinli kullanıcıyla).
- Web paneli kökü 200; paket "Fason Devere" ekranını taşır.
- Lisans bloğu (`kapaliModuller`) kurulumdan önceyle aynı.
- Konteyner günlüğünde göç / açılış hatası yok.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 24)

- `3cc10f86d` #739 fix(patron-app): bildirimler girişi tek kompakt kart
- `ddb2f60af` #740 docs(patron-bulutu): §13i yükseltme kaydı — `c8ca00c62547`
- `d04d6bfb7` #741 fix(patron-app): device-test UI fixes (KPI grid, on-time, a11y label, trend sign)
- `b421c0fd0` #742 fix(patron-app): keep content intact while the rail animates
- `d07622448` #743 fix(mobil): allow alphanumeric password in portrait/phone login
- `63abda970` #744 fix(mobil): release landscape lock when leaving tablet-only screens
- `dda704064` #745 fix(electron): hide license-closed modules from menu, tiles and routes
- `6a2153d17` #746 feat(devere): warp plan engine + multi-yarn warp spec schema (D1)
- `4ee9c1158` #748 feat(devere): warp beam birth yarn breakdown + single reader for warp spec yarns (D2)
- `aae9d547b` #747 feat(devere): fason warping order schema + CRUD (D4a)
- `0ff9c5283` #749 feat(devere): multi-yarn warp spec write surface + card form (D3a)
- `c94e7a4be` #751 feat(devere): warp plan calculator screen (D3b)
- `4f8e7af2e` #750 feat(devere): yarn dispatch to warping orders, LIFO cancel, lot policy (D4b-1)
- `29513af6f` #752 feat(devere): yarn return, cross-order transfer ledger, carry-over balance (D4b-2)
- `bd319540c` #753 feat(devere): direct supplier-to-warper yarn receipt (D4c)
- `b607ce063` #754 feat(devere): receive returning beams from warping subcontractor (D5a)
- `80e18c404` #756 feat(devere): D6-be read endpoints — order dispatches, returns, named holdings
- `237313d5c` #755 feat(devere): panel warping order list, page, create/edit and cancel (D6a)
- `ffb12c606` #757 feat(devere): settle warping orders, waste ledger and reopen (D5b)
- `59668f17e` #759 feat(devere): yarn-at-subcontractor screen and card summaries (D6c)
- `454b8d67c` #758 feat(devere): warping order dispatches, dispatch cancel, warp instruction print (D6b-1)
- `fd1be591e` #760 feat(devere): warping order yarn holdings, returns, transfers (D6b-2)
- `d23327f89` #761 feat(panel): devere D7a — beam receipt, receipts + reconciliation, receipt undo
- `9bf382636` #762 feat(panel): devere D7b — settlement, settlement history, reopen

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel / tablet turunda `surum-notlari.json`a girer. Metin
terfide kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-18",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Fason devere",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Çözgü kartına birden çok iplik girebilirsiniz; ana iplik ve toplam tel satırlardan hesaplanır. Mevcut kartlarınız aynen durur." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Çözgü Hesabı: kart, levent sayısı ve boyunu girin; her iplikten kaç kg gerektiğini fire payıyla birlikte görün." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Fason Devere Siparişi: devereciye iplik gönderin, geri alın, siparişler arasında aktarın, talimatı yazdırın, dönen leventleri kabul edin ve siparişi kalan iplikle birlikte kapatın." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Fasondaki İplik ekranı: hangi deverecide hangi iplikten ne kadar durduğunu tek yerde görün." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Mal kabulde gelen ipliği depoya almadan doğrudan bir devere siparişine gönderebilirsiniz." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Lisansınızda kapalı olan bölümler artık menüde ve ana sayfada görünmüyor." },
    { "kapsam": "tablet", "tip": "duzeltme", "metin": "Telefonda ve dikey ekranda harfli parolayla giriş yapılabiliyor; tablete özel ekrandan çıkınca ekran yeniden dönebiliyor." }
  ]
}
```
