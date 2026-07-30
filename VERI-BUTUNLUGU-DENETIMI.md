# Veri Bütünlüğü Denetimi — AI Audit Talimatı

> Bu dosya bir yapay zeka ajanına (Claude Code, Cursor, vb.) verilmek üzere hazırlanmıştır.
> Kullanım: `Bu projeyi VERI-BUTUNLUGU-DENETIMI.md dosyasındaki talimata göre denetle.`

---

## 1. Görev

Bu kod tabanını **veri bütünlüğü (data integrity)** açısından denetle. Amaç; duplicate (çift) kayıt, orphaned/ghost (hayalet) kayıt, race condition ve kısmi başarısızlık (partial failure) kaynaklı veri bozulmalarını tespit etmek ve somut düzeltme önermek.

Yeni özellik yazma. Sadece analiz et, bul, kanıtla, düzeltme öner.

---

## 2. Aranacak Sorun Kategorileri

Aşağıdaki terimlerin her biri bir arama ekseni olarak kullanılmalıdır:

### 2.1 Çift / kopya veri
- `duplicate records` — aynı mantıksal varlığın birden fazla satırı
- `non-idempotent writes` — aynı isteğin tekrarı yeni kayıt üretiyor
- `double submit` — kullanıcı iki kez tıklıyor / client retry atıyor
- `at-least-once delivery` — kuyruk/webhook aynı mesajı iki kez teslim ediyor
- `retry storm` — timeout sonrası otomatik tekrar denemeler
- `duplicate side effects` — mail, SMS, ödeme, stok düşümü iki kez tetikleniyor
- `missing deduplication window` — tekrar tespiti için zaman penceresi yok

### 2.2 Hayalet / öksüz veri
- `orphaned records` — parent silinmiş, child kalmış
- `dangling references` — var olmayan ID'ye işaret eden FK/alan
- `ghost records` — mantıksal olarak silinmiş ama sorgularda hâlâ görünen
- `soft-delete leakage` — `deleted_at` dolu kayıtların rapor/sayaç/unique index'e sızması
- `missing referential integrity` — DB seviyesinde FK yok, sadece uygulama katmanı doğruluyor
- `cascade misconfiguration` — `ON DELETE` davranışı yanlış veya tanımsız

### 2.3 Eşzamanlılık (concurrency)
- `race condition`
- `lost update` — iki eşzamanlı yazma birbirini eziyor
- `TOCTOU` (time-of-check-to-time-of-use) — kontrol ile kullanım arası boşluk
- `concurrent write conflict`
- `missing optimistic locking` — version / updated_at kontrolü yok
- `missing pessimistic locking` — `SELECT ... FOR UPDATE` gerekli ama yok
- `missing distributed lock` — cron/worker birden fazla instance'ta çakışıyor
- `double-spend` — bakiye/stok/kontenjan aynı anda iki kez tüketiliyor

### 2.4 İşlem (transaction) sınırları
- `non-atomic transaction` — atomik olması gereken blok transaction dışında
- `missing rollback` — hata yolunda geri alma yok
- `wrong isolation level` — `dirty read`, `non-repeatable read`, `phantom read` riski
- `long-running transaction` — kilit süresi ve deadlock riski
- `nested transaction misuse`

### 2.5 Sistemler arası tutarsızlık
- `dual-write problem` — DB + dış servis (ödeme, mail, webhook, arama indeksi) aynı akışta
- `missing transactional outbox`
- `eventual consistency drift`
- `cache-DB inconsistency` — yazma sırası hatası, stale cache kalıcılaşması
- `missing reconciliation job` — mevcut bozuklukları bulan periyodik doğrulama yok
- `missing dead letter queue`
- `saga compensation failure` — telafi adımı eksik veya kendisi idempotent değil

### 2.6 Şema seviyesi eksikler
- `missing unique constraint` / `missing composite unique index`
- `missing foreign key`
- `nullable field that should be NOT NULL`
- `non-idempotent migration` — yarıda kesilirse tekrar çalıştırılamıyor
- `counter drift` — `SET x = <okunan değer>` yerine `SET x = x + 1` olmalı

