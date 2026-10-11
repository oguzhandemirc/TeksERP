# Backend `2.15.4`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (bizim yönettiğimiz Linux deneme
sunucusu); öncü/genel gruba ve Windows fabrika filosuna çıkış ayrı karar.
**Paket:** `tekserp-backend-oci-2.15.4.tar` (213302784 B; imaj config özeti `sha256:b55015b221a1e3de1e06296062516bbb7d48cf63f41b7d553e2c9a272cf5d990`, güncelleyici 0.2.5 `00c8d9e2c22915e2…`, kid `pkt-2026-1`, CI koşusu 38121071544)
**SHA256:** `e8ad1347d14508971f2737fc78e7ad975d6263c62e713160595e90d24858449d`
**Commit:** `556056a76` (etiket `backend-v2.15.4`; `test` grubu `backend-oci/2.15.4`, 2026-10-11)
**Önceki saha sürümü:** 2.15.3 yayında (`test` grubu). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce
sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). Güncelleme programı 0.2.5 (değişmedi), sunucu
hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

İki iş: **tezgah alarmı** ve **iş emri adlarının değişmesi**.

- **Tezgah alarmı gelir ama KAPALI gelir.** Açılmadıkça hiçbir şey değişmez, alarm tablolarına tek satır yazılmaz.
  Açmak için panelde **Genel Ayarlar → Tezgah izleme → "Tezgah alarmı"** (yeni panel gerekir). Açılınca hedef
  süresini aşan tezgah duruşu alarm olur; alarm görevliye, süre daha da uzarsa üst kademeye (patron/müdür) çalar.
  Görevli alarmı üstlenebilir, susturabilir, not düşebilir. Yalnız dokuma (tezgah) modülü açık kurulumda anlamlıdır.
- **Ad değişikliği:** "İş Emri" artık **"Terbiye İş Emri"**, "Dokuma İşi" artık **"Dokuma İş Emri"**. Sunucunun
  mesajları, belge/rapor/etiket başlıkları ve izin açıklamaları yeni adı kullanır. Sistemdeki kayıtlar, numaralar ve
  geçmiş değişmez — yalnız ekranda/belgede görünen ad.
- **Veritabanında değişiklik var** (yeni alarm tabloları) → güncelleme programı güncellemeden ÖNCE otomatik yedek
  alır; yedek alınamazsa güncelleme yapılmaz.

## 2. Ne değişti

Önceki etiket `backend-v2.15.3`e göre. Ölçüm: `git diff --stat backend-v2.15.3.. -- Teks-Erp/prisma Teks-Erp/src` —
bir yeni migration, alarm motoru + uçları, görünen ad değişikliği; güncelleme programı ve native kod farksız.

**Tezgah alarmı (bayrak `tezgah.alarmEnabled`, VARSAYILAN KAPALI)**

- `5944bdaba` — alarm durum tablosu `loom_alarms` + değişmez olay defteri `loom_alarm_events` (migration
  `20261011090000_loom_alarm`), kademe motoru ve zamanlayıcı işi `loom-alarm.job`. Bayrak kapalıyken iş hiçbir satır
  yazmaz (ölçüldü: kapalıyken 0 satır).
- `b2398d55d` — yeni uçlar `/api/loom-alarms` (liste · detay · üstlen · bırak · sustur 15/30/60 dk · susturmayı kaldır
  · not ekle · not geri çek); kapı: tezgah modülü kapalıysa 403 `MODULE_DISABLED`, alarm bayrağı kapalıysa 403
  `LOOM_ALARM_DISABLED`. Yeni izinler `loom:alarm-view` · `loom:alarm-ack` · `loom:alarm-escalation` (katalog boot'ta gelir, ROLE ATANMAZ —
  atama panelden). Tezgah Salonu'nda üst kademeye çıkmış alarm `ESCALATED` görünür (yalnız bayrak açıkken).
- `068fe4055` · `6eccde3f8` — denetim etiketleri, makine silme seddi, bekçi kararlılığı düzeltmeleri.
- `c17fac11e` — ekran kataloğuna Alarmlar ekranı.
- `6b5575624` — Genel Ayarlar alarm satırları ayar şifresi kapsamına (`settings:dokuma`): `tezgahAlarmEnabled`,
  `tezgahAlarmUnclassifiedTargetMinutes` (sebebi girilmemiş duruşun hedef süresi), `tezgahAlarmRenotifyMinutes`
  (tekrar çalma aralığı), `tezgahAlarmEscalateWhenAcked` (üstlenilmiş alarm da üst kademeye iletilsin).

**Görünen ad: Terbiye İş Emri / Dokuma İş Emri**

- `55250464c` — tek kaynak terim modülü `src/constants/terim.ts` + eski ad cırcırı.
- `3b881feef` — sunucu mesajları ve kataloglar (izin açıklaması, rol şablonu, sebep, numara serisi etiketi, ekran,
  arama) yeni adla.
- `f73099ea1` — belge/rapor/etiket alan adları (refakat kartı, fason çeki/kabul, doğrudan sevk).
- `97c464539` — demo/seed + olay adı `TERM_CATALOG_TEXT_MIGRATED` + **veri göçü betiği**
  `scripts/terim_katalog_metin_gocu.ts` (aşağıda §4).

**Diğer**

