# Sevkiyat turu — 2026-09-06

Kullanıcının bildirdiği iş gerçeğiyle başladı: *"fabrika düzensiz çalışıyor; elemanlar
sipariş OLSA BİLE siparişi işaretlemeden sevk ediyor."* Bu cümle §1d'yi (42 sevkiyat /
11.384,7 m deftere girmeyen metraj) bir **kod hatası** olmaktan çıkarıp bir **iş akışı
gerçeği** yaptı — çözüm "kapıyı sıkılaştır" değil, "rejimi bayrakla seç".

Beş ajanlı salt-okunur keşif: bu dizindeki JSON dosyaları.

---

## 1 · Keşif üç varsayımı çürüttü

| Varsayım | Ölçüm |
|---|---|
| "Kademeli rejim yok, eklemeliyiz" | **Vardı** (`shipping.orderRequirement` off/warn/block, 2026-09-03) — ama yanlış yarımı ölçüyor |
| "`block` açılsa sorun çözülür" | 89 sevkiyatın **88'inde sipariş zaten seçili** → `block` 42 boşluğun **hiçbirini** durdurmazdı |
| "Müşteri renk sütunu yapılmamış" | **Yapılmış**, dört katmanda da var. Sorun kod değil **veri**: 62 kumaş karşılığına karşı **8 renk karşılığı** |

Ve bir sert ölçüm: *"siparişe yazılmayan X m"* uyarısı **2026-07-30'dan beri ekranda**;
42 boşluğun tamamı o tarihten **sonra** oluştu. **Uyarı tek başına davranışı değiştirmemiş.**

---

## 2 · Yapılanlar

| # | İş | Commit |
|---|---|---|
| 1 | **Çuval filtre hatası** — "tüm cariler"den cari seçince tüm müşteriler listeleniyordu | `dccf83db` |
| 2 | **Dev DB süpürgesi** — envanterden desene + ortam kapısı | `29f19d0c` |
| 3 | **Çeki listesine ayrı ad rejimi** (`shipping.docCekiNameMode`) | `077e9a5d` |
| 4 | **Kapsama ekseni** + **ekran↔kâğıt ad hizası** + **toplu çuval dağıtma** | `8affd3e9` |
| 5 | **Ürün listesinde müşteri rengi ayrı sütun** (`shipping.docProductColorSplit`) | `15886fed` |

### Kök nedenler — hiçbiri tahmin edilen yerde değildi

- **Çuval filtresi:** sunucu temizdi. `useDataTable`'ın arama debounce'u mount anındaki
  **filtresiz** URL kopyasını 300 ms sonra geri yazıp `filter[customerId]`i siliyordu.
  Kapıdan cari seçmek filtreyi yazıp *aynı tıkta* listeyi mount ettiği için tam o akışta ısırıyordu.
  ⚠️ `setSearchParams`ın fonksiyonel biçimi bunu **çözmez** — setter `prev`i kendi kapanışından verir.
- **Ekran↔kâğıt:** iki projeksiyon yalnız `OrderLine` override'ını taşıyordu; belge master
  alias kademesini de çözüyordu. **424 topta (%24)** irsaliyede müşteri adı basılıyor,
  elemanın ekranında görünmüyordu. Tablet aynı ucu kullandığı için düzeltmeyi bedavaya
  aldı — **APK gerekmedi**.
- **Süpürge:** 14 önekli "tek kaynak" listesi 313 artığın **sıfırını** eşliyordu; kodda
  406 farklı önek vardı. Betiğin **ortam kapısı da yoktu** ve `test_script_guards` bunu
  göremiyordu (yalnız ham SQL izlerine bakıyor, Prisma `deleteMany` görmüyor).

### Bayrak tasarımı — üçü de varsayılanı BUGÜNKÜ davranış

| Bayrak | Değerler | Varsayılan |
|---|---|---|
| `shipping.orderCoverage` | off · warn · block | **off** |
| `shipping.docCekiNameMode` | devral · bizdeki · musterideki · ikisi | **devral** |
| `shipping.docProductColorSplit` | açık/kapalı | **kapalı** |

