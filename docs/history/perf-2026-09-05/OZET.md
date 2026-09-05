# Performans turu — 2026-09-05

Kullanıcı kararı: *"ne kadar durduğu önemli değil, yazılımda bize performans kazandıracaksa yapalım."*
Yöntem bu repoda zaten yazılı olan ölçüt: **kazancı ölçülmeyen değişiklik yapılmaz.** Her düzeltmenin öncesi/sonrası `EXPLAIN (ANALYZE, BUFFERS)` ya da sayılmış sorgu adedi var.

Ham ölçümler bu dizindeki JSON dosyalarında (`seq-scan` · `index-envanteri` · `kod-desenleri` · `istemci` ve dört `*-sonuc` dosyası).

---

## 1 · Dürüst çerçeve

**Bugün yanan bir performans sorunu yoktu.** En pahalı ölçülen sorgu 13 ms, en yavaş uç 293 ms, veri küçük (832 top · 51.164 audit satırı · 373 iş emri). Aranan şey **ölçekle büyüyen maliyet** ve **yazma maliyeti** oldu.

Bu yüzden üç bulgu ölçülüp **"yapma"** damgası yedi ve bu da bir sonuçtur:

- **Trigram index'leri (11 adet) ölü değil.** `idx_scan = 0` görünüyorlar çünkü tablo küçük ve planlayıcı seçmiyor; arama yolu kodda canlı. Silinselerdi saha aramaları yavaşlardı.
- **`include` → `select` bu şemada kazanç getirmiyor.** Ölçüldü: sorgu sayısı sayfa boyutundan bağımsız (offset-50 → 24 sorgu, cursor-500 → 23). Maliyet bayt değil gidiş-dönüş sayısı; kazanç ilişki SAYISINI azaltmakta.
- **Offset sayfalama kapısı işini yapıyor.** `MAX_OFFSET=10000` sınırında sorgu hâlâ 0,1 ms mertebesinde.

## 2 · En büyük kazanç bir index değil, bir tarih seddi

`isUndoSourcedByAudit` (`inventory.service.ts`) iptal edilmiş bir topun detayı açıldığında **ve tablette barkodu okutulduğunda** `system_logs` tablosunu baştan sona tarıyordu.

| | Önce | Sonra |
|---|---|---|
| Süre | 7,95 ms | 0,56 ms |
| Buffer | 2.499 (19 MB) | 713 |
| Plan | Seq Scan | Index Scan |

Çözüm topun **kendi `statusChangedAt` damgasından** türetilen bir `createdAt` penceresi. Çapa ölçümle seçildi: 23 audit satırının hepsi damgadan 2–9 ms sonra yazılmış, pay ±10 dakika. Davranış eşitliği ölçüldü: 44 iptal topun 44'ünde eski ve yeni yüklem **aynı** kararı veriyor.

⚠️ Dev veritabanı yalnız 4 günlük log tutuyor; üretimde tablo 6 aylık. **Bu rakam alt sınırdır.**

**GIN index'i denendi ve gerekçeli olarak reddedildi:** jsonb GIN, sorgunun iki dalının hiçbirini karşılamıyor — `->> ... LIKE 'ön ek'` desteklenmiyor, dizi kapsaması da kolonun kendisine değil alt nesneye bakıyor. Üstelik `system_logs` en çok yazılan tablo (68.800 insert), GIN oraya en pahalı seçenek olurdu.

Aynı mekanizma `ImportService.getRunRecords`'a uygulandı: 11,48 → 1,33 ms, `Sort` düğümü tamamen kalktı.

## 3 · Planda "Index Scan" yazması yetmiyor

`recordId` `tableName` olmadan gönderilebiliyordu. Plan `Index Scan` yazıyor ama ilk kolon boş olduğu için **index'in tamamı** okunuyordu.

| | Önce | Sonra |
|---|---|---|
| Buffer | 478 | 4 |
| Süre | 1,79 ms | 0,025 ms |

Kural belgede zaten yazılıydı, **kapısı yoktu**. Zod `superRefine` ile fail-closed kapı kondu, yeni bekçi `test_system_log_query_gate` (9 kontrol, negatif sondayla kırmızı verdiği ölçüldü). İstemci taraması yapıldı: `recordId` gönderen tek yüzey `tableName`'i zaten birlikte gönderiyor.

**Ders:** plan düğümünün adı yanıltır, asıl ölçüt `Buffers`tır.

