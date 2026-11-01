# Backend `2.15.14`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (üyesi tek kurulum: bulut deneme sunucusu,
satıcı DB'sinde `kurulum.kanalKodu = test` tek satır, 2026-11-01 ölçüldü); öncü/genel gruba çıkış ayrı karar (terfi
etiketi). Bu belge `2.15.14-taslak.md` girdi notunun (KÜÇÜK-F, teklif belgesi donması) üstüne 2026-11-01 sürüm
hazırlığında yazıldı; açık dilimler (SY-P2…P4, D4-K3e) indikten sonra §2 ve §4 yeniden ölçülür.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki sürüm 2.15.13 (`backend-oci/son-zincir.json`, etiket
`backend-v2.15.13`); deneme sunucusunda KURULU olan 2.15.12'dir (2.15.13 indirildi, kurulum onayı bekliyor —
`/opt/tekserp/test-musteri/surumler/`). Deneme 2.15.12 → 2.15.14 geçer: 2.15.13 belgesinin içeriği ve göçleri de
bu kurulumda uygulanır. Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce sağlık bilgisinden okunur.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

Dalga 4 (hizmet veren / fason işlemci fabrika istekleri) ve tül dokuma fabrikası istekleri: gelen belge taslağı
(irsaliye fotoğrafından emanet top girişi), hizmet faturası, kurşun çıkış metresi, tambur ölçüm kaynağı, müşteri
barkodu, cari kilidi ve risk limiti, sevke hazır işler, masraf bağı ve kârlılık, KDV/tevkifat, desen kartı ve
varyant, çözgü katmanları, siparişten üretim önerisi. Yeni modül ve davranış ayarlarının hepsi bugünkü davranışla
doğar; operatöre görünür etki ancak ayar açılınca başlar.

## 2. Ne değişti

Ölçüm: `backend-v2.15.13` (`4e6cad988`) → `origin/main` @ `be9180daa`, ilk ebeveyn hattında 158 commit (≈150 PR).
Alt proje farkı: `Teks-Erp/src` 445 dosya · `Electron/src` 523 dosya (web paneli imajda) · `mobil/src` 133 dosya
(bu turda tablet yayını YOK) · `patron/sunucu` 14 · `patron/uygulama` 36 · `satici` 2 (modül kataloğu satırı) ·
`okuma/` 28 (yeni yerel okuma servisi — imaja GİRMEZ).

**Gelen belge taslağı (modül `gelenBelge.enabled`, varsayılan KAPALI; ön koşul emanet modülü)** — #243–#257,
#262, #266, #273, #282, #295, #300, #348. Müşteri irsaliyesinin fotoğrafı/PDF'i panelden ya da tablette Belge
Tara ile yüklenir, okuma servisi taslak çıkarır, gözden geçirme ekranında onaylanınca emanet top girişi doğar. 4 yeni
izin (`gelen-belge:read/write/approve/template`; `approve` SoD kümesinde). Okuma servisi (`okuma/`, Python
RapidOCR) ayrı süreçtir, bu imajda yoktur; servis yoksa okuma işi başarısız işaretlenir, elle giriş yolu açıktır.

**Hizmet veren (fason işlemci) profili ve hizmet faturası** — #250, #253, #258, #260, #264, #265, #271, #278,
#285, #313. SERVICE kalem türü, gramaj kademesi eşlemesi, hizmet fatura taslağı, dönem sonu faturası, müşteri bazlı
tetik (`finance.serviceBilling.*`, varsayılan kapalı). Profil ayar paketi betiği dry-run varsayılan.

**Kurşun çıkış metresi** — #249, #254, #259, #261, #263, #283. Metre defteri, sapma politikası + ofis onayı, tablet
sayaç ekranı. `kursun.meterCapture` varsayılan `OFF` (= bugünkü davranış).

**Tambur ölçüm kaynağı ve en ölçen istasyon** — #274, #275, #280, #289, #296, #302, #304, #310, #312, #329, #330,
#350. MACHINE/OPERATOR/SIMULATED beyanı, simüle kesim metresi faturalanmaz, süpervizör düzeltme ucu, sayaç
kalibrasyon kaydı, plan kapısı en eşiği, istasyon süzgeci. Zorunluluk ayarları varsayılan KAPALI.

**Makine duruşları (dokumasız rejim)** — #285, #292–#294, #299, #309. Tablet duruş çipi, rapor, patron bulutu kartı.

