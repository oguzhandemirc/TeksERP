# Sürüm belgesi şablonu — `backend-<sürüm>.md`

> Bu dosyayı KOPYALA, adını `backend-2.9.9.md` gibi ver ve doldur.
> Şablonun kendisi kapıdan MUAFTIR (`SABLON.md` adı bekçide adıyla dışlanır).

---

## Bu belge kime yazılıyor

**Paketi KURAN kişiye ya da oturuma.** Bugün kurulumu fabrikadaki Claude oturumu
yapıyor ve o **dosya okuyor, sohbet geçmişi değil**. Belge bu yüzden var: kuran
taraf, paketi üretenin sohbetine muhtaç olmasın.

⚠️ Operatör sürüm notuyla KARIŞTIRMA. `surum-notlari.json` fabrikadaki
**operatöre** yazılır (panel/tablet, uygulama içinde gösterilir, teknik terim
yasak). Bu belge **mühendise/kurana** yazılır ve teknik terim serbesttir.
Backend'in operatör notu YOKTUR ve olmayacaktır — operatör sunucuyu görmez.

## Yedi başlık neden sabit

Serbest metin altı ay sonra doldurulamaz; sabit başlık soruyu **sormaya zorlar**.
2026-09-10'da `dist-web`in yeniden derlendiği tam bu yüzden atlandı — "ne
değişti" diye bir başlık olsaydı soru sorulmuş olurdu.

Başlığın karşılığı yoksa **sil değil, "yok" yaz**. Boş bırakılan başlık
"unutuldu mu, yok mu" sorusunu açar; bekçi de doldurulmamış başlığı kırmızı verir.

---

# Backend `<sürüm>`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
⚠️ Yukarıdaki üç alanı ELLE DOLDURMA — `paketle.ps1` paketi ürettikten sonra
kendisi yazar. SHA256'yı insanın kopyalaması tam da hatanın çıkacağı yerdir.

**Önceki saha sürümü:** `<sürüm>` ⚠️ TAHMİN ETME — `git tag -l "backend-v*"` ya da
kurana `/health` sordur. 2026-09-10'da "2.9.6" denildi, sahadaki 2.9.7'ydi.

## 1. Özet

<Tek cümle. "Ne için çıktı" sorusunun cevabı.>

## 2. Ne değişti

- `<commit>` — <madde>
- …

⚠️ `dist-web` (patron modülü web arayüzü) pakete GİRER ve Electron kaynağından
derlenir → **panel değişen her turda değişir**. Değiştiyse burada beyan et.

## 3. Sözleşme

- **Kırıldı mı:** hayır / evet + hangi uç
- **Eski istemci ne yapar:** <altı tetik: uç kaldırma · alan adı · tip/birim ·
  zorunlu parametre · enum · izin>
- **`minVersion` dokunuldu mu:** hayır / evet (⚠️ sahadakinden BÜYÜK olamaz;
  önce istemci yayınlanır)

## 4. Migration

- **Var mı:** hayır / evet — `<n>` adet
- **Toplam migration:** `<n>` (önceki sürümle aynıysa yaz — kuran `[7/9]`da
  "No pending migrations" bekler; UYGULARSA bu beklenmedik bir durumdur, DURMALI)
- **Geri alınabilir mi:** HAYIR (bu depoda migration geri alınamaz; rollback =
  yedekten restore)

## 5. Kurulum notu

- **Beklenen kesinti:** `<sn>`
- **Sıra:** backend ÖNCE, panel/tablet sonra (kırılma yoksa sıra serbest — yaz)
- **Bu sürüme özel:** <yoksa "yok">
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK ·
  uygulanmış migration'a dokunma · postgres/node süreçlerini `Stop-Process` ile
  durdurma · `C:\Etkili-Yazilim` ve junction'lara dokunma · `-GeriAl` ile
  `-Zorla` birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME ·
  **`[7/9]` migration eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**

## 6. Geri alma

`kur.ps1 -GeriAl` <ya da bu sürüme özel yol>. Eşik ÖNCESİ hata: script kendini
toplar, `app.eski-*` oluşmaz. Eşik SONRASI: yedekten restore.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 list` (online mı, restart sayısı)
- `/health` (api + db + version)
- `backend-err.log` son 30 satır — yeni hata var mı
- ölçülen kesinti
- <bu sürüme özel doğrulama; yoksa "yok">
