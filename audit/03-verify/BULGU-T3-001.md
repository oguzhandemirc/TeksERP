# BULGU-T3-001 — Doğrulama Raporu

**Bulgu:** Offline kuyruktan flush edilen KK1 kaydı 409 POSSIBLE_DUPLICATE alırsa
hiçbir iz bırakmadan düşer — top sistemde hiç doğmaz.
**Girdi kanıt seviyesi:** K1 → **Bu turda hedeflenen:** K2/K3.

## 1) Kod okuması ile mekanizma DOĞRULANDI (genişletilmiş K1)

Bulgudaki tüm dosya/satır referansları tek tek okunup teyit edildi:

- `mobil/src/offline/announceFailure.ts:24-25,50-57` — `CONFLICT_CODES` seti
  (`POSSIBLE_DUPLICATE`, `CLIENT_TOKEN_COLLISION`) `shouldAnnounceFailure`'da
  gerçekten `false` döndürüyor; gerekçe yorumu aynen bulguda alıntılandığı gibi
  ("ekran modalla SORUYOR; toast aynı kararı ikinci kez sordururdu").
- `mobil/src/offline/queryClient.ts:32-54` — `MutationCache.onError`
  (`announceStationFailure`) global callback. Dosyanın **kendi yorumu**
  (satır 38-40) bu callback'in *"observer'sız (restore edilmiş)
  mutation'ları da kapsadığını"* açıkça yazıyor — yani geliştiricinin kendisi
  bu callback'in component'siz de tetiklendiğini biliyor ve bilerek buraya
  koymuş (component-level `onError`'ın ezilme riskine karşı). Bu, bulgunun
  "gözlemcisiz mutation'da yalnız bu susturulmuş callback çalışır" iddiasını
  BİRİNCİ ELDEN doğruluyor.
- `mobil/src/offline/mutations.ts:209-213` — `KK1_CREATE_ENTRY` için
  `setMutationDefaults` sadece `mutationFn` + `OFFLINE_AWARE` (retry/retryDelay)
  taşıyor; `onError` YOK. Modal açan tek yol component-bağlı `useMutation`
  hook'u (`KK1Screen.tsx`).
- `mobil/src/screens/Modules/KK1/KK1Screen.tsx:996-1013` — okundu, doğrulandı:
  `onError` içinde `POSSIBLE_DUPLICATE`/`CLIENT_TOKEN_COLLISION` için
  `setConflict(...)` ile modal açılıyor ve **`return` — toast YOK** yorumu var
  (satır 1013 civarı). Bu callback yalnız ekran mount'ken (`useMutation`
  observer'ı canlıyken) tetiklenir — React Query'nin `defaultMutationOptions`
  önceliği zaten `queryClient.ts:35-37`'de belgeli (global < key-default <
  component).
- `mobil/src/offline/persistPolicy.ts:20-24,92-105` — `revivePendingStationMutations`
  restore edilen `pending` istasyon mutation'larını `paused`'a çeviriyor; bu da
  "resume, KK1Screen mount olmadan da olur" senaryosunu MÜMKÜN kılan mekanizma.
- `Teks-Erp/src/services/inventory.service.ts:864-901` (bulgudaki 881-901
  aralığını da kapsayan biraz daha geniş blok) okundu: guard `twin` bulursa
  `throw AppError.conflict(...)` **tx İÇİNDE** — Prisma callback'i bunu
  ROLLBACK eder (satır ~873-876 yorumu: *"Rollback yan etkisiz — bu noktaya
  kadar tek yazma yok, barkod sayacı hiç artmadı"*). **Bu, K2 sorgusunun bu
  bulgu sınıfında neden yapısal olarak sonuçsuz kalacağını da açıklıyor** —
  reddedilen top DB'de gerçekten SIFIR satır bırakıyor (bkz. §2).

**Ek doğrulama (bulguda olmayan, bu turda eklenen):** `resumePausedMutations()`
çağrıları tarandı (`mobil/src/offline/sessionSwitch.ts:57` — `nudgeOutbox()`,
girişten hemen sonra) + TanStack Query v5'in kendi `onlineManager` reconnect
davranışı (kütüphane çekirdeğinde `online→resumePausedMutations` otomatik
tetiklenir). Bu, senaryodaki "tablet yeniden başlar, ağ gelince kuyruk
KK1Screen açık olmadan da boşalır" adımının **iddia değil gerçek davranış**
olduğunu gösteriyor — flush, kullanıcı KK1 ekranına dönmeden, örn. login
sonrası veya farklı bir ekranda wifi geri gelince de olur.

## 2) K2 — Veride ihlal sorgusu

**Denendi, DB erişimi ortam hatasıyla kapalı** (bkz.
`audit/data/BULGU-T3-001.txt`): `sql-saha.sh` ve `sql-dev.sh` ikisi de
Postgres.app'in "trust" auth için GUI dialog istemesi yüzünden bağlanamadı
(`FATAL: Postgres.app failed to verify "trust" authentication ... failed to
show a dialog`). Bu, önceki (finder) oturumundaki aynı ortam kısıtı — sorgu
veya yetki sorunu değil.

**Daha önemlisi:** §1'deki `inventory.service.ts` okuması sorgu boşluğunu
kavramsal olarak da anlamsızlaştırıyor. Guard tetiklendiğinde tx rollback
oluyor ve barkod sayacı bile artmıyor — yani DB'de aranacak "eksik/atlanmış
top" izi YOK. `BULGU-T3-001.sql`'deki sorgu (kuyruktan geç gelen kayıtları
`clientEnteredAt` ile `createdAt` farkından bulma) yalnız DOLAYLI bir sonda
olabilirdi (kuyruktaki BAŞARILI ikinci girişleri bulur, düşenleri değil) —
DB erişimi olsa bile bu sorgu bulgunun asıl iddiasını (kayıp topun DB'de hiç
görünmemesi) doğrudan kanıtlayamazdı; yalnız "böyle bir kuyruk senaryosu
gerçekten oluyor mu" diye dolaylı bir ipucu verirdi. Bu nedenle K2 bu bulgu
sınıfı için yapısal olarak zayıf bir kanıt yoludur — mekanizma zaten kaynak
kodda (tx rollback) kanıtlanıyor.