---

## 3. Çıktı Formatı

### Bölüm A — Bulgular
Her bulgu için tek satır tablo/kart:

```
[Kategori] | Dosya:satır | Tetikleyen senaryo | Etki | Önem (Kritik/Yüksek/Orta/Düşük) | Düzeltme
```

- **Tetikleyen senaryo:** "Kullanıcı ödeme sonrası sayfayı yenilerse", "Webhook 5sn timeout sonrası tekrar gelirse" gibi somut olmalı.
- **Etki:** veri kaybı / çift kayıt / hayalet kayıt / yanlış bakiye / tutarsız rapor.
- **Düzeltme:** kod diff'i veya migration SQL'i.

Önem sıralaması: para, stok, kimlik/yetki ve kullanıcıya görünen sayaçları etkileyenler **Kritik**.

### Bölüm B — Idempotency Haritası
Yazma yapan tüm endpoint / handler / job / consumer'ları listele:

| Yol | Idempotent mi? | Neden değil | Önerilen anahtar (idempotency key) | Saklama süresi |
|---|---|---|---|---|

### Bölüm C — Şema Eksikleri ve Migration
Eksik unique/FK/NOT NULL constraint'leri listele ve **çalıştırılabilir migration SQL** ver.
Constraint eklemeden önce mevcut ihlal eden kayıtları bulan `SELECT` ve temizleyen `UPDATE/DELETE` sorgusunu da ver (sıra: tespit → temizlik → constraint).

### Bölüm D — Transaction Sınırları
Atomik olması gereken ama olmayan işlem blokları. Her biri için doğru sınırın nerede başlayıp bitmesi gerektiğini göster.

### Bölüm E — Doğrulama Sorguları
Şu anda veritabanında bozuk veri olup olmadığını gösteren, kopyala-çalıştır SQL'ler:
1. Duplicate tespiti (`GROUP BY ... HAVING COUNT(*) > 1`)
2. Orphan tespiti (`LEFT JOIN ... WHERE parent.id IS NULL`)
3. Soft-delete sızıntısı
4. Sayaç/toplam uyuşmazlığı (denormalize alan vs. gerçek `COUNT/SUM`)
5. Durum makinesi ihlalleri (imkânsız state kombinasyonları)

### Bölüm F — Regresyon Testleri
Her Kritik/Yüksek bulgu için test senaryosu:
- Aynı isteği eşzamanlı 2+ kez gönder
- İstek ortasında bağlantı kes / timeout
- Webhook'u iki kez teslim et
- Job'ı iki instance'ta aynı anda başlat
- Migration'ı yarıda kes, tekrar çalıştır

### Bölüm G — Öncelikli Aksiyon Planı
En fazla 10 madde, etki/efor sırasına göre.

---

## 4. Denetim Checklist'i

Aşağıdaki her soruyu kod üzerinde tek tek yanıtla. Yanıt: **Güvenli / Riskli / Doğrulanmalı** + gerekçe + dosya referansı.

### Yazma yolları
- [ ] Her `create` endpoint'i aynı isteği iki kez alırsa ne olur?
- [ ] Kritik akışlarda (ödeme, sipariş, kayıt, rezervasyon) client retry + timeout çift kayıt üretir mi?
- [ ] Idempotency key üretiliyor, saklanıyor ve kontrol ediliyor mu? Anahtar gerçekten benzersiz mi?
- [ ] `INSERT` yerine `upsert` / `ON CONFLICT` gereken yerler var mı?

### Şema
- [ ] Benzersizlik kuralı DB constraint'i ile mi korunuyor, yoksa sadece uygulama kodunda mı?
- [ ] Bileşik benzersizlik (ör. `user_id + slug`) gereken yerlerde index var mı?
- [ ] Tüm ilişkilerde FK tanımlı mı? `ON DELETE` davranışı bilinçli mi seçilmiş?
- [ ] Soft-delete kullanılan tablolarda unique index `deleted_at`'i hesaba katıyor mu?

