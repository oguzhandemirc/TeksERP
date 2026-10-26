# Bildirim v2 — açma runbook'u (`bildirim.gelenKutusuEnabled`)

> Kim: kurulumu yapan / destek. Ne: yeni gelen kutusu + zil + bildirim tercihlerini bir fabrikada AÇMAK, ilk gün izlemek, gerekirse geri dönmek.
> Kurallar: `docs/kurallar/bildirim.md`. Ölçümler ve duman sonuçları: `docs/design/BILDIRIM-OLCUM-2026-10.md`.
> Bu belgede parola, ayar şifresi, TOTP ya da bağlantı dizesi YAZILMAZ; gerekenler kurulum kasasından alınır.

## 0. Ön koşullar

- Backend bildirim v2'yi taşıyan sürümde (2.15.13+) ve migration'lar uygulanmış (`prisma migrate deploy` yeşil; `notification_*` tabloları var).
- Panel ve tablet aynı ya da daha yeni sürümde (eski tablet bayrağı "kapalı" görür, zararsız).
- Backend TEK süreç; `NOTIFICATION_JOBS_ENABLED` tanımsız ya da `true` (yalnız yardımcı sunucuda `false`).
- Yedek alınmış (`yedek` ekranı; son başarılı yedek bugünün).
- Kişilerin izinleri doğru: bildirimi görme süzgeci izin + modüldür; profil izin VERMEZ.
- İsteğe bağlı: Sistem → Bildirim profilleri'nde fabrika varsayılanı / profiller önceden hazırlanır (bayrak kapalıyken de düzenlenebilir).

## 1. Bayrağı açma

1. Panelde `admin:settings` sahibi kullanıcıyla: Genel Ayarlar → **Bildirimler** kategorisi → "Yeni bildirim gelen kutusu" AÇIK → Kaydet (ayar şifresi tanımlıysa sorulur).
2. Doğrula: backend günlüğünde dağıtıcının başladığı satırı gör; panelde zil çizilir, Bildirimler sayfası açılır; `GET /api/bildirim/ozet` → `enabled:true`.
3. **İlk açılış su damgası:** her koşul türünün (termin geçti, iş emri gecikti, sevkiyat onay bekliyor…) ilk turu SESSİZ taban turudur — o an zaten var olan durumlar bildirim ÜRETMEZ, yalnız bundan sonra yeni oluşan/düzelen durumlar bildirim üretir. Bu yüzden açılıştan sonraki ilk dakikalarda zilin boş kalması NORMALDİR.

> Neden: su damgası olmadan ölçümde 807 birikmiş geciken sipariş 102 kişiye 125.766 gelen kutusu satırı üretti (2026-10-26, `BILDIRIM-OLCUM-2026-10.md` §3). Bayrağı kapatıp açmak tabanı YENİDEN alır: arada oluşmuş durumlar için de bildirim çıkmaz.

## 2. İlk gün izleme

Salt okuma sorguları (fabrika DB'sinde YALNIZ okuma; yazma/silme yok):

```sql
-- Bekleyen outbox (sıfıra yakın kalmalı; büyüyorsa dağıtıcı yetişmiyor ya da duruyor)
SELECT count(*) FROM notification_outbox WHERE "processedAt" IS NULL;

-- Tekrar denenen / hata alan satırlar
SELECT kind, attempts, "lastErrorCode", count(*)
FROM notification_outbox
WHERE "processedAt" IS NULL AND attempts > 0
GROUP BY 1, 2, 3 ORDER BY 4 DESC;

-- Açık koşullar (taban turundan sonra yavaş değişir; ani sıçrama yeni birikim demektir)
SELECT kind, count(*) FROM notification_conditions WHERE "resolvedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC;

-- Kişi başına okunmamış (bir kişide yüzlerce → tercih/profil gözden geçirilir)
SELECT "userId", count(*) FROM notification_inbox WHERE "readAt" IS NULL AND "resolvedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

- **SSE (zil) bağlantı sayısı:** ayrı bir sayaç ucu yok; sunucuda backend portuna kurulu bağlantı sayısı (`lsof -iTCP:<port> -sTCP:ESTABLISHED`) yaklaşık ölçüdür (açık panel sekmesi + ön plandaki tablet başına bir). Ölçüm: 500 akışta RSS ~465 MB, p95 gecikme 228 ms — normal fabrika ölçeği bunun çok altındadır.
- **Gecikme:** `endpoint_latency_daily`te yalnız `GET /api/bildirim/ozet` görünür (zil/bekle uzun yaşayan akış olduğu için ölçüm dışıdır).
- **Günlük:** "dağıtıcı" ve "koşul kaynağı … değerlendirilemedi" satırları; ikincisi koşulu KAPATMAZ (fail-closed), sonraki turda yeniden dener.

## 3. Geri dönüş

- **Bayrağı KAPAT** (aynı ekran). Etkisi: yeni bildirim yazılmaz, dağıtıcı ve koşul tarayıcısı durur, `/api/bildirim/*` 409 `BILDIRIM_KAPALI`, zil çizilmez, tezgah alarmı eski 15 sn yoklamasına döner. Veri SİLİNMEZ; yeniden açınca su damgası yeniden alınır (bkz. §1.3).
- Migration geri alınmaz; sürüm geri almaya gerek yoktur — bayrak kapalıyken davranış bildirim v2 öncesiyle aynıdır.

## 4. Bilinen sınırlar

- **Tablet LAN TLS sahada ölçülmedi:** tablet akışı (`expo/fetch` SSE) fabrika LAN TLS zincirinde henüz sahada denenmedi; akış kurulamazsa tablet uzun yoklamaya (`/bekle`), o da yoksa 30 sn `/ozet` yoklamasına iner — gecikmeli ama kayıpsız. İlk açılışta bir tablette zilin geldiğini gözle doğrula.
- **Tablet uyanık tutulmaz:** keep-awake eklenmedi; tablet arka plana/uykuya geçince akış kapanır, öne dönüşte kaçanlar `rev`/`epoch` farkıyla tamamlanır.
- **Masaüstü (OS) bildirimi varsayılan KAPALI:** kişi Bildirim tercihleri'nden tür seçer; pencere odaktayken OS bildirimi çıkmaz, uygulama içi tost çıkar.
- **İlk açılış su damgası:** açılış anında zaten var olan durumlar için bildirim çıkmaz; bu durumlar raporlarda/listelerde görünmeye devam eder.
- Gelen kutusu telemetridir: rapor sayısı buradan türetilmez; okunmuş 90 / okunmamış 180 gün sonra budanır.
