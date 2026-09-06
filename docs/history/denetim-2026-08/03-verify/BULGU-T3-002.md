# BULGU-T3-002 — Doğrulama (Tur 3, bağımsız doğrulayıcı)

**Kaynak bulgu id eşleşmesi:** T3-002 == S-2-01 (`audit/01-find/tur3-S-2-senaryo-sevkiyat.md:238`),
`merged_from: ["S-2-01"]`. Aynı iddia, aynı kod satırları.

## 1) Statik doğrulama (kendi başıma yeniden okundu, bağımsız)

Bulgudaki her kod iddiası tek tek yeniden okunup doğrulandı:

- `mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx:280-297` — `shipMut.mutationFn`
  içinde `orderIds: undefined` **sabit**. Ekranın kendi yorumu bunu itiraf ediyor:
  *"Sipariş eşleştirme yapılmaz (orderIds boş)."* → mobilde sipariş seçim ekranı yok, iddia doğru.
- `shipping.service.ts:1339-1354` (`writeShipmentAllocationsTx`) — `if (orderIds.length === 0) return;`
  satırı doğrulandı; `orderIds` boşsa `sackAllocation` defterine **hiçbir satır yazılmaz**.
- `shipping.service.ts:1288-1294` (`setShipmentOrdersTx`) — `grep -n "setShipmentOrdersTx" src`
  yalnız 2 vuruş verdi: tanım (1288) + tek çağıran `createShipment` (1423). Sipariş kümesi
  **kurulumdan sonra hiçbir yerden değiştirilemiyor** — doğrulandı.
