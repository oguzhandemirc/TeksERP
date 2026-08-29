# BULGU-T3-004 — Doğrulama Raporu (Tur 3, ③ Doğrulayıcı)

## Bulgu özeti
`tambur-undo.service.ts` içindeki `applySingleRestore` (satır 1221-1386) ve
`applyFull` (satır 1434-1677) transaction'ları, işlemin sonunda
`completeWorkOrderIfStepsDone`in ikizi bir örüntüyle (`recomputeStepStatus` +
`workOrder.updateMany({ where: { status: COMPLETED } })`) WorkOrder'ı geri
diriltiyor, ama **`touchWorkOrderTx` ile WO satırını write-kilitlemiyor**.
`roll-step.helper.ts:188-190`'daki docstring bu kilidin sözleşme olduğunu
açıkça yazıyor ("Çağıran tx başında touchWorkOrderTx ile WO'yu
write-kilitlemeli"). Kilidin YOKLUĞU, eşzamanlı bir `finalize` (son top)
işlemiyle yarışınca WorkOrder'ın COMPLETED'a düşmesine rağmen adımda canlı
(IN_PRODUCTION) bir top ve/veya açık hareket kalmasına yol açabilir
(test_consistency §20 sınıfı phantom-read/write-skew).

## K2 — veride ihlal sorgusu
- Sorgu: `audit/data/BULGU-T3-004.sql` (WO COMPLETED iken adımında canlı top
  veya açık hareket kalan satırları arar).
- Sonuç: `audit/data/BULGU-T3-004.txt`.
- **ARANAMADI** — bu oturumda hem `sql-dev.sh` hem `sql-saha.sh` Postgres.app'in
  GUI trust-auth diyaloğunu gösteremediği için (headless ajan oturumu)
  bağlantı reddedildi:
  ```
  FATAL: Postgres.app failed to verify "trust" authentication
  DETAIL: ... user that started the server is no longer logged in ...
  ```
  Postgres sunucu süreci çalışıyor (ps aux ile doğrulandı, pid 770), sorun
  ortamın GUI-onay gerektiren auth eklentisinde — kodun veya bulgunun bir
  kusuru değil. Aynı kısıt Tur 2'nin verify oturumunda da (S-3-02.log,
  2026-08-29T00:33:38Z) bağımsız olarak gözlemlenmiş.

## K3 — eşzamanlılık repro'su
- Script zaten mevcuttu: `Teks-Erp/scripts/audit_repro_S-3-02.ts` (1 sıralı
  referans turu + 10 paralel tur; `finalize(B) ‖ applyFull(A)`; AUDITREPRO
  damgalı fixture, `finally` temizliği, feature-flag'e dokunmuyor). tsc
  kontrolünden geçmiş durumda.
- Bu oturumda yeniden koşturuldu:
  ```
  cd Teks-Erp && npx tsx scripts/audit_repro_S-3-02.ts 2>&1 | tee audit/repro/BULGU-T3-004.log
  ```
- **TETİKLENEMEDİ** — script `prisma.item.create()` fixture kurulumunda aynı
  `Postgres.app failed to verify "trust" authentication` hatasıyla (P2039)
  daha ilk adımda düşüyor; eşzamanlılık senaryosuna hiç ulaşamıyor. Log:
  `audit/repro/BULGU-T3-004.log` (S-3-02.log ile birebir aynı hata sınıfı).

## Kod-düzeyi doğrulama (bu oturumda ayrıca yapıldı)
DB erişimi olmadığı için kanıt seviyesini kod tarafında pekiştirmek amacıyla
iddia edilen üç nokta tekrar, satır satır doğrulandı:

1. `grep -n "touchWorkOrderTx\|pg_advisory" Teks-Erp/src/services/tambur-undo.service.ts`
   → **0 vuruş** (dosyanın tamamında). Bulgudaki "koruma_kontrolu" maddesi (1)
   ve (2) doğru.
2. `roll-step.helper.ts:186-190` docstring'i teyit edildi — birebir bulguda
   alıntılanan cümleyi taşıyor: *"Çağıran tx başında touchWorkOrderTx ile
   WO'yu write-kilitlemeli (remainingSteps sayımı eşzamanlı finish/fason/
   finalize ile serileşsin)."*
3. `applySingleRestore` (satır 1330-1346 hareket yeniden açma, 1377
   `recomputeStepStatus`, 1378-1381 `WHERE status=COMPLETED` geç dirilme) ve
   `applyFull` (satır 1667-1676, aynı örüntü) elle okundu — ikisi de kilitsiz,
   bulgudaki satır numaraları doğru.
4. Karşı taraf (`tambur.service.ts:931,1282`) `touchWorkOrderTx` kullandığı
   doğrulandı — asimetri gerçek: finalize yolu kilitli, undo yolu değil.

Bu okuma bulgunun **mekanizmasını** (kilit eksikliği + docstring'in tersi
sözleşme) K1 üstünde bir kesinlikle doğruluyor, ama eşzamanlı iki transaction'ın
gerçekten çarpışıp WO'yu phantom-COMPLETED'a düşürdüğünü DB'de veya çalışan bir
repro'da gösteremedi.

## Sonuç
- **Kanıt seviyesi: K1'de KALDI** (K2/K3'e çıkarılamadı — ortam kısıtı, DB'ye
  bu oturumda erişim yok).
- **Şiddet: S1 KORUNDU** (S0 için K2/K3 şart, sağlanamadı — enflasyon yok).
- Bulgunun mekanizması (kilitsiz `completeWorkOrderIfStepsDone` çağrısı +
  yazılı sözleşmenin ihlali + karşı yolun kilitli olması) kod okumasıyla
  yeniden ve bağımsız olarak doğrulandı; bu, bulguyu güçlü bir K1 yapıyor
  ama K2/K3'ün gerektirdiği "veride veya çalışan bir repro'da gösterilmiş
  ihlal" eşiğine bu oturumda ulaşılamadı.
- **Tavsiye:** DB erişimi (Postgres.app GUI onayı veya headless bir bağlantı
  yolu — örn. parola tabanlı `pg_hba.conf` girişi ya da SSH tüneli) sağlanan
  bir sonraki oturumda hem `BULGU-T3-004.sql` hem `audit_repro_S-3-02.ts`
  doğrudan koşulabilir; ikisi de hazır ve bekliyor.

## Repro script / log referansları
- `Teks-Erp/scripts/audit_repro_S-3-02.ts` (ilk yazan denetçiden miras, bu
  bulgunun yerel kimliğiyle eşleşiyor — S-3-01 bu bulguya `merged_from` ile
  birleştirildi).
- `audit/repro/S-3-02.log` — Tur 2'nin ilk koşumu (aynı hata).
- `audit/repro/BULGU-T3-004.log` — bu oturumun tekrar koşumu (aynı hata,
  bağımsız doğrulama).
