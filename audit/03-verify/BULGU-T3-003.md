# BULGU-T3-003 — Doğrulama (TUR 3)

**Sonuç: `repro-tetiklenemedi` (ORTAM ENGELİ) — ama kod-yolu analizi K1 içinde belirgin şekilde derinleştirildi/güçlendirildi.**

## 1) K2 denemesi — DB'ye SIFIR erişim (dev de, saha kopyası da)

Denenenler, hepsi aynı hatayla düştü:
- `audit/tools/sql-dev.sh -c "select 1"`
- `audit/tools/sql-saha.sh -c "select 1"`
- `psql "postgresql://oad@localhost:5432/adnansahin_db"`
- `psql` unix socket (`/tmp/.s.PGSQL.5432`) üzerinden

```
FATAL:  Postgres.app failed to verify "trust" authentication
DETAIL: Postgres.app failed to show a dialog. This can happen when the user
        that started the server is no longer logged in. Try restarting the
        PostgreSQL server.
HINT:   Change pg_hba.conf to require a password
```

`ps aux` ile teyit: sunucu `shared_preload_libraries=auth_permission_dialog` ile
başlıyor — Postgres.app 18'in "trust" kimlik doğrulaması artık bir GUI onay
diyaloğu istiyor. Bu ajan oturumu headless olduğu için diyalog gösterilemiyor,
sunucu bağlantıyı reddediyor. Sistemde başka bir PostgreSQL kurulumu / psql
yok (yalnız Postgres.app 18). Bu, saha/prod verisiyle ilgili bir kısıt değil,
bu geliştirme makinesindeki PostgreSQL sürümüne özgü bir GUI-onay
mekanizmasıdır ve mevcut oturumda aşılamıyor. Sorgular ve sonuç
`audit/data/BULGU-T3-003.sql` / `.txt`'ye yazıldı.

## 2) K3 denemesi — mevcut repro scripti yeniden koşturuldu

Bulguya bağlı repro scripti zaten vardı: `Teks-Erp/scripts/audit_repro_S-2-01.ts`
(3 kollu: A-sıralı kontrol, B-12 turlu yarış, C-kaynak sondası). Script SÖZLEŞMEYE
UYGUN yazılmış (dev-guard, `AUDITREPRO-` damgası, `finally` temizlik, N-turlu
Promise.all). Yeniden koşturuldu:

```
cd Teks-Erp && npx tsx scripts/audit_repro_S-2-01.ts 2>&1 | tee audit/repro/BULGU-T3-003.log
```