- `9d1d674ee` — hesap kilidi ayak izi yanıttan önce yazılır (davranış aynı; bekçi kararsızlığı).

**Pakete girmeyen:** panel (alarm zili, Alarmlar listesi/sayfası, kırmızı şerit, alarm sesi, Genel Ayarlar alarm
satırları, panelin yeni adları), tablet ve patron uygulamasının yeni adları — ayrı sürümlerle çıkar. Bekçiler ve
belgeler.

**Değişmeyen:** var olan uçların sözleşmesi, var olan alanların anlamı, güncelleme programı. `dist-web` bu imajda
yok (Docker).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: yeni uç ailesi `/api/loom-alarms`, üç yeni izin, dört yeni ayar anahtarı,
  Tezgah Salonu'nda alarm bayrağı açıkken yeni kademe değeri `ESCALATED` + `alarmId`. Mesaj metinlerinde ad
  değişikliği (kod/alan adı değil).
- **Eski istemci ne yapar:** eski panel yeni uçları çağırmaz, alarm ayarını göstermez; bayrak kapalı geldiği için
  hiçbir fark görmez. Eski panel/tablet sunucudan gelen mesajlarda yeni adı ("Terbiye iş emri") görür, kendi
  ekranında eski adı — karışık ad geçicidir, yeni panel/tabletle kapanır. Tablet alarm uçlarını kullanmaz.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 1 adet: `20261011090000_loom_alarm` (yalnız EKLEME: üç yeni enum tipi, iki yeni tablo, indeks,
  CHECK ve defter mührü; var olan tabloya kolon/backfill YOK).
- **Toplam migration:** 375 (2.15.3'te 374). 2.15.3'ten gelen kurulum tam 1 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR.
- **Prova:** en eski canlı ham dump'ta (`tekserp_yeni_20260923_030001`, 238 migration) restore → `migrate deploy`
  (137 migration, rc=0) → doğrulama kipinde açılış (`/health/yerel` 200) yapıldı — **dört ayağın üçü (3/4)**;
  bekçilerin canlı dump'a karşı koşulması (4. ayak) kullanıcı kararına bırakıldı, YAPILMADI.
- **Veri yazan adımlar:** güncelleme sırasında YOK. Ad değişikliğinin veri göçü betiği
  `scripts/terim_katalog_metin_gocu.ts` pakete GİRER ama güncelleme onu **KOŞMAZ**: varsayılanı kuru koşumdur
  (yalnız listeler); fabrika veritabanına yazım yalnız `--apply --canli-onay` ile ve kullanıcının açık onayıyla.
  Kapsam: izin açıklamaları, kodlu rol şablonu adları, sistem sebep metinleri, etiket alan etiketleri — YALNIZ metin
  hâlâ eski kod varsayılanına birebir eşitse; fabrikanın elle değiştirdiği metne ve hareket/olay satırlarına
  dokunmaz. Koşulmazsa var olan bu satırlar eski adla kalır (iş etkisi yok, yalnız görünen metin).
- **Geri alınabilir mi:** migration geri alınmaz. İmaj 2.15.3'e dönebilir: yeni tablolar eski sürümce okunmaz, iş
  akışı etkilenmez. Tam dönüş = güncelleme öncesi yedekten geri yükleme.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 1 migration); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; alarm ekranlarını ve yeni adları gösteren panel/tablet sonra.
- **Bu sürüme özel:**
  - Migration var → güncelleme programı güncellemeden önce otomatik yedek alır (ONAYLI kipte panel onayından sonra).
    Yedek adımı geçmeli.
  - Alarm KAPALI gelir; kurulumdan sonra açılmaz. Açma kararı fabrikanındır (Genel Ayarlar → Tezgah izleme, yeni
    panel). Açmadan önce `loom:alarm-*` izinleri ilgili rollere panelden atanmalıdır.
  - Ad göçü betiği kurulumun parçası DEĞİLDİR; koşulacaksa ayrı adım, önce kuru koşum listesi, sonra kullanıcı onayı.
- **Bilinen sınırlar (dürüst):** 2.15.0–2.15.3 belgelerindeki güncelleme programı sınırları aynen geçerli. Alarm
  bildirimi yalnız panel içinde (zil, şerit, ses; Electron'da işletim sistemi bildirimi) — tarayıcıdaki web panelinde
  işletim sistemi bildirimi yok; sessiz saat yok. Patrona iletim payı 0 iken birinci ve üst kademe aynı anda çalar.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Migration geri alınmaz; 2.15.3 imajı yeni tablolarla açılır (onları okumaz).
Veriyi güncelleme öncesine döndürmek gerekirse otomatik yedekten geri yüklenir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.4, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.4, güncelleme programı 0.2.5, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Yedek: güncelleme öncesi yedek alındı; günlükte `SEMA_OLCULEMEDI` yok.
- Veritabanı: 375 migration bitmiş, sorunlu migration yok; `loom_alarms` ve `loom_alarm_events` var ve BOŞ (bayrak
  kapalı).
- `GET /api/loom-alarms` bayrak kapalıyken 403 `LOOM_ALARM_DISABLED` (tezgah modülü kapalı kurulumda
  `MODULE_DISABLED`) döner.
- İmajın bütünlük öz-denetimi geçerli (açılış günlüğü).
- Hata günlüğünün son satırları — yeni hata var mı.
