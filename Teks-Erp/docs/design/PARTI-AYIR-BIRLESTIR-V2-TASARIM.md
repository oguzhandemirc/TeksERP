# Parti Ayır/Birleştir v2 — Serbest Split/Merge Tasarımı

> Durum: TAMAMLANDI — Faz 0-5 UYGULANDI (2026-07-16): K14 çift-koşul kilit,
> K15 merge belge birleştirme, K16 split/move sevk cerrahisi, K17 mergedIntoId
> soy bağı, K18 labelDirty (K11/K5/manual-move dahil) + Electron UI (kilitli
> parti seçimi, kimlik-anahtarlı somut onay dökümü, "→ P… altına birleşti"
> rozeti, BatchCorrectModal sevk-cerrahisi notu). Doğrulama: backend 18 script +
> tsc (387 assertion) ve Electron typecheck + eslint + vitest 316/316 yeşil;
> 3 tur adversarial inceleme (tüm MAJOR'lar kapalı). Kalan: sahada manuel UI
> doğrulaması (kilitli merge onayı, merged-lane rozeti, farklı-firma 409 toast'u)
> + BranchLanes.tsx dosya-boyutu refaktörü (971 satır — ayrı iş) + commit.
> Önceki tasarım: `PARTI-MODELI-TASARIM.md` (K1-K13) — bu doküman K8/K10 kilit
> kurallarını sektör standardına göre revize eder; parti modelinin geri kalanına
> dokunmaz.

## 1. Problem

Bugün K8 araçlarının üçü de (taşı / birleştir / ayır) yalnız **sevksiz** partide
çalışır; kilit tanımı `iptal edilmemiş sevk VAR` olduğundan **sevk görmüş parti
sonsuza dek kilitlidir** — mal fasondan dönse bile. Saha ihtiyacı ise net:

- "4 parti aynı fasonda duruyor, birleştiremiyorum" (IE1507260026 vakası).
- "P1507260095'te 2 top var, birini ayrı partiye ayıramıyorum" (fasonda → kilit).

## 2. Sektör araştırması — damıtılmış bulgular

| Sistem | Split/Merge modeli | Açık belge/fason kısıtı |
|---|---|---|
| SAP | Birinci sınıf işlem YOK — hareket-bazlı (mvt 309 yeniden-etiketleme); soy bağı MB56 ile TÜRETİLİR | Fasondaki mal "special stock O": idari düzeltme serbest, **yapısal işlem dönüşe ertelenir** |
| Oracle Cloud/OSFM | Split/Merge/Translate **birinci sınıf olay** + otomatik genealogy; merge'de "temsilci lot" | Yalnız **available** (rezerve olmayan) miktar; açık requisition → BLOKE; rezervasyonlar deterministik kuralla taşınır/silinir |
| Dynamics 365 | Transfer journal (hareket-bazlı) + Traceability add-in (üstte soy grafı) | — |
| Infor M3 | Tank blend: iki lot ölür, YENİ lot doğar; kalıtım kodifiye (statü=en kötüsü, tarih=en erken) | **Çekme listesindeki lot blend'e giremez** |
| Tekstil (MES/patent/SG) | Split/merge **taranıp imzalanan açık olay**; split'te bir parça orijinal numarayı korur; genealogy parent-child zinciri | Fasonda "dondurulmuş parti + belge zinciri": yapısal işlem dönüş kabulüne ertelenir |

**Sonuçlar:**
1. Bizim "sevkli parti kilitli" kuralımız sektör normu — ama sektörde kilit
   **açık taahhüt sürerken** geçerlidir; bizde **kalıcı**. Asıl hata bu.
2. Split/merge sektörde **açık, gerekçeli, soy bağı bırakan olaydır**; kaynak
   kayıtlar silinmez, "birleşti/bölündü" izi kalır.
3. Merge'de kimlik: temsilci/en eski numara yaşar (bizim kuralımız doğru).
4. Fasondayken (mal fiziken dışarıda) yapısal işlem: SAP/tekstil ertelemeyi,
   Oracle OSFM **kural tabanlı belge yeniden-hedeflemeyi** seçer. Kullanıcı
   ihtiyacı (aynı fasondaki partileri birleştirmek) OSFM yolunu gerektirir.

## 3. Karar — üç katmanlı serbestleşme

### K14 — Kilit daraltılır: "sevk görmüş" değil, "mal fiilen dışarıda" ✅ UYGULANDI

```
locked(batch) = batch'te AT_SUBCONTRACTOR statülü top VAR
             VEYA batch'e bağlı, iptal edilmemiş + fasondan-sevk-edilmemiş
                  ve OUTSTANDING (dönmemiş kalemi olan) sevk VAR
```

- ÇİFT koşul bilinçli (adversarial bulgu F1): AT_SUB top detach edilirse
  roll-koşulu söner ama açık sevk outstanding kalır ("zombi") — yalnız-roll
  kilidi aynı (parti, adım)'da ikinci açık sevke kapı açardı. İki koşuldan biri
  yaşadıkça kilit sürer; mal tamamen dönünce ikisi de söner → kendiliğinden açılır.
- Mal tamamen döndüyse (RETURNED) parti düzenlenebilir — split/merge/move
  serbest (sevk kayıtları tarihçe olarak partide kalır).
- `isBatchLockedTx` (batch.service.ts) + `getBatches` lane `locked` türetimi
  (workorder.service.ts) aynı çift kuralda; regresyon: `test_k14_lock_edges.ts`.
- DIRECT_SHIPPED sevkler kilit saymaz (mal zaten çıktı, dönmeyecek).
- Faz 1-2 arası köprü guard'ı (adversarial bulgu F2): `cancelReceipt` artık
  canlanacak topların batchId'si = sevkin batchId'si değilse 409 — K14'ün açtığı
  merge/move sonrası kabul iptali parti/sevk tutarlılığını bozamaz (K15 belge
  cerrahisi gelince merge zaten sevki de taşıyacağından bu yol doğal çalışır).
- Harmonizasyon borcu: workorder-manual-move.service.ts'teki inline kilit
  kopyaları (≈:261, :407-412) eski katı kuralda — o dosyada başka oturum
  çalıştığından bilinçli dokunulmadı; oturum kapanınca `isBatchLockedTx`'e bağla.

### K15 — Fasondayken merge: belge de birleşir (OSFM kuralı)

Fasonda topları olan partiler birleştirilebilir; birleştirme **sevk kayıtlarını
da taşır ve aynı (adım, firma) çiftindeki açık sevkleri tek kayıtta birleştirir**:

1. Guard: seçilen partilerin açık sevkleri **aynı adımda farklı firmalara** ise
   409 + çakışma listesi (F74 belirsizliği — firma çözümü bozulur). Farklı
   adımlardaki sevkler serbest (çözüm zaten stepId-scope'lu).
2. Kaynak partilerin TÜM sevkleri (tarihçe dahil) `dispatch.batchId = survivor`
   olarak yeniden hedeflenir.
3. Aynı (adım, firma)'daki birden çok **açık** sevk tek kayıtta toplanır: en eski
   dispatch yaşar, diğerlerinin kalemleri ona taşınır, boşalanlar
   `cancelReason: "K15_MERGE: <survivorNo>"` ile kapanır → **"bir (parti, adım)
   çifti için en fazla bir açık sevk"** değişmezi korunur (firmByBatch /
   buildPendingParties / undoTransfer bire-bir varsayımları bozulmaz).
4. Basılı irsaliyeler fiziken fasoncuda — birleşik sevke not düşülür; belge
   yeniden basılabilir.

### K16 — Fasondayken split: sevk kalemi de bölünür

1. Taşınan topların açık sevk kalemleri, **aynı firma+adım+tarih meta'sıyla yeni
   partiye bağlı yeni sevk kaydına** taşınır (`splitFromDispatchId` notu).
   Sevkin TÜM kalemleri taşınıyorsa kayıt olduğu gibi yeniden hedeflenir (yeni
   belge doğmaz).
2. Dönmüş/kısmi sevklerde yalnız outstanding kalemler taşınabilir.
3. Mevcut kural sürer: partinin tüm topları elle bölmede seçilemez.

### K17 — Soy bağı: kaynaklar silinmez, `mergedIntoId` ile yaşar

- `Batch.mergedIntoId String?` (self-FK, `splitFromId` simetriği) + index.
- Merge'de boşalan kaynak partiler **silinmez**; `mergedIntoId = survivor` ile
  tarihçe satırı olarak kalır (sektör: "kaynak lot sıfırlanır ama kaydı yaşar").
  `deleteIfEmptyAndTraceless` yalnız hiç iz görmemiş (sevksiz + soy bağsız +
  merge görmemiş) partileri silmeye devam eder.
- Lane görünümü: birleşmiş kaynak partiler "boş parti" toggle'ının altında
  "→ P… altına birleşti" rozetiyle listelenir; timeline sorgusu değişmez
  (toplar zaten survivor'da).

### K18 — Etiket senkronu

Üyelik değiştiren her işlem (move/merge/split) etkilenen topların
`labelDirty = true` bayrağını atar — fiziksel etiketteki Parti No ile DB
ayrışması "yeniden bas" uyarısına düşer. (Bugün HİÇBİR K8 aracı bunu yapmıyor.)

## 4. Korunan değişmezler (envanterden)

- K10 sürer: bir sevk = bir parti (`dispatch.batchId` tek FK) — K15/K16 belge
  cerrahisi tam da bunu korumak için var.
- Bire-bir açık sevk / (parti, adım) — K15 madde 3 ile garanti.
- `AT_SUBCONTRACTOR` topun batchId'si = o adımda açık sevki olan parti — merge'de
  toplar VE sevk birlikte survivor'a taşındığı için eşitlik bozulmaz; undoTransfer
  guard'ları (`r.batchId === dispatch.batchId`) geçmeye devam eder.
- Born roll kalıtımı `dispatch.batchId`'den — retarget sonrası doğru partiye doğar.
- En eski numara yaşar (K8 + K11 iki kod yolu senkron kalır).
- Aynı WO kısıtı, atomik claim + audit disiplini, kart-parti bağımsızlığı aynen.

## 5. Ön-temizlik — tasarımdan bağımsız, ÖNCE düzeltilecek canlı sorunlar

Envanter denetiminin bulduğu, bugün bile duran üç mayın:

1. **CANLI 500:** `inventory.service.ts:1016, :1060` — `workOrder: { select: { batchNumber: true } }`
   alanı WorkOrder'da artık yok (parti-redesign rename kaçağı); `getProductionFlow`
   kuyruk kolonları her çağrıda Prisma validation hatası fırlatıyor (typecheck,
   Promise.all excess-property bastırması yüzünden yakalamıyor).
2. **Ölü kod:** `tambur.service.ts:285-303 buildBranchInfoMap` — batchId'yi
   dispatch.id ile karşılaştırıyor (eski batchSplitId kalıntısı); dispatchNo /
   branchOrdinal zenginleştirmesi hiç çalışmıyor.
3. **Yorum-kod uyumsuzluğu + sızıntı riski:** sevk iptali (`subcontractor.service.ts:1597-1616`)
   yorumu "batchId temizlenir" diyor, kod temizlemiyor; iptal sonrası STOCK top
   eski batchId'siyle başka WO'nun sevk auto-attach'ine girerse cross-WO parti
   sızıntısı mümkün (`dispatch()` bu dalda `assertBatchInWorkOrder` çağırmıyor).

## 6. Uygulama planı (fazlı)

| Faz | İçerik | Dokunulan |
|---|---|---|
| 0 | Ön-temizlik (§5'in üçü) + regresyon scriptleri | inventory / tambur / subcontractor service |
| 1 | Şema: `Batch.mergedIntoId` + migration; kilit tanımı K14 (backend + lane) | schema, batch.service, workorder.service |
| 2 | K15 merge (belge birleştirme + guard + audit) — `mergeBatches` genişler | batch.service (+dispatch cerrahisi), test script |
| 3 | K16 split/move (sevk kalemi bölme) — `splitBatch`/`moveRolls` genişler | batch.service, test script |
| 4 | K18 labelDirty + Electron UI: kilitli partide checkbox/menü açılır, onay
      diyaloğu taşınacak sevkleri somut listeler ("yıkıcı işlemde detaylı onay"),
      birleşmiş parti rozeti | BranchLanes, BatchCorrectModal |
| 5 | Mobil doğrulama (FasonKabul gruplaması) + tam test süiti + doküman güncelleme | mobil, scripts |

Test kapsamı boşlukları da kapatılır: (parti,adım)→tek-açık-sevk ihlal senaryosu,
buildPendingParties çakışması, iptal-sonrası batchId kalıntısı cross-WO senaryosu.

## 7. Bilinçli sınırlar

- Farklı **iş emirlerinin** partileri yine birleşmez (Batch.workOrderId tekil) —
  PARTI-MODELI §13 kapsam dışı kararı sürüyor.
- Aynı adımda **farklı firmaya** açık sevkli partiler birleşmez (409 + liste) —
  fiziksel gerçek: mal iki ayrı firmada; önce kabul/iptal gerekir.
- Fasondayken bölmede kısmi-dönmüş sevkin dönmüş kalemleri taşınamaz.