**Sonuç: ilk DB sorgusunda (`prisma.systemSetting.findUnique`, satır 190) aynı
`Postgres.app failed to verify "trust" authentication` hatasıyla çöktü.** Hiçbir
fixture (order/roll/sack) yaratılamadı — script en baştaki ön-koşul okumasında
düştüğü için `cleanup()` de sildiği hiçbir şey olmadan aynı hatayla tekrar
çöktü (temizlenecek veri yok, DB'de kalıntı bırakılmadı). Tam log:
`audit/repro/BULGU-T3-003.log`.

Bu, önceki tur (③) sırasında script yazarının notuyla birebir aynı: "ORTAM
ENGELİ nedeniyle koşturulamadı" — iki bağımsız oturumda da aynı blokaj.
`kanit_seviyesi` bu yüzden **K1'de kalıyor**, K2/K3'e çıkarılamadı.

## 3) Bu turda yapılan ek şey — kod yolunun ikinci bir okumadan geçirilmesi

DB erişimi kapalıyken elde kalan tek araç kaynak inceleme. Bulgudaki iddiaları
tek tek `shipping.service.ts` ve `order-status.helper.ts`'te yeniden izledim
(bağımsız — diğer denetçilerin çıktısı okunmadı) ve **iddianın mekanizması
doğru ama pencerenin TANIMI bulguda anlatılandan biraz farklı** olduğunu
gördüm — bu bir çürütme değil, daha kesin bir failure_mode:

- Bulgu metni "computeSackAllocations kalemleri okuduktan sonra cancelOrderLine
  commit ederse" diyor ve senaryoyu "diyalog dakikalarca açık kalır, tx dışında
  okunur" gibi anlatıyor. Kod böyle DEĞİL: `writeShipmentAllocationsTx` →
  `computeSackAllocations(tx, …)` **transaction'ın İÇİNDE** çağrılıyor
  (`shipping.service.ts:1350`, çağıran `shipping.service.ts:1424`, tx
  `shipping.service.ts:1399`'da açılıyor). Yani ACTIVE_LINE SELECT'i tx
  BAŞLAMADAN önce değil, tx içinde — READ COMMITTED altında en son commit
  edilmiş veriyi görür.
- Gerçek pencere: bu SELECT (satır ~1316) ile insert (`sackAllocation.createMany`,
  satır ~1352) arasındaki, VE bu tx'in nihai COMMIT'i arasındaki milisaniyelik
  aralıkta `cancelOrderLine` kendi transaction'ını commit ederse. Kod bu SELECT'i
  kilitsiz yapıyor (`FOR UPDATE` yok) ve satır kilidi (`touchOrderLinesTx`)
  ancak `performDispatchTx` içinde (satır 1878), yani tahsis ZATEN yazıldıktan
  SONRA alınıyor — kilit geriye dönük hiçbir şeyi doğrulamıyor, yalnız
  `shippedQty`/status yazımını serileştiriyor.
- `order-status.helper.ts:127-145` teyit: iptal edilmiş kalem için de
  `shippedQty` HER ZAMAN yazılıyor — kod bunun BİLİNÇLİ olduğunu söylüyor
  ("sevk defteri iptalden etkilenmez — mal çıktıysa çıkmıştır"). Bu, GERİYE
  DÖNÜK bir iptal-sonrası düzeltme için doğru bir tasarım kararı; ama bulgunun
  sorduğu soru bu değil — sorun, "mal çıktı" önermesinin YARIŞTA henüz doğru
  olmamasıdır (cancel, sevkiyat commit'inden ÖNCE, kullanıcının niyetiyle
  gerçekleşiyor ama motor bunu göremiyor).

Yani: **pencere bulguda tarif edildiğinden DAHA DAR** (tüm dialog süresi değil,
tx içi SELECT→COMMIT aralığı — muhtemelen birkaç-onlarca ms), ama mekanizma
gerçek ve kodda AÇIKÇA yok — hiçbir yerde tahsis yazımından önce veya commit
öncesi kilit altında `cancelledAt IS NULL` yeniden doğrulanmıyor. Bu doğrulama
K1'i sarsmıyor, tam tersine iddiayı DAHA KESİN bir failure_mode'a indirgiyor
(dar ama gerçek bir race window; C1/C2 sonda sonuçları da bunu destekliyor —
`performDispatchTx` gövdesinde revalidasyon izi yok).

## 4) Sonuç ve öneri

- `kanit_seviyesi`: **K1** (değişmedi — ortam engeli DB'ye hiçbir erişim
  bırakmadı, ne saha kopyasında ne dev'de).
- `siddet`: **S1** kalmalı (K2/K3 olmadan S0'a çıkarılamaz — kural gereği).
- Kod-düzeyi analiz orijinal bulguyu ÇÜRÜTMEDİ, tam tersine mekanizmayı daha
  kesin tarif etti (bkz. §3) — ACTIVE_LINE SELECT'i tx içinde ama kilitsiz,
  tahsis yazımından önce veya commit'ten önce yeniden doğrulama YOK.
- Sonraki turda DB erişimi açılırsa (Postgres.app'in GUI onay diyaloğu
  onaylanır / farklı bir PG kurulumuna geçilirse) mevcut
  `audit_repro_S-2-01.ts` doğrudan koşturulabilir durumda — script'in kendisi
  değil, yalnız ortam bağlantısı engel.

**Kanıt eki:** `audit/data/BULGU-T3-003.sql`, `audit/data/BULGU-T3-003.txt`,
`audit/repro/BULGU-T3-003.log`.