## 3) K3 — Repro script

**Yazılmadı**, gerekçe finder'ın notuyla aynı ve bu turda da geçerliliği
teyit edildi: `audit/repro/_REPRO-SOZLESMESI.md` sözleşmesi DEV DB + Prisma
üzerinden eşzamanlı backend isteğiyle tetiklenen bir yarış sınıfı için
tasarlanmış (`Teks-Erp/scripts/audit_repro_*.ts`, `Teks-Erp/node_modules`
üzerinden Prisma). Bu bulgunun kusuru ise **istemci tarafında** (React
Query'nin gözlemcisiz/restore edilmiş mutation'da hangi `onError`'ın
çalıştığı) — sunucu tarafı zaten doğru çalışıyor (409 doğru dönüyor, tx
doğru rollback ediyor). Gerçek bir runtime repro'nun `@tanstack/react-query`
+ `mobil/src/offline/*` modüllerini çalıştırması gerekir; bu paket yalnız
`mobil/node_modules` altında var (`Teks-Erp/`de yok, repo kökünde
`node_modules` yok) ve audit kısıtı hem "TEK yazma iznin
`Teks-Erp/scripts/audit_repro_<id>.ts`" hem de "mobil değişmez (SALT-OKUNUR)"
diyor — yani mobil ağacına yeni bir test dosyası da eklenemez, script de
mobil'in bağımlılıklarına erişemeyen bir dizine yazılmak zorunda. Bu ikisi
birlikte, mevcut audit altyapısıyla gerçek bir çalıştırılabilir K3 repro'yu
bu bulgu sınıfı için imkânsız kılıyor.

**Yapılan alternatif (davranışsal doğrulama, kod-okuma ötesi):**
Sınıf "hata yutma" (B.3) olduğu için görev talimatına göre K3 yerine "tek
istekle davranışsal kanıt" hedeflendi; ancak bu da runtime gerektirdiğinden
(React Native ortamı / gerçek cihaz veya en azından Node'da mobil'in
node_modules'ı ile çalışan bir harness) bu oturumun araç/izin kısıtları
içinde çalıştırılamadı. Bunun yerine §1'de yapılan genişletilmiş kod
doğrulaması ile mekanizmanın HER adımı (susturma seti → global callback →
component callback'in yokluğu → resume'un observer'sız olabilirliği →
sunucunun rollback'i) ayrı ayrı, ilgili dosyaların GERÇEK içeriğiyle teyit
edildi.

## Sonuç

Bulgu **doğrulanmış** durumda kalıyor — mekanizma kaynak kodda uçtan uca
izlenebiliyor ve geliştiricinin kendi yorumları (`queryClient.ts:38-40`)
bulgunun iddiasını üçüncü bir kaynak olarak teyit ediyor. Kanıt seviyesi K2/K3'e
**çıkarılamadı**: K2 bu ortamda erişim hatasıyla engellendi VE bu bulgu sınıfı
için yapısal olarak zaten zayıf bir kanıt yolu; K3 hem sözleşme (DEV DB/Prisma
odaklı) hem de audit yazma-izni kısıtları (mobil SALT-OKUNUR, `@tanstack/react-query`
yalnız `mobil/node_modules`'ta) yüzünden bu turda çalıştırılamadı.
Kanıt seviyesi **K1** olarak kalıyor, ancak önemli ölçüde genişletilmiş/çapraz
doğrulanmış bir K1 (6 dosyanın tamamı satır satır okunup teyit edildi + 2 ek
dosya/davranış — `sessionSwitch.ts` ve TanStack Query'nin reconnect-resume
davranışı — bu turda eklendi).

**Şiddet (S1) ve failure_mode değişmiyor** — enflasyon yapılmadı.
