# TEKS-ERP BACKEND & VERİTABANI DENETİMİ — ÇOK AJANLI DENETİM GÖREVİ

> Bu dosyanın tamamı Claude Code (Fable CLI) oturumuna **tek seferde** yapıştırılacak görev talimatıdır.
> `<<< >>>` işaretli üç yeri göndermeden önce doldur; gerisi hazırdır.

---

# BÖLÜM 0 — ÇALIŞTIRMA TALİMATI

**ultracode**

Bu bir denetim görevidir. Aşağıdaki çalışma koşullarını kabul et:

- **Efor**: maksimum. Bu iş "az ama emin bulgu"nun değil, **geniş tarama + her bulgunun ayrı ayrı çürütülmeye çalışılması**nın işidir. Yüzeysel tarama kabul edilmez.
- **Oturum**: tek oturum. Paralelliği içeriden kur.
- **Alt ajan / workflow izni: AÇIK.** Ajanlara dağıt, paralel okuyucular ve bağımsız denetçi panelleri kur. Bu izin oturum boyunca geçerlidir; her seferinde tekrar sormana gerek yok.
- **Bütçe / token limiti**: yok. Eksiksizlik kısalıktan önceliklidir.
- **Beceri paketi**: `express-api-audit` denetim beceri paketini yükle ve kullan.
- **Ölçüm hakkı**: bulguları koddan okumakla yetinme; **dev DB'ye karşı sorgu çalıştır ve `scripts/test_*.ts` bekçilerini kullan**. Gerektiğinde yeni eşzamanlılık repro scriptleri yaz (`scripts/audit_repro_*.ts`).
- **Üretim (prod) ortamı**: canlıdır. Prod'a karşı **hiçbir** yazma, DDL, uzun kilit alan sorgu veya migration çalıştırma. Prod'dan yalnızca okuma amaçlı istatistik/plan alınabilir ve bu ayrıca işaretlenir. Öneriler `[PROD'DA ÇALIŞTIRMA]` etiketiyle verilir.
- **Bu tur salt-okunur denetimdir.** Kod düzeltmesi yazma, refactor yapma, migration üretme. Düzeltmeler ikinci turda ele alınacaktır. İstisna: yalnızca `scripts/audit_repro_*.ts` altına yazılacak, üretim koduna dokunmayan kanıt/repro scriptleri.
- **Nihai çıktı**: tek bir rapor artefaktı (Bölüm 7 yapısında) + bulguların JSON dosyası (`docs/history/denetim-2026-08/findings.json`) + repro scriptleri.

---

# BÖLÜM 1 — KAPSAM, ÖNCELİK VE SİSTEM BAĞLAMI

## 1.1 Kapsam

```
Kök dizin        : Teks-Erp/
Kapsam           : <<< tüm backend / yalnızca şu modüller: sevkiyat, stok, üretim, fatura ... >>>
Kapsam dışı      : frontend UX, altyapı sertleştirme, lisans uyumu
```

Kapsam belirtilmemişse **tüm backend** varsay ve raporda bunu varsayım olarak yaz.

## 1.2 Aranan sorun sınıfları — öncelik sırası

Aşağıdaki sıra, çakışma durumunda ajan zamanının nasıl bölüneceğini belirler.

```
P0  Yarış koşulu (race condition) ve çift kayıt / mükerrer iş etkisi
P1  Para, miktar, metraj hesabının doğruluğu (yuvarlama, birim çevrimi, maliyet)
P2  Yetki açığı ve tenant/şirket izolasyonu ihlali
P3  Hata yutma ve sessiz veri kaybı (yakalanmayan async hata, boş catch, rollback edilmeyen iş)
P4  Veri bütünlüğü (kısıt eksikliği, yetim kayıt, denormalize alan sapması)
P5  Performans ve ölçeklenebilirlik
P6  Test edilebilirlik, gözlemlenebilirlik, teknik borç

Kullanıcının değiştirdiği öncelik: <<< boş bırakılırsa yukarıdaki sıra geçerlidir >>>
```

## 1.3 Teknik künye (doğrula, varsayma)

Aşağıdakileri **repodan okuyarak doğrula** ve raporun başına gerçek değerlerle yaz. Tahminle doldurma.

```
Runtime / dil          : Node.js sürümü, TypeScript sürümü        → package.json, .nvmrc
HTTP katmanı           : Express sürümü (4 mü 5 mi — kritik fark)  → package.json
ORM                    : Prisma sürümü                             → package.json
Veritabanı + sürüm     : ?                                         → schema.prisma, docker-compose, env örneği
relationMode           : "foreignKeys" mı "prisma" mı              → prisma/schema.prisma  ★
Varsayılan izolasyon   : DB varsayılanı + kodda override           → SHOW / $transaction opts
Süreç modeli           : tek process / PM2 cluster / N replika / k8s
Zamanlanmış işler      : node-cron / BullMQ / Agenda / setInterval / harici cron
Kuyruk / mesajlaşma    : var mı, hangisi, teslim garantisi
Cache                  : Redis / in-memory / yok
Çok şirketlilik        : şirket_id kolonu / şema / DB ayrımı; filtre nerede uygulanıyor
Entegrasyonlar         : e-Fatura/GİB, banka, kantar, el terminali, MES/PLC, kargo, B2B
Mevcut bekçi scriptleri: scripts/test_*.ts — hangileri neyi doğruluyor
```

★ `relationMode = "prisma"` ise veritabanında **hiç foreign key yoktur**. Bu tek başına S0/S1 sınıfı bir bulgudur ve tüm veri bütünlüğü analizini değiştirir. İlk kontrol edilecek şeylerden biridir.

## 1.4 Sonsuz bütçe nasıl harcanacak

Zamanın çoğunu şuraya harca:
1. **Kritik yazma yollarının eşzamanlılık analizi** (Bölüm 4) — en yüksek getirili iş burasıdır.
2. **Dev DB'de fiili ihlal arama** — "teorik olarak olabilir" ile "dev/prod verisinde 17 kayıtta olmuş" arasındaki fark, raporun tüm ikna gücüdür.
3. **Çürütme turları** — yanlış pozitif, denetim raporunu değersizleştiren tek şeydir.

---

# BÖLÜM 2 — ORKESTRASYON: BEŞ AŞAMA

## ① KEŞİF — Paralel alan haritalayıcıları

Aşağıdaki okuyucu ajanları **paralel** başlat. Her biri yalnızca haritalar; bulgu yazmaz, yargı vermez. Çıktıları ortak bir bağlam dosyasına yazılır (`docs/history/denetim-2026-08/00-map/*.md`).