**Müşteri barkodu** — #288, #303, #305, #306, #320, #383, #390. Tek okutma boğazı müşteri koduna açılır,
belirsiz kodda aday modalı, müşteri barkod serisi, Tambur çıkışında kod doğuşu (`label.customerCodeAt` varsayılan
`NONE`), yeni izin `roll:customer-code`.

**Cari kilidi, risk limiti, cari birleştirme** — #291, #298, #301, #311, #314, #324, #327, #328, #349, #378,
#379, #395. Cari kilidi modeli + 5 kapı (409 `CARI_HOLD`), risk limiti iş kabulü/sevk (`RISK_LIMIT_EXCEEDED`,
varsayılan kapalı), kart başına tek cari hesap, hareketli çift hesabın virmanla birleştirilmesi + geri alma.

**Sevke hazır işler** — #287, #297, #321, #341, #342, #360, #363. Hazırlık yüklemi, panel ekranı, tablet Sevk
Kapısı çipleri, bildirim koşulu, sevk top listesi Excel'i.

**Masraf, kârlılık, maliyet** — #279, #307, #315, #319, #322, #332, #334, #335, #338, #347, #357, #358, #361,
#362, #373, #377, #381, #386, #391–#394, #396. Masraf özeti ve masraf bağı, makine saat ücreti + hizmet sarf normu,
gerçekleşen kârlılık (gelir + sarf + dış fason + makine-saat + genel gider), sunum dövizi (donmuş kur), kg bazlı
terbiye tarifesi, dokuma gerçek maliyeti, varyant standart maliyeti, SEPARATE_BEAM katman firesi.

**Fatura KDV + tevkifat** — #359. Genel ve müşteri bazında (`finance.withholding.enabled` varsayılan kapalı).

**Dokuma: desen kartı, varyant, çözgü katmanları, üretim önerisi** — #317, #326, #333, #337, #343, #351, #353–#356,
#364–#368, #372, #375, #380, #384, #385, #388. Desen kartı + atkı sıra kodu + varyant, sipariş satırı varyantı ve
hedef değer (kuşak), çözgü katmanları motoru (`beamMode`), levent raporu katman kırılımı, tezgâh önerisi, siparişten
üretim önerisi (önizleme + uygula), Üretim planı sekmesi, tül Excel içe aktarımı, fason rota finalize ölçümü.

**Patron bulutu** — #294, #299, #314, #321, #347, #373, #374, #395. Yeni anlıklar `ozet-masraf`, `karlilik-ozet`;
cari hesap projeksiyonuna kilit alanı; iş emrine sevke hazırlık alanı; makine duruş kartı; kasa hareketleri.

**Küçükler ve önceki taslak** — #236 (KÜÇÜK-F: "Sevk Edilenler" adı, kasa notunda `multiCurrency`, top kartında
"İz sür"), #241 (teklif SENT / fiyat listesi PUBLISHED geçişinde belge tx içinde donar; önce gönderilmiş ve hiç
basılmamış kayıt ilk basımda eskisi gibi oluşur), #242, #268, #269, #281, #286, #290 (sekme davranışı tercihi),
#308, #382, #389, #370.

**Güncelleyici ve hizmet konağı** — `tekserp-guncelleyici` 0.2.8 → 0.2.9, `tekserp-hizmet` 0.2.0 → 0.2.1
(`scripts/test_guncelleyici_surum.mjs` yeşil, taban `backend-v2.15.13`). `Teks-Erp/docker`, `deploy/pg`,
`deploy/node-surumu.json`, `deploy/kanallar.json`, `deploy/dagitim.json` etiketten beri DEĞİŞMEDİ.

