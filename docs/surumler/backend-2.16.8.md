# Backend `2.16.8`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip). Öncü/genel gruba çıkış ayrı karar (terfi etiketi). Deneme dağıtımı görevi:
2026-11-19 ("deneme sunucusunu main'in son haline güncelle").
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.7 (etiket `backend-v2.16.7` →
`26b7a0bce`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Fason devere planlama bağı: üretim ihtiyacından (kumaş metresi, dokuma iş emri, müşteri siparişi) devere siparişi
önerisi; Fason Kokpitinde "Devere gecikmeleri" bandı; iplik ihtiyacında "Deverecide" sütunu. "Admin (Tam Yetki)"
şablonuna eklenen yeni izinler şablona bağlı kullanıcılara açılışta yayılır. Sunucu mesajlarında sayılar Türkçe
biçimde; seçici ve "hepsini yükle" okumalarında sessiz kesilme giderildi. **Göç yok.**

## 2. Ne değişti

Ölçüm: `backend-v2.16.7` (`26b7a0bce`) → `origin/main` @ `a1070e21f`, ilk ebeveyn hattında 11 PR (#764–#774).
Alt proje farkı: `Teks-Erp/src` · `Teks-Erp/scripts` (bekçiler) · `Electron` (web paneli imajın `/app/dist-web`
dizinine girer) · belge. `Teks-Erp/prisma` DEĞİŞMEDİ.

**Devere planlama bağı (#769)** — Yeni salt okuma ucu `GET /api/warp-plan/need?source=FABRIC|WEAVING_ORDER|ORDER`
(`warpspec:read`, devere modülü kapısı): talep → çözgü kartı başına gereken metre (take-up dahil) − arz (stok/planlı
levent + açık devere siparişinin dönmemiş metresi) = eksik ve levent adedi × boy önerisi. Panel: Çözgü Hesabında
"İhtiyaçtan → devere önerisi" sekmesi, dokuma iş emri panelinde "Çözgü ihtiyacı" bölümü, üretim önerisinden "Fason
devere önerisi" bağı; "Devere siparişi aç" formu dolu açılır.

**Devere gecikmeleri ve deverecideki iplik (#772)** — Yeni uç `GET /api/warping-orders/delays`
(`warping-order:read`, devere kapısı): açık devere siparişleri etkin termine göre (geciken · 2 gün içinde · terminsiz).
Panel: Üretim → Fason Kokpiti'nde özet şeridinin altında "Devere gecikmeleri" bandı (yalnız devere açık ve izin varsa).
İplik ihtiyaç planına "Deverecide (fasonda)" sütunu ve isteğe bağlı "Deverecideki ipliği düş" parametresi
(`deverecideDus`, varsayılan düşmez — çift sayım olmasın diye).

**Tam Yetki izin yayılımı (#765, #766)** — Açılış uzlaştırması "Admin (Tam Yetki)" (`ADMIN_FULL`) şablonuna YENİ izin
eklediğinde, şablonun önceki SoD dışı bütün izinlerine süresiz sahip kullanıcılara da yazar (aynı tx; yeni advisory
kilit uzayı 8049; kullanıcı × izin başına audit `ADMIN_FULL_AUTO_SPREAD`). SoD izinleri yayılmaz. Geriye dönük
DEĞİL: 2.16.7'de şablona girmiş dört `warping-order:*` izni denemedeki `admin` kullanıcısına bu sürümle gelmez.

**Sayı biçimi (#767, #771, #774)** — Devere, levent ve diğer kullanıcıya dönük sunucu mesajlarında miktarlar ortak
`qty-text` yardımcısıyla Türkçe biçimde (ondalık virgül, binlik nokta). Hizmet faturası sevk kilitleri ayrı yardımcıya
taşındı (davranış aynı).

**Seçici tavanları (#768, #770, #773)** — Devere depo seçicisinde iplik stokları, lot ve hazır levent seçicileri ve
hazır işler "hepsini yükle" okumaları imleç sonuna kadar sayfalanır; tavanda sessiz kesilme yok.

Yeni izin yok. Yeni bayrak yok. Yeni ayar yok.

`tekserp-guncelleyici`, `tekserp-hizmet`, `Teks-Erp/native`, `Teks-Erp/docker`, `Teks-Erp/prisma`, `deploy/`
DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.7..a1070e21f`).
  - Uçlar yalnız EKLENDİ (`/api/warp-plan/need`, `/api/warping-orders/delays`); kaldırılan uç yok.
  - İplik ihtiyaç planı yanıtı `deverecideKg` / `deverecideEmanetKg` / `meta.kaynaklar.deverecide` / `meta.deverecideDus`
    alanlarını EK taşır; devere ya da iplik kapalıyken yanıt bayt-eşit.
  - Buluta giden tel ve projeksiyonlar değişmedi; bulut önce şartı YOK.
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): yeni uçları çağırmaz; iplik ihtiyacında yeni sütunu sunucu sunumundan çizer, bandı ve
    rozeti göstermez. Web paneli imajla birlikte yenilenir.
  - Tablet: etkilenmez.
  - Patron uygulaması: etkilenmez.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 527 (2.16.7 ile aynı).
- Açılış uzlaştırması (göç değil) yalnız yeni `ADMIN_FULL` izni doğduğunda kullanıcı izni ekler; bu sürümde katalogda yeni
  izin olmadığından denemede yayılım beklenmez.
- **Geri alınabilir mi:** şema aynı; 2.16.7 imajı aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend (web paneli imajla birlikte) → masaüstü panel ve tablet bağımsız. Bulut önce şartı yok.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Gecikme bandı için rolde
  `warping-order:read` ve `devereEnabled` modülü gerekir.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: yeni uçlar salt okumadır, kayıt doğurmaz. Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve
güncelleme öncesi yedeğe kendiliğinden dönülür (`GERI_DONDU`). Göç olmadığından 2.16.7 imajı aynı şemayla açılır;
yine de grupta geri inme yok, düzeltme ileri sürümle. Etiket `backend-v2.16.8` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.8; güncelleyici durumu `BASARILI`.
- Veritabanı: 527 migration bitmiş, yarım/geri alınmış 0 (kurulumdan önceyle aynı).
- `GET /api/feature-flags` 200; `GET /api/warping-orders/delays` ve `GET /api/warp-plan/need` 404 DEĞİL (izinsizse 403).
- Web paneli kökü 200; paket "Devere gecikmeleri" metnini taşır.
- Lisans bloğu (`kapaliModuller`) kurulumdan önceyle aynı.
- Konteyner günlüğünde açılış hatası yok.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 11)

- `dd7233fb8` #764 docs(archive): record deneme backend 2.16.7 install
- `0504ff53b` #765 feat(yetki): spread new ADMIN_FULL permissions to bound users at boot
- `6ba2fb106` #766 docs(yetki): note ADMIN_FULL spread exception to boot reconcile rule
- `0e6de4164` #767 fix(devere): format numbers in warping messages the Turkish way
- `2ff8f3047` #768 fix(panel): page through yarn stocks in warping warehouse picker
- `beb137ba8` #769 feat(devere): warp need to fason warping order suggestion (D8)
- `bf1490028` #770 fix(panel): load lot and ready-beam pickers to the end of the cursor
- `6b6d0140b` #771 fix(dokuma): format warp beam message numbers with the shared qty helper
- `d53f5e4cf` #772 feat(devere): D8b — iplik ihtiyacında deverecideki iplik + kokpitte devere gecikmeleri
- `092301c4d` #773 fix(panel): stop silent truncation in ready-works load-all reads
- `a1070e21f` #774 fix: format quantities in user-facing server messages via qty-text helper

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel / tablet turunda `surum-notlari.json`a girer. Metin
terfide kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-19",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Devere planlama ve gecikmeler",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Kumaş metresi, dokuma iş emri ya da siparişten ne kadar çözgü gerektiğini görün; eksik için devere siparişini tek tıkla dolu açın." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Fason Kokpitinde Devere gecikmeleri bandı: termini geçen, iki gün içinde dolan ve terminsiz devere siparişleri." },
    { "kapsam": "panel", "tip": "yeni", "metin": "İplik ihtiyacında deverecide duran iplik ayrı sütunda görünür; isterseniz eksikten düşebilirsiniz." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Tam Yetki şablonuna yeni bir yetki eklendiğinde bu şablonla tam yetkili kullanıcılara da kendiliğinden açılır." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Uyarı ve hata mesajlarındaki miktarlar Türkçe biçimde yazılır (ör. 1.250,5 kg)." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "İplik, lot ve hazır levent seçicileri ile hazır işler listesi artık kayıtların tamamını getirir." }
  ]
}
```
