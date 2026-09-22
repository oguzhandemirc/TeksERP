# Numaralandırma Şablonları — tasarım

> Canlı tasarım belgesi. Kural özeti `docs/kurallar/numaralandirma.md`, karar hikâyesi `docs/history/CLAUDE-NOT-ARSIVI.md` 2026-09-22. Faz A · B · C indi; Faz D kâğıtta.

## §0 Problem

Repoda 39 numara üreteci var ve ön ekleri servislerde literal. Yazılım başka fabrikalara satılacak; her fabrika kendi ön ekini/biçimini ister. Bugün bunu değiştirmenin tek yolu kod değiştirmek — yani müşteri başına fork, kök `CLAUDE.md`'nin yasakladığı şey.

İkinci tetik ölçüldü: "sevkiyat içi çuval sırası ön eki" ayarı sunum katmanında canlı okunuyordu; program ekranı eski, belge yeni ön eki gösterdi. Kullanıcının koyduğu değişmez:

> "belge-çıktı-programdaki veriler birbiriyle aynı olmalı; programda p-2 yazarken çıktı p20260202 görmemeliyiz."

## §1 Sektör karşılaştırması

| Sistem | Model | Geçmişe etki | Sıfırlama |
|---|---|---|---|
| **SAP** | Number Range Object (NRIV) — nesne başına aralıklar, iç/dış numara | Yok; aralık değişimi yalnız yeni belgeye | Mali yıla bağlı aralık |
| **Dynamics BC** | No. Series + No. Series Line (başlangıç tarihli satır) | Yok; yeni satır kendi başlangıç tarihinden itibaren geçerli | Satır değişimiyle |
| **Odoo** | `ir.sequence` — prefix/suffix'te tarih yer tutucuları, padding, `ir.sequence.date_range` | Yok | Tarih aralığı kaydıyla |
| **Logo / Netsis / Mikro** | "Numaralama şablonu" — sabit metin + tarih + sayaç + işyeri segmentleri | Yok ("şablon değişikliği yalnız yeni fişleri etkiler") | Şablondaki tarih parçasıyla |

Ortak payda üç cümle: **(a)** biçim veridir, kodda değil · **(b)** geçmiş asla yeniden numaralanmaz · **(c)** sayaç kapsamı biçimin tarih parçasından doğar. Tasarım bu üçünü aynen alır.

## §2 Model

```
NumberSeries { key(unique) · label · prefix · dateSegment · digits · separator
               retiredPrefixes[] · scanned · editable · updatedById }
enum NumberSeriesDateSegment { NONE  DDMMYY  YYMM  YYYYMM  YY  YYYY }
```

**Kod-sahipli alanlar** (boot uzlaştırması her açılışta tazeler): `label` · `scanned` · `editable`, ayrıca yalnız kodda yaşayan `kind` ve `lockedReason`.
**Veri-sahipli alanlar** (yalnız panel yazar, uzlaştırma DOKUNMAZ): `prefix` · `dateSegment` · `digits` · `separator` · `retiredPrefixes`.

Kod üretimi: `seriesPrefix()` sabit başı kurar (`prefix [sep] [tarih] [sep]`), sayaç o başla başlayan kodların sayısal max'ı + 1, kod = baş + `padStart(digits)`.

| Seri | Bugünkü kod | prefix · dateSegment · digits · sep |
|---|---|---|
| `sack` | `CV2209260001` | CV · DDMMYY · 4 · "" |
| `packingLotCode` | `PRT-2609-0001` | PRT · YYMM · 4 · "-" |
| `packingLotName` | `P-3` | P · NONE · 1 · "-" |
| `item` | `STK-000001` | STK · NONE · 6 · "-" |

## §3 Reddedilen seçenekler

1. **Geçmişi yeniden numaralandırma** — donmuş belge müşteride basılı, depodaki çuval etiketi eski barkodu taşıyor, numara defter satırlarında referans. Sektörde de yok.
2. **Serbest maske stringi** (`{PREFIX}{DDMMYY}{####}`) — sayaç sorgusu literal başı hesaplayabilmeli; maske ayrıştırma ister, çakışma kapısını zorlaştırır ve kullanıcıya sözdizimi öğretir. Yapılandırılmış alanlar + canlı önizleme daha az hata üretir.
3. **Ayrı `NumberSeriesCounter` tablosu** — rollback'te boşluk doğurur, yeni advisory uzayı ister ve türetilmiş sayacın cevaplamadığı hiçbir soruyu cevaplamaz. Tarih segmenti sıfırlama dönemini zaten kodluyor.
4. **Feature-flag satırı olarak modellemek** — `settings-config.ts`'e dördüncü satır türü eklemek 6 dosya + sözleşme bekçisinin iç-alan-adı kuralını değiştirmek demekti; numaralandırma davranış anahtarı değil yapılandırma verisidir.
5. **Küresel ön ek tekilliği** — ölçüldü: bugün `KS`, `IADE` ve `P` zararsızca çakışıyor (ayrı tablolar, okutulmuyorlar). Küresel kapı doğduğu gün üç yanlış kırmızı verirdi.

## §4 Fazlar