`dist-web` (web paneli) imaja girer ve yukarıdaki panel değişikliklerinin hepsini taşır; masaüstü panel paketi bu
turda YOK (yayındaki masaüstü panel 1.6.6).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (dilim PR'larının "eski istemci" beyanları + `client-version-policy.ts` farkı yok). Uç
  kaldırma yok; var olan yanıtlara yalnız ek alan; yeni uçlar ve yeni hata kodları (`CARI_HOLD`,
  `RISK_LIMIT_EXCEEDED`, `SIMULATED_METER_DISABLED`, gelen belge kodları) yalnız yeni ayar AÇIKKEN doğar.
- **Eski istemci ne yapar:**
  - Tablet 1.4.3 (sahadaki): ölçüm kaynağı alanı göndermez → `tambur.olcumKaynagiZorunlu` KAPALI kaldıkça kesim
    bugünkü gibi; kurşun metresi göndermez → `kursun.meterCapture = OFF`ta bugünkü gibi; cari kilidi açılırsa
    kilitli caride sevk 409 alır ve genel hata metni görür (tam ekran yalnız yeni tablette); müşteri barkodu
    okutması yeni tablette. Zorunluluk ayarlarının açıklamaları "önce tüm tabletler yeni sürümde" der.
  - Masaüstü panel 1.6.6: yeni ekranları göstermez, yeni alanları yok sayar; Kasa & Banka Defteri notu eski koşulla
    çizilir.
  - Patron bulutu 0.2.0 (VDS, `5156f26d2259`): yeni anlıkları (`ozet-masraf`, `karlilik-ozet`) giriş başına
    `PROJEKSIYON_BILINMIYOR` ile reddeder, paketin geri kalanı kabul edilir (`sync-apply.ts` giriş başına ret);
    cari kilit alanı var olan projeksiyonda ek alandır, saklanır. Bulut güncellenene dek bu iki özet uygulamada
    görünmez.
  - Satıcı (`db021d06a0df`): yoklama şeması modül anahtarında yalnız biçim denetler → fabrika yoklaması kırılmaz;
    portal `gelenBelge.enabled`i HAK'a ancak yeni satıcı imajıyla seçebilir (modül deneme için gerekiyorsa satıcı
    ÖNCE).
- **`minVersion` dokunuldu mu:** hayır — `Teks-Erp/src/config/client-version-policy.ts` `backend-v2.15.13`e göre
  farksız; öneri: değişmesin.
- **Yeni ayarlar:** 53 ayar anahtarı (`system-setting.service.ts` `SETTING_KEYS` farkı) ve modül anahtarı
  `gelenBelge.enabled`; hepsi bugünkü davranışla doğar (geçmişi olan kurulumda modül göçü sabit `false` yazar).

## 4. Migration