## 4 · Prisma `distinct` SQL'e inmiyor

Audit ekranının iki dropdown'ı 14.067 ve 49.879 satırı Node'a çekiyordu — yakalanan SQL'de ne `DISTINCT` ne `LIMIT` vardı. `$queryRaw` + `SELECT DISTINCT` ile:

| | Önce | Sonra |
|---|---|---|
| Telde satır | 63.946 | 139 |
| Sorgu | 3 | 2 |

Bir alternatif de ölçülüp terk edildi (`JOIN users` sonra `DISTINCT`: 12,87 ms / 5.345 buffer — öncekinden kötü).

## 5 · Yazma maliyeti

- **`system_logs_category_createdAt_idx`** 3.600 kB → **56 kB** kısmi index'e çevrildi (%98,4). Kazanç okumada değil yazmada: en çok yazılan tablonun insert'lerinin %97,5'i artık bu index'in bakımını ödemiyor.
- **10 gereksiz index** kaldırıldı — her biri non-partial bir UNIQUE tarafından tam kapsanıyordu, yani `[DB-12]` kuralının fiilî ihlaliydi. Disk kazancı küçük (160 kB) ve küçük olduğu ölçüldü; asıl değer kuralın veritabanında gerçekten tutuyor olması.
- **`rolls` tablosunda HOT güncelleme oranı %0,8** — güncellemelerin %99,2'si 28 index'in hepsine yazıyor. Bu turda **dokunulmadı**: hangi index'in düşeceği canlı `idx_scan` verisi ister. Sıradaki iş.

## 6 · Envanter sekmeleri

"Bitmiş Depo" ve "Üretimde" sekmelerinin sıralamasını karşılayan hiçbir index yoktu; ikisi de sıralı tarama yapıyordu. İki kısmi index eklendi ve **planlayıcı 832 satırlık tabloda bile ikisini de seçti**:

| Sekme | Buffer | Süre |
|---|---|---|
| Depo | 140 → 16 | 0,386 → 0,064 ms |
| Üretimde | 134 → 47 | 0,169 → 0,048 ms |

## 7 · İstemci tarafı

- **Envanter açılışı 9-10 istekten 2'ye indi.** `FilterBar` dokuz katalog sorgusunu dropdown hiç açılmadan atıyordu; `enabled: open` ile ilk açılışa ertelendi.
- **`useDataTable` her mount'ta yüklü tüm sayfaları seri yeniden çekiyordu.** Sekme içi gezinti sayfayı unmount ettiği için her dönüşte 9 seri istek atılıyordu; artık 0.
- **Kanban ucu 115 → 66 sorgu.** Kart, liste yüzeyinin ilişki setini ödünç alıyordu; karta dar bir projeksiyon verildi. İş emri liste rollup'ı da 24 → 18 sorguya indi ve **rollup değerleri birebir aynı kaldı** (50 satırlık sayfa doğrulandı).

**Ölçülüp iş çıkmayanlar:** sekme geçişi ve pencere odağı hiç istek atmıyor (`refetchOnWindowFocus` kapalı, `staleTime` 5 dk). Mobil açılışta bloklayan ağ isteği yok.

## 8 · Sıradaki işler (ölçüldü, bu turda yapılmadı)

1. **`rolls` index sayısı** — 28 index, HOT %0,8. Canlı `idx_scan` verisiyle hangisinin düşeceğine karar verilir.
2. **`loadAllForPicker` 500 tavanı** — `items` 138 · `colors` 126 · `customers` 77. 3,6× pay var ama tavan aşılınca panel **hata fırlatıyor**, mobil ise **sessizce kesiyor** — mobil daha riskli, önce o.
3. **Etiket şablonu havuz listesi** tasarımcı JSON'unu (`fields`, ort. 1.271 B) çekiyor — `omit` ile çözülür.
4. **Anasayfa 5 KPI için 5 ayrı istek** — tek uçta toplanabilir ama KPI'ler farklı izinlere bağlı, kapı tasarımı ister.
5. **Sayım uygulama** eksik top başına 5 sorgu; tavanda ~1.000 sorgu tek transaction'da.

## 9 · Doğrulama

Backend **457/457** (351 sn, temiz koşum) · Electron 213 dosya / 2.290 test · üç projede lint 0 hata ve tavan aşılmadı · dört tip kontrolü, doküman ve migration kapıları temiz. Üç migration dev'e uygulandı; `test_db_invariants` envanterine yazıldı.
