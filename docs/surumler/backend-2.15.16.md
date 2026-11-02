# Backend `2.15.16`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (üyesi tek kurulum: bulut deneme sunucusu;
fabrika yok); öncü/genel gruba çıkış ayrı karar (terfi etiketi).
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki sürüm 2.15.15 (etiket `backend-v2.15.15` → `77b790179`). Güncellenecek
her kurulumda sahadaki sürüm kurulumdan önce sağlık bilgisinden okunur.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

Gelen belge (irsaliye/çeki listesi) okuma iyileştirmeleri ve okuma uyarılarının panel/tablette görünmesi, onaydan
sonra kendiliğinden açılan iş emri için rota önerisi zinciri, tablet okuma özeti ucu, yönetim bulutunun reddettiği
günlük özetin yeniden denenmesi, giriş düzeltmeleri. Göç yok; yeni ayarların hepsi bugünkü davranışla doğar.

## 2. Ne değişti

Ölçüm: `backend-v2.15.15` (`77b790179`) → `origin/main` @ `3f9215925`, ilk ebeveyn hattında 36 commit (#431–#466).
Alt proje farkı: `Teks-Erp/src` 45 dosya · `Electron/src` 147 dosya (web paneli imajda) · `mobil/src` 24 dosya
(tablet yayını ayrı; #442 native) · `okuma/` 12 dosya (okuma hizmeti backend imajına GİRMEZ) · `patron/`, `satici/`,
`deploy/` değişmedi.

**Gelen belge okuma** — #435 (yan çekilmiş sayfa kendiliğinden döner; okuma hizmeti), #437 (üst üste binen sayfa
çekimlerinde yinelenen satır atlanır), #445 (HEIC/HEIF yükleme okuma hizmetiyle dönüştürülür + panelde sürükle-bırak),
#448 (blok başına iş kimliği; tablosuz ürün sevk fişinden tek satır; el yazısı şüpheli değer uyarısı), #461 (silinen
taslağın fotoğrafı yeniden yüklenince saklı okumadan satır kurulur; boş sayfa yeniden okunur; foto yüklenen elle
taslak "OCR" kaynağına geçer), #462 (okuma uyarıları detayda ve tablet özetinde TEK listeden; ikinci belge izi;
el yazısı şüphe oranı ayarı), #463 (yalnız şüpheliyi engelleyen onay kapısı seçeneği, şablondan gönderen, tablosuz
fişte metre kaynağı, aynı parti bilgisi), #465 (varsayılan ürünle girecek satır sorunlu sayılmaz; çeki listesi
başlığındaki "Müşteri MT" belge toplamı beyanı; şüpheli hücre vurgusu), #466 (toplam kapısı iletilerinde Türkçe
sayı biçimi).

**Gözden geçirme ve liste** — #440 (taslak toplu silme: önizleme + kayıt başına seçim; satır sağ tık menüsü),
#439 (taranan sayfada yakınlaştırma/kaydırma/döndürme), #451 (onay kapısının yüklemleri tek kaynak; "yalnız sorunlu
satırlar" süzgeci + blok başına toplam fark şeridi).

**Otomatik iş emri ve rota** — #441 (onaydan sonra iş emri kendiliğinden açılır; fabrika ayarı, varsayılan KAPALI),
#450 (rota önerisi zinciri: son iş emri → müşterinin tek rotası → fabrika varsayılan rotası; öncelik ayarı).

**Tablet okuma özeti ucu** — #449. Yeni salt okuma ucu `GET /api/gelen-belge/irsaliyeler/:id/okuma-ozeti`
(`gelen-belge:write`); durum ve Türkçe neden sunucuda türetilir. Tablet tarafı tablet yayınıyla gelir.

**Liste standardı (yalnız web paneli)** — #446, #447, #453, #454, #457, #458: liste sayfaları tam genişlik düzeni.

**Yönetim bulutu eşitlemesi** — #455. Bulutun reddettiği GÜNLÜK özet artık "gün tamam" sayılmaz; yalnız reddedilen ad
1 → 2 → 4 → 8 sa geri çekilmeyle yeniden gönderilir; günlükte reddedilen projeksiyon ve bulut kodu adıyla yazılır.
Yeni projeksiyon ya da tel şeması değişikliği YOK (`projections.ts`, `wire/esitleme.ts` farksız) → bulut önce
yükseltilmez.

**Giriş** — #431 (`USER_CHOICE` politikasında TOTP kurmamış kullanıcı kilitlenmez; kurulum = katılım), #433 (yönetici
parola sıfırlamasında "ilk girişte değiştirsin" isteğe bağlı, `requireChange` varsayılan true; parola değiştirme
isteğine 30 sn süre).

**Küçükler** — #443 (toplu silme penceresi uzun adlarda taşmaz), #452/#438/#459/#460/#464 (CI ve test düzeltmeleri;
ürün davranışı yok).

**Güncelleyici ve hizmet konağı** — `tekserp-guncelleyici` 0.2.9, `tekserp-hizmet` 0.2.1 DEĞİŞMEDİ
(`scripts/test_guncelleyici_surum.mjs` yeşil, taban `backend-v2.15.15`). `deploy/pg`, `deploy/node-surumu.json`,
`deploy/kanallar.json`, `deploy/dagitim.json` değişmedi.

`dist-web` (web paneli) imaja girer; masaüstü panel paketi bu turda YOK.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Uç kaldırma yok; yeni uçlar (`okuma-ozeti`, `toplu-sil/onizleme`, `toplu-sil`); var olan
  yanıtlara yalnız ek alan (`notices`, `totalsCheck`, satır `problems`/`itemFallback`, `sameBatch`, ayar görünümündeki
  yeni alanlar); `reset-password` gövdesine isteğe bağlı `requireChange` (yoksa bugünkü davranış). Yeni 409
  `DELIVERY_NOTE_SUSPECT_PENDING` yalnız `BLOCK_SUSPECT` seçilince doğar.
