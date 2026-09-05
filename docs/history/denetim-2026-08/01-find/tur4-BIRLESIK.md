# Tur 4 — Birleştirilmiş Bulgu Listesi

Kaynak: `audit/01-find/tur4-*.md` (34 ham bulgu, denetçiler E-1/E-2/E-3).
Yöntem: Ç7 (aynı kök neden/aynı kod noktası birleştirme) + önceki turlarla (T1-T3, seen-t1t2t3.json) çakışma eleme.

## Birleştirilmiş Bulgular (26)

| Yeni ID | Başlık | Şiddet | Kanıt | Kaynak ID'ler | Dosya | Satır |
|---|---|---|---|---|---|---|
| BULGU-T4-001 | İçe aktarımda tarih hücresi takvimi doğrulamıyor: '31.02.2026' sessizce 3 Mart olur, 2 haneli yıl / sayısal hücre yanlış okunur | S2 | K3 | E-1-02, E-2-01 | Teks-Erp/src/services/import/import-coerce.ts | 71-98 |
| BULGU-T4-002 | "Tarih-yalnız" alanlar UTC gece yarısına çakılıyor — bugün terminli sipariş 400 alır, termin gününde kapanan sipariş OTIF'te GEÇ sayılır | S2 | K3 | E-1-03 | Teks-Erp/src/services/order.service.ts | 955-964, 1848-1855 |
| BULGU-T4-003 | "Aynı clientToken, FARKLI gövde" idempotency kuralı yalnız 4 uçta var — Tambur depo kesimi, açık kumaş kesimi/oluşturma, çuval açma ikinci FARKLI isteğe "başarılı" diyor | S2 | K1 | E-2-02 | Teks-Erp/src/services/tambur.service.ts | 2276-2300 (ikiz 2970-2990; inventory.service.ts:4217-4234; shipping.service.ts:181-215) |
| BULGU-T4-004 | apply-attribute-to-rolls top sayısını sınırlamıyor — N seri transaction istemci bütçesini ve kapanış penceresini aşar, failed[] kimseye ulaşmaz | S2 | K1 | E-3-05 | Teks-Erp/src/controllers/workorder.controller.ts | 265-270 (döngü: workorder-link.service.ts:783-807) |
| BULGU-T4-005 | Toplu etiket (2000 top tavanı) tek-process sunucuda CPU+bellek tepesi üretiyor; 15s'de vazgeçilen istek tekrar basışta işi ÇOĞALTIYOR, OOM restartına kadar gidebiliyor | S2 | K1 | E-3-08 | Teks-Erp/src/controllers/label.controller.ts | 19, 41 (servis: label.service.ts:1122-1136, 1170-1195) |
| BULGU-T4-006 | Yazıcı çıktısı alındıktan sonra ağ koparsa labelPrintedAt yazılmaz — mükerrer paneli YANLIŞ topu "asıl" önerir | S2 | K1 | E-3-09 | Teks-Erp/src/services/label.service.ts | 2075-2118 (tüketici: duplicate-rolls.service.ts:210-213) |
| BULGU-T4-007 | Masaüstü güncelleme kapısı koşulsuz — minVersion yükseltilir ve yayın sunucusuna erişilemezse panel çıkışsız kilitlenir | S2 | K1 | E-3-13 | Electron/src/components/layout/UpdateGate.tsx | 63-67, 130 |
| BULGU-T4-008 | Audit arşiv kesme tarihi `setMonth` ile ay uzunluğunu taşıyor — ayın 29/30/31'inde "6 ay" fiilen kısalır, o günlerin logu erken arşivlenir | S3 | K3 | E-1-01 | Teks-Erp/src/services/audit.service.ts | 204-206 |
| BULGU-T4-009 | Süreli yetki "gün sonu" değil sabah 03:00'ta biter ve "bugüne kadar" yetki verilemez — gece vardiyasının ortasında sessiz 403 | S3 | K3 | E-1-04 | Teks-Erp/src/routes/admin.routes.ts | 332, 339-341 |
| BULGU-T4-010 | Belge numarası GGAAYY taşıyor → sözlüksel sıra kronolojik DEĞİL; ayrıca 9999'u aşan sıra biçim sözleşmesini sessizce kırıyor | S3 | K3 | E-1-05 | Teks-Erp/src/utils/code-format.ts | 33-35, 82-89, 109-112 |
| BULGU-T4-011 | KK1 giriş damgası kelepçeyi aşınca sessizce sunucu saatine düşüyor — bozuk saatli tablette çevrimdışı kuyruk boşalınca meşru toplar 409 fırtınası üretir | S3 | K1 | E-1-07 | Teks-Erp/src/services/helpers/duplicate-guard.helper.ts | 36, 42, 113-127 |
| BULGU-T4-012 | Gün sınırı tek kaynağa taşındı ama gösterim/belge-no tarafındaki 15 nokta hâlâ süreç saat dilimine bağlı ve TZ pinlenmemiş — gece 00:00-03:00'te kâğıt ile kod farklı gün söyleyebilir | S3 | K1 | E-1-08 | Teks-Erp/src/services/return.service.ts | 1084-1086 (+ 14 render noktası) |
| BULGU-T4-013 | Aynı fiziksel alanın üst sınırı uçtan uca dört farklı: kumaş eni bir uçta 1000 cm, ötekinde 999.999.999, üçüncüsünde SINIRSIZ | S3 | K1 | E-2-03 | Teks-Erp/src/controllers/workorder.controller.ts | 268, 272, 279-281, 297-299 (+ subcontractor.controller.ts:77,85,119,159,160; kartela.controller.ts:23-24,38-39) |
| BULGU-T4-014 | positive() alt sınırı yanıltıcı: 0 reddedilir ama 0,0004 kabul edilir ve Decimal(12,3) onu 0,000'a yuvarlar — sıfır metrajlı canlı top doğar | S3 | K1 | E-2-04 | Teks-Erp/src/controllers/inventory.controller.ts | 23 (+ tambur.controller.ts:34,81,133; subcontractor.controller.ts:119,159; tambur.service.ts:736-738) |
| BULGU-T4-015 | DB restartı/ağ kopması/statement_timeout/bağlantı tavanı 503 değil generic 500 üretiyor — pg adapter'ın haritalamadığı SQLSTATE'ler (NUL bayt, deadlock, P1001/P1008/P1017/P2037/P2039) çıplak 500'e düşüyor | S3 | K1 | E-3-03, E-2-06 | Teks-Erp/src/middlewares/error.middleware.ts | 148-169, 530-536, 560-586, 600-634 (+195-210,355-356,504-513,609-633) |
| BULGU-T4-016 | İçe aktarım sayı okuması iki yereli desteklediğini söylüyor ama '1e5' → 15, '1,234,567' → null | S3 | K1 | E-2-07 | Teks-Erp/src/services/import/import-coerce.ts | 31-52 |
| BULGU-T4-017 | Sunucu saati geriye kayarsa gece yedeği sessizce atlanır — tek bir log satırı bile yazılmaz | S3 | K1 | E-3-10 | Teks-Erp/src/jobs/backup-scheduler.ts | 93-102 |
| BULGU-T4-018 | /health status alanı sabit 'UP' — DB düşükken, disk dolarken, havuz zaman aşımı alırken ve yedek eskiyken de UP der; hiçbir metrik bir hükme dönüşmüyor | S3 | K1 | E-3-11 | Teks-Erp/src/app.ts | 398-419, 479-493 |
| BULGU-T4-019 | pool.on('error') yalnız konsola yazıyor — DB bağlantı düşmeleri hiçbir sayaca, audit'e ya da /health'e girmiyor | S3 | K1 | E-3-12 | Teks-Erp/src/lib/prisma.ts | 75-82 |
| BULGU-T4-020 | Fason kabulünde barkod sayacı rezervasyonu transaction'ın içinde — 300 parça tavanında F tipi sayaç satırı tx boyunca kilitli kalır, Tambur kesim/finalize kuyruğa girer | S3 | K1 | E-3-14 | Teks-Erp/src/services/subcontractor.service.ts | 3046-3050 (helper: roll-barcode.helper.ts:82-88) |
| BULGU-T4-021 | mobil/app.json sürümü 1.0.0, build.gradle versionName 2.9.9 — sürüm kapısının karşılaştırdığı değer belirsiz | S3 | K1 | E-3-15 | mobil/app.json | 5 (ayrıca build.gradle:95-96) |
| BULGU-T4-022 | Barkod sayacının 9999 tavanı ARTIŞTAN SONRA kontrol ediliyor: reddedilen çok-segmentli rezervasyon günün kalan kapasitesini kalıcı olarak yakıyor | S4 | K1 | E-2-05 | Teks-Erp/src/services/helpers/roll-barcode.helper.ts | 82-94 |
| BULGU-T4-023 | parseBool: ASCII yazımlı 'hayir' tanınmıyor — 'aktif/pasif' için iki yazım eklenmiş, 'hayır' için unutulmuş | S4 | K1 | E-2-08 | Teks-Erp/src/services/import/import-coerce.ts | 54-63 |
| BULGU-T4-024 | İçe aktarım enum hücresi Türkçe katlamayla eşleştiriliyor: 'internal'/'critical' küçük harfle yazılınca reddediliyor | S4 | K1 | E-2-09 | Teks-Erp/src/services/import/import.service.ts | 93-104 |
| BULGU-T4-025 | PATCH /reason-presets/reorder mükerrer id'yi elemiyor: kontrol kümeye değil DİZİ uzunluğuna bakıyor, bir satır hiç sıralanmıyor | S4 | K1 | E-2-10 | Teks-Erp/src/services/reason-preset.service.ts | 497-513 |
| BULGU-T4-026 | nextDailySeq tavansız: 9999'dan sonra üretilen belge kodu kendi tarama biçim doğrulamasından (isDailyCode) düşüyor | S4 | K1 | E-2-11 | Teks-Erp/src/utils/code-format.ts | 96-112 |