### Eşzamanlılık
- [ ] İki eşzamanlı istek aynı satırı okuyup güncellerse lost update oluşur mu?
- [ ] Stok/bakiye/kontenjan düşümü atomik mi? (`SET x = x - 1 WHERE x >= 1` mi, yoksa oku-hesapla-yaz mı?)
- [ ] "Önce kontrol et, sonra yaz" deseni var mı? Aradaki boşluk kilitle korunuyor mu?
- [ ] Cron / scheduled job iki instance'ta aynı anda çalışırsa çakışır mı? Advisory lock var mı?

### İşlem bütünlüğü
- [ ] Birden fazla tabloya yazan akışlar tek transaction içinde mi?
- [ ] Hata yolunda rollback garantili mi? `catch` bloğunda yarım iş kalıyor mu?
- [ ] Transaction içinde dış servis çağrısı (HTTP, mail, ödeme) yapılıyor mu? (Yapılmamalı.)

### Dış sistemler
- [ ] DB yazma + dış servis çağrısı aynı akışta mı? Biri başarısız olunca diğeri telafi ediliyor mu?
- [ ] Outbox pattern veya eşdeğeri var mı?
- [ ] Kuyruk/webhook tüketicileri aynı mesajı iki kez alırsa ne olur? Deduplication var mı?
- [ ] Başarısız mesajlar nereye gidiyor? DLQ var mı, izleniyor mu?
- [ ] Cache ile DB arasında yazma sırası ne? Stale veri kalıcılaşabilir mi?

### Silme ve yaşam döngüsü
- [ ] Silme işlemi ilişkili kayıtları bırakıyor mu?
- [ ] Soft-delete edilen kayıtlar sorgu, rapor, sayaç, arama ve dışa aktarımlarda görünüyor mu?
- [ ] Kullanıcı silindiğinde ona bağlı tüm veri tutarlı hale geliyor mu?

### Veri taşıma ve toplu işlem
- [ ] Import/migration scriptleri yarıda kesilirse tekrar çalıştırılabilir mi (resumable + idempotent)?
- [ ] Toplu işlemler batch'lere bölünüyor mu, kısmi başarı yönetiliyor mu?
- [ ] Denormalize edilmiş sayaçlar/toplamlar gerçek veriyle periyodik olarak karşılaştırılıyor mu?

### Gözlemlenebilirlik
- [ ] Duplicate/orphan oluştuğunda fark edilir mi? Alarm/metrik var mı?
- [ ] Reconciliation job var mı? Ne sıklıkla, ne kontrol ediyor?

---

## 5. Kurallar

1. **Varsayım yapma.** Emin olmadığın yeri `DOĞRULANMALI` etiketiyle işaretle ve hangi bilgiye ihtiyacın olduğunu yaz.
2. **Kanıt göster.** Her bulguda dosya yolu ve satır numarası ver.
3. **Teorik risk ile gerçek risk'i ayır.** Bu kod tabanında fiilen tetiklenebilecek senaryoları öne al.
4. **Kod yazmadan önce raporu bitir.** Düzeltmeleri ancak onay verildikten sonra uygula.
5. **Yıkıcı işlem önerirken** (DELETE, constraint ekleme, migration) önce yedek/dry-run adımını belirt.
6. Çıktı dili: Türkçe. Teknik terimler İngilizce kalabilir.

---

## 6. Proje Bağlamı (doldur)

```
Stack:            (ör. Next.js + Prisma + PostgreSQL / WordPress + WooCommerce + MySQL)
ORM / Query katmanı:
Kuyruk / job sistemi:
Cache:
Dış entegrasyonlar:   (ödeme, kargo, mail, webhook...)
Kritik tablolar:      (para/stok/kimlik içerenler)
Deploy / instance sayısı:
Bilinen olaylar:      (daha önce yaşanmış çift kayıt vb.)
```
