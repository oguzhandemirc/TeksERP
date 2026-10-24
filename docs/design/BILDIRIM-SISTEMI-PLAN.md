# Bildirim sistemi v2 — gelen kutusu, zil, alarm bağlantısı, tercihler: dilimli plan

**Durum: TASLAK 2026-10-24**, patron oturumu · Yazan: plan yazarı ajanları (araştırma+tasarım ajanı → bitiriş ajanı) · Girdiler: `scratchpad/bildirim/{KARARLAR,R-N1-mevcut,R-N2-tasarim,DEVIR-PLAN}.md` · Ana dal `main` @ `2bd3d7b08` (yollar bu SHA'da doğrulandı; YENİ işaretliler henüz yok).

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir; her dilimin ajan istemi `scratchpad/bildirim/istemler/<KOD>.md`dedir, oradaki sözleşme buradakinin kopyasıdır (çelişirse BURASI kazanır; BURASI `KARARLAR.md` ile çelişirse KARAR kazanır).

## 0 · Amaç, istek, ek şart, kapsam dışı

**Amaç.** Bugünkü panel zili (`NotificationBell.tsx`) bir bildirim sistemi değildir: `SystemLog`dan son aktiviteyi okur ve "okunmamış" sayısını audit'ten türetir — bu çekirdek kurala aykırıdır (audit yalnız ayak izidir). Kişiye özel, okunabilir/ertelenebilir, birleşen, gerçek zamanlı bir gelen kutusu yoktur; tezgah alarmı kendi 15 sn yoklamasıyla tek başına yaşar.

**Kullanıcı isteği (özet).** Üç sınıf: ALARM (onay ister), BİLDİRİM (kişisel gelen kutusu, OLAY/KOSUL), ETKİNLİK (sayaçsız akış). İş işlemiyle aynı transaction'da outbox, tek süreç içi dağıtıcı, içeriksiz SSE zil, panelde gerçek okunmamış sayısı; tezgah alarmı bu kanala bağlanır; masaüstü OS bildirimi; tablet gelen kutusu ve şeridi; patron push hazırlığı.

**Ek şart (kullanıcı).** Herkes kendi bildirimini seçebilmeli ama yönetici zorunlu olanları kilitleyebilmeli: katalog → fabrika varsayılanı → bildirim profili → kullanıcı tercihi katmanları; katı şemalı tercih tablosu; takip; kapsam süzgeçleri; sessiz saat; gün özeti; "haftada ~N bildirim" önizlemesi.

**Kapsam dışı (bilerek, v2+):** e-posta/SMS/WhatsApp (F6 yok) · sel kapağı (kullanıcı başı dakika sınırı) · genel alarm motoru ve tezgah alarmına K3 kademesi · @bahsetme · sistem tepsisi (tray) · "müşterilerim" süzgeci (temsilci alanı yok) · FCM/ntfy/ön plan servisi (tablet) · patron push'un canlıya açılması (F5 yalnız hazırlık) · kök `CLAUDE.md` alan dizinine `bildirim` satırı (1e/kullanıcı kararı).

## 1 · Teşhis (R-N1)

1. Zil `SystemLog`dan okur ve okunmamış sayısını audit'ten türetir (`test_audit_okuma_kaynagi` beyanı `audit-okuma-beyan.ts:51` "son aktivite zili" DENETIM_EKRANI olarak muaf tutuyor; sayı türetme yine de kural ruhuna aykırı).
2. Zil yalnız `admin:settings` sahibine görünür; Etkinlik sayfası (`/system/activity`) ise `admin:settings ∨ system:activity` ister — iki kapı tutarsız.
3. Kişiye özel kayıt yok: okundu/ertele/birleştirme, "neden aldım", derin bağlantı yok.
4. Gerçek zamanlı kanal yok; panel ve tablet tezgah alarmını 15 sn yoklar (`alarm-bell-query.ts`).
5. Durum-temelli uyarılar (yedek alınamadı, eşitleme gecikti, lisans, güncelleme onayı, termin, gecikme) yalnız ilgili sayfaya girilince görülür; kimse "çözüldü" haberini almaz.
6. Masaüstü OS bildirimi yalnız tezgah alarmı için var (`loom-alarm-notify.ipc.ts`); rozet/overlay yok.
7. Tercih, takip, sessiz saat, profil kavramı yok; patron bulutu kataloğu (`patron/sunucu/src/catalog/notifications.ts`) fabrikayla ad hizasında değil.

## 2 · Kararlar B1–B7 (bağlayıcı; tam metin `KARARLAR.md`) + onaylı yorumlar

| # | Karar (kısa) |
|---|---|
| B1 | Üç sınıf: ALARM (onay, kademe, nöbetteyken kapatılamaz yalnız süreli susturulur; `LoomAlarm` ilk üye, tabloları KALIR, genel sisteme kanal/alıcı/gelen kutusuyla bağlanır; K3 yok) · BİLDİRİM (gelen kutusu; OLAY ve KOSUL; aynı konu birleşir) · ETKİNLİK (sayaçsız; eski zil içeriği Etkinlik sayfasına; audit'ten sayı türetme kalkar). |
| B2 | Yeni paket yok. Aynı tx'te `notification_outbox` (tek yazar `emitNotification`; katalog dışı tür derleme+bekçi hatası); dağıtıcı commit sonrası tetik + 5 sn süpürme, advisory kilit envanterine yeni uzay, atomik claim; gelen kutusu `ON CONFLICT (alıcı, tekil_anahtar) DO UPDATE`; gelen kutusu TELEMETRİ (okunmuş 90/okunmamış 180 gün, outbox işlendikten 7 gün); içeriksiz SSE zil, istemci başına TEK bağlantı, düşüş uzun yoklama; varsayılan KAPALI başlar. |
| B3 | Aşamalar F0 (zil→Etkinlik, katalog, bekçi) · F1 (çekirdek + panel gelen kutusu + v1 türleri) · F2 (tezgah alarmı SSE'ye; yoklama 15→60 sn yedek) · F3 (masaüstü OS + overlay/flash/rozet) · F4 (tercih, takip, profil, yönetici ekranı, tablet gelen kutusu/şerit, sessiz saat, gün özeti) · F5 (patron push HAZIRLIK, bayrak arkasında) · F6 yok. Tablet ön plan cihazıdır; `expo-keep-awake` yalnız istasyon ekranlarında (veto). |
| B4 | Görme süzgeci TEK helper `canSeeNotificationType(user, tür)` = izin ∧ modül; tercih ekranı, dağıtım, okuma aynı helper (AST bekçisi); izin kaybı → gizlenir (fail-closed). Alıcı kaynakları birleşir, sonra görme süzgeciyle KESİŞİR (kural yetki genişletmez); alıcı listesi olay anında DONAR; aktör hariç. |
| B5 | Tercih katmanları + kilit (kullanıcı kapatamaz, erteler) + katı şemalı `notification_preferences` (gevşek JSON yasak) + kapsam süzgeçleri + takip (oluşturan otomatik, "bırak" otomatiği ezer) + kanal × tür + sessiz saat + gün özeti + önizleme + `settings:notifications` izni. |
| B6 | v1 ≈12 tür (bu planda 13; §4); katalog tek kaynak dosya + bekçi; basit yer tutuculu Türkçe şablon (LiquidJS değil); patron kataloğu ad hizası F5'te. |
| B7 | Worktree + PR + CI; Opus high (mekanik Sonnet); imza Opus 5.5; force-push yasak → merge; literal `unlink`; belge şablon tasarımcısı işiyle bölge-yerel ekleme. |

**Patron onaylı yorumlar (Karar):**

- **Karar Y1 — "bildirim modülü" bir DAVRANIŞ BAYRAĞIDIR.** `modul-bayrak.md` çekirdeği "`MODULE_FLAG_KEYS` dokuzdur, genişletilmez" der; modül anahtarı eklenmez. DB anahtarı `bildirim.gelenKutusuEnabled`, sabit `SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED`, API alanı `bildirimGelenKutusuEnabled`, varsayılan **false** (= bugünkü davranış). Kapalıyken: `emitNotification` no-op (outbox satırı yazılmaz), dağıtıcı ve koşul tarayıcısı başlamaz, `GET /api/bildirim/ozet` 200 `{enabled:false}`, diğer `/api/bildirim/*` uçları 409 `details.code=BILDIRIM_KAPALI`, alarm yoklaması 15 sn aynen. Kapsam tablosuna girmez → yalnız `admin:settings` yazar. Yalnız F0 (eski zilin kalkması, Etkinlik bağlantısı) bayraksızdır.
- **Karar Y2 — sessiz saat ve alarm.** Sessiz saat ALARM sınıfını kendiliğinden bastırmaz: **nöbetteki alıcıya** (alıcı kaynağı `HALL_SHIFT` / `DUTY_OVERRIDE` / `USER` kademe kuralı) alarm sessiz saatte de ses + OS bildirimiyle çalar; **nöbet dışındaki alıcıya** (`PERMISSION` / `BY_PERMISSION` düşüşü) sessiz saat uygulanır. Gelen kutusu satırı her durumda yazılır; sessiz saat yalnız ses/OS/tablet sesi kanallarını susturur.
- **Karar Y3 — önizleme verisi ayrı sayaç tablosundan.** Outbox 7 günde budanır, önizleme 30 gün ister → `notification_daily_stats (factoryDay @db.Date, kind, events)` günlük sayaç tablosu, tekil (factoryDay, kind), 35 günde budanır. Veri yoksa katalog `tahminiHaftalik` kullanılır.

## 3 · Mimari

### 3.1 Veri akışı

```
iş işlemi tx ──► emitNotification(tx, kind, subject, payload)  ──► notification_outbox (aynı tx; bayrak kapalıysa no-op)
                    │ commit sonrası kickDispatcher() (nudge-coalescer)
koşul tarayıcısı ──► notification_conditions (ACILDI/KAPANDI) + emit (aynı tx)
                    ▼
dağıtıcı (5 sn süpürme + kick; tx: 8040 kilidi → FOR UPDATE SKIP LOCKED LIMIT 100)
   alıcı çözümü (izin ∪ takipçi ∪ nöbet ∪ liste) ∩ canSeeNotificationType ∖ aktör → tercih/kilit/kapsam (F4)
   → toplu INSERT … ON CONFLICT (userId, groupKey) WHERE resolvedAt IS NULL DO UPDATE → processedAt
   → notification_daily_stats += 1 → tx sonrası hub.zil(userIds)
SSE hub ──► `zil {k, rev, alarmRev}` (içeriksiz) ──► panel / tablet REST'ten okur (/ozet, /)
```

### 3.2 Tablolar (F1 — N1-SEMA)

Ortak: UUID PK `@db.Uuid`, `createdAt`/`updatedAt` `@db.Timestamptz`, tablo adları snake_case `@@map`.

- **`notification_outbox`**: `kind varchar(64)` · `phase varchar(16)` CHECK ∈ {OLAY, ACILDI, KAPANDI, GUNCELLENDI} · `subjectType varchar(32)` · `subjectId uuid?` · `subjectKey varchar(160)` · `conditionId uuid?` · `actorUserId uuid?` · `payload jsonb` (yalnız kimlikler ve görüntü dizeleri: belgeNo, kod, ad; **tutar yok**) · `dedupeKey varchar(200)` · `occurredAt` · `claimedAt?` · `processedAt?` · `attempts int` CHECK ≥0 · `lastErrorCode varchar(64)?` · `recipientCount int?`. İndeks: partial `(createdAt) WHERE processedAt IS NULL`. `kind` CHECK YOK (yeni tür migration istemesin; tek kaynak katalog + bekçi).
- **`notification_inbox`**: `userId` FK users · `kind` · `klass` CHECK ∈ {ALARM, BILDIRIM} · `subjectType` · `subjectId?` · `groupKey varchar(200)` · `count int` CHECK ≥1 · `firstAt` · `lastAt` · `lastOutboxId uuid` · `payload jsonb` · `reason varchar(16)` CHECK ∈ {IZIN, TAKIPCI, OLUSTURAN, NOBET, LISTE, ALARM_ALICISI} · `kanalMasaustu bool` · `kanalTablet bool` · `ozet bool default false` · `readAt?` · `snoozedUntil?` · `resolvedAt?`. PARTIAL UNIQUE `(userId, groupKey) WHERE resolvedAt IS NULL`; indeks `(userId, lastAt DESC)`.
- **`notification_conditions`**: `kind` · `subjectKey` · `subjectType` · `subjectId?` · `openedAt` · `resolvedAt?` · `payload`. PARTIAL UNIQUE `(kind, subjectKey) WHERE resolvedAt IS NULL`.
- **`notification_daily_stats`**: `factoryDay @db.Date` · `kind` · `events int` CHECK ≥0; UNIQUE `(factoryDay, kind)`. `@db.Date` aynı commit'te `test_timestamptz_contract` muafına (fabrika günü dilimden hesaplanır, `src/constants/time.ts`).

Polimorfik `subjectId` FK'sızdır (telemetri; şemada `///` gerekçe). Partial unique'ler migration SQL'inde yazılır ve `test_db_invariants` `PARTIAL_INDEXES` listesine girer. Migration `npx prisma migrate dev --create-only`, `DropForeignKey` satırları silinir, SQL idempotent (`IF NOT EXISTS`), yalnız ek tablo → eski kod yeni şemayla çalışır.

### 3.3 Tablolar (F4 — N4-SEMA)

- **`notification_preferences`**: `userId`, `kind`, `channel` CHECK ∈ {UYGULAMA, OZET, MASAUSTU, TABLET_SES, PATRON_PUSH}, `enabled bool`, `scope jsonb?`; UNIQUE `(userId, kind, channel)`; SEYREK (yalnız katman sonucundan sapma yazılır).
- **`notification_user_settings`**: `userId @unique`, `quietStart`/`quietEnd varchar(5)?` ("HH:MM", CHECK biçim), `quietChannels text[]`, `digestHour smallint?`, `sound bool`.
- **`notification_profiles`**: `code`, `name`, `archivedAt?`, `clientToken @unique`.
- **`notification_profile_cells`**: `profileId`, `kind`, `state` CHECK ∈ {ACIK, KAPALI, KILITLI}; UNIQUE `(profileId, kind)`; saf yapılandırma pivotu (replace = hard delete serbest).
- **`notification_profile_members`**: `profileId`, `userId`; UNIQUE `(profileId, userId)`; pivot.
- **`notification_factory_defaults`**: `kind @unique`, `state` CHECK ∈ {MIRAS, ACIK, KAPALI, KILITLI}, `params jsonb` (katalog zod şemasıyla doğrulanır; eşikler), `extraRecipientIds uuid[]`.
- **`record_follows`**: `userId`, `orderId?`, `workOrderId?`, `weavingOrderId?` + CHECK `num_nonnulls(orderId, workOrderId, weavingOrderId) = 1` + üç partial unique `(userId, <fk>) WHERE <fk> IS NOT NULL`; `state` CHECK ∈ {TAKIP, BIRAKTI}; `reason` CHECK ∈ {OLUSTURAN, ELLE}. Emsal: `LoomAlarm` "yeni tür = nullable FK + XOR CHECK".

### 3.4 Audit muafiyeti, saklama, budama

`Teks-Erp/scripts/lib/audit-muafiyeti.ts`: NotificationOutbox / NotificationInbox / NotificationDailyStats → TELEMETRI · NotificationCondition → SISTEM_ISI · NotificationPreference / NotificationUserSetting / RecordFollow → KULLANICI_TERCIHI · NotificationProfileCell / NotificationProfileMember → EBEVEYN_EYLEMDE. Profil ve fabrika varsayılanı audit'lidir.

Budama TEK dosyada: YENİ Teks-Erp:src/services/notification-prune.service.ts, çağıran `Teks-Erp/src/jobs/maintenance.job.ts` gece penceresi. Süreler: inbox okunmuş 90 / okunmamış 180 gün · outbox işlenmiş 7 gün · conditions çözülmüş 180 gün · daily_stats 35 gün. Beyan `Teks-Erp/scripts/test_telemetri_defter_degil.ts` `BUDANAN_DEFTER_DISI` (inbox/outbox/stats TELEMETRI, conditions DURUM; `silen` = prune servisi). Defter testi: satır silinince hiçbir rapor sayısı değişmez (önizleme yalnız tahmin) → defter değildir.

### 3.5 Advisory kilit ve eşzamanlılık

- YENİ uzay **8040 `NOTIFICATION_DISPATCH_LOCK_NS`** (şu an envanterde son 8039). Envanter satırı `Teks-Erp/src/services/helpers/period-guard.helper.ts` başlığına; sabit + ilk kullanım AYNI commit. `test_advisory_lock_namespaces` yalnız `pg_advisory_xact_lock` tanır → bloklayan form, tx'in İLK ifadesi. Anahtarlar `hashtext('bildirim-dagitici')`, `hashtext('bildirim-kosul:' || kind)`. Merge anında 8040 dolmuşsa sonraki boş numara alınır ve plan güncellenir.
- Dağıtıcı satır seçimi `FOR UPDATE SKIP LOCKED`; claim `processedAt` damgasıyla tx içinde; hata → `attempts++`, `lastErrorCode`, iş işlemini geri almaz.
- Okundu ATOMİK: `updateMany {id, userId, readAt:null}`; count 0 → kayıt kullanıcınınsa 200 `{degisti:false}`, değilse 404. Ertele: `updateMany {id, userId}` `snoozedUntil`. `tx.*` + `Promise.all` yasak. PG 40P01/40001 → 409.
- Koşul açma `INSERT … ON CONFLICT DO NOTHING RETURNING` (yalnız gerçekten açılan için ACILDI emit); kapama `UPDATE … WHERE resolvedAt IS NULL RETURNING` (yalnız gerçekten kapanan için KAPANDI).

### 3.6 Idempotency ve birleştirme

- emit iş tx'ine bağlıdır: rollback → outbox yok; replay edilen istek (token-replay boğazı) iş kaydını yeniden yaratmadığı için emit de tekrarlanmaz.
- `groupKey`: OLAY'da `dedupeKey` (katalog `tekilKalibi`'ndan); pencere W>0 ise `dedupeKey + ':' + floor(epoch/W)` (sabit kova; "N sipariş geldi"). KOSUL'da `kind:subjectKey:conditionId` (yeniden açılan koşul yeni satır). ALARM'da `alarm:<alarmId>`.
- Çakışmada: `count+1, lastAt, payload, lastOutboxId, readAt=NULL, snoozedUntil=NULL`. KAPANDI → ilgili satırlarda `resolvedAt=now`, `readAt=coalesce(readAt, now)`.
- Profil POST `clientToken @unique` (kayıt yaratan uç); replay `helpers/token-replay.helper.ts`ten.

### 3.7 emit, katalog, görme süzgeci

- YENİ Teks-Erp:src/services/helpers/notification-emit.helper.ts: `emitNotification(tx, kind: NotificationKind, subject, payload, {actorUserId, phase})` TEK yazar; `NotificationKind` katalog union'ı → katalog dışı tür derleme hatası; AST bekçisi outbox'a başka yazar olmadığını ölçer. Commit sonrası `kickDispatcher()` (`Teks-Erp/src/jobs/nudge-coalescer.ts` `createNudgeCoalescer` emsali).
- YENİ Teks-Erp:src/constants/notification-catalog.ts (§4).
- YENİ Teks-Erp:src/services/helpers/notification-visibility.helper.ts: `visibleKindsFor(user)` / `canSeeNotificationType(user, kind)` = izin (DNF: konjonksiyonlardan biri tam) ∧ modül (katalog `modul: EkranModul`; `ModulKey` ise bayrak açık, `cekirdek:*`/`planlanan:*` hep açık) ∧ ek kapı (ör. `tezgahAlarm` resolver). Alıcı izin kümesi `loom-alarm-recipient.helper.ts` `loadEffectiveGrants` emsali; sistem hesabı ve pasif kullanıcı düşer; aktör düşer (ALARM hariç). Dağıtım, okuma, tercih ekranı aynı helper (`test_bildirim_tek_kaynak`).

### 3.8 Dağıtıcı ve koşul tarayıcısı

- YENİ Teks-Erp:src/jobs/notification-dispatch.job.ts + Teks-Erp:src/services/notification-dispatch.service.ts: 5 sn süpürme + kick; tick başı ≤100 outbox satırı; toplu `INSERT … SELECT unnest(...)`. ALARM yolu alıcıyı DONMUŞ `LoomAlarmRecipient`ten okur (yeniden çözmez).
- YENİ Teks-Erp:src/jobs/notification-condition.job.ts + `registerConditionSource({kind, periodMs, evaluate()})`: `evaluate()` doğru olan subject kümesini döner; fark açılır/kapanır. **evaluate hata verirse hiçbir koşul kapanmaz** (fail-closed; sahte "çözüldü" yok). Sistem kaynakları 60 sn, iş taramaları 5 dk.
- `Teks-Erp/src/server.ts` başlatma/durdurma: iki iş bayrak açıkken başlar; bayrak çalışırken açılırsa sonraki ayar okumasında başlar (yeniden başlatma gerektirmez — N1-MOTOR ölçer).

### 3.9 Sürüm sayacı ve SSE hub

- YENİ Teks-Erp:src/services/notification-bell-hub.ts, YENİ Teks-Erp:src/routes/bildirim.routes.ts, `Teks-Erp/src/app.ts` içinde `app.use("/api/bildirim", …)`.
- `GET /api/bildirim/zil` (verifyToken + tablet cihaz başlıkları): `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `res.flushHeaders()`. İlk olay `merhaba {epoch, rev, alarmRev}`; sonra `zil {k:'kutu'|'alarm', rev, alarmRev}` (içeriksiz); 25 sn'de `: ping`. Kullanıcı başı 5 bağlantı (6.'da en eski kapanır), genel 500. 60 sn'de oturum/`tokenVersion` yeniden doğrulama; bağlantı ömrü 30 dk. `permission-management.service.ts` atama/geri alma → `hub.kapat(userId, 'yetki')`.
- Sürüm: süreç `epoch` (açılış damgası) + kullanıcı başı `rev` (bellek). `epoch` değişince istemci tam yeniden çeker.
- Uzun yoklama `GET /api/bildirim/bekle?rev=` ≤25 sn.
- **Tuzak 1 — sıkıştırma:** `app.ts`teki `compression({threshold:1024})` SSE'yi tamponlar → SSE rotası sıkıştırmadan muaf (`no-transform` + filtre) ve `flushHeaders`; bekçi gzip'li istekte ilk olayın <1 sn geldiğini ölçer.
- **Tuzak 2 — kapanış:** `server.ts` kapanış fazında açık SSE bağlantıları süreci 5 sn sonra zorla kapattırır → hub, dinleyiciler kapanmadan ÖNCE bütün bağlantıları kapatır.
- **Tuzak 3 — gecikme ölçümü:** `Teks-Erp/src/middlewares/latency.middleware.ts` uzun bağlantıyı uç gecikmesi sayar → `zil` ve `bekle` yolları ölçümden muaf (aksi halde `EndpointLatencyDaily` kirlenir).

### 3.10 İstemci düşüş merdiveni

SSE → (3 hata/2 dk ya da 403/404) uzun yoklama → (404 = eski backend) 30 sn `/ozet` yoklaması. Panel tek akış (Chromium HTTP/1.1 sunucu başı 6 bağlantı). Başlıklar TEK kurucudan: Electron `Electron/src/services/apiClient.ts` interceptor mantığı (Bearer + web'de `X-TeksERP-CSRF`), tablet `mobil/src/services/api.ts` (Bearer, `x-device-id`, cihaz kanıtı, `X-Client-Kind/Version/Instance`). Tablet `import { fetch } from 'expo/fetch'`, yalnız ön planda; LAN TLS'te akış ölçülür, olmazsa uzun yoklama.

### 3.11 Tezgah alarmı bağlantısı (F2)

`Teks-Erp/src/services/loom-alarm.service.ts` `writeEventTx` (~:92), `writeRaisedEventTx` (~:99), `writeActorEventTx` (~:260) içinde aynı tx'te `emitNotification(tx, 'dokuma.tezgah-alarmi', …)`. Dağıtıcı ALARM yolunda alıcı = donmuş `LoomAlarmRecipient` (mod `LISTED`: kaynak HALL_SHIFT/DUTY_OVERRIDE/USER → `reason=NOBET`, PERMISSION → `ALARM_ALICISI`; mod `BY_PERMISSION`: izin sahipleri, `ALARM_ALICISI` = nöbet dışı); RESOLVED/CANCELLED → `resolvedAt`; `alarmRev++` zil. Panel `alarm-bell-query.ts` yoklaması SSE sağlıklıyken 15→60 sn; sağlıksızken 15 sn. `LoomAlarm` tabloları ve kademe motoru değişmez; K3 yok.

### 3.12 Eski istemci ve sözleşme

Kıran değişiklik YOK: yalnız yeni uçlar + bayrak yüküne ek alan. Eski panel eski zili yoklar (uç değişmez, Etkinlik verisi aynen). Yeni panel + eski backend → `/ozet` 404 → zil çizilmez, alarm 15 sn. Eski tablet bayrak alanını tanımaz (fail-closed false). `minVersion` artmaz. Dağıtım sırası backend önce, panel + tablet sonra.

## 4 · Katalog v1 (13 tür)

Dosya YENİ Teks-Erp:src/constants/notification-catalog.ts. Alanlar: `kod`, `sinif` (ALARM|BILDIRIM), `altTur` (OLAY|KOSUL), `grup`, `izinler` (DNF), `modul` (EkranModul), `kapi?`, `tekilKalibi`, `pencereSn`, `varsayilan` (HERKES | izin[] | KAPALI), `kilit` (YOK|HER_ZAMAN|NOBETTE), `kanallar`, `varsayilanKanallar`, `baslik`/`govde`/`cozuldu` (`{yer}` tutuculu), `panelEkran` (SCREEN_CATALOG anahtarı) + `panelYol`, `tabletEkran?`, `paramSemasi?` (zod), `tahminiHaftalik`, `saklama`. Render helper yer tutucuları payload'dan doldurur (LiquidJS değil).

Bekçi `test_bildirim_katalogu`: her `panelEkran` SCREEN_CATALOG'da var; `modul` = ekranın modülü; her izin konjonksiyonu ekranın `requires`ından en az birini içerir; kilitli türün varsayılanı KAPALI olamaz; şablon yer tutucuları beyanlı payload alanlarıyla eşleşir; (N5 sonrası) patron eşleme tablosu tam.

| # | Kod | Sınıf/alt | Kaynak | İzin (DNF) | Modül / kapı | Varsayılan · kilit · kanal | Derin bağlantı |
|---|---|---|---|---|---|---|---|
| 1 | `sistem.yedek-basarisiz` | B/KOSUL | `backupHealth()` (`lib/health-snapshot.ts` ~:126; uyari\|kritik) + offsite `recordSweep` başarısızlığı (`jobs/offsite-sweeper.ts`); subject `gece`/`offsite` | [system:backups] | cekirdek:sistem-kimlik-belge | izin sahipleri · HER_ZAMAN · uygulama+masaüstü | /system/backups |
| 2 | `sistem.esitleme-gecikti` | B/KOSUL | `getCloudSyncStatus()` (`jobs/cloud-sync.job.ts` ~:93): uygun ∧ son başarılı tur > 30 dk (param) ya da HATA/KISMI sürüyor | [admin:users] | cekirdek | izin sahipleri · YOK · uygulama+masaüstü | /access/patron-bulut |
| 3 | `sistem.lisans-uyarisi` | B/KOSUL | `getLicenseSnapshot()` (`lib/license/runtime.ts` ~:312): kademe normal dışı ∨ geçerlilik ≤14 gün; subject = neden kodu | [license:view] | cekirdek | izin sahipleri · HER_ZAMAN · uygulama+masaüstü | /system/license |
| 4 | `sistem.guncelleme-onay-bekliyor` | B/KOSUL | `getUpdateStatus()` (`services/update-status.service.ts`): aday var ∧ onay yok; subject = sürüm | [license:manage] | cekirdek | izin sahipleri · YOK · uygulama | /system/updates |
| 5 | `siparis.patron-siparisi` | B/OLAY | `createOrderFromMessage` tx'i, makbuz yazımından sonra (`services/cloud-inbox.service.ts` ~:161–186) | [order:read] | cekirdek:siparis-musteri | order:write · YOK · uygulama+masaüstü · pencere 600 sn | /operations/orders?focus=<id> |
| 6 | `siparis.termin-yaklasti` | B/KOSUL | tarama: status ∈ {PENDING, APPROVED, PARTIAL_SHIPPED} ∧ deadline ∈ [şimdi, +3 fabrika günü] (param `gun`) | [order:read] | cekirdek:siparis-musteri | order:write (F4 + takipçi) · YOK · uygulama, özete uygun, masaüstü kapalı | /operations/orders?focus=<id> |
| 7 | `siparis.termin-gecti` | B/KOSUL | `daysPastDeadline` (`helpers/order-deadline.helper.ts` ~:12) > 0 ∧ açık statü | [order:read] | cekirdek:siparis-musteri | aynı | aynı |
| 8 | `isemri.gecikti` | B/KOSUL | WorkOrder status ∈ {PLANNED, IN_PROGRESS} ∧ plannedEndDate < şimdi (indeks var) | [workorder:read] | productionEnabled | workorder:write · YOK · uygulama | /operations/work-orders/:id |
| 9 | `kalite.kk1-oran-dusuk` | B/KOSUL | bugünkü fabrika gününde finalize metrajda 1. kalite oranı < %85 ∧ ≥200 m, kumaş kırılımı; subject `<itemId>:<factoryYmd>`; yüklem `getQualityScorecard` (`reports/quality-scorecard.report.service.ts` ~:306) ile boğaz-ikiz helper'a çıkarılır | [quality:read] | productionEnabled | quality:write · YOK · uygulama | /reports/quality/scorecard |
| 10 | `fason.donus-gecikti` | B/KOSUL | açık fason kalemi daysOpen > 10 gün (param), firma kırılımı; yüklem `reports/subcontract-scorecard.report.service.ts` (~:97/:186) | [subcontractor:read] | planlanan:fason | izin sahipleri · YOK · uygulama | /reports/subcontract/scorecard |
| 11 | `sevkiyat.onay-bekliyor` | B/KOSUL | tarama Shipment status=PLANNED (alan dosyasına dokunmaz) | [shipping:read] | cekirdek:sevkiyat-depo | shipping:write · YOK · uygulama | /operations/shipments/:id |
| 12 | `dokuma.levent-bitiyor` | B/KOSUL | MOUNTED levent kalanGun ≤ 1 (param) — `finishForecastReport` (`reports/levent-bitis-tahmini.report.service.ts` ~:39) | [warpbeam:read] ∨ [mobile:dokuma] | dokumaEnabled | warpbeam:write (F4 + salon sorumlusu) · YOK · uygulama + tablet şerit (ses kapalı) | /operations/warp-beams?search=<leventNo>, tablet `Dokuma` |
| 13 | `dokuma.tezgah-alarmi` | ALARM | loom-alarm.service yazıcıları (F2) | [loom:alarm-view] ∨ [mobile:tezgah-uyari] | tezgahEnabled + kapı `tezgahAlarm` | alıcı DONMUŞ · NOBETTE · uygulama+masaüstü+tablet ses | /operations/loom-alarms/:id, tablet `UyariDetay` |

Kaynak kodlar KOSUL türlerinde yüklemi kopyalamaz: rapor sayısıyla aynı soruyu cevaplayan koşul TEK helper'da (boğaz-ikiz), rapor bekçileri bayt-eşit yeşil kalır.

**Sonraki dalgalar (R-N2 F.8):** v2 = alarm çevresi + iş: DOK-2, DOK-4, KİŞ-1, IE-1, IE-2, SIP-2, STK-1, SYS-2, SYS-6. v3 = finans + SoD + kalan: SIP-1, SIP-5, PAT-2, IE-4, IE-5, KAL-2, TOP-1, KUR-1, FAS-2, SEV-1, SEV-2 (kilit), SEV-3, SEV-4, STK-2, STK-3, FIN-1..4, DOK-5..7, CAR-2, SYS-4, SYS-7, GÜV-1. Etkinlik'e (sayaçsız) gidenler: KAL-3, TAM-1, FAS-1, DOK-8, CAR-1. Yeni tür eklemek reçetelidir (`docs/RECETELER.md` § Yeni bildirim türü, N0-KAT yazar).

## 5 · Tercih ve profil modeli (F4)

### 5.1 Katman çözümü

```
cozumle(user, kind, channel):
  if !canSeeNotificationType(user, kind): return GIZLI            # tek kaynak helper
  k = KATALOG[kind]
  durum = k.varsayilan kapsıyor(user) ? ACIK : KAPALI; kilit = (k.kilit == HER_ZAMAN); kaynak = 'katalog'
  fd = fabrikaVarsayilani[kind]
  if fd.state == ACIK: durum = ACIK; kaynak='fabrika'
  if fd.state == KAPALI and !kilit: durum = KAPALI; kaynak='fabrika'
  if fd.state == KILITLI: durum = ACIK; kilit = true; kaynak='fabrika'
  hucreler = profillerinden(user).hucre(kind)                     # birleşim
  if any(h == KILITLI): durum = ACIK; kilit = true; kaynak = 'profil:<ad>'
  elif any(h == ACIK): durum = ACIK; kaynak = 'profil:<ad>'
  elif hucreler and all(h == KAPALI) and !kilit: durum = KAPALI
  if k.kilit == NOBETTE and alici.nobette: kilit = true
  p = tercih[user, kind, channel]                                  # seyrek sapma
  if p and !(kilit and channel == UYGULAMA): durum = p.enabled; kaynak='kullanici'
  if channel != UYGULAMA and !(etkin(UYGULAMA) or etkin(OZET)): durum = KAPALI
  return {durum, kilit, kaynak, kapsam: p?.scope}
```

- Kilit yalnız UYGULAMA kanalını zorlar: kapatılamaz, ertelenebilir. Kilitli türe kapatma PUT → 409 `details.code=NOTIFICATION_KIND_LOCKED`. Görülemeyen türe PUT → 400.
- UI'daki uygulama içi üç durum: **Anlık** (UYGULAMA açık) · **Yalnız gün özeti** (UYGULAMA kapalı, OZET açık → inbox satırı `ozet=true`) · **Kapalı**.

### 5.2 Kapsam süzgeçleri

Katı zod, tür başına katalogda beyanlı; tanınmayan anahtar 400; yalnız DARALTIR; kilitli türe uygulanmaz. v1 anahtarları: `yalnizTakip: true` (yalnız takip ettiğim kayıtlar) · `istasyonlar: 'BENIM' | uuid[]` (canlı WorkSession ∪ HallShiftResponsible) · `esik` (param türlerinde; ör. termin `gun`, levent `kalanGun`). "Seçili durum geçişleri" v2 türleriyle gelir.

### 5.3 Takip

`record_follows`. Oluşturan otomatik takipçi AYNI tx'te `INSERT … ON CONFLICT DO NOTHING` (BIRAKTI ezilmez): `OrderService.insertPreparedOrderTx` (`Teks-Erp/src/services/order.service.ts` ~:2252), `createWorkOrderTx` (`Teks-Erp/src/services/helpers/workorder-event.helper.ts` ~:156), dokuma işi (`Teks-Erp/src/services/weaving-order.service.ts` ~:212). Alıcı kaynakları: TAKIPCI (`state=TAKIP`), OLUSTURAN, NOBET (salon sorumlusu, tezgah alarm çözücüsünden genelleştirilir), LISTE (fabrika varsayılanı `extraRecipientIds`). Hepsi görme süzgeciyle KESİŞİR.

### 5.4 Sessiz saat ve gün özeti

Sessiz saat `quietStart–quietEnd` fabrika diliminden (`Teks-Erp/src/constants/time.ts`; gece yarısını aşan aralık desteklenir), `quietChannels` ⊆ {MASAUSTU, TABLET_SES, PATRON_PUSH}. Gelen kutusu satırı her zaman yazılır; satırın `kanalMasaustu/kanalTablet` bayrakları sessiz saatte false düşer. ALARM: Karar Y2. Gün özeti: `ozet=true` satırlar rozete girmez; zil fabrika gününün ilk açılışında "Gün özeti" kartında okuma anında gruplanır (ayrı iş yok); `digestHour` kartın en erken gösterim saatidir.

### 5.5 Önizleme

`POST /api/bildirim/tercihler/onizleme` gövdedeki tercih taslağıyla son 30 günün `notification_daily_stats` sayımını kullanıcının görme kümesi + kapsamı oranında ölçekler; veri yoksa `tahminiHaftalik`. Cevap `{haftalik, enCok:[{kind, sayi}], kaynak:'olcum'|'tahmin'}`. Kabul: tohumlanmış veride gerçek dağıtım sayısının ±%10'u.

### 5.6 API (`/api/bildirim`, hepsi verifyToken; kişisel uçlar ek izin istemez)

| Uç | Not |
|---|---|
| GET `zil` | SSE (§3.9) |
| GET `ozet` | `{enabled, okunmamis, alarmAcik, epoch, rev}`; bayrak kapalı → `{enabled:false}` |
| GET `/` | `?sekme=tumu\|okunmamis\|alarmlar\|ertelenen&cursor&limit`; liste + cursor + özet tek where |
| POST `/:id/okundu` · `/:id/okunmadi` · `/:id/ertele` | ertele `{sure:'1s'\|'yarin-sabah'\|'vardiya-sonu'}` |
| POST `tumunu-okundu` → `{ids}` · POST `geri-al-okundu {ids}` | 6 sn geri al |
| GET `bekle?rev=` | uzun yoklama ≤25 sn |
| GET `katalog` | görülebilir türler + çözülmüş hücreler (kaynak, kilit) |
| GET/PUT `tercihler` · POST `tercihler/onizleme` | PUT tam gövde; istemci cevaptan yeniden kurar |
| POST `tercihler/varsayilana-don/onizleme` · POST `tercihler/varsayilana-don {ids}` | yıkıcı → önizleme + per-record seçim |
| GET/PUT `ayarlar` | sessiz saat, özet saati, ses |
| GET/PUT/DELETE `takip/:tur/:id` | tur ∈ siparis\|is-emri\|dokuma-isi |
| GET/POST `profiller` · PATCH/DELETE(arşiv) `profiller/:id` · PUT `profiller/:id/hucreler` · POST `profiller/:id/kilit-onizleme` · PUT `profiller/:id/uyeler` · GET/PUT `fabrika-varsayilani` | `requireAnyPermission(settings:notifications, admin:settings)`; POST `clientToken` |

Bayrak kapalıyken `ozet` dışındaki uçlar 409 `BILDIRIM_KAPALI`. Swagger her uç için.

### 5.7 `settings:notifications` reçetesi (N4-SEMA; migration YOK)

`Teks-Erp/src/constants/permission-catalog.ts` satırı · `role-template-catalog.ts` dar rol (Sistem Yöneticisi) · `screen-catalog.ts` girdisi `system/notification-profiles` (modül `cekirdek:sistem-kimlik-belge`) · `Electron/src/lib/permissions.ts` kümesi · `Electron/src/routes/content-routes.tsx` + `Electron/src/pages/System/tile-config.ts` karosu AYNI listeyle · bekçiler `test_permission_catalog`, `test_role_template_catalog`, `test_screen_catalog`, `test_route_auth_coverage`, `test_route_mount_reachability`, `test_swagger_spec`. SoD üçlüsüne girmez.

## 6 · UI/UX

### 6.1 Panel zili (N1-PANEL; F2'de Alarmlar sekmesi)

YENİ Electron:src/components/layout/BildirimZili.tsx, Topbar'da `LoomAlarmBell` yanında (kırmızı alarm hapı AYRI kalır). Rozet = okunmamış BİLDİRİM (ALARM ve `ozet` hariç), 99+. Bayrak kapalı/404 → zil çizilmez.

```
┌─ Bildirimler ─────────────────────────────── [⚙] ┐  420 px
│ [Tümü] [Okunmamış 12] [Alarmlar 1]                │
│ ┌ Gün özeti · 7 bildirim (Sipariş 4, Kalite 3) ┐ │
│ └─────────────────────────────── [Göster] ──────┘ │
│ BUGÜN                                             │
│ ● 🛒 3 patron siparişi geldi (+2)       5 dk      │
│      İzniniz: Sipariş yazma   [Aç][✓][Ertele ▾]   │
│ ● 💾 Gece yedeği alınamadı             42 dk      │
│      Kilitli · İzniniz: Yedekler                  │
│   ⚙ İş emri İE-0412 gecikti      ✔ Çözüldü 1 sa   │
│ DÜN                                               │
│   📦 Sevkiyat SV-0088 onay bekliyor     dün 17:40 │
│      Takip ediyorsunuz                            │
├───────────────────────────────────────────────────┤
│ Tümünü okundu say              Tüm bildirimler →  │
└───────────────────────────────────────────────────┘
```

Satır: grup ikonu (alan rengi; renk tek başına anlam taşımaz), başlık, "(+N)", göreli saat (fabrika dilimi, `Electron/src/lib/factory-time.ts`), sebep etiketi, KOSUL çözüldüyse yeşil "Çözüldü". Hover eylemleri: Aç · Okundu · Ertele ▾ (1 saat / Yarın 08:00 / Vardiya sonu — vardiya bilinmiyorsa gizli) · (F4) Takipten çık. "Tümünü okundu say" onaysız + 6 sn "Geri al" tostu. Boş: "Yeni bildirim yok" + "Bildirim ayarları". Kit: `@/components/ui` (popover, tabs, badge, button, tooltip, empty-state, sonner, dropdown-menu), lucide ikonları. Erişilebilirlik: rozet `aria-label="12 okunmamış bildirim"`, ok tuşları + Esc, eylem düğmeleri emir kipi.

### 6.2 Bildirimler sayfası

YENİ `Electron/src/pages/Notifications/`, rota `/notifications`: sol süzgeç (grup, durum: okunmamış/ertelenen/çözüldü, tarih), tablo (cursor), toplu okundu, derin bağlantı. Süzme SUNUCUDA.

### 6.3 Etkinlik sayfası (N0-ETK, bayraksız)

Eski `NotificationBell.tsx` silinir; `/system/activity` (`Electron/src/pages/System/Activity/ActivityPage.tsx`) başlığı "Etkinlik"; Topbar'da sayaçsız "Etkinlik" ikon bağlantısı, görünürlük `SYSTEM_ACTIVITY_ACCESS` (admin:settings ∨ system:activity) — tutarsızlık kapanır.

### 6.4 Ayarlar → Bildirimler (kişisel; N4-PANEL)

YENİ rota `/settings/notifications` (herkes), `Electron/src/pages/Settings/SettingsPage.tsx`'e kart.

```
Ayarlar › Bildirimler                                   [Varsayılana dön…]
┌──────────────┬───────────────────────────────────────────────────────────┐
│ Sipariş   (3)│ [🔎 Ara…]                                                 │
│ Üretim    (1)│ SİPARİŞ                        [Hepsini aç] [Hepsini kapa]│
│ Kalite    (1)│ ───────────────────────────────────────────────────────── │
│ Sevkiyat  (1)│ Patron siparişi geldi                                     │
│ Fason     (1)│ Buluttan sipariş düştüğünde. Neden: İzniniz Sipariş yazma │
│ Dokuma    (2)│ Uygulama içi [Anlık|Özet|Kapalı]  Masaüstü [●]  Tablet [–]│
│ Sistem    (4)│ Kapsam: [Tümü ▾]                                          │
│              │ ───────────────────────────────────────────────────────── │
│              │ 🔒 Gece yedeği alınamadı           Neden kilitli? (ⓘ)     │
│              │ Uygulama içi [Anlık] (kilitli)    Masaüstü [●]            │
│              │ ───────────────────────────────────────────────────────── │
│              │ 2 tür yetkiniz dışında olduğu için listelenmedi.          │
├──────────────┴───────────────────────────────────────────────────────────┤
│ Bu ayarla haftada ~34 bildirim (en çok: Termin yaklaştı 18)   [ölçüm]    │
├──────────────────────────────────────────────────────────────────────────┤
│ Sessiz saat [22:00]–[07:00]  Kanallar: ☑Masaüstü ☑Tablet sesi            │
│ Gün özeti saati [08:00]   Ses [●]                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Grup listesinde yalnız görülebilir türü olan gruplar (Sipariş, Üretim, Kalite, Sevkiyat, Fason, Stok, Finans, Dokuma, Sistem). Arama tr-katlamalı. Grup toplu aç-kapa kilitlileri atlar, "3 satır değişti" tostu. Kilitli satır: kilit ikonu, tooltip kaynağı (katalog / fabrika / profil adı), "Kapalı" seçeneği yok. "Varsayılana dön" önizlemeli: sapma satırları listelenir, seçilir. Kaydet = tam gövde PUT, cevaptan yeniden kur.

### 6.5 Ayarlar → Bildirim profilleri (yönetici; N4-PROFIL)

Rota `/system/notification-profiles` (settings:notifications ∨ admin:settings), Sistem hub karosu.

```
Sistem › Bildirim profilleri                              [+ Yeni profil]
┌────────────────────────┬────────────────────────────────────────────────┐
│ Planlama  PLN · 6 üye  │ [Matris] [Üyeler] [Fabrika varsayılanı]        │
│ Kalite    KAL · 3 üye ◀│ Tür                       Açık  Kapalı  Kilitli│
│ Sevkiyat  SVK · 4 üye  │ Patron siparişi geldi      ( )   (•)     ( )   │
│ Dokuma    DOK · 9 üye  │ KK1 oranı düşük            ( )   ( )     (•)   │
│                        │   ⚠ Bu türü 2 üye alamaz: izinleri yok         │
│ [Arşivlenenler]        │ Termin yaklaştı            (•)   ( )     ( )   │
│                        │ …                                              │
│                        │                     [Kilit önizlemesi] [Kaydet]│
└────────────────────────┴────────────────────────────────────────────────┘
```

Üyeler sekmesi kullanıcı seçici MODAL açar (combobox yok). Fabrika varsayılanı sekmesi: MİRAS/AÇIK/KAPALI/KİLİTLİ + eşik parametreleri (katalog zod) + ek alıcılar. Kilitleme önizlemesi: tercihini kapatmış kullanıcılar listelenir, seçilir (yıkıcı işlem kuralı). Profil izin VERMEZ; uyarı satırı yalnız bilgi.

### 6.6 Takip düğmesi (N4-PANEL)

`Electron/src/pages/Operations/Orders/OrderDetailSheet.tsx`, `Electron/src/pages/Operations/WorkOrders/WorkOrderDetailHeader.tsx` (gerekirse `WorkOrderDetailSheet.tsx`), `Electron/src/pages/Operations/WeavingOrders/WeavingOrderDetailSheet.tsx`: "Takip et" / "Takip ediliyor ▾ (Takibi bırak)". Bayrak kapalıysa çizilmez.

### 6.7 Masaüstü OS bildirimi (N3-MASAUSTU)

`Electron/electron/ipc/loom-alarm-notify.ipc.ts` + `Electron/shared/loom-alarm-notify.ts` genelleştirilir: YENİ Electron:shared/bildirim-notify.ts; alarm kanalı geriye uyumlu kalır. Pencere öndeyse OS bildirimi yok, uygulama içi tost. Windows `setOverlayIcon` (okunmamış; hazır PNG seti 1–9, 9+) + alarmda `flashFrame(true)`; macOS/Linux `app.setBadgeCount`. `app.setAppUserModelId` zaten `Electron/electron/main.ts` ~:125. Küçültülmüş pencerede zil gecikmesi ölçülür; kötüyse `backgroundThrottling:false`.

### 6.8 Tablet (N4-TABLET)

Yeni `MobileScreenKey` AÇILMAZ. Başlıkta zil düğmesi → `mobil/src/components/RightPanelDrawer.tsx` içinde gelen kutusu (büyük dokunma alanı, yalnız tablet kanalı açık türler). İstasyon şeridi `mobil/src/components/alarm/LoomAlarmStrip.tsx` emsali; alarm şeridi her zaman üstte. Ses mevcut `expo-audio`. `expo-keep-awake` yalnız istasyon ekranlarında (`mobil/src/constants/stationScreens.ts`) ve YALNIZ veto onayından sonra; manifest izni gerekmez. Ön plana dönüşte kaçanlar `rev` farkıyla tamamlanır; arka planda `mobil/src/services/alarmNotify.ts` hatırlatması aynen. Telefon (dikey) aynı çekmeceyi kullanır.

## 7 · Dilimler

Ortak: worktree `../Teks-Erp-wt/<KOD>`, dal `feature/bildirim-<kod-küçük>`, kendi test DB'si `tekserp_<kod, tiresiz küçük harf>_test` (ör. `tekserp_n1zil_test`; ad kuralı `tekserp_[a-z0-9]+_test`), PR + `gh pr checks --watch` → TÜM SUCCESS → squash merge; bitiş/devir notu `scratchpad/bildirim/DEVIR-<KOD>.md`. Her yeni bekçi negatif sondalı; `Teks-Erp/docs/BEKCI-HARITASI.md` ve docs:kurallar/bildirim.md `## bildirim` bölüm SONUNA satır, aynı commit. Büyüklük: S ≤½ gün, M ~1 gün, L ~1,5 gün.

### N0-KAT · Katalog + kural dosyası — Opus high, M
**Hedef:** v1 kataloğu, render helper, katalog bekçisi, alan kural dosyası, reçete. **Dosyalar:** YENİ Teks-Erp:src/constants/notification-catalog.ts · YENİ Teks-Erp:src/services/helpers/notification-render.helper.ts · YENİ Teks-Erp:scripts/test_bildirim_katalogu.ts · YENİ docs:kurallar/bildirim.md · `docs/kurallar/README.md` · `Teks-Erp/docs/BEKCI-HARITASI.md` (`## bildirim` sonuna) · `docs/RECETELER.md` (SONUNA "Yeni bildirim türü"). **Migration:** yok. **Bekçi:** `test_bildirim_katalogu` (§4 ölçütleri); sonda: bir türün `panelEkran`ını uydurma anahtara çevir → kırmızı. **Kabul:** 13 tür, bekçi yeşil, `npx tsc --noEmit` temiz. **Risk:** EkranModul/izin eşlemesinin ekran `requires`ıyla çelişmesi → türü değil ekranı esas al. **Bağ:** yok.

### N0-ETK · Eski zil → Etkinlik (bayraksız) — Sonnet, S
**Hedef:** §6.3. **Dosyalar:** `Electron/src/components/layout/NotificationBell.tsx` (sil) · `Electron/src/components/layout/Topbar.tsx` · `Electron/src/pages/System/Activity/ActivityPage.tsx` · `Teks-Erp/scripts/lib/audit-okuma-beyan.ts` (~:51 gerekçe) · ilgili panel testleri. **Bekçi:** `test_audit_okuma_kaynagi`, panel vitest. **Kabul:** zil yok, Etkinlik ikonu `SYSTEM_ACTIVITY_ACCESS` ile; ekran görüntüsü. **Risk:** Topbar'ı N1-PANEL de değiştirir → N0-ETK önce. **Bağ:** yok.

### N1-SEMA · F1 tabloları — Opus high, M
**Hedef:** §3.2 dört tablo + migration `<ts>_bildirim_cekirdek`. **Dosyalar:** `Teks-Erp/prisma/schema.prisma` · migration · `Teks-Erp/scripts/test_db_invariants.ts` · `Teks-Erp/scripts/lib/audit-muafiyeti.ts` · `Teks-Erp/scripts/test_timestamptz_contract.ts` (muaf) · `Teks-Erp/scripts/test_telemetri_defter_degil.ts` (budayıcı N1-MOTOR'da olduğundan beyan orada; bekçi şema-beyan çiftini aynı commit istiyorsa ajan ölçer, karar rapora). **Bekçi:** `test_db_invariants`, `test_timestamptz_contract`, audit muafiyet bekçisi, şema prova. **Kabul:** migration test DB'de iki kez koşar (idempotent); partial unique ve CHECK'ler `\d` ile görülür. **Risk:** Prisma partial unique'i ifade edemez → SQL'de + bekçi listesi. **Bağ:** yok.

### N1-BAYRAK · `bildirim.gelenKutusuEnabled` — Sonnet, S
**Hedef:** Karar Y1; `docs/RECETELER.md` § Yeni feature flag 19 adım. **Dosyalar:** `Teks-Erp/src/services/system-setting.service.ts` · `Teks-Erp/src/routes/feature-flag.routes.ts` · `Electron/src/services/featureFlagService.ts` · `Electron/src/pages/GeneralSettings/settings-config.ts` · `Electron/src/pages/GeneralSettings/flag-modules.ts` (`cekirdek`) · `mobil/src/services/featureFlag.service.ts` (fail-closed false) · `Teks-Erp/scripts/lib/hepsi-acik.ts` + `npx tsx scripts/profil-matrisi.ts --acik-yaz`. **Bekçi:** `test_feature_flag_contract`, `test_settings_scopes`, `test_profil_tamligi`. **Kabul:** varsayılan false; panelde Genel Ayarlar'da satır. **Risk:** belge şablon tasarımcısı aynı dosyalarda → bölge-yerel ekleme. **Bağ:** yok.

### N1-MOTOR · emit + görme + dağıtıcı + koşul iskeleti + budama — Opus high, L
**Hedef:** §3.5–3.8. **Dosyalar:** YENİ `notification-emit.helper.ts`, `notification-visibility.helper.ts`, `notification-dispatch.service.ts`, `jobs/notification-dispatch.job.ts`, `jobs/notification-condition.job.ts`, `notification-prune.service.ts` · `jobs/maintenance.job.ts` · `period-guard.helper.ts` (8040) · `server.ts` · `test_telemetri_defter_degil.ts` beyanı. **Bekçi:** YENİ `test_bildirim_motoru` (rollback → outbox yok; yeniden başlatmada işlenmemiş bir kez işlenir; pencerede 3 olay → count=3; 10 paralel olay → tek satır; aktör hariç; izin kaybı → gizli; evaluate hatası koşul kapatmaz; bayrak kapalı → outbox yok), YENİ `test_bildirim_tek_kaynak` (AST: outbox'a tek yazar; görme yalnız helper'dan); `test_advisory_lock_namespaces`. Sonda: aktör filtresini sil → kırmızı. **Kabul:** bekçiler yeşil, 5k upsert/tick süresi ölçülüp rapora. **Bağ:** N0-KAT, N1-SEMA, N1-BAYRAK.

### N1-ZIL · SSE hub + gelen kutusu API — Opus high, L
**Hedef:** §3.9, §5.6 F1 uçları. **Dosyalar:** YENİ `notification-bell-hub.ts`, `routes/bildirim.routes.ts` (+ controller/servis), `app.ts` (mount + compression istisnası), `middlewares/latency.middleware.ts`, `server.ts` (kapanış), `permission-management.service.ts` (hub.kapat), swagger. **Bekçi:** YENİ `test_bildirim_zil` (bekci-http deseni: gzip'li istekte ilk olay <1 sn, ping, 6. bağlantı en eskiyi düşürür, auth'suz 401, kapanışta akış biter, olay→zil <2 sn, latency tablosuna satır düşmez) + YENİ `test_bildirim_api` (okundu atomik, ertele, tümü+geri al, izinsiz tür gizli, bayrak kapalı 409/`{enabled:false}`); `test_route_auth_coverage`, `test_route_mount_reachability`, `test_swagger_spec`. Sonda: `no-transform`/filtre kaldır → gzip testi kırmızı. **Bağ:** N1-MOTOR.

### N1-OLAY · Patron siparişi — Opus high, S
`cloud-inbox.service.ts` makbuz sonrası `emitNotification(tx,'siparis.patron-siparisi',…)`; bekçi YENİ `test_bildirim_patron_siparisi` (aynı mesaj replay → tek outbox; 600 sn kovada 3 sipariş → count=3; ret yolunda emit yok). **Bağ:** N1-MOTOR.

### N1-KOSUL-SIS · Kaynaklar 1–4 — Opus high, M
YENİ Teks-Erp:src/services/notification-sources/sistem.ts (kaynak başına `registerConditionSource`); bekçi YENİ `test_bildirim_kosul_sistem` (açılır→tek satır, sürer→yeni satır yok, düzelir→KAPANDI + "Çözüldü", tekrar bozulur→yeni satır; kaynak fırlatır→kapanmaz). **Bağ:** N1-MOTOR.

### N1-KOSUL-IS · Kaynaklar 6–12 — Opus high, L
YENİ `notification-sources/is.ts`; kalite ve fason yüklemleri boğaz-ikiz helper'a çıkarılır, rapor sayıları bayt-eşit (`test_quality_scorecard`, `test_levent_kalan_tek_okuyucu` ve BEKCI-HARITASI'nda bu raporlara bağlı bekçiler yeşil; fason karnesinin sayı bekçisi yoksa taşımadan ÖNCE sabitleyici bekçi yazılır); fabrika günü `time.ts`. Bekçi YENİ `test_bildirim_kosul_is`. **Risk:** rapor yüklemini taşırken sayı değişimi → önce bekçi koş, sonra taşı. **Bağ:** N1-MOTOR.

### N1-PANEL · Zil + Bildirimler sayfası — Opus high, L
YENİ Electron:src/components/layout/BildirimZili.tsx, `Electron/src/lib/bildirim/` (zil istemcisi, düşüş merdiveni, başlık kurucu), Electron:src/services/bildirimService.ts, `Electron/src/pages/Notifications/`, `content-routes.tsx`, `Topbar.tsx`. Vitest: merdiven (SSE→uzun yoklama→/ozet), epoch değişince tam çekim, 404 → zil gizli, tümünü okundu + geri al. Ekran görüntüsü (açık zil, boş durum, sayfa). **Bağ:** N1-ZIL (+ N0-ETK).

### N2-ALARM · Tezgah alarmı kanala — Opus high, M
§3.11; `loom-alarm.service.ts` üç yazıcı, dağıtıcı ALARM yolu, `alarm-bell-query.ts` 15→60 sn (SSE sağlıklıyken), zilde Alarmlar sekmesi. Bekçi: mevcut `test_loom_alarm`, `test_loom_alarm_durtme`, `test_loom_alarm_eylem`, `test_loom_alarm_sorumlu` yeşil + `test_bildirim_motoru` YENİ § "donmuş alıcı = gelen kutusu alıcısı; RESOLVED → resolvedAt; alarmRev artar". **Bağ:** N1-PANEL.

### N3-MASAUSTU · OS bildirimi + rozet — Opus high, M
§6.7. Vitest + elle duman (macOS rozet; Windows overlay ekran görüntüsü varsa). **Bağ:** N1-PANEL; IPC dosyası N2-ALARM ile çakışır → N2 merge'ünden SONRA.

### N4-SEMA · F4 tabloları + izin — Opus high, M
§3.3 + §5.7; migration `<ts>_bildirim_tercih`; audit muafiyetleri; `test_db_invariants`. **Bağ:** N1-SEMA.

### N4-MOTOR · Katman çözümü + tercih API'leri — Opus high, L
§5.1–5.6; takip yazımı üç doğuş noktasında; günlük istatistik; profil/fabrika uçları. Bekçi YENİ `test_bildirim_tercih` (kilitli PUT 409; izinsiz tür PUT 400; profil birleşimi; BIRAKTI ezilmez; sessiz saat OS'u bastırır kutuya düşer; nöbetteki alarm sessiz saati yok sayar, nöbet dışı susar; önizleme ±%10; tanınmayan kapsam anahtarı 400). **Bağ:** N4-SEMA, N2-ALARM.

### N4-PANEL · Kişisel ayarlar + Takip + gün özeti — Opus high, L
§6.4, §6.6, gün özeti kartı, zilde "Takipten çık". Ekran görüntüsü. **Bağ:** N4-MOTOR.

### N4-PROFIL · Yönetici profilleri — Opus high, M
§6.5; `tile-config.ts` + `content-routes.tsx` aynı liste. Ekran görüntüsü. **Bağ:** N4-MOTOR.

### N4-TABLET · Tablet zil + gelen kutusu + şerit — Opus high, L
§6.8; `expo/fetch` SSE + uzun yoklama; alarm yoklaması 15→60; jest; emülatör ekran görüntüsü; keep-awake YALNIZ veto onayıyla (yoksa adım atlanır, rapora). **Bağ:** N4-MOTOR, N2-ALARM.

### N5-PATRON · Push hazırlığı (bayrak arkasında) — Opus high, M
Fabrika tür ↔ `patron/sunucu/src/catalog/notifications.ts` `KIND_RULES` eşleme tablosu; içeriksiz push yükü (`patron/sunucu/src/push/transports.ts` `ExpoTransport`: başlık + bildirimId); bekçi "push yükünde iş verisi yok" + katalog eşleme tamlığı (`test_bildirim_katalogu` §). `POST_NOTIFICATIONS`, Firebase, gizlilik metnine DOKUNMAZ; `NATIVE_PUSH=false` kalır. **Bağ:** N0-KAT.

### N6-ENTEG · Deneme fabrikası + ölçüm + sürüm notu — Opus + Sonnet, M
Açma runbook'u (bayrak açma/kapama, geri dönüş), ölçümler (dağıtım süresi p50/p95, SSE sayısı, bellek, koşul tarayıcısı sorgu süresi), sürüm notu TASLAĞI (kullanıcı terfide onaylar), docs:kurallar/bildirim.md son hali, arşiv notu. **Bağ:** hepsi.

### 7.1 Dalgalar (≤3 paralel)

| Dalga | Dilimler | Not |
|---|---|---|
| D1 | N0-KAT ∥ N1-SEMA ∥ N1-BAYRAK | bağımsız |
| D2 | N1-MOTOR ∥ N0-ETK ∥ N5-PATRON | MOTOR D1'in üçünü ister |
| D3 | N1-ZIL ∥ N1-OLAY ∥ N1-KOSUL-SIS | hepsi MOTOR'a bağlı |
| D4 | N1-KOSUL-IS ∥ N1-PANEL ∥ N4-SEMA | PANEL ZIL'e bağlı |
| D5 | N2-ALARM | N3 bunun merge'ünü bekler |
| D6 | N4-MOTOR ∥ N3-MASAUSTU | |
| D7 | N4-PANEL ∥ N4-PROFIL ∥ N4-TABLET | |
| D8 | N6-ENTEG | |

### 7.2 Çakışma bölgeleri

Kural: liste/bölüm SONUNA `// bildirim:` işaretli bölge-yerel ekleme; PR öncesi `git merge origin/main` (rebase/force-push yok).

- **Belge şablon tasarımcısı işiyle paralel:** `Teks-Erp/src/constants/permission-catalog.ts`, `role-template-catalog.ts`, `screen-catalog.ts` (N4-SEMA) · `Electron/src/pages/GeneralSettings/settings-config.ts` + `flag-modules.ts` (N1-BAYRAK) · Electron ayar sayfaları (`SettingsPage.tsx`, N4-PANEL) · `docs/RECETELER.md` (N0-KAT).
- Bildirim içi: `BEKCI-HARITASI.md` + docs:kurallar/bildirim.md (her dilim) · period-guard başlığı (N1-MOTOR) · `test_db_invariants.ts` / `audit-muafiyeti.ts` / `test_telemetri_defter_degil.ts` (N1-SEMA, N1-MOTOR, N4-SEMA) · `server.ts` (N1-MOTOR, N1-ZIL) · `Topbar.tsx` (N0-ETK, N1-PANEL) · `content-routes.tsx` (N1-PANEL, N4-PANEL, N4-PROFIL) · `System/tile-config.ts` (N4-PROFIL) · `loom-alarm-notify.ipc.ts` (N2-ALARM → N3-MASAUSTU).

## 8 · Riskler ve geri alma

1. **Geri alma = bayrağı kapatmak.** Kod geri alınmaz; emit no-op, işler durur, uçlar 409; tablolar kalır (ek tablo, eski kod etkilenmez). N0-ETK bayraksızdır; geri dönüşü revert.
2. **Sıkıştırma tamponlaması:** `compression({threshold:1024})` SSE'yi tutar → rota muafiyeti + `no-transform` + `flushHeaders`; `test_bildirim_zil` gzip'li istekte ilk olay <1 sn ölçer (N1-ZIL).
3. **Kapanışta 5 sn zorla çıkış:** açık SSE süreç kapanışını bekletir → hub dinleyicilerden ÖNCE bütün bağlantıları kapatır; bekçi kapanışta akışın bittiğini ölçer (N1-ZIL).
4. **Gecikme ölçümü kirlenmesi:** uzun bağlantı `EndpointLatencyDaily`ye 25 sn+ uç olarak yazılır → `zil` ve `bekle` ölçümden muaf; bekçi satır düşmediğini ölçer (N1-ZIL).
5. **Chromium 6 bağlantı:** panel tek akış; çoklu sekme web'de kullanıcı başı 5 sınırıyla en eski düşer.
6. **Electron arka plan kısması:** küçültülmüş pencerede zamanlayıcılar yavaşlar → ölç, gerekirse `backgroundThrottling:false` (N3).
7. **`expo/fetch` + LAN TLS belirsiz:** akış ölçülür; olmazsa tablet uzun yoklamada kalır (N4-TABLET).
8. **Dağıtıcı maliyeti:** tick başı 100 satır × ~50 kullanıcı ≈ 5k upsert → toplu `INSERT … unnest`; N1-MOTOR ölçer, eşik aşılırsa LIMIT düşürülür.
9. **İş işlemi asla bildirim yüzünden düşmez:** emit yalnız INSERT, `kind` CHECK yok, payload küçük; dağıtım hatası iş tx'ine dokunmaz.
10. **Koşul tarayıcısı sorgu maliyeti:** indeksli alanlar (`orders.deadline`, `work_orders(status, plannedEndDate)`); 5 dk periyot; N6 ölçer.
11. **Sahte "çözüldü":** kaynak hatası koşul kapatmaz (fail-closed), bekçili.
12. **Sır/kişisel veri:** payload'a tutar, parola, PIN girmez; patron push içeriksiz.
13. **Paralel iş çakışması:** belge şablon tasarımcısıyla ortak dosyalar → bölge-yerel ekleme + merge.

## 9 · Veto listesi (kullanıcıya)

1. `expo-keep-awake` yeni paketi (N4-TABLET onaysız eklemez; adım atlanır).
2. Yeni izin `settings:notifications` ve Sistem Yöneticisi rol şablonuna eklenmesi.
3. `bildirim.gelenKutusuEnabled` davranış bayrağı (modül anahtarı değil — Karar Y1), varsayılan KAPALI; deneme fabrikasında açılır.
4. F5: Firebase/FCM + `POST_NOTIFICATIONS` + gizlilik metni — kod bayrak arkasında, açılmaz.
5. Sessiz saat ↔ alarm yorumu (Karar Y2) — onaylandı, yine de raporda.
6. Kök `CLAUDE.md` alan dizinine `bildirim` satırı — 1e/kullanıcı ekler.
7. N0-ETK'de eski zilin bayraksız kalkması (Etkinlik bağlantısı yerine geçer).
8. Önizleme için ayrı `notification_daily_stats` tablosu (Karar Y3).