**Kapsama neden ayrı bayrak:** `orderRequirement` *niyeti* (sipariş seçildi mi),
`orderCoverage` *sonucu* (mal deftere yazıldı mı) ölçer. İki soru **dik**; tek merdivene
indirmek "bağ sıkılığı arttıkça kapsama da sıkılaşır" diye yanlış bir sözleşme kurar ve
bugün meşru olan "sipariş seçilsin ama fazla mal serbest kalsın" düzenini ifade edilemez kılar.

⚠️ Kapsama kapısı **yalnız kurulumda**; `dispatchShipment`e konmadı — sevk anında `throw`
malı bina içinde kilitler (kamyon kapıda). Aynı gerekçe `orderRequirement` için de yazılı.

---

## 3 · Doğrulama — dürüst tablo

Tam paket **452/459**. Yedi kırmızının **yedisi de** `docs/standart/TEST-VE-DERLEME.md` §7'de
belgelenmiş **ortam-bağımlı bekçi** listesinde ve **hiçbiri bu turun değişikliklerinden
kaynaklanmıyor** — ölçüldü: değişiklikler `git stash`liyken de kırmızı veriyorlar.

Dokunulan bekçiler: `test_shipment_doc_customer_name` 55/55 (35'ten) ·
`test_shipping_flags` 60/60 (53'ten) · `test_sack_bulk_distribute` 16/16 (yeni) ·
`test_feature_flag_contract` 78/78 · `test_printed_documents` 30/30 ·
Electron 214 dosya / 2.293 test · üç projede tip temiz, üç lint tavanı temiz.

**Negatif sonda sayısı: 13.** Hepsi ısırdığı ölçülerek yazıldı.

---

## 4 · Ölçüm iki kez kendi yüklemimi çürüttü

1. `useDataTable` için yazdığım **ikinci koruma** ("mount'ta hiç yazma") sondada **ısırmadı**
   — taze ref tek başına iki vakayı da kapatıyormuş. Ölçülmemiş davranış değişikliği
   bırakmamak için çıkardım, gerekçesini bekçinin başlığına yazdım.
2. Sonda ölçümünde `grep "^❌"` kullandım; bekçinin kırmızı satırları **girintili** olduğu
   için üç sonda da "ısırmıyor" göründü. **Yüklem yanlıştı, bekçi değil.**

---

## 5 · Açık kalanlar

- **§1d'nin kendisi onarılmadı.** 42 sevkiyat / 11.384,7 m hâlâ defterde yok. Onarım ucu
  (`POST /shipments/:id/orders`) motor olarak **var** ama hiçbir istemcide çağıranı **yok**
  ve sahada 0 kez koşmuş; bugün ~7.305 m (29 sevkiyat) geri yazılabilir durumda.
  ⚠️ Hangi kaleme yazılacağı **iş kararıdır**, toplu UPDATE ile yapılmaz.
- **Aday sipariş önerisi (b)** yazılmadı. Ölçüldü ve değerli: 88 sevkiyatın **45'inde tek
  aday**, 44'ünde o tek aday operatörün gerçekten seçtiği sipariş. Motor (`specMatch`) ve uç
  (`GET /open-orders`) zaten var, sorgu 0,3 ms. Ama boşluğun **tavanı %51** — kalanı fazla
  mal ve spec uyuşmazlığı.
- **Renk karşılıkları boş.** 28 aktif müşterinin 22'sinde hiç renk adı yok. Yeni bayrak
  görünümü düzeltir, **boşluğu doldurmaz**.
- **Süpürge `--apply` koşulmadı** — artığı silmek ortam-bağımlı bekçilerin rengini
  değiştirebilir; ayrı ve bilinçli adım.
- **44 betiğin 42'sinde ortam kapısı yok** — lint tavanı deseniyle dondurulmalı.
