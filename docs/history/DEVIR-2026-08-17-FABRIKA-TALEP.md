# Devir Notu — Fabrika Talep Listesi (2026-08-17 gecesi)

**Dal:** `adnansahin` · **Plan:** [`docs/history/FABRIKA-TALEP-2026-08-17.md`](../design/FABRIKA-TALEP-2026-08-17.md)
**APK:** `2.7.5` / versionCode `42` — masaüstünde, tablette açılışı doğrulandı.
(2.7.4 aynı gün ikinci turla değiştirildi; sahaya **2.7.5** kurulur.)

> ⚠️ **Dal satırı TARİHSELDİR:** `adnansahin` dalı 2026-09-02'de **EMEKLİ** edildi (`main`'in atası; tek commit kaybolmadı). İş bugün `main` üzerindedir — bkz. `deploy/README.md` ve `docs/design/MODUL-BAYRAK-TASARIM.md` §0. Bu belgeyi okuyup var olmayan dala `checkout` deneme.

---

## 1. Ne bitti

| # | Madde | Durum | Nerede |
|---|---|---|---|
| 1 | Sekme geçişinde liste sıfırlanması | ✅ | Electron (menü + komut paleti + rota hafızası) |
| 2 | İş emri listesinde parti kolonu | ✅ | Backend + Electron + mobil |
| 3 | Türkçe harf ayrımsız arama | ✅ | Backend (tek dosya) |
| 4 | "SON PARTİ: P47" | ✅ | Electron + mobil |
| 5 | Stok kodu alanı en alta / kapalı | ✅ | Electron |
| 6 | Tambur yetkileri | ✅ | Backend (+ **6 gizli 403 daha** bulundu) |
| 7 | Cihaz eşleştirme | ⏭️ **Atlandı** (kullanıcı kararı) | — |
| 8 | "Sipariş Bağla" butonu | ✅ | Backend + Electron |
| 9 | Yarı mamül alımı | 🟡 **Kısmi** — aşağıya bak | Backend + Electron |
| 10 | Sipariş bağlayınca kalıtım | ✅ | Backend + Electron |
| 11 | Ekru / fasona renksiz git | ✅ | Backend + Electron |
| 12 | En değişimi | ✅ | Backend + Electron |

### Madde 9 — ne bitti, ne kaldı

**Bitti:** Yarı mamül girişinin TAMAMI backend'de (`RollEntrySource.SEMI_FINISHED`,
statü zorlaması, yeni yetki `mobile:kk1-yari-mamul`), Electron'da **"Yarı Mamül
Girişi"** butonu (Ham Stok sekmesi) ve Ham Stok listesinde **"Giriş Türü"**
filtresi. Yani iş bugün panelden uçtan uca yapılabilir.

**Kalan:** Mobil **KK1 ekranındaki** "Ham / Yarı mamül" seçimi. Bilerek
yapılmadı — `KK1Screen.tsx` 3500+ satır, sahadaki en yüksek trafikli ve en
kırılgan ekran (çevrimdışı kuyruk, mükerrer tuzağı, geçmiş çökme vakaları) ve
gece tek başıma yalnız "açılıyor mu" düzeyinde doğrulayabilirdim. Backend kapısı
hazır, arayüz eklenince ek bir sunucu değişikliği gerekmiyor.

**Rota şablonu ("Yarı Mamül" = Kurşun+Tambur):** seed'e eklenmedi — seed yalnız
ilk kurulumda koşuyor. **Panelden bir kez oluşturulmalı** (Tanımlar → Rotalar).

---

## 2. Madde 6 — beklenenden büyük çıktı

Tambur'un iki ucu (renk + kumaş listesi) gerçekten `mobile:tambur`u kabul
etmiyordu. Bunu tekrar etmesin diye yazılan bekçi
(`scripts/test_mobile_screen_permissions.ts`) **aynı sınıftan 5 gizli 403 daha**
buldu; hepsi kapatıldı:

| Ekran | Uç | Eksik olan |
|---|---|---|
| Tambur | `GET /colors` | `mobile:tambur` |
| Tambur | `GET /items` | `mobile:tambur` |
| Tambur | `DELETE /kursun-qc/error` | `mobile:tambur` |
| Kartela Sevk | `GET /rolls/barcode/:kod` | `mobile:kartela-sevk` |
| Hızlı İş Emri | `GET /customers` | `mobile:hizli-is-emri` |
| Hızlı İş Emri | `GET /items` | `mobile:hizli-is-emri` |
| İade Girişi | `GET /quality-grades` | `mobile:iade` |

Bekçi ayrıca **Tambur'un ek yetenek yetkilerini** tek yerde belgeliyor
(`mobile:tambur-duzelt` → manuel top/getir/üret; `label:edit` → etikette müşteri
adı). "Ekran açılıyor ama şu tuş çalışmıyor" sorusunun cevabı artık orada.

---

## 3. Deploy adımları (sırayla)

1. **Sunucuda pull + restart** (backend). Boot'ta izin uzlaştırması yeni izni
   kendi getirir: `mobile:kk1-yari-mamul`.
2. **Migration:** `npm run prisma:migrate` (= `migrate deploy`).
   Tek migration: `20260817004721_fabrika_talep_2026_08_17`
   — `RollEntrySource.SEMI_FINISHED` + `dispatchWithoutColor` (2 tablo).
   Kolonlar `DEFAULT false`, veri dönüşümü YOK, vardiya dışı gerektirmez.
