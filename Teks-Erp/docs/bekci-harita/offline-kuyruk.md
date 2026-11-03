## offline-kuyruk

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Electron/src/test/fason-receive-attempt.test.ts` | Fason kabulunde replay kimligi (panel): ayni teslimat yeniden gonderilirse AYNI token, sonraki teslimat YENI token (yoksa ikinci gercek teslimat cache |  | ✓ |  |
| `mobil/src/components/SyncStatusChip.test.tsx` | Rozet sözleşmesi: tam senkronda HİÇ render edilmez; çevrimdışı sebebi (wifi mi sunucu mu) ayrı cümle; rozet dokunulamaz ve 'KAYIT GİTMEDİ' basmaz (kal |  | ✓ |  |
| `mobil/src/hooks/useReasonPresets.test.tsx` | Üç kademeli katalog: sunucu erişilemezken gömülü zemin kullanılır (liste ASLA boş dönmez — boş liste operatörü kilitler) ve aynı veri için dizi REFERA |  |  |  |
| `mobil/src/offline/announceFailure.test.ts` | Kalıcı düşüşü anında toast'la söyler, hiçbir yere yazmaz: çakışma 409'u toast BASMAZ (modal soruyor), istasyon-dışı mutation ve noAuth kapsam dışı, me |  |  |  |
| `mobil/src/offline/announceWire.test.ts` | TEL testi: damga (persistPolicy revive → mutation meta) GERÇEK queryClient MutationCache.onError üzerinden announce'a ulaşıyor mu — saf karar testleri |  | ✓ |  |
| `mobil/src/offline/backoff.test.ts` | jitteredBackoff: exp × [0.7,1.3] sınırları, tavan 30 sn, gerçekten jitter üretir (senkron dalga yok), geç denemelerde patlamaz. |  |  |  |
| `mobil/src/offline/barcode.test.ts` | generateClientUuid geçerli UUID v4 üretir (backend Zod .uuid() sözleşmesi) ve ardışık çağrılar çakışmaz. |  |  |  |
| `mobil/src/offline/deadline.test.ts` | withDeadline: tavandan önce biterse değer döner; hata 'bitti' sayılır ve ASLA reject etmez; tavan dolunca timedOut döner, iş iptal edilmez ve geç hata |  |  |  |
| `mobil/src/offline/entryAttempt.test.ts` | Token yapışkanlığının İKİ yönü: sunucu restart'ında 4 basış → TEK token (2026-08-03 saha vakası) ve offline seri girişte 5 basış → 5 FARKLI token (yap |  |  |  |
| `mobil/src/offline/flushThenLogout.test.ts` | Çıkış/oturum değişiminde adım SIRASI ortak calls[] diliyle ölçülür (flush → clear → closeSession → resetSession) ve çevrimdışıyken davranış ayrışır. |  |  |  |
| `mobil/src/offline/mutations.test.ts` | Üretimdeki GERÇEK config ölçülür: registerStationMutationDefaults sonrası queryClient.getMutationDefaults()'tan retry/retryDelay/networkMode geri okun |  |  |  |
| `mobil/src/offline/persistPolicy.test.ts` | Kalıcılık politikası: keyStartsWith önek eşleşmesi, BOOTSTRAP/PERSISTED anahtar kümeleri, istasyon mutation'ı tanıma, shouldPersistMutation ve reviveP |  |  |  |
| `mobil/src/offline/printQueue.test.ts` | Kalıcı yazıcı kuyruğu: dedup (çift dokunuş 2 kâğıt basmaz), at-least-once (aktif iş persist edilmez ama listede kalır), otomatik yeniden deneme yalnız |  |  |  |
| `mobil/src/offline/serverReachability.test.ts` | online = ağ linki VE sunucu erişilebilir: yeni sinyalin doğru AND'lenmesi + B6 saha vakasının kuyruk üzerinden geri gelmemesi (revalidateServer, repor |  |  |  |
| `mobil/src/offline/sessionSwitch.test.ts` | clearUserScopedQueries: public bootstrap query'leri korunur (login ekranı cache'ten çizilir) ve mutation cache'ine ASLA dokunulmaz (bekletilen outbox  |  |  |  |
| `mobil/src/screens/Modules/FasonKabul/receiveAttempt.test.ts` | Fason kabul replay kimliği iki yönlü: aynı teslimat yeniden gönderilirse AYNI token; farklı/sonraki teslimat YENİ token (sunucu yükü karşılaştırmadan  |  | ✓ |  |
| `mobil/src/services/appUpdate.service.test.ts` | İki sessiz arıza: gönderilmemiş kayıt varken reloadAsync YAPILMAZ (uçuştaki KK1/tambur kaydı eksik kalır) ve sürüm karşılaştırması SAYISAL ('2.9.10' < |  |  |  |
| `mobil/src/utils/queryState.test.ts` | queryProblem: çevrimdışıyken React Query sorguyu DURAKLATIR hata VERMEZ (isError:false, isPaused:true) — yalnız isError'a bakan ekran bunu 'boş liste' |  |  |  |
