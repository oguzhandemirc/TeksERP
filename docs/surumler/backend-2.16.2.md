# Backend `2.16.2`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip — 2.16.1 turunda ölçüldü, 2026-11-14). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi). Kullanıcı onayı (deneme dağıtımı): 2026-11-14 "devam edebilirsin".
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.1 (etiket `backend-v2.16.1` →
`a1ef904a7`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Bildirim kataloğunun üretim, depo/sevkiyat ve finans dilimleri: üretim · dokuma · kalite · kurşun · tambur · bakım
(S2), depo · sevkiyat · fason · gelen belge · satınalma (S3), finans · cari kart · ana veri · maliyet · yetki · cihaz
(S4) olayları ve bunların saatlik/vardiya/gün sonu özetleri. Katalog 39 türden 94 türe çıkar. Göç YOK. Davranış
yeni bildirim türlerinde, mevcut bildirim bayraklarının arkasında.

## 2. Ne değişti

Ölçüm: `backend-v2.16.1` (`a1ef904a7`) → `origin/main` @ `0fa2e7146`, ilk ebeveyn hattında 5 PR (#709, #711–#714).
Alt proje farkı: `Teks-Erp/src` (bildirim kataloğu, kaynakları ve emit noktaları) · `patron/uygulama` (imaja
girmez) · belge. `patron/sunucu`, `Electron`, `mobil` DEĞİŞMEDİ.

**Üretim bildirimleri (S2, #712)** — makine/tezgah duruş ve arıza (`bakim.ariza`; arıza kümesi
`BREAKDOWN_STOP_REASON_CODES`), levent, dokuma çalışma deseni, kurşun ve tambur olayları; koşul tarayıcısı
"makine/tezgah duruyor · uzun arıza"; saatlik/gün sonu üretim · kalite · kurşun ve vardiya sonu dokuma özetleri.

**Depo bildirimleri (S3, #713)** — sevkiyat (`sevkiyat.yola-cikti`, sevk geri alma), iade, depo transferi, sayım,
stok düzeltme, fason gönderim/dönüş, gelen belge onayı, mal kabul ve satınalma olayları; gün sonu sevkiyat · depo ·
fason özetleri.

**Finans ve yönetim bildirimleri (S4, #714)** — tahsilat/ödeme (`finans.tahsilat`), fatura, fiyat listesi, çek/senet
vadesi koşulu, cari kart, ürün doğuşu, standart maliyet, kullanıcı oluşturma/pasifleştirme/izin değişimi/parola
sıfırlama, iki adımlı doğrulama sıfırlama, yeni cihaz onayı; gün sonu finans özeti (yalnız sayılar, tutar yok). Teklif süresi doldu koşulu
(`teklif.suresi-doldu`).

Emit noktaları kaydı yazan işlemle aynı tx'tedir (geri alınırsa bildirim yok). Yeni türlerin hepsi buluta
`patronKind: null` olarak eşlenir — telefona fabrika dürtüsüyle (PATRON_PUSH) gider, bulut kataloğuna tür eklenmez.

**Diğer** — patron uygulaması kapalı modül uyarısı ve geniş ekran formları (#709; backend imajına girmez), patron
bulutu 13h kayıt belgesi (#711).

`tekserp-guncelleyici`, `tekserp-hizmet`, `deploy/`, `Teks-Erp/native`, `Teks-Erp/docker`, `Dockerfile`,
`Teks-Erp/prisma` DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.1..0fa2e7146`).
  - `Teks-Erp/src/routes`, `controllers`, `validators` farkı YOK; uç eklenmedi/kaldırılmadı.
  - Bildirim katalog yanıtı yeni türleri taşır (aynı alan biçimi).
  - Buluta giden tel ve projeksiyonlar değişmedi → "bulut önce" GEREKMEZ (`patron/sunucu` farkı yok).
- **Eski istemci ne yapar:**
  - Masaüstü panel / tablet: etkilenmez; yeni türler bildirim listesinde mevcut biçimle görünür.
  - Patron uygulaması: yeni türleri S1 türleriyle aynı dürtü yoluyla alır (tel biçimi aynı).
  - Patron bulutu: güncel (`143003333f51`).
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni türler mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled`
  bayraklarının arkasında.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 518 (2.16.1 ile aynı). Değiştirilen/silinen eski göç yok; veri değiştiren betik/backfill yok.
- **Geri alınabilir mi:** göç yok; 2.16.1 imajı aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend → (patron uygulaması değişikliği bağımsız).
- **Bu sürüme özel:** yok. Bayraklar denemede zaten açık.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: bildirim bayrakları panelden kapatılır. Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve
güncelleme öncesi yedeğe kendiliğinden dönülür (`GERI_DONDU`). Göç olmadığından 2.16.1 imajı aynı şemayla açılır;
yine de grupta geri inme yok, düzeltme ileri sürümle. Etiket `backend-v2.16.2` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.2; güncelleyici durumu `BASARILI`.
- Veritabanı: 518 migration bitmiş, yarım/geri alınmış 0.
- `GET /api/client-policy/patron` 200.
- Bildirim kataloğu yeni türleri döndürür (`sevkiyat.yola-cikti`, `bakim.ariza`, `finans.tahsilat`).
- Özet zamanlayıcısı açılışta hata yazmaz (konteyner günlüğünde `bildirim-ozet`/digest hatası yok).
- Patron bulutu eşitlemesi kurulumdan sonra 200 sürüyor.
- Konteyner günlüğünde yeni hata yok.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 5)

- `979cc2287` #711 docs(patron-bulut): record 13h upgrade to `143003333f51` (notification sound S0)
- `38f477fcd` #709 fix(patron-app): closed module calm notice, centred forms on wide screens
- `2b5ad33b2` #713 feat(bildirim): S3 depot/shipping/fason/incoming-doc/purchasing notification kinds
- `419323c4e` #712 feat(bildirim): S2 production, weaving, kursun, tambur and maintenance notifications
- `0fa2e7146` #714 feat(bildirim): S4 finance/card/master-data/cost/access/device notification kinds

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-14b",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Üretim, depo ve finans olayları için yeni bildirimler",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Üretim olayları (makine arızası ve duruş, dokuma, kurşun, tambur, kalite) bildirim olarak gelir; sık olaylar saatlik, vardiya ya da gün sonu özeti olarak toplanır." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Depo olayları (sevkiyatın yola çıkması, iade, transfer, sayım, fason gönderim ve dönüş, gelen belge, satınalma) bildirim olarak gelir." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Finans ve yönetim olayları (tahsilat, ödeme, fatura, çek/senet vadesi, yeni ürün, kullanıcı ve izin değişiklikleri) bildirim olarak gelir; gün sonu finans özeti tutar göstermez." }
  ]
}
```
