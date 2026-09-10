# Backend `2.9.9`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.9.8** (kurulum 2026-09-07 07:51, `SONRASI-3-2026-09-07.txt`)

## 1. Özet

Saha log'undan ve saha turundan çıkan sekiz düzeltme: muhasebe fişi Excel'i
irsaliyedeki adı basıyor, üç sessiz arıza kapatıldı (şablon önizlemesi 403,
etiket audit izi, offsite hedefi), iki teşhis altyapısı eklendi (süreç uyarısı
yığın izi, kapanış faz log'u). **Yeni migration yok, sözleşme kırılmadı.**

## 2. Ne değişti

- `b18af0d0` — **Muhasebe sevk fişi Excel'i ad rejimini uyguluyor.** Aynı
  sevkiyatın PDF'i müşterinin adını, Excel'i bizim adımızı basıyordu; ikisi de
  aynı donmuş belgeden besleniyordu, karar tek helper'a taşındı
  (`resolveDocNameMode`). Fiş ucu artık `docNameMode` alanını taşıyor.
- `90d7c482` — **Şablon önizlemesi dar izinli tasarımcıya 403 veriyordu.**
  `POST /printed-documents/:docType/sample-html` yalnız `admin:settings`
  taşıyordu; ekranın kendisi `DOCUMENT_DESIGN_READ`e taşınmıştı. Fabrika
  log'unda 4 kez 403. Belge tasarım yüzeyinin dört ucundan biri atlanmıştı.
- `7693cfa8` — **Etiket "Bas" audit izi düşmüyordu** (mobil).
  `POST /api/labels/rolls/null/print` → 400. Fiziksel baskı çalışıyordu, yalnız
  `LABEL_PRINTED` audit'i yazılmıyordu — sessiz ve bu yüzden ağır.
- `a55ab875` — **Kapanış 5 sn'yi doldurunca NEREDE takıldığını söylüyor.**
  Fabrikada 6 kapanışın 2'si zorla bitmişti ve log'da tek cümle vardı.
- `4d1a2ebf` — **Süreç uyarıları yığın iziyle log'a.** `pg` DeprecationWarning'in
  nereden geldiği `--trace-deprecation` (= yeniden başlatma) olmadan görünür.
- `d508bb60` — **`kur.ps1` [5/9] dosya kilidi yarışı.** 2.9.8'in BİRİNCİ denemesi
  bu yüzden düşmüştü; taşıma artık 5 kez ısrar ediyor.
- `7b84d5ea` — **K-1** (offsite hedefi göreli yazılınca yedekler aynı diske
  gidiyor ve ekran yeşil diyordu) · **O-1** ("Otomatik yedek saati" ölü
  kumandaydı, artık kilitleniyor) · `[offsite]` açılış yanlış alarmı kaldırıldı ·
  `kur.ps1` çıkış kodu toplaması ve `[4/9]` "not found" satırı.
- `5c668a9e` — Üretim kodunda tanımlayıcılar İngilizce + commit kapısı ([IL-16]).
  Davranış değişikliği YOK.
- `940df11e` — Karar notları + kural satırları (belge).

**`dist-web` DEĞİŞTİ.** Panel kaynağı bu turda 11 dosyada değişti
(`b18af0d0`→`940df11e`), web arayüzü paketi yeniden derlendi. Patron modülünü
kullanan kurulumlarda arayüz güncellenir.

## 3. Sözleşme

- **Kırıldı mı:** hayır.
- **Eski istemci ne yapar:** çalışmaya devam eder. Yeni alanların ikisi de
  EKLEME: `dispatch-report.docNameMode` ve `GET /backups.scheduleEnabled`.
  Görmeyen istemci bugünkü davranışı sürdürür (Excel bizim adımızı basar,
  yedek saati kumandası açık kalır) — yeni davranışın varsayılanı = bugünkü.
- **İZİN GENİŞLEDİ (daralmadı):** `sample-html` ucu `admin:settings` →
  `DOCUMENT_DESIGN_READ`. Daha önce erişebilen herkes erişmeye devam eder;
  `document-template:read` taşıyanlar ARTIK erişebilir. Kimse yetki kaybetmez.
- **`minVersion` dokunulmadı.**

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** **238** — 2.9.8 ile AYNI. Kuran `[7/9]`da
  `"No pending migrations to apply."` bekler. **Uygularsa bu beklenmedik bir
  durumdur → DUR ve insana rapor et.**
- **Geri alınabilir mi:** konu dışı (migration yok). Genel kural: bu depoda
  migration geri alınamaz, rollback = yedekten restore.

## 5. Kurulum notu

- **Beklenen kesinti:** ~25 sn (2.9.8'de ölçülen: 23 sn).
- **Sıra:** serbest — sözleşme kırılmadı. Panel 1.3.2 ile birlikte gitmesi
  önerilir; Excel düzeltmesi İKİSİNİ birden ister (backend alanı gönderir,
  panel kolonu çizer). Biri eksikken çıktı bugünkü gibi kalır, bozulmaz.
- **Bu sürüme özel:** `kur.ps1` DÜZELTMESİ BU PAKETTE. 2.9.8'in birinci
  denemesini düşüren `[5/9]` yarışı kapatıldı — taşıma 5 kez ısrar ediyor ve
  düşerse hatayı aynen fırlatıyor (otomatik geri alma yine koşar). Paketin
  içindeki `kur.ps1` ile yanına konan gevşek `kur.ps1` AYNI olmalı; SHA256'ları
  karşılaştırılmadan kurulum başlatılmaz.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK ·
  uygulanmış migration'a dokunma · postgres/node süreçlerini `Stop-Process` ile
  durdurma · `C:\Etkili-Yazilim` ve junction'lara dokunma (`C:\TeksERP\pgsql\bin`
  oraya bakan bir junction, pm2 daemon ikilisi de orada) · `-GeriAl` ile `-Zorla`
  birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME ·
  **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**

## 6. Geri alma

`C:\TeksERP\kur.ps1 -GeriAl`. Eşik ÖNCESİ hata: script kendini toplar,
`app.eski-*` oluşmaz, mevcut kurulum yeniden başlar (2.9.8'de fiilen yaşandı,
kesinti 3 sn). Eşik SONRASI: yedekten restore.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 list` (online mı, restart sayısı)
- `/health` (api + db + version) — `/api/admin/health` kimlik ister, `/health` yeter
- `[7/9]` satırı: `"No pending migrations to apply."` çıktı mı
- `backend-err.log` son 30 satır — yeni hata var mı
- **`[offsite]` açılış uyarısı ARTIK ÇIKMAMALI** (yanlış alarm kaldırıldı);
  çıkıyorsa hedef gerçekten tanımsızdır
- ölçülen kesinti
- **`pg` DeprecationWarning yeniden çıkarsa YIĞIN İZİNİ ilet** — bu sürümde
  dinleyici eklendi, artık çağrı yerini yazıyor. Teşhisi o kapatacak (D-2).