| Ajan | Görevi | Çıktısı |
|---|---|---|
| **K1 — Rota & yüzey** | Tüm Express route'larını çıkar: method, path, middleware zinciri, handler dosyası, auth middleware var mı, validation var mı | Rota envanteri tablosu |
| **K2 — Şema & kısıt** | `schema.prisma` + tüm `prisma/migrations/**/*.sql` → tablo, kolon, tip, unique, index, FK, CHECK, trigger, default | Şema envanteri + kısıt matrisi |
| **K3 — Transaction & kilit** | `$transaction` kullanımlarının tamamı, sınırları, içinde ne var, isolationLevel/timeout opsiyonları, raw kilit ifadeleri | Transaction envanteri |
| **K4 — Yazma yolları** | Hangi kod yolu hangi tabloya yazıyor: HTTP handler / cron / queue consumer / script / seed | Varlık × Yazma Yolu matrisi |
| **K5 — Yetki kapıları** | Auth/authz middleware'leri, rol kontrolleri, şirket/tenant filtresinin nerede uygulandığı, filtresiz sorgular | Yetki kapısı haritası + kapısız rota listesi |
| **K6 — Hata yolu** | try/catch dağılımı, async handler sarmalayıcısı var mı, global error handler, boş catch, yutulan promise, loglama | Hata yolu haritası |
| **K7 — Hesap & birim** | Para/miktar/metraj hesaplayan tüm kod noktaları; yuvarlama, birim çevrimi, KDV, iskonto, maliyet formülleri — aynı hesabın kaç ayrı yerde yazıldığı | Hesap noktaları envanteri + kopya hesap listesi |
| **K8 — Zamanlanmış & arka plan** | Cron/queue/worker tanımları, sıklık, tekil çalışma garantisi, yeniden çalıştırma davranışı | İş envanteri |
| **K9 — Entegrasyon** | Dış sistem adaptörleri: çağrı yönü, retry, timeout, idempotency anahtarı, transaction ile ilişkisi | Entegrasyon envanteri |
| **K10 — Değişmez çıkarımı** | Kod + şema + varsa dokümandan **iş değişmezlerini** yaz (Bölüm 3.E'yi kılavuz al) | Değişmez envanteri |

**① sonunda dur ve bana şunu göster:**
- Varlık × Yazma Yolu × Değişmez matrisi
- Kritik yazma yolları listesi (Bölüm 4.2 ile karşılaştırılmış hâli)
- Teknik künyenin doğrulanmış hâli
- Erişemediğin / anlayamadığın alanlar

Onay bekle. Onay gelmezse 5 dakika içinde varsayımlarını yazıp devam et.

## ② BULMA — Alan başına bağımsız denetçiler

Her denetim alanı için ayrı ajan. Ajanlar **birbirinin bulgularını görmez** (bağımsızlık, aynı kör noktayı paylaşmalarını engeller). Her ajan Bölüm 3'teki kendi alanının kontrol listesini uygular.

| Ajan | Alan | Bölüm 3 referansı |
|---|---|---|
| D-A | Eşzamanlılık & race condition | A |
| D-B | Mükerrer veri & idempotency | B |
| D-C | Veri modeli & kısıtlar | C |
| D-D | Transaction sınırları & dağıtık tutarlılık | D |
| D-E | ERP iş kuralı değişmezleri | E |
| D-F | API & Express katmanı | F |
| D-G | Güvenlik & yetkilendirme | G |
| D-H | Performans | H |
| D-I | Hata yönetimi & gözlemlenebilirlik | I |
| D-J | Migration & kurtarma | J |
| D-K | Test & bekçi scriptleri | K |
| D-L | Kod kalitesi & hesap tekrarı | L |

**Her bulgu için zorunlu:** dosya:satır kanıtı + Bölüm 5 formatı + kanıt seviyesi (Bölüm 2.6).

D-A ve D-B ajanları, ② bitmeden **dev DB'de repro denemesi** yapmak zorundadır (Bölüm 2.5).

## ③ ÇÜRÜTME — Bulgu başına üç bağımsız "bunu yanlışla" denetçisi

Her bulgu, üç ayrı çürütücü ajana verilir. Çürütücünün görevi bulguyu doğrulamak değil, **yıkmaya çalışmaktır.**

Geçerli çürütme gerekçeleri:

| Kod | Gerekçe | Kanıt zorunluluğu |
|---|---|---|
| **Ç1** | Kod yanlış okundu; gerçekte kilit / guard / atomik update var | İlgili dosya:satır |
| **Ç2** | Veritabanı koruyor: unique / check / FK / exclude constraint mevcut | Migration SQL satırı |
| **Ç3** | Kod erişilemez: route'a bağlı değil, ölü kod, feature flag kapalı | Rota envanteri veya flag konfigi |
| **Ç4** | Eşzamanlılık fiilen imkânsız: tek instance garantisi, dağıtık kilit, kuyruk serileştirmesi, tek tüketici | Deployment/scheduler konfigi |
| **Ç5** | Girdi mümkün değil: üst katmanda validation engelliyor | Validation şeması satırı |
| **Ç6** | Etki yanlış tanımlanmış — bulgu doğru ama sonuç iddia edilenden hafif | Gerekçe + doğru etki tanımı |
| **Ç7** | Mükerrer bulgu — başka bir bulgunun aynısı | Diğer bulgu id'si |

**Karar kuralı:**
- 3 çürütücünün **en az 2'si** kanıtlı çürütme sunarsa → bulgu **düşer**, raporun "Değerlendirilip elenen bulgular" ekine gerekçesiyle taşınır (silinmez; denetimin şeffaflığı için kalır).
- Yalnızca **Ç6** ile çürütülürse → bulgu kalır, **şiddeti düşürülür**.
- Çürütücü kanıt gösteremiyorsa çürütme **geçersizdir**; "bence olmaz" çürütme değildir.
- Çürütme, bulguyu **güçlendirebilir** de: çürütmeye çalışırken daha kötü bir şey bulan çürütücü yeni bulgu açar.

Ayrıca her S0 ve S1 bulgusuna, çürütmeyi geçtikten sonra bir **doğrulayıcı ajan** atanır: bulguyu dev DB'de repro etmeyi dener (Bölüm 2.5).

## ④ DOYGUNLUK — Kuruma turları

②–③ döngüsünü, **bir tam turda hiç yeni S0/S1 bulgusu çıkmayana kadar** tekrarla. Her yeni tur, bir öncekinden farklı bir bakış açısıyla girilmelidir:

- **Tur 1**: kod merkezli (yukarıdaki alan ajanları)
- **Tur 2**: veri merkezli — dev/prod verisinde ihlal ara, ihlal bulunca kodda sebebini geriye doğru izle (**bu tur genellikle en değerli bulguları verir**)
- **Tur 3**: senaryo merkezli — gerçek fabrika senaryolarını uçtan uca izle (Bölüm 4.3)
- **Tur 4**: sınır durum merkezli — gece yarısı, ay sonu, yıl dönümü, sıfır miktar, negatif, çok büyük sayı, boş liste, yeniden gönderim, ağ kesintisi, pod restart
- **Tur 5+**: önceki turların kör noktalarını hedefle

Her tur sonunda "bu turda ne yeni çıktı / neden çıktı" özetini bana ilet.

## ⑤ SENTEZ

- Bulguları kök neden kümelerine grupla (40 bulgu yerine "7 kök neden, 40 belirti").
- Şiddet + fiili ihlal + efor üzerinden yol haritası çıkar.
- Bölüm 7 yapısında tek rapor üret.

## 2.5 Kanıt merdiveni — bulgu güç seviyeleri

Her bulguya kanıt seviyesi ata. **S0 bulgusu için K2 veya K3 zorunludur**; K1'de kalan bulgu S1'i geçemez.

| Seviye | Anlamı |
|---|---|
| **K0** | Yalnızca kod okuması — desen eşleşmesi |
| **K1** | Kod + şema + konfigürasyon birlikte doğrulandı; koruma mekanizması olmadığı teyit edildi |
| **K2** | Dev veya prod verisinde **fiili ihlal tespit edildi** (sorgu + sonuç sayısı + örnek kayıt) |
| **K3** | Dev DB'de **eşzamanlı repro scripti ile tetiklendi** (script + çıktı) |

**Repro scripti standardı** (`scripts/audit_repro_<bulgu-id>.ts`):

```ts
// Amaç: aynı sipariş satırından iki paralel sevkiyat, kalan miktarı aşabiliyor mu?
// Ortam: SADECE dev DB. Prod connection string ile çalıştırılması engellenmiştir.
// Beklenen (sağlıklı sistem): biri başarılı, diğeri iş hatası → toplam <= sipariş miktarı
// Gözlenen: <script çıktısı buraya>

const N = 2; // gerekirse 10'a çıkar
const sonuc = await Promise.allSettled(
  Array.from({ length: N }, () => sevkiyatOlustur({ siparisSatirId, miktar }))
);
// commit sonrası değişmezi ölç
```

Script'in başına prod DB'ye bağlanmayı reddeden bir guard koy. Script'ler denetim sonunda repoda kalır; ekibin regresyon bekçisi olur.

## 2.6 Ajanlar arası kurallar

- Ajanlar birbirinin bulgu listesini görmez; yalnızca ① aşamasının haritalarını paylaşır.
- Her ajan kendi alanı dışında bir şey görürse "sınır ötesi not" bırakır; ilgili ajana yönlendirilir.
- Hiçbir ajan kontrol maddesini sessizce atlamaz; uygulayamadığını "kapsam dışı — sebep" olarak raporlar.
- Ajanlar prod'a yazmaz, üretim koduna dokunmaz.

## 2.7 İkinci görüş (opsiyonel, en sonda)

Sentez bittikten sonra istersen aynı prompt'u sıfırdan ikinci bir oturumda koştur ve iki raporu karşılaştır. Başta gerekli değildir; ③ aşaması zaten bağımsız görüş işlevini içeriden görüyor.

---

# BÖLÜM 3 — DENETİM ALANLARI

Her maddede: **(a) ne aranır · (b) Express/Prisma'da nasıl tespit edilir · (c) kanıt · (d) fabrika etkisi**

---

## A. EŞZAMANLILIK VE YARIŞ KOŞULLARI  `[P0]`

### A.1 Check-then-act (oku → karar ver → yaz)

**(a)** Bir koşulun okunup, ardından o koşula dayanarak yazılması; arada kilit veya atomik guard olmaması.

ERP'deki karşılıkları: stok yeterli mi → düş · kart var mı → yoksa aç · sipariş onaylı mı → onayla · kredi limiti aşılıyor mu → kaydet · rezerve edilebilir mi → rezerve et · lot karantinada mı → sevk et · dönem açık mı → fiş at.

**(b) Prisma'ya özgü tespit:**

```bash
# Oku-sonra-yaz kalıbı
rg -n "prisma\.\w+\.(findUnique|findFirst)" -A 12 | rg -n "\.(update|create|delete)\("
# Uygulamada hesaplanıp set edilen alan (lost update kaynağı)
rg -n "\{\s*(miktar|kalan|bakiye|stok|rezerve)\s*:\s*[^{]" 
rg -n "(miktar|kalan|bakiye)\s*:\s*\w+\s*[-+]\s*"
# Atomik alternatif kullanılmış mı
rg -n "\{\s*increment:|\{\s*decrement:"
# Guard'lı updateMany + count kontrolü
rg -n "updateMany\(" -A 8
rg -n "\.count\s*===\s*0|\.count\s*<\s*1|count === 0"
```

**Prisma'da güvenli desen** — atomik guard'lı update ve etkilenen satır kontrolü:

```ts
const r = await tx.siparisSatir.updateMany({
  where: { id, kalan: { gte: miktar } },   // guard WHERE'in içinde
  data:  { kalan: { decrement: miktar } }, // atomik decrement
});
if (r.count === 0) throw new IsHatasi("Kalan miktar yetersiz");
```

`update()` + `{ kalan: yeniDeger }` deseni **her zaman** yarışa açıktır. `decrement` kullanılmış ama `where` içinde guard yoksa **negatife düşer** — bu ayrı bir bulgudur; `decrement` tek başına yeterli koruma değildir, mutlaka ayrıca kontrol et.

**Kilit gerekiyorsa** Prisma'da `SELECT ... FOR UPDATE` yalnızca raw ile mümkündür:
```ts
await tx.$queryRaw`SELECT id FROM siparis_satir WHERE id = ${id} FOR UPDATE`;
```
Bunun kullanıldığı yerleri ara; kullanılmıyorsa ve guard'lı update de yoksa bulgu yaz.

**(d) Zorunlu çıktı — çakışma zaman çizelgesi.** Her yarış bulgusunda iki aktörlü çizelge yaz:

```
T1  A: findFirst(kalan)  → 100
T2  B: findFirst(kalan)  → 100
T3  A: kontrol 100 >= 80 ✓
T4  B: kontrol 100 >= 60 ✓
T5  A: update(kalan = 20) ; COMMIT
T6  B: update(kalan = 40) ; COMMIT
SONUÇ: 140 birim sevk (sipariş 100). Kalan 40 görünüyor. Fiziksel stok -40.
```

### A.2 Kaybolan güncelleme (lost update)

**(a)** Prisma'nın **yerleşik optimistic locking'i yoktur.** `@Version` benzeri bir mekanizma otomatik gelmez; elle kurulmuş mu diye bak.

**(b)** Kontrol et:
- Şemada `version Int @default(0)` benzeri alan var mı? Varsa **update'lerin `where`'inde kullanılıyor mu**? Sadece kolonun var olması hiçbir şey korumaz.
- API katmanı versiyonu taşıyor mu (`If-Match` / body'de `version`)? Taşımıyorsa optimistic locking kullanıcılar arası çakışmayı yakalamaz — **çok yaygın ve çok gözden kaçan hata**.
- Sunucu versiyon uyuşmazlığında `409` dönüyor mu, yoksa sessizce mi eziyor?
- Prisma `update` gönderilen alanları yazar; ama iki kullanıcı **aynı** alanı düzenliyorsa yine ezme olur.

**(d)** İki planlamacı aynı iş emrini açar, biri miktarı biri tarihi değiştirir; ikinci kaydeden ilkinin değişikliğini iz bırakmadan siler, üretim yanlış adette çalışır.

### A.3 İzolasyon seviyesi ve anomaliler

**(b)**
- DB varsayılan izolasyonunu **çalıştırarak** doğrula (PostgreSQL genelde `read committed`).
- Prisma'da izolasyon ancak açıkça verilir:
  ```ts
  prisma.$transaction(async (tx) => { ... }, { isolationLevel: "Serializable" })
  ```
  `rg -n "isolationLevel"` → hiç sonuç yoksa **tüm sistem DB varsayılanında** çalışıyordur. Bu bilgiyi raporun başına yaz; tüm eşzamanlılık analizi buna dayanır.
- Her kritik değişmez için hangi anomalinin mümkün olduğunu tablola:

| Anomali | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|
| Non-repeatable read | **Evet** | Hayır | Hayır |
| Phantom read | **Evet** | DB'ye göre | Hayır |
| Lost update (uygulama) | **Evet** | **Evet** | Hayır |
| Write skew | **Evet** | **Evet** | Hayır |

- **Write skew'i özellikle ara** — tek satır kilidi bunu çözmez:
  - "Aynı anda tek aktif fiyat listesi olabilir" → ikisi de aktifleşir
  - "Aynı makineye çakışan saatte iki iş emri atanamaz" → farklı satırlar kilitlenmez
  - "Toplam rezervasyon ≤ stok" → ayrı satırlardan eklenirken toplam aşılır
  - "Bir seri no tek depoda olabilir"
  Çözüm sınıfları: kısıtı tek satıra indirgeme (materialize edilmiş toplam + CHECK), `Serializable`, PostgreSQL `EXCLUDE` constraint, advisory lock.
- `Serializable` kullanılan yerlerde **serialization failure (40001) retry'ı var mı?** Yoksa kullanıcı ham hata alır. Körü körüne retry varsa idempotency sorunu doğar (Bölüm B).

### A.4 Prisma transaction tuzakları  ★ bu ortamda en verimli alan

- **`$transaction` varsayılan timeout'ları**: interactive transaction'da `maxWait ≈ 2s`, `timeout ≈ 5s`. ERP'de bir üretim bildirimi 200 bileşen backflush ediyorsa veya MRP koşuyorsa bu süre yetmez → transaction **ortada patlar**. Uzun işlemlerde opsiyon verilmiş mi bak:
  ```bash
  rg -n "\$transaction\(" -A 6 | rg -n "timeout|maxWait"
  ```
- **Transaction içinde `await` ile dış çağrı**: HTTP (e-Fatura, banka, kargo), dosya, e-posta, `sleep`. Kilit ağ süresince tutulur; dış sistem başarılı olup DB rollback olursa **tutarsızlık**. Ara:
  ```bash
  rg -n "\$transaction\(" -A 40 | rg -n "axios|fetch\(|got\(|httpClient|sendMail|nodemailer|s3|upload"
  ```
- **Transaction dışına taşan yazma**: `tx` yerine global `prisma` client'ın transaction bloğu içinde kullanılması — bu yazma **transaction'a dahil değildir ve rollback edilmez**. Sessiz yarım kayıt üretir, çok sinsi:
  ```bash
  rg -n "\$transaction\(async \(tx\)" -A 40 | rg -n "\bprisma\.\w+\.(create|update|delete|upsert)"
  ```
  Bu desen bulunursa neredeyse kesin bir bulgudur.
- **Sıralı (array) `$transaction` vs interactive**: `prisma.$transaction([a, b, c])` atomiktir ama arada karar veremezsin; karar gerekiyorsa interactive kullanılmalı. Karar mantığı transaction dışında kalmışsa yarış doğar.
- **İç içe transaction**: Prisma nested interactive transaction desteklemez; servis fonksiyonu hem kendi başına hem başka transaction içinden çağrılıyorsa davranış tutarsızlaşır. `tx` parametresini opsiyonel alan servisleri ara.
- **Connection pool tükenmesi**: uzun interactive transaction sayısı > pool boyutu → tüm istekler bekler. `connection_limit` ayarını ve eşzamanlı transaction sayısını karşılaştır.
- **`$transaction` içinde `Promise.all`**: aynı `tx` üzerinde paralel sorgu — bağlantı tek olduğu için sıralanır veya hata verir; ayrıca hata durumunda kısmi durum.
- **Nested write (`create` içinde `create`)**: tek transaction'dır, bu iyi; ama derin nested write'ta kısmi hata mesajları anlaşılmaz olur ve constraint sırası beklenmedik hata üretir.

### A.5 Zamanlanmış işler ve çoklu instance  `[P0]`

**(a)** Node uygulaması PM2 cluster / birden fazla replika ile çalışıyorsa, `node-cron` **her worker'da ayrı ayrı tetiklenir**. ERP'de bu doğrudan mükerrer kayıt demektir.

**(b)** Kontrol et:
- Kaç process/replika çalışıyor? (PM2 ecosystem, Dockerfile, k8s replicas)
- Cron tanımları process başına mı yükleniyor? `rg -n "cron.schedule|setInterval|new CronJob|Agenda|BullMQ"`
- **Tekil çalışma garantisi** var mı: lider seçimi, DB advisory lock, Redis lock, BullMQ repeatable job (tek job id), `INSTANCE_ID === 0` kontrolü?
- **Önceki koşu bitmeden yenisi başlayabilir mi?** (overlap koruması)
- Pod restart'ta yarım kalan iş: baştan mı başlıyor? Baştan başlıyorsa işlenmiş kayıtlar tekrar işlenir mi?
- Dağıtık kilit varsa: TTL var mı? **TTL, işin en uzun süresinden kısa mı?** (Kısaysa kilit erken düşer, iki instance aynı anda çalışır — çok atlanan bir hata.) Sahiplik doğrulaması ve fencing token var mı?
- MRP koşusu, maliyet hesaplama, e-fatura gönderim, yaşlandırma, amortisman işleri özellikle incelenmeli.

### A.6 Belge numarası üretimi  `[P0]` ★

**(a)** Fatura, irsaliye, sipariş, iş emri, fiş numarası. ERP'nin en riskli tek noktası.

**(b)** Anti-desen ara:
```bash
rg -n "aggregate\(" -A 8 | rg -n "_max"
rg -n "orderBy.*desc" -A 5 | rg -n "sira_no|siraNo|belgeNo|fisNo|no:"
rg -n "MAX\(.*no.*\)" -i
```
- `MAX(no)+1` veya "son kaydı bul, +1" deseni → **S0**. İki eşzamanlı istek aynı numarayı alır; unique index varsa biri hata alır, yoksa **mükerrer fatura numarası** oluşur ve bu mevzuat ihlalidir.
- Sayaç tablosu kullanılıyorsa: `FOR UPDATE` veya guard'lı `updateMany` var mı?
- Prisma `autoincrement()` kullanılıyorsa: **sequence boşluk bırakır** (rollback, cache). Fatura seri-sıra numarasının Türkiye'de **boşluksuz** olması beklenir. Boşluk politikası nedir? Boşluksuz gerekiyorsa numara transaction'ın **en son adımında** alınmalıdır — nerede alındığını kontrol et.
- Sayaç anahtarı `seri + yıl + şirket + şube` kırılımını kapsıyor mu?
- Yıl dönümü sıfırlaması yarışa açık mı?
- e-Fatura ETTN/UUID tekil mi; tekrar gönderimde aynı ETTN mi kullanılıyor?
- **Mevcut veride boşluk ve mükerrer ara** (K2 kanıtı):
```sql
SELECT seri, sira_no + 1 AS eksik_baslangic
FROM (SELECT seri, sira_no, LEAD(sira_no) OVER (PARTITION BY seri ORDER BY sira_no) nx FROM fatura) t
WHERE nx IS NOT NULL AND nx <> sira_no + 1;

SELECT sirket_id, seri, sira_no, COUNT(*) FROM fatura GROUP BY 1,2,3 HAVING COUNT(*) > 1;
```

### A.7 Node/Express içi eşzamanlılık

- Modül seviyesinde paylaşılan mutable state (module-scope `let`, `Map` cache, sayaç) — çoklu istek arasında sızar.
- Request context (şirket/kullanıcı) `AsyncLocalStorage` ile mi taşınıyor, yoksa global değişkenle mi? Global ise **başka şirketin verisine yazma** riski, S0.
- `async` handler'da `await` sonrası `res` durumunun değişmesi; yanıt gönderildikten sonra devam eden iş.
- Fire-and-forget promise'ler (`void doSomething()`, `.then()` zinciri catch'siz) — hata yutulur, iş sessizce yapılmaz.
- Prisma client örneği tekil mi? Her istekte yeni client oluşturuluyorsa bağlantı patlaması.

### A.8 Cache ve eşzamanlılık

- Invalidation commit'ten **önce** mi yapılıyor? Önceyse başkası eski değeri okuyup tekrar cache'ler.
- Cache anahtarında şirket/tenant var mı? Yoksa **veri sızıntısı**.
- In-memory cache çoklu instance'ta tutarsızdır — kullanılıyorsa bunu bulgu olarak yaz.

---

## B. MÜKERRER VERİ VE IDEMPOTENCY  `[P0]`

### B.1 Veritabanı seviyesinde tekillik — son savunma hattı

**(b)** Her ana varlık için beklenen tekilliği yaz, `schema.prisma` ve migration SQL'lerinde karşılığını ara:

| Varlık | Beklenen anahtar |
|---|---|
| Stok kartı | (şirket, stok_kodu) |
| Cari | (şirket, cari_kodu) + VKN/TCKN üzerinde en az uyarı |
| Fatura | (şirket, seri, sıra_no) ve (şirket, ettn) |
| İrsaliye / Sipariş / İş emri | (şirket, belge_no) |
| Seri no | (stok, seri_no) |
| Lot | (stok, lot_no) |
| Kullanıcı | email (case-insensitive) |
| Yevmiye fişi | (şirket, dönem, fiş_no) |
| Barkod | global tekil veya (stok, birim) |

**Prisma'ya özgü kritik boşluklar — bunlar sistemik kök neden adayıdır:**
- Prisma şeması **partial unique index desteklemez**. Soft delete varsa (`deletedAt`), `@@unique` silinmiş kayıtları da kapsar → silinen kod tekrar açılamaz; ekip bunu aşmak için genellikle **unique'i kaldırır** ve mükerrer kapısı açılır. Doğru çözüm raw migration:
  ```sql
  CREATE UNIQUE INDEX uq_stok_kod_aktif ON stok_kart (sirket_id, stok_kodu) WHERE deleted_at IS NULL;
  ```
  Böyle bir raw migration var mı? Yoksa bulgu.
- Prisma **CHECK constraint desteklemez**. `miktar > 0`, `borc/alacak dengesi`, `iskonto 0-100` gibi kurallar raw migration ile eklenmiş mi? Eklenmemişse "veritabanı hiçbir iş kuralını korumuyor, tek savunma uygulama kodudur" tespitini kök neden olarak yaz.
- Prisma **EXCLUDE constraint desteklemez** → aralık çakışması (fiyat listesi, vardiya, makine ataması) yalnızca uygulamada korunuyordur, write skew'e açıktır.
- `relationMode = "prisma"` ise **FK yoktur** → yetim kayıt taraması zorunlu.
- Nullable kolon unique anahtarın parçasıysa: PostgreSQL'de NULL'lar tekrar edebilir → tekillik fiilen çalışmaz.

**Fiili mükerrer taraması (K2 kanıtı) — her ana tablo için çalıştır:**
```sql
SELECT sirket_id, stok_kodu, COUNT(*), array_agg(id)
FROM stok_kart GROUP BY 1,2 HAVING COUNT(*) > 1;

-- büyük/küçük harf ve boşlukla gizlenen mükerrerler
SELECT lower(btrim(stok_kodu)) k, COUNT(*), array_agg(id)
FROM stok_kart GROUP BY 1 HAVING COUNT(*) > 1;
```

**Türkçe karakter tuzağı**: `toLowerCase()` locale'e bağlıdır; Node'da `toLocaleLowerCase("tr")` ile `I → ı` olur. Normalizasyon tutarsızsa "İSTANBUL" ve "istanbul" ayrı kayıt olur.
```bash
rg -n "toLowerCase|toUpperCase|toLocaleLowerCase|normalize\("
```
Ayrıca baştaki/sondaki boşluk, non-breaking space ve Unicode normalizasyonu (NFC) uygulanıyor mu?

### B.2 "Varsa güncelle yoksa ekle" yarışı

- `findFirst` → yoksa `create` deseni **her zaman** yarışa açıktır (bkz. A.1 grep'i).
- Prisma `upsert()`: **hedefte gerçek unique index yoksa atomik değildir** ve iki paralel çağrı iki kayıt üretir. Her `upsert` için `where` alanının şemada `@unique`/`@@unique` olduğunu doğrula:
  ```bash
  rg -n "upsert\(" -A 6
  ```
  Bu, Prisma projelerinde en sık gerçekleşen mükerrer kaynağıdır.
- Unique violation (`P2002`) yakalanıp anlamlı iş hatasına çevriliyor mu, yoksa 500 mü dönüyor?
- `P2002` yakalanıp "o zaman güncelle" ile retry ediliyorsa, retry idempotent mi?

### B.3 API idempotency  `[P0]`

**(a)** El terminali, kararsız fabrika Wi-Fi'ı, gateway timeout, çift tıklama → aynı POST'un 2-3 kez gelmesi ERP'de normaldir.

**(b)**
- Mal kabul, üretim bildirimi, sevkiyat, ödeme, fatura kesme uçlarında **Idempotency-Key** desteği var mı? Yoksa **S0/S1**.
- Idempotency kaydı ile işin **aynı transaction**'da olması şart. Ayrıysa iki paralel retry ikisi de "yeni" görür.
  Doğru desen: idempotency tablosuna unique key ile `create` (kilit görevi görür) → iş → sonucu yaz. Aynı `$transaction` içinde.
- Aynı anahtar farklı gövdeyle gelirse ne oluyor? (Hata vermeli.)
- Doğal idempotency anahtarı kullanılabilir mi? (terminal_id + local_seq, kantar fiş no, barkod okuma damgası)
- İstemci tarafı buton disable'ı **koruma sayılmaz**; raporda böyle belirt.

### B.4 Kuyruk, olay ve entegrasyon

- Kuyruk varsa **at-least-once**tir. Consumer idempotent mi? İşlenen mesaj id'leri unique kısıtlı bir tabloda tutuluyor mu?
- ACK sırası: iş commit edildikten **sonra** mı ACK? Öncesiyse mükerrer/kayıp.
- **Dual write**: DB'ye yaz + kuyruğa/dış sisteme gönder atomik değildir. **Outbox** deseni var mı? Yoksa: commit sonrası broker down → olay hiç gitmez (sessiz kayıp); gönderim sonrası rollback → hayalet olay.
- BullMQ kullanılıyorsa: job id ile dedup var mı, `attempts`/backoff ayarları, failed job'ların akıbeti izleniyor mu?

**Entegrasyon kaynaklı mükerrerler — ERP'de bir numaralı kaynak:**
- Excel/CSV içe aktarma: aynı dosya iki kez yüklenirse? Dosya hash'i veya satır doğal anahtarı var mı? Kısmi başarı sonrası tekrar yükleme?
- El terminali / kantar offline senkron: cihaz benzersiz kayıt id'si üretiyor mu?
- MES/PLC üretim sayacı **kümülatif mi artımlı mı** okunuyor? Artımlıysa tekrar okuma çift sayım; kümülatifse sayaç sıfırlanması eksi üretim yaratır.
- Banka ekstresi: banka referans no üzerinde tekillik var mı?
- **Zamanlanmış senkron watermark'ı**: "son çalışmadan sonrakileri çek" mantığında `>` mü `>=` mi? `>` ile aynı saniyedeki kayıtlar kaybolur, `>=` ile mükerrer olur. Doğrusu id/cursor tabanlı ilerlemedir. **Bu hatayı özellikle ara.**

### B.5 Mantıksal mükerrer ana veri

Aynı cari farklı unvan yazımıyla, aynı stok farklı kodla açılmış olabilir. VKN doğrulama + tekillik kontrolü var mı? Mevcut mükerrer oranını ölç ve raporla.

---

## C. VERİ MODELİ VE KISITLAR  `[P4]`

- **FK varlığı**: `relationMode` kontrolü + migration SQL'lerinde `FOREIGN KEY` araması. Yoksa yetim kayıt taraması yap:
  ```sql
  SELECT COUNT(*) FROM stok_hareket sh LEFT JOIN stok_kart sk ON sk.id = sh.stok_id WHERE sk.id IS NULL;
  ```
  Aynı taramayı tüm ilişkiler için üret.
- `onDelete` davranışları: ERP'de `Cascade` tehlikelidir (stok kartı silinince hareketler silinmemeli). `Restrict`/`NoAction` beklenir.
- **Para/miktar tipi**: `schema.prisma`'da `Float` aranır. Para veya miktar `Float` ise **S0** — yuvarlama hataları maliyeti ve mutabakatı bozar. `Decimal @db.Decimal(p,s)` olmalı.
  ```bash
  rg -n "Float" prisma/schema.prisma
  rg -n "Decimal" prisma/schema.prisma
  ```
  Prisma `Decimal` JS tarafında `Decimal.js` nesnesidir; **koda `Number()` ile dönüştürülüp hesaplanıyorsa kazanç sıfırdır** — bunu ara:
  ```bash
  rg -n "Number\(|parseFloat\(|toNumber\(\)" -g '!*.test.ts'
  ```
  Bu, Prisma projelerinde çok sık görülen sessiz para hatasıdır.
- **Precision/scale**: birim fiyatta 2 hane yetmez (0,00042 TL/gr). Miktar hanesi birime uygun mu (kg 3, adet 0, metre 2)?
- **Yuvarlama politikası tek yerde mi?** Satır mı yuvarlanıyor, toplam mı? KDV yuvarlama sırası fatura toplamını 1 kuruş kaydırıp e-Fatura reddine yol açar. K7 ajanının "aynı hesap kaç yerde yazılmış" çıktısıyla birleştir.
- **Döviz**: tutar kolonunun yanında para birimi + kur + kur tarihi var mı?
- **Tarih/saat**: UTC mi yerel mi? `DateTime` alanları timezone'lu mu? **İş günü (business date) ile sistem zamanı ayrımı var mı** — gece vardiyası 23:50'de bildirim yaparsa hangi güne yazılır? Ay sonunda dönem kaydırır.
- **Durum alanları**: enum mu, serbest string mi? Serbest string yazım hatasıyla veri bozar.
- **Denormalize alanlar** (stok bakiye, cari bakiye, sipariş kalan): hareketlerle tutuyor mu? **Mutabakat sorgusu çalıştır — bu denetimin en değerli tek çıktısıdır:**
  ```sql
  SELECT b.stok_id, b.depo_id, b.miktar AS bakiye,
         COALESCE(SUM(CASE h.yon WHEN 'G' THEN h.miktar ELSE -h.miktar END),0) AS hesaplanan,
         b.miktar - COALESCE(SUM(CASE h.yon WHEN 'G' THEN h.miktar ELSE -h.miktar END),0) AS fark
  FROM stok_bakiye b LEFT JOIN stok_hareket h
    ON h.stok_id=b.stok_id AND h.depo_id=b.depo_id
  GROUP BY 1,2,3 HAVING b.miktar <> COALESCE(SUM(CASE h.yon WHEN 'G' THEN h.miktar ELSE -h.miktar END),0);
  ```
  Aynısını cari bakiye, sipariş kalan miktar, rezerve miktar ve muhasebe mizanı için de yaz.
- **Audit kolonları** ve değişiklik geçmişi: kritik belgelerde kim ne zaman neyi değiştirdi izlenebiliyor mu? Audit kaydı uygulama tarafından güncellenebiliyor mu (güncellenmemeli)?
- **Soft delete filtresi**: Prisma middleware/extension ile global mi uygulanıyor, yoksa her sorguda elle mi? Elle ise unutulan yerleri ara. `$queryRaw` sorgularında middleware **çalışmaz** — bunları ayrı tara.
- **Şirket/tenant filtresi**: aynı analiz. En sağlamı RLS'tir; kullanılıyor mu?
  ```bash
  rg -n "prisma\.\w+\.(findMany|findFirst|updateMany|deleteMany)" -A 6 | rg -v "sirketId|companyId|tenantId"
  ```
  Bu taramanın çıktısı gürültülü olacaktır; ajan elle ayıklamalı ve gerçek boşlukları raporlamalıdır.

---

## D. TRANSACTION SINIRLARI VE TUTARLILIK

- Bir iş biriminin tüm parçaları tek transaction'da mı? (irsaliye başlığı + satırlar + stok hareketi + rezervasyon düşümü)
- Transaction dışında kalan yazmalar (A.4'teki `prisma` vs `tx` taraması).
- Yan etkiler commit sonrasına alınmış mı? (e-posta, webhook, dosya, dış sistem çağrısı) Rollback edilemeyen yan etki transaction içindeyse bulgu.
- Read replica varsa: kullanıcı kaydettiğini hemen görebiliyor mu?
- Mikroservis/ayrık servis varsa: telafi (compensation) tanımlı mı, telafi başarısız olursa ne oluyor?

---

## E. ERP İŞ KURALI DEĞİŞMEZLERİ  `[P0/P1]`

Her madde için dörtlü uygula: **kural kodda var mı → eşzamanlılık altında korunuyor mu → DB kısıtı destekliyor mu → mevcut veride ihlal var mı**

**Stok/Depo**
- Negatif stok engelleniyor mu, kontrol atomik mi? Negatife izin bilinçli politika mı, eksiklik mi?
- `rezerve_miktar ≤ mevcut_miktar` korunuyor mu? Ölü rezervasyonlar birikiyor mu?
- Depo transferi çıkış+giriş tek transaction mı? Eşleşmeyen transferleri sorgula.
- Lot/seri: bir seri no aynı anda iki depoda olabiliyor mu? SKT geçmiş lot sevk edilebiliyor mu? FEFO tüketimi aynı lotu iki işe verebilir mi?
- **Birim çevrimi**: hareketler temel birime normalize ediliyor mu? Çevrim faktörü değişince geçmiş hareketler bozuluyor mu (faktör versiyonlanmalı)?
- Sayım sırasında hareket girişi donduruluyor mu? Sayım farkı atomik mi?

**Üretim**
- İş emri durum makinesi zorlanıyor mu? Eşzamanlı durum değişikliği?
- BOM: döngüsel referans engelleniyor mu (yoksa MRP sonsuz döngü)? BOM versiyonu iş emrinde saklanıyor mu — saklanmıyorsa BOM değişince geçmiş maliyet değişir, **kritik**.
- Üretim bildirimi + backflush tek transaction mı? Bileşen stoğu yetersizse ne oluyor?
- Aynı bildirim iki kez girilebilir mi (el terminali/MES)?
- Aynı makineye çakışan saatte iki iş emri (write skew)?
- MRP: iki koşu paralel çalışabilir mi, yarıda kesilirse yarım veri kalır mı, mükerrer planlı emir üretir mi?

**Satınalma / Satış / Sevkiyat**
- **Kalan miktar aşımı**: iki eşzamanlı irsaliye sipariş miktarını aşabilir mi? (En olası bulgu, mutlaka repro et.)
- Bir irsaliyeden iki kez fatura kesilebilir mi? İşaretleme atomik mi?
- İade miktarı sevk miktarını aşabilir mi?
- Kredi limiti kontrolü eşzamanlı siparişte aşılabilir mi (write skew)?
- Fiyat hangi anda donuyor? Fiyat listesi geçerlilik aralıkları çakışıyor mu, seçim deterministik mi? İskonto/kampanya/sözleşme önceliği tek yerde mi hesaplanıyor?

**Finans / Muhasebe**
- `SUM(borç) = SUM(alacak)` — kodda ve veride kontrol et.
- **Dönem kapanışı**: kapalı döneme kayıt atılabiliyor mu? Kontrol **her yazma yolunda** mı yoksa sadece bir serviste mi? Kapanış sırasında eşzamanlı kayıt girilebilir mi?
- Fatura numarası ardışıklığı (A.6).
- KDV/tevkifat hesabı, yuvarlama, oran versiyonlaması.
- Ödeme eşleştirme: aynı ödeme iki faturaya kapatılabilir mi? Kapatma tutarı aşabilir mi?
- Maliyet: FIFO/ortalama katmanları eşzamanlı hareketlerde doğru tüketiliyor mu? Geriye dönük hareket girilince yeniden hesaplama atomik mi? Dönem sonu maliyet koşusu iki kez çalışırsa maliyet ikiye katlanır mı?
- **e-Fatura**: gönderim idempotent mi? "GİB'e gitti ama DB'ye yazılamadı" durumu nasıl ele alınıyor? (Klasik dual-write, mevzuat riski, **S0**.) Durum mutabakat işi var mı?

**Yetki / onay**
- Aynı kişi hem oluşturup hem onaylayabiliyor mu (görevler ayrılığı)?
- Onay limitleri kodda zorlanıyor mu? Eşzamanlı çift onay belgeyi iki kez ilerletir mi?
- Onaylanmış belge sonradan değiştirilebiliyor mu, onay düşüyor mu?

---

## F. EXPRESS / API KATMANI  `[P3]`

- **Express sürümü kritik**: Express 4'te `async` handler'daki hata `next()`e gitmez → **unhandled rejection**, istek asılı kalır veya süreç çöker. `express-async-errors` veya `asyncHandler` sarmalayıcısı var mı? Sarmalayıcısız async route'ları listele — **bu, sessiz hata yutmanın bir numaralı kaynağıdır**:
  ```bash
  rg -n "router\.(get|post|put|patch|delete)\(.*async" 
  rg -n "express-async-errors|asyncHandler|catchAsync"
  ```
- Global error handler var mı (4 argümanlı middleware)? Hata gövdesinde stack/SQL sızıyor mu?
- **Auth middleware kapsaması**: K1'in rota envanterini al, auth middleware'i olmayan rotaları listele. Bu liste doğrudan bulgu üretir.
- **Validation**: zod/joi/class-validator var mı, tüm yazma uçlarında mı? Yoksa tip güvenliği çalışma zamanında yoktur.
- **Mass assignment**: `req.body` doğrudan Prisma `data`'ya geçiriliyor mu?
  ```bash
  rg -n "data:\s*req\.body|\.\.\.req\.body"
  ```
  Geçiyorsa client `fiyat`, `durum`, `sirketId`, `onaylandi` gibi alanları set edebilir → **S0**.
- **Sayfalama tutarlılığı**: `skip/take` (offset) ile sayfa gezinirken veri değişirse kayıt tekrarlanır veya atlanır. Dışa aktarma/senkronda mükerrer/kayıp üretir. Cursor tabanlı sayfalama ve deterministik `orderBy` (tie-breaker `id`) var mı?
- **Toplu uçlar**: kısmi başarı semantiği tanımlı mı? Client retry ettiğinde başarılı satırlar tekrar işlenir mi?
- Timeout, retry backoff+jitter, circuit breaker; yavaş entegrasyon tüm event loop'u/pool'u tüketebiliyor mu?
- N+1: Prisma'da `include` eksikliği veya döngü içinde sorgu.
  ```bash
  rg -n "for\s*\(|\.map\(async" -A 8 | rg -n "await prisma\."
  ```
- Uzun süren iş (MRP, rapor) senkron HTTP içinde mi? Timeout sonrası kullanıcı tekrar tetiklerse mükerrer koşu.
- `res.json` commit'ten önce mi gönderiliyor?

---

## G. GÜVENLİK VE YETKİLENDİRME  `[P2]`

- **IDOR/BOLA**: `/api/fatura/:id` çağrısında kaydın kullanıcının şirketine ait olduğu doğrulanıyor mu? Her nesne erişiminde sahiplik kontrolü ara — kaçırılan bir numaralı açıktır.
- Fonksiyon seviyesi yetki: onaylama, maliyet görme, fiyat değiştirme, dönem kapatma.
- Alan seviyesi yetki: maliyet/kâr marjı herkese dönüyor mu?
- **SQL injection**: `$queryRawUnsafe` / `$executeRawUnsafe` kullanımları; `$queryRaw` template literal'i **parametreleştirir**, `Unsafe` versiyonları etmez.
  ```bash
  rg -n "\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\("
  ```
  Dinamik `ORDER BY`/filtre üreten rapor motorları whitelist kullanıyor mu?
- Sırlar: `.env`, connection string, API anahtarı repoda mı? Git geçmişinde sır var mı?
- Toplu dışa aktarma: bir kullanıcı tüm cari/stok/fiyat listesini indirebilir mi, loglanıyor mu?
- KVKK: kişisel veri envanteri, loglara TCKN/telefon yazılıyor mu, silme talebi karşılanabiliyor mu?
- DB kullanıcısı süper yetkili mi?
- Dosya yükleme: tip/boyut doğrulama, path traversal, erişim kontrolü.
- Rate limit, brute force koruması, JWT süresi/iptali.

---

## H. PERFORMANS  `[P5]`

- FK kolonlarında index var mı? (Prisma FK'ye otomatik index koyar, ama `relationMode="prisma"` ise koymaz — kontrol et.)
- En pahalı sorgular: `pg_stat_statements` (dev/prod salt-okunur).
- Büyük tablolarda sequential scan; `pg_stat_user_tables`.
- Kullanılmayan/mükerrer index'ler: `pg_stat_user_indexes`.
- Sınırsız büyüyen tablolar (stok hareket, log, audit): partition/arşiv stratejisi var mı? 5 yıl sonra ne olur?
- Connection pool boyutu vs eşzamanlı transaction sayısı; uzun transaction'ların pool'u kilitlemesi.
- Sıcak satır: vardiya başında 40 kişi aynı stok satırını güncelliyorsa kilit kuyruğu.
- `findMany()` sınırsız dönüş; tüm tabloyu belleğe alan kod.
- Ağır raporlar operasyonel DB'de mi koşuyor?

---

## I. HATA YÖNETİMİ VE GÖZLEMLENEBİLİRLİK  `[P3]`

- **Yutulan hatalar** — sessiz veri kaybının bir numaralı sebebi:
  ```bash
  rg -n "catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\{\s*\}|catch.*\{\s*//"
  rg -n "\.catch\(\(\) => \{\}\)|\.catch\(console\.(log|error)\)"
  rg -n "^\s*void \w+\(|(?<!await )\w+Async\(" 
  ```
- Hata yakalanıp `null`/boş dizi dönülüyor mu? Çağıran bunu "veri yok" sanıyor mu?
- Rollback sonrası yan etkiler geri alınabiliyor mu?
- Korelasyon id (request id) uçtan uca taşınıyor mu?
- **İzleme ve alarm**: mükerrer kayıt, negatif stok, dengesiz fiş, yetim kayıt için otomatik kontrol var mı? Cron'un **çalışmadığı** fark ediliyor mu (sessiz başarısızlık en tehlikelisi)?
- **Mutabakat işleri**: bakiye vs hareket, ERP vs banka, ERP vs e-Fatura, ERP vs MES. Var mı, sonucu izleniyor mu?

---

## J. MIGRATION VE KURTARMA  `[P5]`

- Migration'lar sürümlü mü, elle SQL çalıştırma pratiği var mı?
- `prisma db push` üretimde kullanılıyor mu (kullanılmamalı — migration geçmişi kaybolur)?
- Büyük tabloda kilit riski: `ALTER TABLE`, index oluşturma (`CREATE INDEX CONCURRENTLY` kullanılmış mı?), `NOT NULL` ekleme. Bunlar üretimde fabrikayı durdurabilir.
- Zero-downtime uyumu: kolon silme/rename tek adımda yapılıyorsa eski sürüm uygulama hata verir.
- Backfill scriptleri parçalı mı, tekrar çalıştırılabilir mi, yarıda kalırsa devam edebiliyor mu?
- Yedek: sıklık, saklama, **geri yükleme testi yapıldı mı?** RPO/RTO tanımlı mı?
- Seed verisi mükerrer üretiyor mu?

---

## K. TEST VE BEKÇİLER  `[P6]`

- Mevcut `scripts/test_*.ts` bekçilerini oku: **neyi doğruluyorlar, hangi değişmezleri kapsamıyorlar?** Kapsanmayan değişmezleri listele — bu, ekibe verilecek en somut çıktılardan biridir.
- **Eşzamanlılık testi var mı?** Kritik yazma yolları için `Promise.all` ile paralel istek testi. Yoksa bu başlı başına bir bulgudur.
- Idempotency testi: aynı isteği iki kez gönderme.
- Testler gerçek DB'ye karşı mı çalışıyor? Mock/in-memory ise kilit ve kısıt davranışını taklit etmez → **eşzamanlılık hatalarını gizler**.
- Test verisi izolasyonu, testlerin birbirini etkilemesi.

---

## L. KOD KALİTESİ VE HESAP TEKRARI  `[P1/P6]`

- **Aynı hesabın birden fazla yerde yazılması** (fiyat, KDV, maliyet, metraj, birim çevrimi) — ERP'de en pahalı teknik borç. K7 ajanının envanterinden çıkar ve **formüller arasındaki farkları göster**.
- İş mantığının yeri: controller'da mı, servis katmanında mı, ikisinde birden mi?
- Prisma tuzakları: `Decimal` → `Number` dönüşümü, `include` derinliği, `select` eksikliğinden gelen aşırı veri, `$queryRaw` ile ORM filtrelerinin baypas edilmesi.
- `TODO/FIXME/HACK/geçici` yorumlarını listele — çoğu bilinen ama kaydedilmemiş risktir.
- Ölü kod, kullanılmayan tablo/kolon, tip güvenliği delikleri (`any`, `as unknown as`, `@ts-ignore`).

---

# BÖLÜM 4 — KRİTİK YAZMA YOLU ANALİZİ (ZORUNLU)

## 4.1 Sekiz soru

Her kritik yazma yolu için sırayla cevapla ve raporda tablola:

| # | Soru |
|---|---|
| 1 | Bu işlem hangi değişmezi korumak zorunda? |
| 2 | Tek `$transaction` içinde mi? Sınır nerede başlıyor/bitiyor? |
| 3 | Okuma ile yazma arasında karar veriliyor mu (check-then-act)? |
| 4 | Okunan satır kilitleniyor mu / guard'lı `updateMany` + `count` kontrolü var mı? |
| 5 | Karar tek satır yerine bir küme/aralık üzerindeyse (write skew) nasıl korunuyor? |
| 6 | DB kısıtı (unique/check/FK/exclude) son savunma olarak var mı? |
| 7 | İki eşzamanlı aktörle çizelge kurulduğunda değişmez bozuluyor mu? |
| 8 | Bozuluyorsa fabrikadaki gerçek etkisi ne? |

7'ye "evet" ise bulgu aç ve **repro scripti yaz** (K3).

## 4.2 Kapsanması zorunlu yazma yolları

1. Mal kabul (stok giriş) · 2. Sevkiyat (stok çıkış) · 3. Depo transferi · 4. Rezervasyon oluştur/iptal ·
5. Üretim bildirimi + backflush · 6. İş emri durum değişimi · 7. Sipariş → irsaliye (kalan düşümü) ·
8. İrsaliye → fatura · 9. Belge numarası üretimi · 10. Yevmiye fişi oluşturma · 11. Ödeme/tahsilat eşleştirme ·
12. Dönem kapatma · 13. Envanter sayım kapatma · 14. MRP / maliyet koşusu · 15. e-Fatura gönderimi ·
16. Her entegrasyon içe aktarma yolu · 17. Fiyat listesi / iskonto güncelleme · 18. Kullanıcı-rol-yetki değişikliği

## 4.3 Senaryo turu için gerçek fabrika akışları

Tur 3'te bu akışları uçtan uca izle ve her adımda 8 soruyu uygula:

- Vardiya başında 40 el terminalinden eşzamanlı mal kabul
- Aynı siparişten iki depodan paralel sevkiyat
- Üretim bildirimi tam olarak stok biterken geliyor
- Ay sonu kapanışı sırasında geç gelen irsaliye
- e-Fatura gönderimi timeout alıyor, kullanıcı tekrar deniyor
- El terminali offline çalışıp 2 saat sonra 300 kaydı senkronize ediyor
- MRP koşusu sürerken planlamacı BOM değiştiriyor
- Sayım açıkken depoya mal giriyor
- Pod restart'ı, bir `$transaction` tam ortasında gerçekleşiyor

---

# BÖLÜM 5 — BULGU FORMATI

## 5.1 Markdown

```markdown
### [BULGU-042] Sipariş kalan miktar kontrolü yarışa açık

| Alan | Değer |
|---|---|
| Şiddet | S0 — Kritik |
| Kategori | A.1 Check-then-act |
| Öncelik sınıfı | P0 |
| Modül | Satış / Sevkiyat |
| Kanıt seviyesi | K3 (dev DB'de repro edildi) |
| Çürütme sonucu | 3 çürütücü, 0 kanıtlı çürütme — ayakta |
| Durum | Açık |

**Özet**
İrsaliye oluşturulurken sipariş satırının kalan miktarı `findFirst` ile kilitsiz okunuyor,
kontrol sonrası `update` ile yazılıyor. İki sevkiyat görevlisi aynı siparişten aynı anda
irsaliye kestiğinde sipariş miktarından fazla mal sevk edilebiliyor.

**Kanıt**
- `src/modules/sevkiyat/sevkiyat.service.ts:118-146` — kilitsiz oku-karar ver-yaz
- `prisma/schema.prisma:412` — `SiparisSatir`'da version alanı yok
- `prisma/migrations/**` — kalan miktarı koruyan CHECK yok (Prisma CHECK desteklemiyor, raw migration da eklenmemiş)
- `ecosystem.config.js:8` — PM2 cluster, 4 instance
- DB izolasyon seviyesi: read committed (doğrulandı)

**Çakışma senaryosu**
T1 A:findFirst→100 · T2 B:findFirst→100 · T3 A:100>=80 ✓ · T4 B:100>=60 ✓
T5 A:update(20);COMMIT · T6 B:update(40);COMMIT → 140 sevk, kalan 40 görünüyor

**Repro (K3)**
`scripts/audit_repro_042.ts` — 2 paralel çağrı, 10 tekrar.
Çıktı: 10/10 denemede toplam sevk sipariş miktarını aştı. Ek: `docs/history/denetim-2026-08/repro/042.log`

**Veride fiili ihlal (K2)**
```sql
SELECT ss.id, ss.miktar, SUM(d.miktar) sevk
FROM siparis_satir ss JOIN irsaliye_detay d ON d.siparis_satir_id = ss.id
GROUP BY 1,2 HAVING SUM(d.miktar) > ss.miktar;
```
Dev DB: 17 satır. Prod (salt-okunur): 4 satır. Ek: `docs/history/denetim-2026-08/data/042.csv`

**İş etkisi**
Müşteriye siparişten fazla mal sevk edilir; stok ve cari bakiye hatalı olur; fazla sevkiyat
faturasız çıkabilir. Ay sonu mutabakatında açıklanamayan fark oluşur.

**Öneri (ikinci tur için)**
1. Guard'lı atomik update + `count === 0` kontrolü
2. Raw migration ile `CHECK (sevk_edilen <= miktar * (1 + tolerans))`
3. `scripts/test_sevkiyat_concurrency.ts` bekçisi olarak repro scriptinin kalıcılaştırılması
4. Mevcut 4 prod kaydı için finans onaylı düzeltme prosedürü

**Kabul kriteri**
İki paralel istekte ikincisi iş hatası alır; `SUM(sevk) <= siparis.miktar` her koşulda korunur.

**Efor**: 2 gün kod + 1 gün veri düzeltme
```

## 5.2 JSON (`docs/history/denetim-2026-08/findings.json`)

```json
{
  "id": "BULGU-042",
  "baslik": "...",
  "siddet": "S0",
  "kategori": "A.1",
  "oncelik": "P0",
  "modul": "Satis.Sevkiyat",
  "kanit_seviyesi": "K3",
  "kanit": [{"tur":"kod","yol":"src/...","satir":"118-146","not":"..."}],
  "cakisma_senaryosu": "T1 ... T6 ...",
  "repro_script": "scripts/audit_repro_042.ts",
  "veride_ihlal": {"dev": 17, "prod": 4, "sorgu": "SELECT ..."},
  "etkilenen_degismez": "SUM(sevk) <= siparis.miktar",
  "is_etkisi": "...",
  "curutme": {"denenen": 3, "kanitli_curutme": 0, "sonuc": "ayakta", "notlar": []},
  "oneriler": [{"vade":"kisa","aciklama":"..."}],
  "kabul_kriteri": "...",
  "efor_gun": 3
}
```

---

# BÖLÜM 6 — ŞİDDET

| Kod | Ad | Tanım |
|---|---|---|
| **S0** | Kritik | Sessiz veri bozulması, mali kayıp, mevzuat ihlali veya veri kaybı. Üretimde büyük olasılıkla zaten oluşmuştur. |
| **S1** | Yüksek | Ciddi tutarsızlık veya güvenlik açığı; belirli koşullarda tetiklenir. |
| **S2** | Orta | Operasyonel sorun, hatalı rapor, performans bozulması. |
| **S3** | Düşük | Teknik borç, bakım zorluğu. |
| **S4** | Bilgi | Gözlem / iyileştirme fırsatı. |

**Matris**

| Etki \ Olasılık | Düşük | Orta | Yüksek |
|---|---|---|---|
| Kritik (mali/mevzuat/veri kaybı) | S1 | S0 | S0 |
| Yüksek (tutarsız veri) | S2 | S1 | S0 |
| Orta (operasyonel) | S3 | S2 | S1 |
| Düşük | S3 | S3 | S2 |

**Düzeltici kurallar**
- Hata sessizce oluşuyor ve hiçbir alarm/mutabakat yakalamıyorsa → **bir kademe yükselt**.
- Kullanıcı anında net hata alıyorsa → bir kademe düşür.
- Kanıt seviyesi K1'de kalan bulgu **S1'i geçemez**. S0 için K2 veya K3 zorunlu.
- Olasılık değerlendirmesinde işlem hacmini, gerçek eşzamanlılığı (vardiya başı yığılma), instance sayısını ve retry/entegrasyon varlığını hesaba kat.

---

# BÖLÜM 7 — RAPOR YAPISI

```
1. YÖNETİCİ ÖZETİ (max 2 sayfa, teknik olmayan dille)
   1.1 Kapsam ve tarih  1.2 Genel risk seviyesi
   1.3 En kritik 5 bulgu ve fabrikaya etkisi
   1.4 Veride tespit edilen fiili tutarsızlıklar (sayılarla)
   1.5 Öncelikli aksiyon listesi

2. METODOLOJİ VE SINIRLAMALAR
   2.1 Ajan yapısı ve tur sayısı  2.2 Kanıt seviyeleri dağılımı
   2.3 Kanıt boşlukları / erişilemeyenler  2.4 Varsayımlar

3. SİSTEM ANLAYIŞI
   3.1 Doğrulanmış teknik künye  3.2 Mimari ve veri modeli özeti
   3.3 Kritik yazma yolları haritası  3.4 İş değişmezleri envanteri

4. BULGU ÖZET TABLOSU
   ID | Başlık | Kategori | Şiddet | Kanıt sev. | Veride ihlal | Efor

5. AYRINTILI BULGULAR (A–L, şiddet sırasına göre)

6. KRİTİK YAZMA YOLU MATRİSİ (8 soruluk tablo)

7. VERİ SAĞLIK RAPORU
   Çalıştırılan tüm doğrulama sorguları, sonuç sayıları, örnek kayıtlar

8. ÇÜRÜTME KAYDI
   8.1 Ayakta kalan bulgular  8.2 Elenen bulgular ve eleme gerekçeleri
   8.3 Şiddeti düşürülenler

9. KÖK NEDEN ANALİZİ
   (örn. "DB kısıtlarına hiç güvenilmiyor — Prisma CHECK/partial index
    desteklemediği için raw migration yazılmamış", "eşzamanlılık hiç
    düşünülmemiş", "idempotency altyapısı yok", "mutabakat kültürü yok")

10. YOL HARİTASI
    Acil (0-2 hafta) / Kısa (1-2 ay) / Orta (3-6 ay) / Uzun

11. VERİ ONARIM PLANI
    Bozuk kayıtlar, kim hangi onayla nasıl düzeltecek

12. ÖNERİLEN KALICI KONTROLLER
    12.1 Eklenecek DB kısıtları (raw migration taslakları) [PROD'DA ÇALIŞTIRMA]
    12.2 Eklenecek mutabakat işleri ve alarmlar
    12.3 Kalıcılaştırılacak eşzamanlılık bekçileri (scripts/test_*.ts)
    12.4 Ekibe verilecek kod inceleme kontrol listesi

EKLER: A. Tüm sorgular  B. Repro scriptleri ve çıktıları
       C. Ajan çıktı haritaları  D. Terimler sözlüğü
```

---

# BÖLÜM 8 — KURALLAR VE YASAKLAR

**Yap**
- Her bulguda fabrika gerçekliğine dön: depoda, üretimde, muhasebede ne olur?
- Önce veride fiili ihlal ara; "olabilir" ile "17 kayıtta olmuş" arasındaki fark raporun tüm gücüdür.
- Kök nedenleri grupla; 40 bulgu değil "7 kök neden, 40 belirti" sun.
- Ekibin doğru yaptıklarını da yaz — hem raporun güvenilirliğini artırır hem o kalıpların korunmasını sağlar.
- Belirsizlikte varsayımı `[VARSAYIM]` etiketiyle yaz ve devam et; denetimi durdurma.

**Yapma**
- Kanıtsız bulgu ("muhtemelen", "genelde böyle olur").
- Prod'a yazma, DDL, uzun kilit alan sorgu, migration.
- Üretim kodunu değiştirme, refactor, düzeltme yazma (bu tur salt-okunur).
- Şiddet enflasyonu veya deflasyonu.
- Bulunan sırrı/kişisel veriyi rapora kopyalama — yerini belirt, içeriğini yazma.
- Kontrol maddesini sessizce atlama.

---

# BÖLÜM 9 — BAŞLA

Şimdi sırasıyla:

1. Bölüm 1.3'teki teknik künyeyi **repodan okuyarak** doldur; `relationMode`, Express sürümü, instance sayısı ve izolasyon seviyesini özellikle doğrula.
2. `express-api-audit` beceri paketini yükle.
3. ① KEŞİF aşamasını paralel ajanlarla çalıştır; sonunda **Varlık × Yazma Yolu × Değişmez matrisini** ve kritik yazma yolu listesini bana göster, onay bekle.
4. Onay sonrası ②→③→④ döngüsünü doygunluğa kadar sürdür.
5. ⑤ SENTEZ ile Bölüm 7 yapısında raporu üret; `docs/history/denetim-2026-08/findings.json` ve repro scriptlerini bırak.
6. Raporu şununla bitir: uygulanamayan kontroller, ihtiyaç duyulan ek kanıt, ikinci tur (düzeltme) için önerilen sıra.

Uzunluk sınırı yoktur. Eksiksizlik kısalıktan, kanıt iddiadan önceliklidir.