## Önceki Turlarda Görülüp Düşürülen (6)

| Yerel ID | Seen ID | Gerekçe |
|---|---|---|
| E-1-06 | BULGU-T2-034 | Aynı kök neden: finalizedAt/statusChangedAt trigger'ı now()=tx başlangıcı yazıyor, damga doğuştan önce olabiliyor. T2-034 zaten prod ölçümüyle (955/2431 top) kanıtlamış; E-1-06 yeni kanıt getirmiyor. |
| E-3-01 | BULGU-T1-008 | Birebir aynı bug ve aynı satır aralığı: ImportRun replay anahtarı en sonda yazılıyor, 15 sn timeout sonrası dosyanın tamamı ikinci kez yazılıyor. |
| E-3-02 | BULGU-T2-007 | Aynı kök neden: fason kabulde clientToken her denemede yeniden üretiliyor — T2-007 aynı bug'ı zaten işaretlemiş (istemci/servis tarafı ayrımı yeni bir bulgu üretmiyor). |
| E-3-04 | BULGU-T1-102 | Birebir aynı bulgu: birleştirmenin 120sn tx bütçesi DB'nin 50sn statement_timeout'unu aşıyor, 200k satırlık eşik DB'nin vermeyeceği söz. |
| E-3-06 | BULGU-T1-105 | Aynı kod ve aynı kusur: Sipariş Bağla (override) zincirinin atomik olmaması — son adım düşerse plan değişmiş, bağ kurulmamış kalıyor. |
| E-3-07 | BULGU-T1-037 (elendi) | T1-037 ÇÜRÜTÜLDÜ statüsünde: SEPARATE dalı HTTP'den erişilemez ölü kod olduğu ve girdi validasyonunda elendiği kanıtlandı. E-3-07 bu çürütmeyi ele almıyor, yeni kanıt getirmiyor — yeniden açılmadı. |
