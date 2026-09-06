# Doğrulama — BULGU-T2-001

**Başlık:** Sevk edilen içerik hiçbir sipariş satırına yazılmadan sevk edilebiliyor (`specMatch` tutmayan içerik `SackAllocation` üretmiyor; sevkiyat yine de DISPATCHED oluyor, sipariş defterinde iz kalmıyor)
**Kaynak bulgu:** T2 turu, S1, K2 iddialı (bu doğrulama turunda K2/K3'e çıkarma denemesi)

## 1) Kod doğrulaması (K1 — tamam, mekanizma birebir teyit edildi)

`Teks-Erp/src/services/helpers/allocation.helper.ts:36-49`:
```ts
export function specMatch(a, b): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  ...
}
```
Renk/en ikisi de doluysa eşitlik ister; biri null ise gevşek eşleşir — bulgunun tarifiyle birebir.

`allocation.helper.ts:211-239` (`distributeSacksToLines`): eşleşmeyen çuval içeriği için `result`'a hiçbir satır eklenmez — sessizce atlanır (yorum satırı zaten bunu söylüyor: "Bir çuvalın bir satıra hiç uymayan içeriği (spec/şube) tahsis edilmez").

`shipping.service.ts:1339-1354` (`writeShipmentAllocationsTx`): `computeSackAllocations` çağrılır, `allocations.length > 0` dalında `createMany`; `else` dalı YOK → 0 satırlık tahsis sessiz "başarı" olarak döner, hata fırlatılmaz.

`shipping.service.ts:1504-1507`: tek uyarı yalnız `createShipment` **önizlemesinde** basılıyor ("Seçili siparişlere yazılamayan ~N m mal var … yine de sevk edilecek") — bilgi satırı, onay/blok DEĞİL; kullanıcı bu diyaloğu atlarsa hiç görmez.

`shipping.service.ts:1873-1882` (`performDispatchTx`, kod adı farklı — asıl fonksiyon `dispatchShipment` içinde bu blok): sevk anında **yeniden tahsis hesaplanmıyor**; yalnız mevcut `SackAllocation` defterinden `recomputeOrderStatusForOrders` çağrılıyor. Yani `createShipment` anında spec eşleşmediği için 0 tahsis yazılmışsa, dispatch bunu asla telafi etmiyor — `shippedQty` sonsuza dek 0 kalıyor.

Zincir uçtan uca doğrulandı: `createShipment` → `writeShipmentAllocationsTx` (spec eşleşmezse 0 satır) → çuval fiziksel olarak dolduruluyor/sevk ediliyor → `dispatchShipment`/`performDispatchTx` yeniden tahsis YAPMIYOR → `recomputeOrderStatusForOrders` boş deftere bakıp `shippedQty=0` yazıyor. Bu, kodun kendi yorumlarında da **bilinçli** bir tasarım kararı olarak belgeleniyor ("Fazla/eşleşmeyen/siparişsiz sevk edilebilir", `shipping.service.ts:1354` civarı) — yani DAVRANIŞ tasarım gereği budur, ama sonucu (sipariş defterinde iz bırakmadan mal çıkması) gerçek bir iş riski taşıyor; kaynak bulgudaki S1 değerlendirmesiyle örtüşüyor.

## 2) K2 — veride fiili ihlal: **DENENDİ, TETİKLENEMEDİ (ortam engeli)**

`audit/data/BULGU-T2-001.sql` yazıldı (Q1: DISPATCHED toplam içerik/tahsis farkı, Q2: sevkiyat bazında fark, Q3: sıfır-tahsisli DISPATCHED sevkiyatlar, Q4: `SIP1008260003` kalemi + `SVK1708260002` içeriği, Q6: kaynak bulgudaki üç kalem id-önekiyle arama).

Koşum denemesi:
```
audit/tools/sql-saha.sh -f audit/data/BULGU-T2-001.sql
```
Sonuç — **bağlantı hatası, sorgudan bağımsız, ortam kaynaklı:**
```
psql: error: connection to server at "localhost" (::1), port 5432 failed:
FATAL:  Postgres.app failed to verify "trust" authentication
DETAIL:  Postgres.app failed to show a dialog. This can happen when the user
that started the server is no longer logged in. Try restarting the PostgreSQL
server.
```
Doğrulama adımları:
- `pg_isready -h localhost -p 5432` → `accepting connections` (sunucu ayakta).
- `psql postgresql://localhost:5432/postgres` (sql-dev/sql-saha'nın da kullandığı aynı yol) → **aynı hata**, 4 kez tekrarlandı (sleep aralıklarıyla), aynı sonuç.
- Unix socket üzerinden bağlantı da (`/tmp/.s.PGSQL.5432`) aynı hatayı veriyor.
- `pg_hba.conf` (`/Users/oad/Library/Application Support/Postgres/var-18/pg_hba.conf`) `trust` diyor ama sunucu `shared_preload_libraries=auth_permission_dialog` ile başlatılmış — bu eklenti "trust" onayını bir GUI diyaloğuyla istiyor ve mevcut oturumda (headless/agent oturumu) bu diyalog gösterilemiyor → **her bağlantı reddediliyor**, sorgunun içeriğiyle ilgisi yok.

Bu, `sql-dev.sh` ve `sql-saha.sh`'nin ikisini de eşit şekilde etkileyen **makine/oturum düzeyinde bir altyapı engelidir** — kural gereği DB'ye başka yoldan bağlanmadım (kural 2), config/pg_hba dosyasına dokunmadım (salt-okunur + kapsam dışı). Bu doğrulama turunda K2 sayısal kanıt **üretilemedi**.

## 3) K3 — repro scripti

Eşzamanlılık/yarış sınıfı bir bulgu değil (kategori E, iş kuralı — tasarım gereği tek istekte oluşan defter boşluğu); sözleşme gereği K3 yerine "tek istekle davranışsal kanıt" uygundu, ama bu da DB erişimi gerektiriyor (Prisma → aynı `adnansahin_db`/aynı Postgres.app sunucusu) → **aynı ortam engeliyle bloklandı**, script yazılmadı (DB'siz çalışamayacağı için anlamsız olurdu; boşuna dosya biriktirmemek adına yazılmadı).

## 4) Sonuç

Kod tarafı **tam ve net şekilde doğrulandı** (K1, hatta iddia edilen tüm 6 kod referansı satır satır teyit edildi — `36-49`, `102-114`, `1339-1359`, `1507`, `1873-1882` hepsi mekanizmayı bulgudaki gibi anlatıyor). Ancak bu doğrulama turunun hedefi olan **K2/K3'e çıkarma denemesi ortam (Postgres.app "trust" auth diyaloğu, headless oturumda gösterilemiyor) yüzünden yapılamadı** — sql-dev.sh ve sql-saha.sh ikisi de aynı anda ve aynı sebeple erişilemez durumda; bu bulguya özgü değil, oturumun genel DB erişimi kesik.

Kaynak bulgunun K2 iddiası (81 DISPATCHED sevkiyat, içerik 27.611,8 m / tahsis 20.459,2 m, 5 tahsissiz sevkiyat, 3 kalemde birebir eşleşme + shippedQty=0) bu turda **ne doğrulandı ne çürütüldü** — yeniden koşulamadı. Kod kanıtı, iddia edilen sayıların **üretilebilir olduğunu** (mekanizma gerçek ve sessiz) gösteriyor; sayısal teyit ortam düzelince tekrar denenmeli.

**Öneri:** Bir sonraki turda önce `psql "postgresql://localhost:5432/postgres" -c "select 1"` ile DB erişimini doğrula; hâlâ aynı hata alınıyorsa Postgres.app'ın GUI oturumu (kullanıcı arayüzü) yeniden başlatılmalı (bu, denetim ajanının yapabileceği bir şey değil — kullanıcı/host tarafı bir işlem).

## Kanıt seviyesi kararı

- **Kod (mekanizma):** tam doğrulandı — 6/6 satır referansı doğru ve iddia edilen davranışı üretiyor.
- **K2 (veri):** denendi, ortam engeliyle tetiklenemedi — nedeni belgelenmiş bağlantı hatasıdır (Postgres.app trust-auth GUI diyaloğu headless oturumda gösterilemiyor).
- **K3 / davranışsal kanıt:** aynı ortam engeli nedeniyle denenmedi (DB'siz anlamsız).
- **Sonuç:** kanıt seviyesi bu turda **K1'de kaldı** (kod ile tam teyitli, veriyle teyit edilemedi). Şiddet ve sınıflandırma kaynak bulgudan (S1, kategori E) DEĞİŞTİRİLMEDİ — yalnız K2 iddiası bu turda ne doğrulanabildi ne çürütülebildi.