- **Eski istemci ne yapar:**
  - Masaüstü panel (yayındaki): yeni ayarları ve toplu silmeyi görmez; onayda yeni 409 kodlarını genel hata iletisiyle
    gösterir. Web paneli imajla birlikte güncellenir.
  - Tablet 1.4.3: okuma özeti ucunu çağırmaz, etkilenmez. Yeni tablet ucu çağırıp eski backend'den 404 alırsa
    "panelden izleyin" der.
  - Patron bulutu, satıcı: etkilenmez.
- **`minVersion` dokunuldu mu:** hayır — `Teks-Erp/src/config/client-version-policy.ts` `backend-v2.15.15`e göre
  farksız; öneri: değişmesin.
- **Yeni ayarlar:** 7 ayar anahtarı, hepsi bugünkü davranışla doğar: `gelenBelge.autoWorkOrder` (false),
  `gelenBelge.defaultRouteTemplateId` (boş), `gelenBelge.routeSuggestionPriority` (`CUSTOMER_FIRST`),
  `gelenBelge.handwritingOutlierFactor` (boş = 4), `gelenBelge.headerLineMeterSource` (`OUTPUT`),
  `gelenBelge.documentTotalCheck` (`INFO`), `gelenBelge.autoSenderFromTemplate` (false); `gelenBelge.unreviewedApproval`
  yeni değer `BLOCK_SUSPECT` (varsayılan `WARN` değişmedi). Yeni izin kodu yok.

## 4. Migration

- **Var mı:** HAYIR — `backend-v2.15.15`ten bu yana yeni göç yok (2026-11-02 ölçüldü, `origin/main` @ `3f9215925`).
- **Toplam migration:** 459 (2.15.15 ile aynı). Paketleme anında yeniden sayılır.
- **Döküm provası:** gerekmez (şema değişmedi).
- **Veri düzeltme betiği:** `scripts/fix_gelen_belge_kaynak.ts` (#461; dry-run varsayılan) kurulumda KOŞMAZ;
  gerekirse ayrıca, elle.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; göç yok.
- **Sıra:** backend tek başına güvenli (bkz. §3). Patron bulutu/satıcı güncellemesi gerekmez.
- **Bu sürüme özel (deneme = barındırılan sınıf):**
  - Okuma (OCR) hizmeti deneme sunucusunda yok: okuma uyarıları, HEIC dönüşümü ve okuma özeti "hizmet yok" durumunu
    gösterir; ayarlar ve onay akışı yine denenebilir.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış geri alma: açılan ayar panelden KAPATILIR (veri silinmez). Sürüm geri alma: güncelleyiciyle yapılan
güncellemede yeni sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür. Göç olmadığından
önceki imaj aynı veritabanıyla açılabilir — yalnız kullanıcı onayıyla. Grupta geri inme yok; düzeltme ileri sürümle.
Etiket `backend-v2.15.16` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.16, sunucu ve veritabanı ayakta; güncelleyici durumu `BASARILI`.
- Veritabanı: 459 migration bitmiş, sorunlu/yarım migration yok; park DB'ler göç düzeyinde eşit.
- Web paneli açılıyor; Gelen Belgeler listesi ve Genel Ayarlar → Gelen Belge bölümü yeni alanları gösteriyor.
- Onaylı tablet 1.4.3 ile PIN girişi ve bir işlem bugünkü gibi.
- Konteyner günlüğünde yeni hata yok.

## Ek — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar. Tablet maddesi tablet yayınıyla görünür.

```json
{
  "id": "2026-11-02a",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Gelen belge okumada iyileştirmeler, otomatik iş emri rotası",
  "maddeler": [
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Gelen belge okuması iyileşti: yan çekilmiş sayfa kendiliğinden düzelir, üst üste binen çekimlerde aynı satır iki kez gelmez, telefonun HEIC fotoğrafı da yüklenebilir, dosyalar sürükleyip bırakılabilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Okuma uyarıları belge detayında görünür: el yazısında şüpheli metre, aynı fotoğrafta ikinci belge izi, doğrulanamayan toplam. \"Yalnız sorunlu satırlar\" ile sorunlu satırlara süzülür; toplam farkı blok başına gösterilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Gelen belge onaylanınca iş emirleri kendiliğinden açılabilir (Genel Ayarlar → Gelen Belge, varsayılan kapalı). Rota sırasıyla son iş emrinden, müşterinin rotasından ya da fabrika varsayılan rotasından önerilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Gelen Belge ayarlarına yeni seçenekler: şüpheli satır varken onayı engelle, şablondan gönderen doldur, tablosuz sevk fişinde metre kaynağı, el yazısı şüphe oranı, belge toplamı farkında gerekçe iste." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Taslak gelen belgeler toplu silinebilir: önce silinecekler listelenir, tek tek seçilir. Taranan sayfa yakınlaştırılıp döndürülebilir." },
    { "kapsam": "tablet", "tip": "yeni", "metin": "Belge Tara'da sayfaları gönderdikten sonra okuma sonucu tablette görünür: kaç satır çıktı, uyarı var mı, okuma sürüyor mu." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Liste ekranları tam genişlikte, aynı düzende açılır." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Yönetim bulutuna gönderilemeyen günlük özet artık aynı gün içinde yeniden denenir." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "İki adımlı doğrulama kullanıcının seçimine bırakıldığında kodu kurmamış kullanıcı girişte kilitlenmez. Parola sıfırlarken \"ilk girişte değiştirsin\" seçimi yapılabilir." }
  ]
}
```
