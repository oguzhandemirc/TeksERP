# Sevk Partisi — Tasarım (2026-09-21)

> Saha isteği (adnansahin): sevkiyat elemanı panelde cariyi seçer, carinin altında **sevk partisi** açar, partinin içinde **çuval açar**, çuvala top okutur; parti içindeki her çuval bir **ambalaj numarası** taşır; partinin bir alt kümesi sevk edilir, parti yaşamaya devam eder. Tablet bu fazda DIŞARIDA (kullanıcı kararı: yalnız Electron).
>
> Karar sahibi: kullanıcı (2026-09-21 oturumu, sekiz şıklı seçim). Uygulama kararları bu belgede; kural satırları `docs/kurallar/sevkiyat.md`, hikâye `docs/history/CLAUDE-NOT-ARSIVI.md`.

## 0. Sektör karşılaştırması (ölçüldü)

SAP S/4 (Handling Unit: paket stokta bağımsız yaşar, teslimata sonra bağlanır; VL10 sevke-hazır listesi ship-to'ya göre süzer, farklı alıcıya ayrı belge), SAP B1 (BP kartında açık teslimat/sipariş bağlantıları; belge siparişten kopyalanır), Datatex NOW (top → koli → palet 5 seviyeli envanter; paketleme koli no + etiket üretir), Odoo/BC (cari formunda "Teslimatlar" düğmesi; BC "sevkiyatları birleştir"). Ortak kalıp: **paketleme nesnesi belgeden bağımsızdır, cari kartı belgeye açılan penceredir, koli numarası paketlemede doğar ve geri verilmez.** Bizim çuval havuzu modeli (`docs/design/CUVAL-HAVUZU-TASARIM.md`) bu kalıpta; sevk partisi havuzun ÜSTÜNE gelen kaptır.

## 1. Kararlar (kullanıcı, 2026-09-21)

| # | Soru | Karar |
|---|---|---|
| K1 | Temel nesne | **`PackingGroup` evrilir** — yeni tablo YOK. Aynı gerçek nesne (bir carinin sevk bekleyen çuval kümesi); ikinci tablo kimlik/rol kuralını bozar (MV-01) ve beş havuz-çıkış yoluna ikinci üyelik bakımı ister. |
| K2 | Ad | **"Sevk Partisi"**; otomatik ad `P-n` cari başına (2026-09-22'ye kadar `SP-n`; eski partiler adını korur). Çıplak "Parti" YASAK (üretim partisi `Batch` ile çakışır). **Ad/numara tekilliği yalnız AÇIK partiler arasında** (2026-09-22): sevk edilmiş "SP-1"/"Cuma tırı" yeni bir partiye yeniden verilebilir, iki AÇIK parti aynı adı alamaz; kimlik `PackingGroup.id`dir, ad değil. Numara rejimi `packing.groupNumbering` (artan / bosluk-doldur) canlı partilere bakar — grup moduyla aynı. |
| K3 | Ambalaj no | Başlangıç (0/1) ve mod (otomatik · otomatik+ezilebilir · elle) **ayarlanabilir**; varsayılan 1 + ezilebilir. |
| K4 | Tablet | **Dokunulmaz.** Tablet grubu okuyup seçmeye devam eder; tablette açılan çuval seçili partide doğarsa numarayı SUNUCU verir. |
| K5 | Yaşam döngüsü | **Durum SEVKTEN TÜRER, elle kapatma YOK** (saha kararı 2026-09-22; ilk karar "elle kapat + otomatik bayrak" GEÇERSİZ): parti AÇIK doğar; son çuvalı sevk edilince "sevk edildi" (`CLOSED`) olur, listeden düşer, ona çuval açılamaz; storno/iptal çuvalı geri getirirse yeniden AÇIK. Sevk edilen çuvallar bu ekranda izlenmez — carinin sevkiyatları Sevkiyatlar ekranında (cari süzgeçli bağlantı). Hiç çuvalı olmamış parti silinir. |
| K6 | Partisiz çuval | **Bayrak** `packing.lotRequired` (açıkken partisiz çuval açma 400). Yazılır, varsayılan KAPALI — açıksa tablet çuval açamaz (tablet bu fazda dışarıda; bu bayrak "çıkışsız kapı" sınıfındadır, ayar satırı uyarır). |
| K7 | Belge | İrsaliye/çeki listesinde **parti adı + ambalaj no** kolonları, **bayrakla** (`shipping.docPackingLot`, varsayılan kapalı = bugünkü belge). |
| K8 | Kısmi sevk · numara geri verme | İkisi de bayrak: `packing.lotPartialDispatch` (varsayılan AÇIK), `packing.packageNumbering` `artan` (varsayılan; numara asla geri verilmez) · `bosluk-doldur` (partiden çıkarılan çuvalın numarası yeniden verilir; sevk edilmişinki hiçbir modda verilmez — DB unique). |

## 2. Model — yalnız EKLEYEN şema

```
enum PackingGroupStatus { OPEN CLOSED }

PackingGroup
  + status        PackingGroupStatus @default(OPEN)
  + closedAt      DateTime? @db.Timestamptz   // "EN SON ne zaman kapandı" — yeniden açılınca NULL'LANMAZ
  + closedById    String?   @db.Uuid
  + nextPackageNo Int       @default(1)        // sayaç; parti mod=artan'da tek yazar UPDATE … RETURNING

Sack
  + packageNo     Int?                          // parti-içi ambalaj no; partisiz/havuz çuvalda NULL
  @@unique([packingGroupId, packageNo])           // NULL'lar çakışmaz; TAM unique (partial DEĞİL)
```

- **Grup modu (bugün, bayrak kapalı):** kolonlar boş durur, davranış bayt bayt aynı — canlılık türetilir (`LIVE_GROUP_WHERE`), numara yeniden kullanılır, boşalan grup görünmez olur.
- **Sevk partisi modu:** canlılık `status = OPEN`; boş parti YAŞAR; `status` elle yazılmaz — sevk tx'i (`autoCloseLotsForSacksTx`) son açık çuval gidince `CLOSED` ("sevk edildi") yazar, storno/iptal (`reopenLotsForSacksTx`) `OPEN`a döndürür; parti sırası (`seq`) yalnız AÇIK partilere bakar → sevk edilmiş partinin numarası/adı yeniden verilebilir; çuval `packageNo` taşır.
- "Canlı grup" tek helper'dan çıkar: `liveGroupWhere(mode)` — grup modunda türetilmiş where, parti modunda `{status: OPEN}`. Üç tüketici (list · sayaç · ad tekilliği) bu helper'dan geçer; elle kopya yasak (AST bekçisi).
- Sevk edilmiş çuval partide ÜYE KALIR (bugünkü kural: sevkte `packingGroupId` temizlenmez) ama EKRANDA GÖSTERİLMEZ (liste kapsamı POOL+PLANNED; parti satırı yalnız açık sayıyı basar); `packageNo` donar — claim'ler `shipmentId IS NULL` ister. Storno çuvalı aynı numarayla aynı partiye döndürür; "sevk edildi" parti OTOMATİK yeniden açılır.
- Tekillik parti içinde DB'de TAM unique (sevk edilmiş çuval partide numarasıyla kaldığı için onun numarası hiçbir modda yeniden doğamaz — "giden numaraları alır" tercihi zaten mevcut sevkiyat-içi `seq` + belge bayrağı kapalı ile karşılanır). `artan`: sayaç monoton, çıkarılan/transfer edilen çuvalın numarası da geri verilmez. `bosluk-doldur`: partiden ÇIKARILAN/transfer edilen çuvalın boşalttığı en küçük numara yeniden verilir (8033 kilidi altında).

## 3. Ayarlar (sistem ayarı, `packing.*` ailesi; reçete `docs/RECETELER.md` § yeni bayrak)

| Anahtar | Tip | Varsayılan (= bugün) | Anlam |
|---|---|---|---|
| `packing.groupMode` | `grup` · `sevk-partisi` | `grup` | Grup davranışı ↔ sevk partisi davranışı. `packing.groupsEnabled` kapalıyken anlamsız (§3.6 çözücü). |
| `packing.packageNoStartsAtZero` | bool | false | Açıkken ilk çuval 0 (kapalı = 1). |
| `packing.packageNoMode` | `otomatik` · `otomatik-ezilebilir` · `elle` | `otomatik-ezilebilir` | Numara sayaçtan mı, ezilebilir mi, tamamen elle mi. |
| `packing.packageNumbering` | `artan` · `bosluk-doldur` | `artan` | Boşalan/sevk edilen numara geri verilir mi. |
| `packing.lotRequired` | bool | false | Partisiz çuval açma 400 `PACKING_LOT_REQUIRED`. |
| `packing.lotPartialDispatch` | bool | true | Kapalıysa sevk, partinin açık çuvallarının TAMAMINI ister (400 `PACKING_LOT_WHOLE`). |
| `shipping.docPackingLot` | bool | false | İrsaliye/çeki listesine parti adı + ambalaj no kolonu (opt-in kolon kuralı). |

Aşağıdaki beş ayar yalnız `groupMode = sevk-partisi`yken okunur; grup modunda bayt bayt bugünkü davranış (negatif sondayla ölçülür). `packing.lotAutoClose` 2026-09-22'de KALDIRILDI (durum ayar değil, sevkten türer).

## 4. API (hepsi `groupMode = sevk-partisi` kapısında; grup modunda 400/bugünkü davranış)

| Uç | Değişiklik |
|---|---|
| `POST /packing-groups` | `sackIds` parti modunda BOŞ olabilir (boş parti); grup modunda `min(1)` kalır. |
| `POST /shipping/sacks` (`openSack`) | `packingGroupId?` + `packageNo?` (ezme/elle) alanları; parti açık değilse 409 `PACKING_LOT_CLOSED`; `lotRequired` açıkken `packingGroupId` yoksa 400. Numara atama tx içinde: `artan` → `UPDATE packing_groups SET "nextPackageNo" = "nextPackageNo"+1 … RETURNING`; `bosluk-doldur` → 8033 kilidi altında en küçük boş. |
| `POST /packing-groups/:id/sacks` (`addSacks`) | = **havuzdan al / partiler arası transfer** (üyelik zaten tek, claim `shipmentId IS NULL ∧ customerId`); hedefte YENİ numara, kaynakta boşluk. |
| `PATCH /sacks/:id/package-no` | Ezme (mod `otomatik-ezilebilir` · `elle`); çakışma 409 `PACKAGE_NO_TAKEN` (Türkçe: "12 numarası bu partide ÇUVAL CV… üstünde"). |
| `GET /packing-groups/summary?customerId` | Cari çalışma alanı özeti: partisiz havuz (çuval/top/m/kg) + açık/sevk edilmiş parti sayısı — parti listesi ekranının kartları. |
| `DELETE /packing-groups/:id` | Hard delete sınıfı ④ (taslak): `deleteMany WHERE {id} AND NOT EXISTS sacks` — çuvalı olan/olmuş parti silinmez, kapanır. |
| `GET /packing-groups?customerId&status=OPEN|CLOSED|ALL` | Parti modunda özet: açık çuval · sevk edilen · toplam m/kg (tek where'den). |
| `createShipment` / `addSacksToShipment` | `lotPartialDispatch=false` → sackIds ≠ partinin açık kümesi ise 400; son açık çuval gidince aynı tx'te `CLOSED` ("sevk edildi") — ayar yok, durum sevkten türer. |
| `cancelPlannedShipmentTx` / storno | Çuval partiye dönerken parti CLOSED ise aynı tx'te OPEN. |

Kilit: **8033** `PACKAGE_NO_LOCK_NS` (`hashtext(packingGroupId)`) — yalnız ezme/elle/bosluk-doldur yollarında, tx'in İLK ifadesi; `artan` sayaç tek satır `UPDATE … RETURNING` olduğu için kilitsiz. Envanter: `period-guard.helper.ts` başlığı + `docs/standart/ESZAMANLILIK.md` + `test_advisory_lock_namespaces`.

Yetki: yeni kod `shipping:packing-lot` (parti sil · ambalaj no ez); parti açma/adlandırma/transfer ve çuval işlemleri mevcut `shipping:write`. Katalog koda, atama panele.

## 5. Belge ve etiket

- `collectShipmentDocContent.sackRows` → `packageNo`, `packingGroupName` eklenir; `shipment-dispatch.html.ts` yalnız `shipping.docPackingLot` açıkken kolon çizer. Electron önizleme (`shipment-note-parts.tsx`) aynı bayrağı okur.
- SACK etiketi: `SACK_FIELDS` + `packageNo`, `packingGroupName` (opt-in alan; barkod `sackNo` KALIR). `packageNo` değişince `labelDirty` — yalnız etkin şablon alanı basıyorsa (`sackNote` kalıbı).

## 6. Electron (yalnız panel)

`Operations/SackContentEdit` içinde, `groupMode = sevk-partisi` iken:

1. **Cari seç** (mevcut `SackEntryGate`) → **Parti listesi** (satırlar, çip değil — 2026-09-22): üstte dört özet kartı (açık parti · havuz çuval/top · havuz m · havuz kg), sabit "Partisiz çuvallar (havuz)" satırı (boşken soluk, kaybolmaz), parti satırları (ad · "N çuval" · m · kg · AÇIK/SEVK EDİLDİ · tarih · not · ⋮ adlandır/sil); durum segmenti Açık · Sevk edilmiş · Tümü, ad/not araması, sıralanabilir başlıklar (ad sayı-duyarlı); "Sevk Partisi Oluştur" ve carinin sevkiyatlarına bağlantı ("Sevkiyatlar").
2. **Parti içi** → çuval listesi (ambalaj no · çuval no · top · m · kg · durum: açık/sevk edildi + sevkiyat no); "Çuval Aç" (moda göre numara alanı: salt-okunur / ezilebilir / zorunlu) · "Yeni Çuvala Geç" (açık çuvalı bırakır, yenisini açar ve içine girer) · "Havuzdan Al" · "Transfer" (aynı carinin başka partisine) · seçili çuvallar → "Sevk Et" (mevcut `CreateShipmentDialog`, `lotPartialDispatch` kapalıysa tümü seçili ve kilitli).
3. **Çuval içi** → mevcut `SackEditorView` (top okutma, tartı, not) değişmez; başlığa parti adı + ambalaj no.
4. Grup modunda ekran bayt bayt bugünkü (`PackingGroupBar` çipleri).
5. Ayarlar → Sevkiyat & İade bölümüne sekiz satır; `lotRequired` satırı "tablet çuval açamaz" uyarısı taşır.

"Simple is more": parti ve çuval için ayrı DURUM düğmesi yok (çuval sevk edilene kadar açık; K6 senaryosu), sihirbaz yok, üç seviye = üç liste.

## 7. Eski istemci / geriye dönüklük

- Tablet `packingGroupId` okur, ad gösterir, seçer: parti modunda partiler "grup" olarak görünür; tablette `openSack` gövdesi `packingGroupId` taşımaz → çuval partisiz doğar (grup modundaki davranış) — `lotRequired` açıkken 400 alır (K6, bilinçli).
- Panel eski sürüm: yeni alanları göndermez → bugünkü uçlar bugünkü cevabı verir; `minVersion` YOK (sözleşme kırılmıyor).
- Grup modundan parti moduna geçiş: mevcut canlı gruplar OPEN sayılır (default), boşalmış gruplar (canlı değil) tek seferlik script ile CLOSED'a çekilir (`--apply` kullanıcının); çuvallara numara **verilmez** (NULL), operatör "Yeniden numarala" der — sessiz backfill yok.

## 8. Bekçiler

- `test_packing_group.ts` §17+: boş parti · sayaç monoton ve eşzamanlı (iki tx aynı anda) · ezme çakışması 409 · `bosluk-doldur` en küçük boş · kısmi sevk bayrağı · otomatik kapanış + storno yeniden açma · transfer yeni numara + kaynak boşluk · kapalı partiye çuval 409 · yalnız boş parti silinir · sevk edilmiş çuvalın parti/numarası değişmez · **grup modunda bayt bayt eski** (negatif sonda: parti kolonları NULL, canlılık türetilmiş).
- `liveGroupWhere` tek kaynak — AST bekçisi (elle `sacks: { some: { shipmentId: null } }` kopyası kırmızı).
- `test_feature_flag_contract` (sekiz ayar) · `test_advisory_lock_namespaces` (8033) · `test_migration_enum_add_value` (`PackingGroupStatus`) · `test_permission_catalog` (`shipping:packing-lot`) · Electron `packingGroupUi.test.ts` §10+ (parti modu ekran kapıları).

## 9. Dilimler (sıra)

| Dilim | İçerik | Kapı |
|---|---|---|
| D1 | Şema (enum + 4 kolon + partial unique) · sekiz ayar (reçete 18 adım) · izin kodu · 8033 envanteri · kural satırları | migration hijyeni · flag contract · lock namespaces · permission catalog |
| D2 | Parti yaşam döngüsü: `liveGroupWhere`, boş parti, close/reopen/delete, list+özet | `test_packing_group` §17–§21 |
| D3 | Ambalaj no: `openSack` partide, sayaç, ezme/elle, numaralama modu, transfer | §22–§27 |
| D4 | Sevk bağı: kısmi sevk bayrağı, otomatik kapanış, storno yeniden açma, donmuş numara | §28–§31 |
| D5 | Belge + etiket kolonları (bayraklı) + önizleme | `test_dispatch_report_gross` yeşil kalır · etiket bekçileri |
| D6 | Electron: ayar satırları · parti listesi · parti içi · çuval aç/geç/transfer/sevk | `packingGroupUi.test.ts` §10+ · tsc · lint |
| D7 | Belge katmanı: `sevkiyat.md` kural satırları, arşiv notu, sürüm notu maddeleri, geçiş script'i | `check-docs` |