- **Var mı:** evet — `backend-v2.15.13`ten bu yana **29** yeni göç (2026-11-01 ölçüldü, `origin/main` @
  `be9180daa`; açık dilimler inince yeniden sayılır). Deneme 2.15.12'den geçtiği için orada **59** göç uygulanır
  (2.15.13'ün 30'u + bu sürümün 29'u).
- İçerik: hepsi ADDITIVE — yeni tablolar (gelen belge, kurşun metre okuması, hizmet eşlemesi/fatura bağı, müşteri
  barkodu, cari kilidi, makine ücreti/sarf normu, desen kartı varyantı, maliyet tül, sipariş varyant hedefi, masraf
  bağı, cari virman, sayaç kalibrasyonu), var olan tablolara boş/varsayılanlı kolon, enum değeri ekleme, trigger
  (`20261029180000_cari_service_billing_trigger`, `20261031230000_d4_desen_islem_isemri_kirletme` — yalnız
  `sync_marks` kirletme trigger'ları). Veri yazan tek göç `20261029000100_gelen_belge_modul_anahtari`
  (`gelenBelge.enabled = false`, yalnız top geçmişi olan kurulumda, `ON CONFLICT DO NOTHING`). DROP TABLE/COLUMN,
  SET NOT NULL, tip değişimi YOK (göç dosyalarında sayıldı).
- **Toplam migration:** 454 (2.15.13'te 425, 2.15.12'de 395). Paketleme anında yeniden sayılır.
- **Canlı döküm provası:** bu sürüm için henüz YOK. Test grubu yayını öncesi öneri: deneme DB'sinin dökümü
  (395 göç) yerel PG16'da `migrate deploy` → 454; öncü/genel terfisinden önce fabrika dökümünde prova ŞART.
- **Geri alınabilir mi:** göç geri alınmaz; eklenen tablo/kolonları eski imaj okumaz (bkz. §6).

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + göç + yeniden başlatma; 59 ekleme göçü tablo yeniden yazmaz.
  Önceki ölçüm: 2.15.13 provasında 62 göç 2 sn. Süre kurulumda ölçülür.
- **Sıra:** (isteğe bağlı) satıcı → backend → patron bulutu → masaüstü panel / tablet. Backend tek başına güvenli
  (bkz. §3); bulut güncellenmezse yalnız iki yeni özet görünmez.
- **Bu sürüme özel:**
  - Deneme 2.15.13'ü hiç kurmadı: 2.15.13'ün kurulum notları (ilk eşitleme turunda sipariş/sevkiyat adlarının yeniden
    gönderimi, olay güdümlü tur kapalı) burada da geçerlidir.
  - Güncelleyici kendini 0.2.9'a günceller ("önce güncelleyici").
  - İsteğe bağlı veri teşhisi (yazmaz; `--apply` yalnız kullanıcı kararıyla): `scripts/fix_cari_cift_hesap.ts`
    (kart başına tek cari hesap), `scripts/fix_emanet_owner_backfill.ts` (sahipsiz doğmuş emanet top). Deneme
    için zorunlu değildir.
  - Gelen belge okuması `okuma/` servisi ister; imajda yok — deneme sunucusunda bu modül açılırsa okuma işi
    başarısız görünür, elle giriş yolu çalışır.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış geri alma: açılan ayar/modül panelden KAPATILIR (veri silinmez). Sürüm geri alma: güncelleyiciyle yapılan
güncellemede yeni sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür. Kurulum başarılı
olduktan sonra geri dönmek gerekirse önceki imaj aynı veritabanıyla açılabilir (eklenen tablo/kolonlar okunmaz) —
yalnız kullanıcı onayıyla. Grupta geri inme yok; düzeltme ileri sürümle. `migrate reset`, `docker compose down -v`,
`dropdb` yok. Etiket `backend-v2.15.14` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.14, sunucu ve veritabanı ayakta; güncelleyici durumu `BASARILI`.
- Veritabanı: 454 migration bitmiş, sorunlu/yarım migration yok.
- `GET /api/feature-flags` → `gelenBelgeEnabled: false` (profil ya da elle açılmadıysa).
- Web paneli açılıyor; "Sevk Edilenler" ekranı ve Kasa & Banka Defteri açılıyor.
- Tablet 1.4.3 ile PIN girişi, bir Tambur kesimi ve bir sevk bugünkü gibi (ayarlar kapalıyken).
- Patron bulutu durum kartı: eşitleme turu hatasız; ret listesinde yalnız `ozet-masraf` / `karlilik-ozet`
  (bulut 0.2.0 kaldıkça beklenen).
- Konteyner günlüğünde yeni hata yok.

## Ek — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer (panel
sürümü o turda yazılır). Metin terfide kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-01",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Gelen belge taslağı, hizmet faturası, cari kilidi, sevke hazır işler, kârlılık ve desen kartları",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Gelen Belgeler: müşterinin irsaliye fotoğrafı ya da PDF'i yüklenir, okunan satırlar gözden geçirilip onaylanınca emanet toplar girilir. Emanet ve gelen belge modülleri açık kurulumlarda görünür." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Hizmet veren fabrikalar için hizmet faturası: işlem başına fiyat, gramaj kademesi ve dönem sonunda toplu fatura taslağı. Ayar açılmadıkça fatura akışı aynı." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Cari kilidi: bir cari hesabı iş kabulüne, sevke ya da faturaya kapatabilirsiniz; kilitli hesap listede rozetle görünür. Risk limiti aşımında iş kabulü ve sevk isteğe bağlı durdurulur." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Sevke Hazır İşler ekranı: sevke hazır olan işler tek listede; İçerideki İşler ekranında hazırlık sütunu; sevk top listesi Excel'e indirilir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Kârlılık ve masraf: müşteri ve iş bazında gerçekleşen kârlılık, masraf özeti, masrafı işe bağlama, makine saat ücretleri. Maliyet modülü açık kurulumlarda." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Faturada KDV ve tevkifat oranı genel olarak ya da müşteri bazında tanımlanır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Dokuma: Desen Kartları ekranı (atkı sırası, varyant), sipariş satırında varyant ve hedef değer, siparişten üretim önerisi ve tezgâh önerisi, Siparişler altında Üretim planı sekmesi." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Makine Duruşları ekranı dokuma dışındaki istasyonlarda da kullanılır; duruş raporu eklendi." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Müşteri barkodu: topa müşterinin barkodu bağlanır, okutulan her noktada müşteri koduyla da bulunur; birden çok eşleşmede seçim penceresi açılır." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Kurşun ve Tambur'da metre kaynağı (makine, operatör, tahmini) kaydedilir; tahmini kesim metresi faturaya girmez, süpervizör kesim metresini düzeltebilir." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Sevkiyat ekranının adı Sevk Edilenler oldu; top kartında İz sür düğmesi; teklif gönderildiği anda belgesi oluşur." }
  ]
}
```