- **Faz A (indi, 2026-09-22):** şema + katalog + servis + boot uzlaştırması + 39 çağrı yerinin bağlanması + `test_number_series` (26 kontrol, dört negatif sonda). Kullanıcıya görünür değişiklik YOK.
- **Faz B (indi, 2026-09-22):** barkod sınıflandırması sunucuya — `GET /api/scan/series`, `search.service.EXACT_FORMATS` tablodan türetilir, `Electron/src/lib/scanner/barcode-kind.ts` ve mobildeki üç regex (`PaketlemeScreen:75` · `DepoScreen:309` · `FasonSevkScreen:82-83`) kalkar, tanınmayan kod `GET /api/scan/resolve`a sorulur, `client-version-policy` `minVersion` YÜKSELMEDİ ve bu ÖLÇÜLDÜ (altı sözleşme tetiğinin hiçbiri ateşlenmiyor; eşik C0b'ye taşındı). Taranan serilerin ön eki bu faz inmeden düzenlenebilir olmaz (kullanıcı kararı). Saha ölçümü: 8.089 gerçek kodda GERİLEME 0.
- **Faz C (indi, 2026-09-22):** panel ekranı (Ayarlar → Numaralandırma), izin `settings:numbering` + ayar şifresi, canlı önizleme ve ölçülmüş etki cümlesi; `RollReturn.returnNo` kolonu (bugün `id`'den türetiliyor); `shippingSackSeqPrefix` deseninden dosya-adı kıran karakterlerin çıkarılması.
  - **C0 (indi):** sayacın KAPSAMI `NumberSeries.formatChangedAt` damgasına bağlandı — sayaç yalnız biçim yürürlüğe girdikten sonra doğan kodlara bakar (tarih segmenti düşünce sabit baş kısalıyor ve eski rejim sayaca giriyordu: sıra 4 yerine 2.209.260.004) ve üretilen kod var olanların üstünden ATLAR (kapsam daraltması sayacı 1'e döndürebiliyor; aynı gün geri alınan bir biçim değişikliği var olan kodu yeniden üretirdi ve `withBarcodeRetry` bunu deterministik tekrarlayıp 409'la bitirirdi). Sayacı hazırlanmamış seri panelden DÜZENLENEMEZ (`scopedCounter` beyanı).
  - **ÖN KOŞUL (C0b) — İNDİ:** taranan (`scanned`) serilerin ön eki panelden değiştirilebilir olmadan ÖNCE `client-version-policy.ts`teki `minVersion`, Faz B'yi (sunucu tabanlı okutma sınıflandırması) taşıyan sürüme yükselir; sıra **önce istemci yayını, sonra backend**. Eşik ileriye dönük bir sürüm TAHMİNİ değil, o yeteneği taşımayan SON sürümdür (`FAZ_B_ONCESI`); iki eksen (panel + tablet) birlikte aranır, `web` muaftır çünkü web paketi backend'in İÇİNDE gider (drift imkânsız — okutma yapmadığı için DEĞİL: özet kabuğu `operations` yollarını açar ve orada yedi okutan yüzey vardır, ölçüldü).
    Gerekçe: Faz B'yi taşımayan bir panel/tablet kendi SABİT regex'iyle okumaya devam eder; ön ek değiştiği an kodu SESSİZCE yanlış türe çözer (çuval kodunu top sanıp "Top bulunamadı" der). Sessiz yanlış dal, 400'den pahalıdır.
    ⚠️ Faz B'de bu eşik **bilerek yükseltilmedi**: altı sözleşme tetiğinin hiçbiri ateşlenmiyor (uç eklendi, yanıt şekli aynı, zorunlu parametre GEVŞEDİ, enum ve izin kümesi aynı) ve kırılma yokken eşiği yükseltmek, güncellemeyi indiremeyen her makineyi çıkışsız biçimde üretim dışı bırakırdı.
    ⇒ Bu ön koşul bir CÜMLE olarak bırakılmaz, **kapı** olur: `updateSeriesFormat`, `scanned: true` bir serinin biçimini değiştirmeyi `minVersion` yeterli sürüme ulaşmadıkça 400 `NUMBER_SERIES_CLIENT_TOO_OLD` ile reddeder (mesajda gereken sürüm yazılı). Böylece "önce istemciyi güncelle" bir niyet değil bir seddir.
  - **C2 (indi):** `RollReturn.returnNo` kolonu + belge-çapalı geri doldurma. Numara SATIRA değil BELGEYE aittir (belge `returnGroupId ?? id` ile çözülür): üye satırlar liderin numarasının kopyasını taşır, tekillik BELGE başınadır (`returnGroupId IS NULL OR = id` — yalnız `IS NULL` demek grupların tamamını kısıt dışında bırakırdı).
  - **C4 (indi):** `shippingSackSeqPrefix` deseninde YAZMA yüklemi daraldı (eğik çizgi dosya/sayfa adını kırıyordu), OKUMA yüklemi GENİŞ kaldı — aynı fonksiyon sevk anında DONMUŞ ön eki de süzüyor ve daraltmak geçmiş belgeyi bugün boş gösterirdi.

- **Faz D:** kalan seriler panele; `document-render/sample-data.ts` örnekleri seri tablosundan üretilir (bugün bayat: `FTR…`/`THS…` gerçek üreteçle uyuşmuyor); istenirse ikinci segment olarak şube/depo kodu.
