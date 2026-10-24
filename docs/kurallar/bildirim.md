# Bildirim · Gelen kutusu · Zil · Alarm kanalı

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: bildirim sistemi v2 planı `docs/design/BILDIRIM-SISTEMI-PLAN.md` (patron oturumu kararları B1–B7 + onaylı yorumlar Y1–Y3, 2026-10-24). Hikâye ve gerekçe planda; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

**Dokunmadan önce (özet):** tür kataloğu TEK kaynaktır (`Teks-Erp/src/constants/notification-catalog.ts`, `NotificationKind`); outbox'a yalnız `emitNotification` yazar, iş tx'inin içinde; gelen kutusu telemetridir, defter değildir; kim görür sorusunun tek cevabı `canSeeNotificationType`; yeni gelen kutusu `bildirim.gelenKutusuEnabled` davranış bayrağıyla KAPALI doğar; yeni tür reçeteyle eklenir (`docs/RECETELER.md` § Yeni bildirim türü). Dilim durumu: N0-KAT ile katalog + render + katalog bekçisi indi; outbox/dağıtıcı/SSE zil sonraki dilimlerde (plan §7).

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Üç sınıfı karıştırma: ALARM onay ister ve kademe yükselir (ilk üyesi `LoomAlarm`, kendi tabloları kalır) · BİLDİRİM kişisel gelen kutusudur (OLAY bir kez olur; KOSUL durum sürdükçe tek kayıttır, düzelince "çözüldü" olur) · ETKİNLİK sayaçsız akıştır ve okunmamış sayısı taşımaz. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Tür kataloğunu TEK kaynakta tut: her tür `NOTIFICATION_CATALOG`ta bir satırdır; görme süzgeci, tercih ekranı, dağıtıcı ve render aynı satırı okur; tür adı başka yerde serbest dize olarak çoğaltılmaz. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Katalog satırının `panelEkran`ı SCREEN_CATALOG'da, `modul`u o ekranın modülü, her izin konjonksiyonu o ekranın (ya da `tabletEkran`ın) `requires`ından birini içerir; tür ile ekran çelişirse EKRANI esas al, türü ona uydur. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Şablon `{alan}` yer tutuculu düz metindir (LiquidJS değil); her yer tutucu `payloadAlanlari`nda beyanlıdır; eksik alan render'da `—` olur, hata fırlatmaz — bildirim iş işlemini düşürmez. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Payload'a tutar ve sır koyma: yalnız kimlik ve görüntü dizeleri (belge no, kod, ad); tutar, parola, PIN, token ne outbox'a ne gelen kutusuna girer. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Kilitli türün (`kilit ≠ YOK`) varsayılanı KAPALI olamaz ve `kilitGerekcesi` taşır; kilit yalnız uygulama kanalını zorlar — kullanıcı kapatamaz, erteleyebilir. · bekçi: `test_bildirim_katalogu`
- **[ÇEKİRDEK]** Outbox'a tek yazar `emitNotification(tx, kind, subject, payload)`tır ve iş işlemiyle AYNI transaction'da çağrılır; rollback'te bildirim de yoktur, token replay'i bildirimi tekrarlamaz.
- **[ÇEKİRDEK]** Gelen kutusu, outbox ve günlük sayaç TELEMETRİdir (defter değil): `AUDIT_EXEMPT_MODELS`te beyanlı, budama yalnız prune servisinden (okunmuş 90 / okunmamış 180 gün · outbox işlendikten 7 gün · sayaç 35 gün); rapor sayısı bu tablolardan türetilmez.
- **[ÇEKİRDEK]** "Bu kullanıcı bu türü görür mü" sorusunu yalnız `canSeeNotificationType(user, kind)` cevaplar (izin DNF ∧ modül ∧ ek kapı); dağıtım, gelen kutusu okuması ve tercih ekranı aynı helper'ı çağırır; alıcı kaynakları birleşip bu süzgeçle KESİŞİR, kural yetki genişletmez; izin kaybında tür gizlenir (fail-closed).
- **[ÇEKİRDEK]** Okunmamış sayısını `SystemLog`dan türetme: audit yalnız ayak izidir; sayı gelen kutusu satırlarından gelir.
- **[ÇEKİRDEK]** Bildirim tablolarında tekilliği partial unique ile kur — `notification_inbox (userId, groupKey)` ve `notification_conditions (kind, subjectKey)`, ikisi de `WHERE "resolvedAt" IS NULL` (çözülen satır anahtarı bırakır; dağıtıcının `ON CONFLICT` hedefi budur); kapalı kümeleri (`phase` · `klass` · `reason`) VarChar + CHECK yaz, `kind`e CHECK koyma; FK yalnız `notification_inbox.userId → users` (RESTRICT), polimorfik ve budanan bağlar FK'sız. · bekçi: `test_db_invariants`

### Kararlar

- **[ÇEKİRDEK]** `bildirim.gelenKutusuEnabled` bir DAVRANIŞ BAYRAĞIDIR, modül anahtarı değildir (`MODULE_FLAG_KEYS` genişletilmez); varsayılanı `false` (= bugünkü davranış); kapalıyken `emitNotification` no-op, dağıtıcı başlamaz, `/api/bildirim/*` 409 `BILDIRIM_KAPALI` (yalnız `/ozet` 200 `{enabled:false}`).
- **[ÇEKİRDEK]** Yeni bildirim türü reçeteyle eklenir (`docs/RECETELER.md` § Yeni bildirim türü): katalog satırı → payload beyanı → kaynak (emit ya da koşul kaynağı) → bekçi; migration gerekmez (`kind` kolonunda CHECK yok).
- **[ÇEKİRDEK]** Gelen kutusu bayrağını kapsam tablosuna koyma (yalnız `admin:settings` yazar; panelde `ADMIN_ONLY_CATEGORY_IDS` beyanlı `bildirim` kategorisi); backend okuyucusu `readNotificationInboxEnabled`, tablet `resolveNotificationInboxEnabled` (yalnız gerçek `true` açar, eski sunucu → kapalı). <sub>(arşiv:2026-10-24)</sub>
- **[ÇEKİRDEK]** Zil sayısı audit'ten türetilmez; Etkinlik sayfası (`/system/activity`) sayaçsızdır: Topbar'da yalnız rozetsiz "Etkinlik" bağlantısı, görünürlüğü sayfanın kendi `SYSTEM_ACTIVITY_ACCESS` kümesinden; eski "Son Aktivite" zili (`NotificationBell`) kalktı. <sub>(arşiv:2026-10-24)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (koşucu `_test` DB'si ister; katalog bekçisi DB'ye dokunmaz).

**Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## bildirim` bölümü.**

Backend: `test_bildirim_katalogu`, `test_screen_catalog`