- `shipping.routes.ts` — tüm `router.*` satırları (37 uç) tek tek listelendi; sipariş kümesini
  yazan/güncelleyen bir uç **yok**. `add-sacks`/`remove-sack` (:301-302) sipariş kümesine
  DOKUNMAZ, yalnız MEVCUT kümeyle tahsisi yeniden hesaplar (`orderRows = shipmentOrder.findMany` →
  aynı kümeyi `writeShipmentAllocationsTx`'e geri besliyor) ve ikisi de yalnız `PLANNED`'da çalışır
  (`shipment.status !== PLANNED → 409`). DISPATCHED sevkiyatta sipariş bağlamanın **hiçbir yolu
  olmadığı** doğrulandı.
- `shipping.service.ts:3652-3672` (`collectShipmentDerived`/fatura satırları) — `invoiceLines`
  dizisi tamamen `sk.allocations` üzerinden kuruluyor (`for (const al of sk.allocations)`);
  tahsis yoksa döngü hiç girmez → `invoiceLines=[]`, `invoiceTotals=[]`. İddia doğrulandı.
- `docs/design/CUVAL-HAVUZU-TASARIM.md:73` — "Fazla / eşleşmeyen / siparişsiz sevk serbesttir"
  notu okundu: **siparişsiz sevk kavramının kendisi kasıtlı bir tasarım kararı**. Ancak bu not
  kullanıcının *seçerek* siparişsiz bırakmasını meşrulaştırıyor; mobildeki durum farklı —
  operatörün seçim **yapma imkânı yok** (alan sabit `undefined`, ekranda sipariş listesi hiç
  render edilmiyor). Masaüstü `previewCreateShipment` tarafında en azından
  `"Sipariş seçilmedi — mal hiçbir siparişten düşülmeden sevk edilecek."` uyarısı var
  (`shipping.service.ts` ~1520 civarı, `warnings.push`); mobilde bu uyarı da yok. Yani asıl kusur
  "siparişsiz sevk mümkün" değil, **"mobilde seçim/uyarı/geri dönüş yok"** — bulgu metni bunu
  doğru çerçeveliyor (başlıkta "sipariş bağı kurmanın hiçbir yolu yok" vurgusu isabetli).

Sonuç: **kod iddialarının tamamı doğru**, K1 zemini sağlam.

## 2) K2 — veride ihlal

`audit/data/BULGU-T3-002.sql` yazıldı (bulgudaki sorguyla birebir aynı — DISPATCHED +
çuvalı var + hiçbir `sack_allocations` satırı yok).

**Bu oturumda ÇALIŞTIRILAMADI** — hem `sql-dev.sh` hem `sql-saha.sh` aynı ortam hatasıyla
reddetti:

```
psql: error: connection to server at "localhost" (::1), port 5432 failed:
FATAL:  Postgres.app failed to verify "trust" authentication
DETAIL:  Postgres.app failed to show a dialog. This can happen when the user
that started the server is no longer logged in.
```

Bu, headless bir subagent oturumunda giderilemeyen bir GUI-onay engeli (Postgres.app'ın
"trust" auth diyaloğu görüntülenemiyor); kod/sorgu kaynaklı değil. Ayrıntı:
`audit/data/BULGU-T3-002.txt`.

**Ama:** bu sorgunun aynısı Tur 2'de prod kopyasına (`tekserp_saha_0825`) karşı
BAŞARIYLA koşturulmuş ve `audit/01-find/tur2-BIRLESIK.md:10` (BULGU-T2-001) altında
şu sonucu vermiş: **5 sevkiyat / 7.200,6 m tahsis yazılmadan DISPATCHED, 7 sipariş
kalemi hâlâ "0 sevk".** Aynı zemin + aynı sorgu olduğu için bu ölçüm bulguyu
doğrudan destekliyor; yalnız bu oturumda bağımsız olarak yeniden üretilemedi.

## 3) K3 — repro script

Zaten yazılmış bir script var: `Teks-Erp/scripts/audit_repro_S-2-01.ts` (Tur 3 bulgu
turunda üretilmiş, `tsc` temiz). Sözleşme gereği YENİDEN yazmadım, mevcut scripti
okuyup yeniden koşturdum:

```
cd Teks-Erp && npx tsx scripts/audit_repro_S-2-01.ts
```

**Sonuç: aynı ortam engeliyle çöktü** (`prisma.systemSetting.findUnique` → Postgres.app
"trust" auth hatası, `P2039`). Log: `audit/repro/S-2-01.log` (bu oturumda üzerine
yazılmadı — Tur 3 bulgu turunun logu zaten aynı sonucu taşıyordu, ben de aynı sonucu
`/tmp/T3-002-run.log`'da doğruladım — bağlantı hatası birebir aynı).

⚠️ Bu bulgu zaten bir **yarış** sınıfı değil (concurrency değil, eksik-uç/tasarım
boşluğu sınıfı — "hesap/mantık" kategorisi). Repro script'in B/C kollarının amacı da
zaten çakışma değil, DB durumunu (order_lines.cancelledAt, ledger coverage) ölçmekti.
Sunucu bu oturumda ayağa kaldırılamadığı (DB yok) ve dev API server'ı da çalışmadığı
(`curl localhost:4000/health` bağlantı reddetti) için "tek istekle davranışsal kanıt"
(K3 alternatifi) de bu oturumda ÜRETİLEMEDİ.

## 4) Sonuç

- **kanit_seviyesi kalıyor: K1** (statik kod kanıtı bağımsız doğrulandı, ek doğrulama
  yapıldı — routes listesi, invoiceLines zinciri, tasarım notu farkı). K2/K3'e bu
  oturumda ÇIKARILAMADI — sebep tamamen ortam (Postgres.app GUI onayı + sunucu ayakta
  değil), kodda/iddiada bir zayıflık değil.
- **Tur 2'nin bağımsız K2 ölçümü (5 sevkiyat/7.200,6 m) bu bulguyu güçlü şekilde
  destekliyor** ama bu oturumun kendi ürettiği bir kanıt değil — rapor bunu açıkça
  ayırmalı (kaynak: BULGU-T2-001, önceki tur).
- **Şiddet (S1) için gerekçe yeterli:** finansal/operasyonel etkisi somut ve kod
  yoluyla kesin (invoiceLines boşalıyor, sipariş kalemi "açık" kalıp mükerrer iş emri
  riski doğuyor, storno'nun da faturalı sevkiyatta reddedildiği doğrulandı — kaçış
  yolu yok). S0'a çıkarmak için doğrudan veri kaybı/güvenlik ihlali gerekir; burada
  veri TUTARSIZLIĞI var ama kalıcı veri kaybı yok (defter eksik ama roll/sack verisi
  sağlam, düzeltilebilir — storno+yeniden kurma yolu faturasızken hâlâ açık). S1 doğru.

**verdict: repro-tetiklenemedi** (ortam engeli — Postgres.app GUI onayı bu oturumda
gösterilemedi; hem dev hem saha DB'ye, hem mevcut repro script'ine, hem canlı API
server'a erişim denendi, hepsi aynı nedenle başarısız). Bulgu geçerliliğini
KORUYOR — statik kanıt tam ve önceki turun bağımsız K2 ölçümüyle destekleniyor.