3. **Electron build** (senin Windows makinende).
4. **APK 2.7.5** tabletlere: `adb install -r` (kaldırma YOK — kaldırırsan cihaz
   kimliği silinir ve eşleştirme tekrar ister; madde 7 hâlâ açık).
5. **İzin ataması (ELLE):** `mobile:kk1-yari-mamul` hiçbir kullanıcıda yok.
   Yarı mamül kabulü yapacak kişiye panelden verilir. (Katalog koda, atama panele.)
6. **Rota şablonu:** "Yarı Mamül" (Kurşun+Tambur) panelden oluşturulur.

**Backend ÖNCE, istemciler SONRA.** Yeni uçlar (`order-links`, `target-color`,
`width`, `linkable-order-lines`) eski backend'de 404 verir.

---

## 4. Testler

- **Backend paketi:** tam tur koşuldu. Yeni bekçiler:
  `test_mobile_screen_permissions.ts` (6), `test_turkish_search_fold.ts` (22),
  `test_workorder_order_link.ts` (34), `test_semi_finished_entry.ts` (8).
  Dördü de **negatif sondayla** kırmızı verdiği doğrulandı.
- **Electron:** `npm run typecheck` temiz, `vitest` 74 dosya / 671 test yeşil.
- **Mobil:** `tsc --noEmit` temiz.

### ⚠️ Benim değişikliklerimden OLMAYAN iki kırmızı

Gece başında, **hiçbir şeye dokunmadan önce** de kırmızıydılar:

1. `test_work_session.ts` — dev DB'de 2026-08-15'ten kalma **açık bir çalışma
   oturumu** var ("Osman", Tablet db507d8d) → `MACHINE_OCCUPIED`. Ortam
   kirliliği; kodla ilgisi yok. Temizlemedim (canlı veriye dokunma kuralı) —
   o oturumu panelden kapatmak yeterli.
2. `test_wip_scorecard.ts` — "en uzun bekleyen listesi" kontrolü ortamdaki veriye
   BAĞIMLI (dev DB fabrika kopyası; testin 3 fixture'ından yalnız en eskisi
   listeye giriyor). Testin kendi kusuru — repo kuralı "ortamdaki veriye bağımlı
   olma"nın ihlali.

---

## 5. Sonraki tur için açık maddeler

- **Madde 7 (cihaz kimliği).** Teşhis planda yazılı: Android `ANDROID_ID`,
  iOS zaten doğru (Keychain uygulama silinse de kalır), Windows `MachineGuid`.
  `expo-application` paketi gerekiyor → APK riski var, cihazda denenmeli.
  **İmza anahtarınız sabit** (kontrol edildi) → `adb install -r` ile üzerine
  kurulumda kimlik korunuyor; sorun kaldır-kur ya da veri temizleme yapıldığında.
- **Madde 9'un KK1 arayüzü** (yukarıda).
- **Arama (madde 3) B yolu:** hacim büyür de yavaşlarsa PostgreSQL `unaccent` +
  ifade index'i. Bugünkü A yolu terim başına en fazla ~39 yaprak üretiyor.


---

# İKİNCİ TUR (aynı gün) — ek 4 madde + 2 düzeltme

Tam liste ve gerekçeler: [`docs/history/FABRIKA-TALEP-2026-08-17.md`](../design/FABRIKA-TALEP-2026-08-17.md)
→ "İKİNCİ TUR" bölümü.

| # | İş | Durum |
|---|---|---|
| 12 | Panel tazelenmiyordu (yanlış sorgu anahtarı) | ✅ Düzeltildi |
| 11 | Kutu ölü bileşendeydi, sahada görünmüyordu | ✅ Canlı editöre taşındı |
| 4 | "Son Kullanılan Parti No" rozeti + bayrak | ✅ |
| 8 | Modal içinde hızlı sipariş oluştur+bağla | ✅ |
| 9 | Electron tek buton + kutu · mobil KK1 mod anahtarı | ✅ |
| 12 | "Toplara da uygula" (parti bazında seçim) | ✅ |
| 13 | Tambur kalite sıfırlama tercihi (cihazda) | ✅ |
| 14 | İş emri listesinde Fason sütunu (geçmiş dahil) | ✅ |
| 15 | Siparişte "2/3 kalem bağlı" sayacı | ✅ |

## Ek deploy adımları (ilk turdakilere EK)

- **Migration YOK** (ikinci turda şema değişmedi).
- **Yeni ayar:** Genel Ayarlar → Parti → *"Son Kullanılan Parti No rozetini
  göster"* (varsayılan AÇIK, kayıt gerekmez).
- **APK 2.7.5** — KK1'de yarı mamül mod anahtarı ve Çalışma Tercihleri'ndeki
  yeni Tambur ayarı bu sürümde.
- **`mobile:kk1-yari-mamul` izni** hâlâ elle atanmalı; KK1'deki mod anahtarı
  yalnız o yetkiyle çizilir.

## Bu turda açılan yeni kapı

`GET /colors` artık `mobile:kk1-yari-mamul` iznini de kabul ediyor (KK1'in renk
seçicisi). Bekçi bunu geliştirme anında yakaladı ve muaf listesine gerekçesiyle
yazıldı — "ekran açılıyor ama liste boş" sınıfı bir hata sahaya inmedi.
