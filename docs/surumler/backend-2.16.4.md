# Backend `2.16.4`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip — 2.16.3 turunda ölçüldü, 2026-11-14). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi). Kullanıcı onayı (deneme dağıtımı): 2026-11-14.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.3 (etiket `backend-v2.16.3` →
`5f5e591d8`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Depoda yaşlanan stok bildirimi (`stok.yaslanan`, yaş kaynağı ayarlı: depoya giriş ya da durum değişimi) ve web
panelinde Bildirim profilleri ekranının sıkılaştırılması (tek satır, katlanır gruplar, arama, okunur eşik
etiketleri). Göç YOK.

## 2. Ne değişti

Ölçüm: `backend-v2.16.3` (`5f5e591d8`) → `origin/main` @ `45bce1c05`, ilk ebeveyn hattında 4 PR (#723–#726).
Alt proje farkı: `Teks-Erp/src` (bildirim kataloğu, koşul kaynağı, ayar) · `Electron` (web paneli imajın
`/app/dist-web` dizinine girer) · `Teks-Erp/scripts` (bekçiler) · belge. `patron/sunucu`, `patron/uygulama`,
`mobil` DEĞİŞMEDİ.

**Yaşlanan stok (#723)** — yeni KOŞUL türü `stok.yaslanan`: depoda N+ gündür (varsayılan 30) duran toplar, depo
başına tek kayıt; metin adet, gün ve metre taşır, tutar yok; böyle top kalmayınca "çözüldü". Yaş kaynağı yeni ayar
`bildirim.stokYaslanan.kaynak` (Ayarlar → Bildirimler): `depo-giris` (varsayılan; depo defterindeki son gerçek giriş,
girişi olmayan top durum tarihine düşer ve adedi metinde yazılır) ya da `durum-degisimi` (`Roll.statusChangedAt`,
Stok & Ölü Stok raf yaşıyla aynı). Gün eşiği Bildirim profilleri → Fabrika varsayılanı "Eşik (gün)". Tek yüklem
`helpers/stock-aging.helper.ts`; ölü toplar (`K18_DEAD_STATUSES`) hariç.

**Bildirim profilleri ekranı (#724, #725)** — Fabrika varsayılanında ham anahtar yerine Türkçe eşik etiketleri
("Gecikme payı (gün)", "Eşik (saat)", "yaklaştı" türlerinde "Kaç gün kala"); eşik ve ek alıcı türün kendi satırında;
iki sekmede katlanır gruplar (durum özeti, grup başına toplu aç/kapat, kilitli tür korunur), kullanıcı başına
hatırlanan katlama ve Türkçe katlamalı arama.

**Bekçi (#726)** — `test_cihaz_birlestirme` temizlik takılmasında teşhisli kırmızı; ürün kodu değişmedi.

`tekserp-guncelleyici`, `tekserp-hizmet`, `deploy/`, `Teks-Erp/native`, `Teks-Erp/docker`, `Dockerfile`,
`Teks-Erp/prisma` DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.3..45bce1c05`).
  - Uç eklenmedi/kaldırılmadı; ayar listesine bir anahtar eklendi (`bildirim.stokYaslanan.kaynak`).
  - Bildirim katalog yanıtı yeni türü taşır (aynı alan biçimi).
  - Buluta giden tel ve projeksiyonlar değişmedi → "bulut önce" GEREKMEZ (`patron/sunucu` farkı yok).
- **Eski istemci ne yapar:**
  - Masaüstü panel (eski sürüm): yeni ayarı görmez; bildirim varsayılan kaynakla (`depo-giris`) çalışır; yeni tür
    bildirim listesinde mevcut biçimle görünür. Web paneli imajla birlikte yenilenir.
  - Tablet ve patron uygulaması: etkilenmez.
  - Patron bulutu: değişmedi.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni tür mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled`
  bayraklarının arkasında.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 518 (2.16.3 ile aynı). Değiştirilen/silinen eski göç yok; veri değiştiren betik/backfill yok.
- **Geri alınabilir mi:** göç yok; 2.16.3 imajı aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend (web paneli imajla birlikte) → masaüstü panel değişiklikleri bağımsız.
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Yeni ayarın varsayılanı
  `depo-giris`; kurulum hiçbir ayar satırı yazmaz.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: `stok.yaslanan` Bildirim profillerinden kapatılır ya da bildirim bayrakları panelden kapatılır. Sürüm:
güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve güncelleme öncesi yedeğe kendiliğinden dönülür
(`GERI_DONDU`). Göç olmadığından 2.16.3 imajı aynı şemayla açılır; yine de grupta geri inme yok, düzeltme ileri
sürümle. Etiket `backend-v2.16.4` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.4; güncelleyici durumu `BASARILI`.
- Veritabanı: 518 migration bitmiş, yarım/geri alınmış 0.
- `GET /api/client-policy/patron` 200.
- Bildirim kataloğu `stok.yaslanan` türünü döndürür.
- Ayar uçlarında `bildirim.stokYaslanan.kaynak` varsayılan `depo-giris`.
- Kurulum sırasında/sonrasında `notification_conditions`ta yeni `sistem.lisans-uyarisi` kaydı yok.
- Konteyner günlüğünde `bildirim-ozet` / koşul tarayıcısı hatası yok.
- Web paneli yeni varlık karmalarını sunar; Bildirim profilleri ekranı katlanır gruplarla açılır.
- Patron bulutu eşitlemesi kurulumdan sonra 200 sürüyor.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 4)

- `4f7d0d785` #723 feat(bildirim): stok.yaslanan condition with two age anchors
- `59a61c215` #724 fix(panel): readable threshold labels in notification factory defaults
- `dfed08652` #725 feat(panel): compact notification profile screens with collapsible groups
- `a2a6a8384` #726 test(device): bound cihaz_birlestirme cleanup with diagnosed failure

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-14d",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Depoda bekleyen stok bildirimi ve daha derli toplu bildirim ayarları",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Depoda belirlenen günden uzun bekleyen toplar için depo başına bildirim gelir; günü depoya girişten ya da son durum değişiminden saymayı Ayarlar → Bildirimler'den seçebilirsiniz." },
    { "kapsam": "panel", "tip": "iyilestirme", "metin": "Bildirim profilleri ekranı gruplara ayrıldı: gruplar katlanır, arama yapılır, eşik ayarları türün kendi satırında görünür." }
  ]
}
```
