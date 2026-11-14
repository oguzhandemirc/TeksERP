# Backend `2.16.3`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk ve tek hedef `test` grubu (grubun tek kurulumu `deneme-bulut`,
BARINDIRILAN, Linux, ONAYLI kip — 2.16.2 turunda ölçüldü, 2026-11-14). Öncü/genel gruba çıkış ayrı karar
(terfi etiketi). Kullanıcı onayı (deneme dağıtımı): 2026-11-14.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** `test` grubunda yayındaki ve denemede kurulu sürüm 2.16.2 (etiket `backend-v2.16.2` →
`c9688ae87`).

Sürüm numarası: YAMA hanesi, otomatik (`node scripts/backend-surum.mjs`).

## 1. Özet

Bildirim kataloğunun S5 dilimi (haftalık fason/finans özeti, fatura vadesi yaklaştı/geçti, cari kart değişti,
kurşun kâğıt yolu, bakım kapanış düzeltmesi), patron oturumuna kapalı modül kümeleri (`/auth/me`
`patronClosedSets`) ve güncelleme sonrası açılışta beliren sahte "Lisans uyarısı" bildiriminin düzeltmesi. Göç YOK.

## 2. Ne değişti

Ölçüm: `backend-v2.16.2` (`c9688ae87`) → `origin/main` @ `9cf5ce491`, ilk ebeveyn hattında 6 PR (#716–#721).
Alt proje farkı: `Teks-Erp/src` (bildirim kataloğu, kaynaklar, `/auth/me`) · `Electron` (imaja girmez) ·
`patron/uygulama` (imaja girmez) · belge. `patron/sunucu`, `mobil` DEĞİŞMEDİ.

**Haftalık özetler (S5a, #717)** — `fason.haftalik-ozet`, `finans.haftalik-ozet` (yalnız sayılar, tutar yok);
özet zamanlayıcısına haftalık pencere. `stok.yaslanan` bu sürümde YOK (depoya giriş anının tek kaynağı yok;
kullanıcı kararı bekliyor — arşiv 2026-11-14 S5a notu).

**Vade, cari, kurşun, bakım (S5b, #720)** — `finans.vade-yaklasti`, `finans.vade-gecti` koşulları (fatura vadesi;
yaşlandırma raporuyla aynı çekirdek `invoice-due.helper.ts`), `cari.degisti` (cari kart değişimi),
`kursun.gramaj-sapmasi` kâğıt (bypass) atama yolunda da doğar, `bakim.tamamlandi` gözcü kapanış düzeltmesinde
duruş başına birleşir.

**Patron kapalı modül kümeleri (#718)** — `/auth/me`, patron izinli oturuma `patronClosedSets` alanını ekler:
uçların koştuğu aynı modül kapısının (bayrak ya da lisans tavanı) kapalı dediği kümeler. Hüküm yoksa alan
yayımlanmaz. Panel çağrısına kapı okuması eklenmez.

**Açılışta sahte lisans uyarısı (#721)** — güncelleme/yeniden başlatma sonrası ilk koşul turunda açılış bütünlük
denetimi bitmediği için `sistem.lisans-uyarisi` iki konu açıp (`BUTUNLUK_OLCULEMEDI`, `DERLEME_TARIHI_YOK`)
60 sn sonra kapatıyordu. Artık bütünlük sonuç verene dek (en çok 10 dk) bu iki neden açılmaz. Lisans durumu ve
kapı DEĞİŞMEDİ. Runbook §16.4 adım (4b) "Şimdi yokla".

**Diğer** — panel üretim önerisinde iplik ayrıntısı liste olarak (#716) ve patron uygulamasında kapalı modülün
pano kutusu gizli (#719); ikisi de backend imajına girmez.

`tekserp-guncelleyici`, `tekserp-hizmet`, `deploy/`, `Teks-Erp/native`, `Teks-Erp/docker`, `Dockerfile`,
`Teks-Erp/prisma` DEĞİŞMEDİ. Yeni bağımlılık yok.

Tam döküm: Ek A.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (`backend-v2.16.2..9cf5ce491`).
  - Uç eklenmedi/kaldırılmadı; `/auth/me` yanıtına isteğe bağlı bir alan eklendi (`patronClosedSets`).
  - Bildirim katalog yanıtı yeni türleri taşır (aynı alan biçimi).
  - Buluta giden tel ve projeksiyonlar değişmedi → "bulut önce" GEREKMEZ (`patron/sunucu` farkı yok).
- **Eski istemci ne yapar:**
  - Masaüstü panel / tablet: etkilenmez; yeni türler bildirim listesinde mevcut biçimle görünür.
  - Patron uygulaması: eski sürüm `patronClosedSets`i tanımaz, bugünkü davranış (hepsi görünür, kapalıda gri
    satır). Yeni uygulama + eski fabrika: alan yok → bugünkü davranış.
  - Patron bulutu: değişmedi.
- **`minVersion` dokunuldu mu:** hayır.
- **Yeni bayraklar:** yok. Yeni türler mevcut `bildirim.gelenKutusuEnabled` / `bildirim.patronPushEnabled`
  bayraklarının arkasında.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 518 (2.16.2 ile aynı). Değiştirilen/silinen eski göç yok; veri değiştiren betik/backfill yok.
- **Geri alınabilir mi:** göç yok; 2.16.2 imajı aynı şemayla açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncelleyici yedek + yeniden başlatma; deneme ölçeğinde bir dakikadan az.
- **Sıra:** backend → (panel ve patron uygulaması değişiklikleri bağımsız).
- **Bu sürüme özel:** yayından sonra deneme panelinde "Şimdi yokla" (runbook §16.4 adım 4b). Bu kurulumun
  açılışında `sistem.lisans-uyarisi` YENİ konu açmamalı (#721'in saha doğrulaması).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Davranış: bildirim bayrakları panelden kapatılır. Sürüm: güncelleyiciyle kurulan sürüm açılmazsa önceki imaja ve
güncelleme öncesi yedeğe kendiliğinden dönülür (`GERI_DONDU`). Göç olmadığından 2.16.2 imajı aynı şemayla açılır;
yine de grupta geri inme yok, düzeltme ileri sürümle. Etiket `backend-v2.16.3` silinmez.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.16.3; güncelleyici durumu `BASARILI`.
- Veritabanı: 518 migration bitmiş, yarım/geri alınmış 0.
- `GET /api/client-policy/patron` 200.
- Bildirim kataloğu yeni türleri döndürür (`fason.haftalik-ozet`, `finans.haftalik-ozet`, `finans.vade-yaklasti`,
  `cari.degisti`; modül görünürlüğüne göre süzülebilir).
- `/auth/me` patron oturumunda `patronClosedSets` alanı.
- Kurulum sırasında/sonrasında `notification_conditions`ta yeni `sistem.lisans-uyarisi` kaydı yok.
- Özet zamanlayıcısı açılışta hata yazmaz (konteyner günlüğünde `bildirim-ozet`/digest hatası yok).
- Patron bulutu eşitlemesi kurulumdan sonra 200 sürüyor.

## Ek A — commit dökümü (ilk ebeveyn, eskiden yeniye, 6)

- `2d80607d8` #716 fix(proposal): render yarn detail as a list, not a card table
- `fe3fe2594` #718 feat(patron): hide install-closed modules from patron app navigation
- `caae27613` #717 feat(bildirim): haftalık fason/finans özeti (S5a)
- `03d8bcf1d` #719 feat(patron-app): hide closed-module dashboard tiles, refresh /auth/me on foreground
- `da024f1c9` #720 feat(bildirim): S5b — vade koşulları, cari.degisti, kurşun kâğıt yolu, watchdog düzeltmesi
- `9cf5ce491` #721 fix(bildirim): no license warning while startup integrity check is pending

## Ek B — operatör notu taslağı (`surum-notlari.json` biçimi; terfide onay)

Web paneli sürüm notu penceresini göstermez; kayıt masaüstü panel turunda `surum-notlari.json`a girer. Metin terfide
kullanıcı onayıyla donar.

```json
{
  "id": "2026-11-14c",
  "durum": "TASLAK — terfide kullanıcı onayı",
  "baslik": "Haftalık özetler, vade bildirimleri ve güncelleme sonrası sahte lisans uyarısının giderilmesi",
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Haftalık fason ve finans özeti bildirimi gelir; finans özeti tutar göstermez." },
    { "kapsam": "panel", "tip": "yeni", "metin": "Vadesi yaklaşan ve vadesi geçen faturalar ile cari kart değişiklikleri bildirim olarak gelir." },
    { "kapsam": "panel", "tip": "duzeltme", "metin": "Güncellemeden sonra birkaç saniyeliğine görünen yersiz 'Lisans uyarısı' bildirimi artık çıkmaz." }
  ]
}
```
