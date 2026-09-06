# TUR 1 — BİRLEŞİK BULGU DEFTERİ

239 ham bulgu → **168 birleşik bulgu**. 122 ham bulgu 51 kümede birleştirildi; **hiçbir bulgu düşürülmedi, hiçbir bulgu eklenmedi**.

Önceki turlarda görülenler listesi (`seen`) BOŞ verildiği için `dropped_as_seen` boştur.

## Özet

| Şiddet | Adet |
|---|---|
| S1 | 24 |
| S2 | 65 |
| S3 | 60 |
| S4 | 19 |
| **Toplam** | **168** |

| Kanıt sev. | Adet |
|---|---|
| K3 | 18 |
| K2 | 64 |
| K1 | 85 |
| K0 | 1 |

## Uygulanan birleştirme kuralları

- **Ç7-1 — aynı dosya+satır(±15) VE aynı kusur → tek bulgu.** En yüksek kanıt seviyesi ve en somut `failure_mode` korundu; `kanit[]` birleştirilip tekrarlar ayıklandı; `merged_from` tüm yerel idleri taşıyor.
- **Ç7-2 — aynı kök neden farklı dosyalarda → TEK bulgu**, kanıt listesinde tüm yerler. Örnekler: iptal izi yazmayan altı yol (BULGU-T1-033), enum tüketicilerinin fail-open olması (BULGU-T1-099), 8022↔WO kilit sırası ailesi (BULGU-T1-027), replay statü kapısı beş yolda (BULGU-T1-006).
- **Ç7-3 — aynı satırda farklı kusur → AYRI bulgu.** Bilerek ayrı tutulanlar: `applyManualProperties` metraj pini (001) ↔ statü pini/yetki kapsamı (085); `error.middleware` SQLSTATE haritası (026) ↔ http-errors statüsü (046); `recordPrintEvent` seeded:false yutulması (049) ↔ labelDirty koşulsuz temizleme (063) ↔ istemci retry yokluğu (062); `attachRolls` WO statü guardı (004) ↔ kilit sırası/ABBA (027); `devices/announce` include upsert (151) ↔ rate limit + tavan (118).
- **Ç7-5 — şiddet DEĞİŞTİRİLMEDİ.** Farklı şiddet taşıyan kopyalar birleşirken EN YÜKSEK şiddet korundu; hiçbir bulgu yükseltilmedi (indirmek çürütücülerin işi).
- **Ç7-6 — yeni idler** `BULGU-T1-001`den başlayarak şiddet sırasına göre (S1 → S2 → S3 → S4).

## Bulgular

| Yeni id | Başlık | Şiddet | Kanıt | Modül | Kaynak id'ler |
|---|---|---|---|---|---|
| BULGU-T1-001 | "Düzelt" ekranının mutlak metraj yazımı kesim geçmişini eziyor — kesilmiş toptan yoktan metraj doğuyor (guard yapısal olarak kör, üstelik claim metrajı pinlemiyor) | S1 | K3 | Envanter (Roll) / Tambur | D-A-01, D-E-08, KYY-2-01 |
| BULGU-T1-002 | Tambur aşım kesiminde parent guard'sız yazılıyor: iki eşzamanlı kesim 100 m'lik toptan 240 m çocuk üretir ve aşım defteri 100 m eksik yazar | S1 | K3 | Tambur / envanter | KYY-3-01, D-K-20 |
| BULGU-T1-003 | tambur-undo iş emri satırını hiç kilitlemiyor: iş emri iptaliyle yarışta top, İPTAL EDİLMİŞ iş emrinin SKIPPED adımına IN_PRODUCTION olarak diriltiliyor (ayrıca kardeşlerin tersi kilit sırası) | S1 | K3 | Üretim / Tambur | KYY-1-01, D-A-10 |
| BULGU-T1-004 | attachRolls/quickStart ve manualMove iş emri statüsünü transaction dışında okur: iptal edilen iş emrine canlı top bağlanır | S1 | K3 | İş emri / envanter | KYY-3-02 |
| BULGU-T1-005 | Fason KISMİ kabulde aynı clientToken eşzamanlı gelince idempotent replay yerine 'Barkod üretimi 5 denemede başarısız' 409'u dönüyor — aynı teslimat iki kez düşülüyor (withBarcodeRetry 28/28 çağrı yerinde predicate'siz) | S1 | K3 | Fason | KYY-1-02, D-B-03, D-A-07 |
| BULGU-T1-006 | İptal edilmiş kaydın clientToken'ı replay edilince sunucu 'success:true' + o kaydın kimliğini dönüyor — KK1 ham giriş, sipariş, sevkiyat, çuval ve açık kumaş yollarında idempotency'nin 4. durumu yok (bekçi de yok) | S1 | K3 | KK1 · Sipariş · Sevkiyat · Çuval · Açık kumaş | D-B-01, KYY-2-07, KYY-2-08, D-K-05 |
| BULGU-T1-007 | Ana veri tekillik guard'ları (ad ve katlanmış kod) kilitsiz check-then-act; advisory kilit 4 çağrı yerinin yalnız birinde ve DB seddi 17 nameFold tablosunun 3'ünde — paralel istekler aynı adla/kodla N kayıt üretiyor | S1 | K3 | Ana veri (BaseService + Item + Color + Fason) | D-B-02, KYY-1-03, D-A-12, D-B-08 |
| BULGU-T1-008 | İçe aktarımın replay anahtarı (ImportRun) koşumun SONUNDA yazılıyor: uçuştaki tekrar dosyanın TAMAMINI ikinci kez yazar, kaybeden koşumun izi hiç kalmaz | S1 | K3 | İçe aktarım | D-F-04, D-B-04, D-D-04, KYY-2-13, D-K-23 |
| BULGU-T1-009 | İş emri iptali fason kararını ANA TX'TEN ÖNCE ve telafisiz yazıyor: iptal 409 alsa bile fason sevkleri kapatılmış, fasondaki toplar 'içeride' kalır — hatta HAM STOĞA düşer | S1 | K1 | İş emri / Fason | D-D-01, D-A-08, KYY-2-04 |
| BULGU-T1-010 | Sipariş satırının kalan kapasitesi hiçbir katmanda zorlanmıyor: kapasite OrderLine kilidinden ÖNCE okunduğu için aynı kalem iki kez sevk edilir ve shippedQty sessizce quantity'yi aşar | S1 | K3 | Sevkiyat / Sipariş | D-E-01, KYY-3-03 |
| BULGU-T1-011 | Tambur geri almasıyla iptal edilen kesim çocuğu 'İptali Geri Al' ile diriltilebiliyor — metrajı ebeveyne zaten iade edilmişti, ikinci kez canlanıyor | S1 | K2 | Envanter / Tambur | D-C-01 |
| BULGU-T1-012 | Depo kesimi initialQty'yi de düşürüyor: 'üretim anı snapshot'ı' sözleşmesi kırık, iş emrinin üretilen metrajı geriye dönük azalıyor (IE1408260004: −76,7 m) | S1 | K2 | Üretim / Envanter | D-E-02 |
| BULGU-T1-013 | `admin:users` tek başına HER kullanıcının düz PIN'ini/kart kodunu izsiz okur → yöneticinin kimliğine bürünme | S1 | K2 | Kimlik | D-G-01 |
| BULGU-T1-014 | 6 haneli PIN tek başına kimliktir; tek savunma IP-anahtarlı bellek kilidi → alt ağdan doygunluk, üstelik 3 yönetici hesabının PIN'i var | S1 | K2 | Kimlik | D-G-02 |
| BULGU-T1-015 | CI yalnız `main`'e tetikleniyor; fabrikaya çıkan `adnansahin` dalında 140 commit, 33 migration ve 67 yeni bekçi hiç otomatik koşmadı | S1 | K2 | ops/test | D-K-01, D-J-01 |
| BULGU-T1-016 | Kimlik kapsamasının TEK mekanik bekçisi HEAD'de KIRMIZI: `client-policy` `GET /` muaf listesine yazılmadı, `npm test` exit 1 veriyor | S1 | K1 | ops/test · yetki | D-K-02, D-G-18 |
| BULGU-T1-017 | Para/stok etkili ALTI P0 yazma yolunda tek bir paralel yazma sondası yok — sevkiyat kurma ve sevk onayı dahil | S1 | K1 | Sevkiyat · Fason · İş emri · Sipariş | D-K-04 |
| BULGU-T1-018 | `test_manual_move_fason_receive.ts` fixture'sız — rastgele bir AÇIK fason sevkinde GERÇEK kabul yapıyor, temizliği yok, tek-dosya koşumunda üretim kapısı da yok | S1 | K1 | Fason · ops/test | D-K-07 |
| BULGU-T1-019 | scripts/reset-operational.ts ortam kapısı, dry-run ve onay olmadan 30+ tabloyu TRUNCATE ediyor — system_logs ve system_log_archives dahil | S1 | K1 | Scriptler / audit | KYY-3-07, D-J-11 |
| BULGU-T1-020 | kur.ps1 her kurulumda ecosystem.config.js'i paketinkiyle ezer → sunucudaki yedek/offsite/zamanlayıcı ayarları sessizce repo değerlerine döner | S1 | K2 | deploy + yedek | D-J-02 |
| BULGU-T1-021 | Gece yedeğini fiilen alan yedekle.ps1 repoda yok — bütünlük doğrulaması, min-keep koruması, rotasyon ve offsite kopyanın hiçbiri o yolda koşmuyor | S1 | K2 | yedek/ops | D-J-03 |
| BULGU-T1-022 | Makine dışı kopya ve PITR yok; RPO/RTO on-prem kurulum için hiçbir yerde yazılı değil | S1 | K2 | yedek/ops | D-J-04 |
| BULGU-T1-023 | Geri yükleme tatbikatı hiç yapılmamış — kopyaya geri yükleme yolu prod'da bir kez bile koşmadı | S1 | K2 | yedek/kurtarma | D-J-05 |
| BULGU-T1-024 | Gece yedeğinin başarısız olduğunu gören hiçbir mekanizma yok; üstelik bayatlık sayacı deploy yedeğiyle sıfırlanıyor ve 'okunamadı' 'yok'tan daha az ciddi işaretleniyor | S1 | K2 | OPS | D-I-05 |
| BULGU-T1-025 | OrderLine/Order kilit protokolü üç çağıranda ihlal ediliyor: sevk onayıyla yarışta ya deadlock (40P01→500) ya shippedQty lost-update | S2 | K3 | Sipariş / Sevkiyat | KYY-3-05, D-A-02, D-E-12, D-A-05 |
| BULGU-T1-026 | PostgreSQL deadlock'ı (40P01) ve sorgu zaman aşımı (57014) Prisma P2039 olarak geliyor; P2034→409 haritası bu kurulumda ÖLÜ, her çakışma sınıflandırılmamış 500 üretiyor ve mobil kuyruk 3 kez tekrarlıyor | S2 | K3 | Çekirdek / hata yolu | D-A-03, KYY-3-06, D-I-04 |
| BULGU-T1-027 | Parti numarası kilidi (8022) SABİT anahtarlı bir sistem kapısı, çağıranın tx'i boyunca tutuluyor ve edinim sırası iki yönlü (ABBA): 'roll-first' ailesi ile 'WO-first' ailesi çarpışıyor | S2 | K1 | Parti / Fason / İş emri | D-A-04, KYY-3-09, KYY-2-10 |
| BULGU-T1-028 | Çuval taşımada ve sevkiyat kurulumunda kilit sırası istemciden geliyor — ters yönde eşzamanlı işlem PG deadlock'ı üretiyor ve kullanıcıya 500 dönüyor | S2 | K3 | Çuval / Paketleme / Sevkiyat | KYY-2-03, D-A-06 |
| BULGU-T1-029 | `updateTargetProperties` (W8) kilitsiz, claim'siz ve iş emri statüsüne hiç bakmıyor: kapanmakta olan iş emrinin FİİLEN UYGULANMIŞ özelliği hem plandan hem TOPLARDAN siliniyor | S2 | K1 | İş emri / Üretim karakteristiği | D-A-09, KYY-1-04 |
| BULGU-T1-030 | workorder.create transaction AÇIKKEN havuzdan ikinci bağlantı alıyor (İE numarası + plan süresi) — repoda iki kez ölçülüp yasaklanmış sınıfın kalan örneği; tx alan ikiz yazılmış ama bağlanmamış | S2 | K1 | İş emri | D-D-05, KYY-2-06, D-A-11 |
| BULGU-T1-031 | Tek-process invariantının mekanik bekçisi yok ve ona yaslanan korumalar süreç-dışı yazıcıya karşı savunmasız — dev DB'de ÇİFT gece yedeği ve aynı `.part` üzerinde çakışma ÖLÇÜLDÜ | S2 | K2 | Ops / Süreç / Yedek | D-A-13, KYY-1-05, D-K-18 |
| BULGU-T1-032 | finalizedAt trigger'ının kaynak statü listesi 2026-08-25'te eklenen Fire ucunu kapsamıyor — depodan fire edilen top Fire Karnesi'nde ÜRETİM ayına yazılır | S2 | K2 | Raporlar (karneler) / Envanter | D-C-02 |
| BULGU-T1-033 | status=CANCELLED yazan ALTI yol iptal izini hiç yazmıyor — 134/230 iptalde kim/ne zaman/neden yok, geri alma yanlış rafa döndürüyor; fason iptali ayrıca append-only defterden FİZİKSEL siliyor | S2 | K2 | Envanter / Üretim / Fason | D-C-03, D-E-04, KYY-3-14 |
| BULGU-T1-034 | Audit değiştirilemezliği kâğıt üstünde: tamper trigger'ı varsayılan KAPALI bir GUC'a bağlı (fail-open), prod'da açıldığı doğrulanamıyor ve system_logs.userId FK'sı SET NULL (şema/migration 'RESTRICT' diyor) | S2 | K2 | Audit / Ops | D-C-04, D-G-07, KYY-3-08 |
| BULGU-T1-035 | Birleştirme mezar taşı diriltilebiliyor: mergedIntoId self-FK'sı SET NULL ve kalıcı silme guard'ları tombstone saymıyor — survivor silinince soy bağı NULL olur ve tombstone tekillik seddine geri girer | S2 | K2 | Ana veri / Mükerrer paneli | KYY-3-11, D-C-07 |
| BULGU-T1-036 | Sipariş iptalinde iş emirleri sipariş transaction'ından ÖNCE ve telafisiz iptal ediliyor — sipariş açık kalır, iş emirleri ölür | S2 | K1 | Sipariş / İş emri | D-D-02 |
| BULGU-T1-037 | bulkDispatchStep SEPARATE modunda sessiz kısmi başarı: döngü ortasındaki hata önceki fason sevklerini yutuyor, aynı seçimle tekrar denemek 400 veriyor | S2 | K1 | Fason | D-D-03, KYY-3-10 |
| BULGU-T1-038 | Fason kabulünde ölçülen 'en' iş emrine yazılamazsa operatöre söylenmiyor — kardeş renk yolu uyarı gönderiyor, en yolu yalnız konsola yazıyor | S2 | K1 | Fason | D-I-08, D-D-11 |
| BULGU-T1-039 | Depo kesiminde kaynak top tamamen tükenince emekli edilmiyor: 0 metrajlı hayalet top Bitmiş Depo'da kalıyor | S2 | K2 | Envanter | D-E-03 |
| BULGU-T1-040 | cancelReturn sevkiyat kapsam kilidini (8023) almıyor ve sevkiyatın durumunu hiç okumuyor — koruma tamamen karşı taraftaki sayaç guard'ına bağlı | S2 | K3 | Sevkiyat / İade | D-E-05, KYY-3-13 |
| BULGU-T1-041 | Fason servisi WorkOrderStep.status'u sahibin kuralından FARKLI yüklemle yazıyor ('fasonda top kalmadı' ≠ 'adımda iş kalmadı') — adım ve iş emri, içinde canlı top varken kapanır ve kapanış dispozisyonu hiç sorulmaz | S2 | K1 | Fason / Üretim | D-E-06, D-L-04 |
| BULGU-T1-042 | reopenStep fire (SCRAP) topu üretime geri çekiyor: 'fire geri alınamaz' değişmezi belgesiz bir kapıdan deliniyor | S2 | K1 | Üretim (Kurşun/KK2) | D-E-07 |
| BULGU-T1-043 | Görevler ayrılığı kâğıtta var, atamada yok: 8 aktif kullanıcının 6'sı 'sevk et + sevki geri al + metraj düzelt' üçlüsünü birlikte taşıyor | S2 | K2 | Kimlik / Sevkiyat | D-E-09 |
| BULGU-T1-044 | currentQty ≤ initialQty DB seddi yok ve mutabakat kontrolü yalnız ELLE koşuyor: düzeltilmiş bir hata iki hafta daha ihlal üretti, ikinci satır 13 gün fark edilmedi; bugün prod verisinde iki bölüm kırmızı | S2 | K2 | Üretim / Envanter / Ops | D-E-10, D-I-03 |
| BULGU-T1-045 | İçe aktarım ve config-bundle router'larındaki 10 MB gövde katmanı ÖLÜ — global 1 MB parser önce koşuyor, 10.000 satırlık dosya 413 alıyor ve mesaj yanlış sınırı söylüyor | S2 | K3 | İçe aktarım / Çekirdek | D-F-01, D-L-05 |
| BULGU-T1-046 | Statü taşıyan http-errors 500'e düşüyor: bozuk %-dizisi olan HER /:id yolu (ve 415 charset, sendFile hataları) 500 + SAHTE SYSTEM/ERROR audit üretiyor | S2 | K3 | Çekirdek | D-F-02, D-I-10 |
| BULGU-T1-047 | sanitizeWriteData bir KOLON allowlist'idir, ANLAM allowlist'i değil — mergedIntoId/deletedAt istemciden yazılabilir, {set:…} operatörü ad bekçilerini atlar | S2 | K1 | Tanımlar / master-data | D-F-03 |
| BULGU-T1-048 | quick-start uyarı kanallarının hiçbiri istemci tarafından okunmuyor — 'rota kapsaması UYARI'ya indirildi' kararı fiilen ölü | S2 | K1 | Üretim / İş emri | D-F-05 |
| BULGU-T1-049 | Etiket snapshot'ı çözülemezse uç 200 {seeded:false} dönüyor ve `labelDirty` yine de temizleniyor — 'Kime basıldı' niyeti ve 'etiket güncel değil' işareti sessizce kayboluyor | S2 | K1 | Belge / Etiket | D-F-06, D-D-08 |
| BULGU-T1-050 | PUT /api/admin/settings/:key anahtar allowlist'i ve tip/aralık doğrulaması olmadan yazıyor; asBoolean 'true' dışını false sayar → güvenlik anahtarı açık sanılırken kapalı kalır | S2 | K2 | Çekirdek / Sistem ayarı | D-F-07, D-G-13 |
| BULGU-T1-051 | Token 30 gün geçerli, sınırsız paralel oturum, idle kilit yok, taşıma düz HTTP — kopyalanan token bir ay görünmeden çalışır | S2 | K2 | Kimlik | D-G-03 |
| BULGU-T1-052 | Son-yönetici bekçisi ÜYELİĞE bakar, GEÇERLİLİK PENCERESİNE bakmaz; grantPermission'da bekçi hiç koşmaz → gelecek tarihli `validFrom` ile sistem kalıcı yöneticisiz kalır | S2 | K1 | Kimlik / Yetki | D-G-04, KYY-3-12 |
| BULGU-T1-053 | `Teks-Erp/.env` git ile izleniyor — JWT_SECRET + DATABASE_URL depo geçmişinde; 'secret rotasyonu' commit'i yeni sırrı da depoya yazdı | S2 | K2 | OPS | D-G-05 |
| BULGU-T1-054 | Mobil rol şablonları `web` kategorili izin taşıyor → masaüstü kapısı delinir; sahadaki Tambur operatöründe `label-template:write` var | S2 | K2 | Kimlik / Yetki | D-G-06 |
| BULGU-T1-055 | Uygulama DB kimliği süper yetkili (dev'de ölçüldü) ve DDL uygulama içinden çalışıyor — en az yetki hiçbir katmanda uygulanmıyor | S2 | K2 | OPS | D-G-08 |
| BULGU-T1-056 | GET /api/rolls 2026-08-17 deploy'undan sonra her gün 5-10 sn'lik kuyruk üretiyor — 2.431 satırlık tabloda, ve telemetri nedenini söyleyemiyor | S2 | K2 | Çekirdek / Envanter | D-H-01 |
| BULGU-T1-057 | rolls / work_order_steps / roll_movements güncellemelerinin %99,4'ü HOT değil — her top güncellemesi 24 indeksin tamamını yeniden yazıyor | S2 | K2 | Çekirdek / Envanter | D-H-02 |
| BULGU-T1-058 | Sevk raporu, indekssiz rolls.directShipmentId üzerinde doğrudan-sevk başına İKİ korelasyonlu alt sorgu koşuyor | S2 | K1 | Raporlar / Sevkiyat | D-H-03 |
| BULGU-T1-059 | /api/admin/health'e 'görünsün diye' eklenen sessiz-arıza dedektörlerini (auditGuard, restoreCopyCount, discovery.mdns, rollsDeadPct, longestQuerySec, lastAuditError) hiçbir istemci çizmiyor; statement_timeout gibi kritik GUC'lar da yüzeyde yok | S2 | K2 | OPS / Çekirdek | D-I-01, D-J-12 |
| BULGU-T1-060 | Sağlık alarmlarının tamamı PULL: evaluateAlerts yalnız Sunucu Durumu sayfası açıkken koşar, SYSTEM/ERROR için hiçbir sayaç/kanal yok — ölçülen teşhis süresi 31,5 saat | S2 | K2 | OPS | D-I-02 |
| BULGU-T1-061 | Barkod/QR üretimi patlarsa eleman sessizce ÇİZİLMEZ — barkodsuz etiket 200 ile basılır, hiçbir yerde iz kalmaz | S2 | K1 | Belge / Etiket | D-I-07 |
| BULGU-T1-062 | Fiziksel etiket basıldıktan sonraki kayıt yolu ateşle-unut ve tekrar denenmiyor: kâğıt çıkar, labelPrintedAt boş kalır, ölü-etiket koruması körleşir | S2 | K2 | Belge / Üretim | D-I-06 |
| BULGU-T1-063 | `recordPrintEvent` `labelDirty`'yi KOŞULSUZ temizliyor — baskı ile print-event arasında yapılan düzeltme sessizce 'etiket güncel' işaretleniyor | S2 | K1 | Etiket | KYY-2-09 |
| BULGU-T1-064 | Başarısız migrate deploy sonrası kurtarma reçetesi hiçbir belgede yok — operatörün elindeki iki seçenek de yanlış ağırlıkta | S2 | K1 | deploy | D-J-06 |
| BULGU-T1-065 | ADD VALUE migration'larının 10'unda IF NOT EXISTS yok ve prod şemasında defter dışı bir enum değeri ölçüldü — sonraki deploy geri alınamaz eşikte kilitlenebilir | S2 | K2 | migration | D-J-07 |
| BULGU-T1-066 | Yumuşak kapı enforce adımının sahibi/tarihi/tetiği yok; items_nameFold_key sahada hâlâ eksik ve tek sinyal KALICI KIRMIZI bir bekçi (test_db_invariants dev'de §5, sahada §1) | S2 | K2 | migration / ana veri / ops-test | D-J-08, D-K-03 |
| BULGU-T1-067 | test_migration_hygiene 'dizinde var / DB'de yok'u UYARI basıyor — migrate deploy'un hiç koşmadığı durum deploy-sonrası doğrulamada YEŞİL görünür | S2 | K2 | migration / bekçi | D-J-09 |
| BULGU-T1-068 | Sürüm sıfırlaması (2.9.x→1.0.0) mobil sürüm kapısını sahadaki tabletler için kalıcı olarak etkisizleştirdi | S2 | K1 | sürüm politikası | D-J-10 |
| BULGU-T1-069 | `test_qc2_idempotency.ts` KK2 idempotency'sinin TEK bekçisi ama servisi hiç çağırmıyor — Prisma'nın @@unique'ini test ediyor, üstelik rastgele canlı kayıt üzerine yazarak | S2 | K1 | Kurşun / KK2 | D-K-06 |
| BULGU-T1-070 | Sessiz temizlik + eksik FK sırası: dev DB'de 480 `TST-WHA` iş emri (tablonun %63'ü) birikmiş; `clean_test_residue` bu öneki tanımıyor | S2 | K2 | ops/test | D-K-08 |
| BULGU-T1-071 | Sevk & Termin Karnesi'nin başlık metrajı BRÜT, günlük serisi NET — aynı yanıtta iki farklı sevk rakamı; bekçi de 'daily' kelimesini hiç geçirmiyor | S2 | K2 | Raporlar / Sevkiyat | D-K-09, D-L-01 |
| BULGU-T1-072 | Kalite/Fire Karnesi bekçisi damganın TAZELENMESİNİ ölçüyor, 'yeniden üretime alınmış ama henüz bitmemiş top karneden DÜŞMELİ' kuralını ölçmüyor — saha kopyasında 4 top / 475 m sızıyor | S2 | K2 | Raporlar / Kalite | D-K-10 |
| BULGU-T1-073 | Fason 'açık+outstanding' tek-kaynak AST bekçisi yalnız TS nesne literallerini tarıyor — aynı koşulun ÜÇ ham-SQL kopyası kapsam dışı (kardeş bekçi ham SQL'i TARIYOR) | S2 | K1 | Fason / Raporlar | D-K-11, D-L-09 |
| BULGU-T1-074 | Yedi advisory kilit noktasının BEŞİNDE sıra bekçisi, İKİSİNDE hiçbir bekçi yok; üstelik üç dosyadaki namespace envanteri bayat ('1-argümanlı uzayı X kullanıyor' iddiası yanlış) | S2 | K1 | Eşzamanlılık altyapısı | D-K-12, D-L-11 |
| BULGU-T1-075 | Bekçilerin %96'sı servisi doğrudan çağırıyor — HTTP/Zod/middleware/guard katmanı 260 yazma ucunun ancak ~%10'unda koşuyor; `dispatchWithoutColor` bu boşluğun ölçülmüş bedeli | S2 | K1 | Tüm yazma yolları | D-K-13 |
| BULGU-T1-076 | `check-migrations.mjs` (commit edilmemiş migration bekçisi) hiçbir otomatik tetikleyiciye bağlı değil: git hook yok, `npm test` çağırmıyor, CI'da bilerek her zaman yeşil ve zaten adnansahin'de koşmuyor | S2 | K1 | ops/test | D-K-14 |
| BULGU-T1-077 | Fason kabul yarışı sondası KAZANANI ölçmüyor — `ok`/`rejected` hesaplanıp yalnız console.log'a basılıyor | S2 | K1 | Fason | D-K-15 |
| BULGU-T1-078 | Parti no yolunun GERÇEK DB'de paralel sondası yok (tek bekçi sahte tx üzerinde çağrı sırasını sayıyor) ve ÜÇ bekçi dosyası kodun TERSİNİ yazıyor ('kilit almaz', '@unique → P2002') | S2 | K2 | Parti | D-K-17, D-K-16 |
| BULGU-T1-079 | Parti İzleme geri-izlemesi sevkiyat statüsünü süzmüyor — PLANNED sevkiyattaki mal "müşteriye gitti" görünüyor | S2 | K2 | Raporlar / Parti | D-L-02 |
| BULGU-T1-080 | "Üretim çıktısı" iki ayrı statü listesiyle tanımlı — iptal edilen Tambur çocuğunun metrajı sonsuza dek "üretimde" sayılıyor (açık WO'larda 1.506,9 m) | S2 | K2 | Üretim / Ürün Dengesi | D-L-03 |
| BULGU-T1-081 | "Rota bu hedefi kapsıyor mu" sorusunun üç farklı cevabı var (400 / uyarı / 409) ve goods muafiyeti yalnız uyarı dalına uygulanmış | S2 | K1 | İş emri | D-L-06 |
| BULGU-T1-082 | "Fire" iki farklı kriterle sayılıyor — Fire Karnesi statüye, Kalite Karnesi kalite koduna bakıyor; aynı ay iki farklı fire rakamı | S2 | K2 | Raporlar / Kalite | D-L-07 |
| BULGU-T1-083 | `setShipmentInvoice` sevkiyat kapsam kilidini almıyor — storno ile yarışta "PLANNED ama faturalı" sevkiyat doğuyor (INV-SEV-14) | S2 | K1 | Sevkiyat / muhasebe izi | KYY-2-05 |
| BULGU-T1-084 | 'Boş sevkiyat sevk edilemez' ve 'EXPORT çuvalı tartılı olmalı' kontrolleri yalnız transaction ÖNCESİ: çuvalsız bir sevkiyat DISPATCHED olup BOŞ irsaliye donduruyor | S2 | K3 | Sevkiyat | KYY-3-04, KYY-2-17 |
| BULGU-T1-085 | applyManualProperties claim'i `status`'ü de pinlemiyor — süpervizör kapsamı bayat statüyle çözülüyor, `roll:manual-adjust` kapısı yarışla atlanabiliyor | S2 | K1 | Envanter (Roll) / yetki | KYY-2-01b |
| BULGU-T1-086 | Eşzamanlı `unlinkOrderLine` 'tip = bağın aynası'nı bozuyor — 0 bağlı iş emri 'Siparişe Özel' kalıyor | S2 | K3 | İş emri ↔ sipariş bağı | KYY-2-02 |
| BULGU-T1-087 | İçe aktarım anahtar katlaması toLocaleUpperCase('tr-TR') — i-ailesinde asimetrik; `activo` ile `ACTIVO` eşleşmiyor, 228 kumaş kodunun 63'ü etkilenebilir | S2 | K2 | İçe aktarım | D-B-07 |
| BULGU-T1-088 | Sipariş içe aktarımının mükerrer uyarısı yalnız müşterinin EN SON siparişine bakıyor; araya bir sipariş girdiyse uyarı hiç çıkmıyor | S2 | K1 | İçe aktarım / Sipariş | D-B-06 |
| BULGU-T1-089 | Replay yanıtlarında payload-özdeşlik kontrolü yok: aynı token FARKLI gövdeyle gelirse önceki sonuç dönüyor ve yeni veri sessizce yutuluyor (içe aktarım + çuval + sevkiyat + açık kumaş + fason makbuz) | S2 | K3 | İçe aktarım / Çuval / Sevkiyat / Fason | D-B-05, D-B-09 |
| BULGU-T1-090 | Yedek damgası işin BAŞINDA yazılıyor ama iş idempotent değil — patlayan gece yedeği o gün bir daha denenmiyor | S3 | K1 | Ops / Yedek | D-A-14 |
| BULGU-T1-091 | Etiket şablonu silme/pasifleştirme, bağlam varsayılanı atamasıyla çaprazlanıyor — kontrol havuzda, yazım tx'te, tx-içi ikiz yok | S3 | K1 | Etiket / Belge | D-A-15 |
| BULGU-T1-092 | dbRestore.copies JSON blob'unda oku-değiştir-yaz: serileştirme kuyruğu üç yazıcıdan yalnız birini kapsıyor | S3 | K1 | Ops / DB kopyası | D-A-16, KYY-2-11 |
| BULGU-T1-093 | Barkod sayacı ve parti no kilidi uzun transaction'ların içinde tutuluyor; 2026-08-10'da yalnız BİR çağrı yeri düzeltildi ve bekçi kalanların DÖNGÜDE olduğunu göremiyor | S3 | K1 | Üretim / Fason / Envanter | D-H-04, D-A-17 |
| BULGU-T1-094 | LIFO/recency guard'ları zaman damgasının KESİN büyüklüğüne (createdAt > X) dayanıyor, sıraya değil — eşit damgada kapı sessizce açılıyor | S3 | K1 | Fason makbuz iptali / İade iptali | D-B-10 |
| BULGU-T1-095 | freezeForSource versiyonu kilitsiz `max+1` ile hesaplıyor ve P2002'yi yalnız lazy-init dalı yakalıyor: belge çakışması sevk transaction'ının tamamını geri sarıyor | S3 | K1 | Donmuş belge | D-B-11, KYY-1-06 |
| BULGU-T1-096 | 'Etiket türü başına tek varsayılan' iki bağımsız DB seddinde tutuluyor; seed yalnız birini yazıyor — sahada SWATCH ayrışmış | S3 | K2 | Belge / Etiket | D-C-05 |
| BULGU-T1-097 | consistency-check.sql §12, mekanik ikizindeki muafiyet listesini taşımıyor — ops sorgusu prod'da 15 yanlış-pozitif satır basıyor | S3 | K2 | Ops / bekçi | D-C-06 |
| BULGU-T1-098 | Belge tarihi/saati ve iade belge numarası SÜREÇ saat diliminden üretiliyor; belge no/barkod FABRİKA gününden — bekçi bu deseni taramıyor | S3 | K1 | Belge | D-C-08 |
| BULGU-T1-099 | Statü/enum kümeleri tip düzeyinde zorlanmıyor: Roll.status geçiş matrisi 21 ayrı listede, entryTitle/variance kind/STATION_KIND_PERM fail-open — yeni enum değeri sessizce eski davranışa düşer (altı kez ısırdı) | S3 | K1 | Çekirdek / Envanter / Çalışma oturumu | D-C-09, D-L-16, D-G-12, KYY-2-12 |
| BULGU-T1-100 | Sipariş kalemi replace'i, iptal/devredilmiş iş emrinin sipariş bağını cascade ile sessizce siliyor | S3 | K2 | Sipariş | D-C-10 |
| BULGU-T1-101 | initialQty = 0 olan iki tüketilmiş ana top, 20 m ve 39 m'lik çocuk taşıyor — DB'de initialQty > 0 kısıtı yok | S3 | K2 | Üretim (Tambur) | D-C-13 |
| BULGU-T1-102 | Birleştirmenin 120 sn'lik tx bütçesi DB'nin 50 sn'lik statement_timeout'u yüzünden ulaşılamaz; 200k satırlık önizleme eşiği DB'nin vermeyeceği bir söz veriyor | S3 | K1 | Ana veri / merge | D-D-06 |
| BULGU-T1-103 | Sevkiyat iptali/stornosunun kim-ne zaman-neden izi yalnızca best-effort audit'te — Shipment'ta iptal kolonu yok | S3 | K2 | Sevkiyat | D-D-07 |
| BULGU-T1-104 | changeTargetColor / changeWidth: havuz claim'i ile refakat kartı bayat işareti ayrı iki yazım | S3 | K1 | İş emri / Refakat kartı | D-D-09 |
| BULGU-T1-105 | Sipariş Bağla (override) zinciri: son adım düşerse plan + toplar kalıcı olarak değişmiş kalır, kullanıcı yalnız hatayı görür | S3 | K1 | İş emri / Sipariş | D-D-10 |
| BULGU-T1-106 | Refakat kartı arşiv kopyası değiştirilebilir: aynı sürümün yeniden basımı defterdeki snapshot'ı üzerine yazıyor; ayrıca iki eşzamanlı baskı aynı sürüm numarasını alıyor | S3 | K1 | Belge / Refakat kartı | D-E-11, KYY-3-15 |
| BULGU-T1-107 | DELETE /api/rolls/:id sözleşmesi query string'de ve Zod'suz: sebep sessizce 500 karaktere kırpılıyor, alt sınır yok, ölü parametre sözleşmede duruyor | S3 | K1 | Envanter | D-F-08 |
| BULGU-T1-108 | Toplu yazma şemalarında dizi TAVANI eksik — ekibin sevkiyat için kapattığı asimetri altı+ uçta açık duruyor (applyAttributeToRolls dahil) | S3 | K1 | Kartela / Parti / Tanımlar / İş emri | D-F-09, D-H-10 |
| BULGU-T1-109 | Ham err.message 200 gövdesindeki operatör alanlarına akıyor — Prisma/pg metni Türkçe-mesaj kuralını deliyor ve hiçbir deftere düşmüyor | S3 | K1 | İçe aktarım / Fason / İş emri / Ops | D-F-10, D-I-14 |
| BULGU-T1-110 | Döngü içi ORM çağrıları: 67 nokta, hepsi tavana bağlı — en kötü 5'te tavan ile bugünkü gerçek arasında 3-8 kat fark var | S3 | K2 | çapraz (Üretim/Sevkiyat/Envanter) | D-F-11 |
| BULGU-T1-111 | Arama `resolveExact` izin süzgecinin ÖNÜNDE koşar — `mobile:kk1` operatörü çuval numarasıyla müşteri adını okuyabilir | S3 | K1 | Arama | D-G-09 |
| BULGU-T1-112 | GET /api/feature-flags 54 ayarı (kilit parametreleri, giriş yöntemleri, oturum politikası, künye) tek izinli saha operatörüne döner | S3 | K1 | Çekirdek | D-G-10 |
| BULGU-T1-113 | Cihaz kapısı başlık göndermeyene HİÇ uygulanmaz ve cihaz kimliği sırsızdır; `close` başka cihazın tüm oturumlarını kullanıcı eşleşmesi aramadan kapatır | S3 | K1 | Kimlik / Cihaz | D-G-11 |
| BULGU-T1-114 | `GET /import/:entity/export` toplu ana veri dökümünü `data:import` istemeden, tavansız ve AUDIT YAZMADAN veriyor | S3 | K2 | İçe aktarım | D-G-14 |
| BULGU-T1-115 | `POST /labels/test-native` gövdeden gelen keyfi IP:port'a ham TCP baytı yazar (SSRF) — bugün bayrakla kapalı | S3 | K1 | Belge / Etiket | D-G-15 |
| BULGU-T1-116 | `POST /admin/db-copies/:name/verify` kardeş uçlardaki ad allowlist'ini uygulamaz — cluster'daki herhangi bir DB'ye bağlanıp sayım yapar ve sahte 'kopya' kaydı yazar | S3 | K1 | Ops / DB kopyası | D-G-16 |
| BULGU-T1-117 | rclone uzak hedefi doğrulanmadan pozisyonel argüman olarak geçiliyor — '--' ile başlayan değer bayrak sayılır, ':backend:' biçimi yapılandırmasız hedefe yönlendirir | S3 | K1 | Ops / Yedek | D-G-17 |
| BULGU-T1-118 | Hiç hız sınırı yok ve `POST /devices/announce` tavanı check-then-act — kimliksiz uç 200 PENDING tavanını doldurup (ya da eşzamanlı isteklerle aşıp) yeni tablet devreye almayı kilitleyebilir | S3 | K1 | Çekirdek / Cihaz | D-G-19, KYY-3-16 |
| BULGU-T1-119 | Log ve audit içeriği: erişim log'u tam URL, audit maskesiz kişisel veri taşıyor ve rotasyon repo dışında doğrulanamıyor; şifre/PIN sızıntısı YOK (ölçüldü) | S3 | K2 | OPS / Çekirdek | D-I-19, D-G-21 |
| BULGU-T1-120 | Rapor katmanının tarih ekseni orders üzerinde indekssiz — yedi rapor sorgusu orderDate/completedAt ile filtreliyor, ikisinin de indeksi yok | S3 | K2 | Raporlar / Sipariş | D-H-05 |
| BULGU-T1-121 | system_log_archives sonsuza kadar büyüyor (hiçbir şey silmiyor) ve arşivleme yolu ne dev'de ne prod'da bir kez bile gerçek satır taşımadı | S3 | K2 | OPS / audit | D-H-06 |
| BULGU-T1-122 | Manuel kodla ürün kaydeden her istek items tablosunun tamamını iki kez belleğe alıyor — ikincisi advisory kilit altında, transaction içinde | S3 | K1 | Ana veri | D-H-07 |
| BULGU-T1-123 | Projenin kendi indeks teşhis aracı index-health.sql bozuk — 10 bölümün 6'sı koşmuyor ve §9 salt-okunur bir teşhis script'i içinde CREATE EXTENSION çalıştırıyor | S3 | K2 | OPS / teşhis | D-H-08 |
| BULGU-T1-124 | Toplu etiket üretimi event loop'u 25 etiketlik bloklar hâlinde kilitliyor — yield aralığı süreye değil sayıya bağlı | S3 | K2 | Etiket / Baskı | D-H-09 |
| BULGU-T1-125 | Yavaş-istek defteri yavaşlığın SEBEBİNİ taşımıyor ve restart'ta siliniyor — sistemin tek ölçülen performans anomalisi kendi telemetrisiyle teşhis edilemiyor | S3 | K2 | OPS / telemetri | D-H-13 |
| BULGU-T1-126 | AppError.internal, withBarcodeRetry tükenmesi ve PrismaClientValidationError sunucuda HİÇ iz bırakmadan dönüyor | S3 | K1 | Çekirdek | D-I-09 |
| BULGU-T1-127 | Script yolundan yapılan ana-veri yazımlarının audit satırı AKTÖRSÜZ: kullanıcı, IP, cihaz ve istek kimliği dördü de boş | S3 | K2 | OPS / Tanımlar | D-I-11 |
| BULGU-T1-128 | Korelasyon kimliği tek yönlü: requestId yalnız audit satırında yaşıyor; yanıtta, log satırında ve hata gövdesinde yok — logEvent ayrıca deviceId hiç yazmıyor | S3 | K2 | Çekirdek / OPS | D-I-12 |
| BULGU-T1-129 | Birleştirme önizlemesi SQL hatasında '0 çakışma' diyor; işlem sonra 'Önizlemeden sonra veriler değişti' diye reddediyor — kullanıcı olmayan bir değişikliği kovalıyor | S3 | K1 | Tanımlar / merge | D-I-13 |
| BULGU-T1-130 | quickStart telafisi düşerse yetim iş emri + aktif refakat kartı kalıyor; yorum audit'ten söz ediyor ama audit çağrısı yok | S3 | K1 | Üretim | D-I-15 |
| BULGU-T1-131 | Boot işlerinde iz asimetrisi: kurulum kimliği üretilemezse audit yazılmıyor ve sebep kataloğu uzlaştırması audit'siz + skipDuplicates'siz — kardeş izin uzlaştırıcısı ikisini de yapıyor | S3 | K1 | OPS / Boot job'ları | D-I-16, KYY-2-16 |
| BULGU-T1-132 | Offsite yedek: 'hedef ayarlı değil' ile 'ayarı okuyamadım' aynı değere iniyor ve süpürücü bunu yalnız konsola yazıyor | S3 | K1 | OPS / Yedek | D-I-17 |
| BULGU-T1-133 | app.listen hata dinleyicisi yok: port doluysa süreç yeniden başlatma döngüsüne girer ve eski sürüm sessizce hizmet vermeye devam edebilir | S3 | K1 | Çekirdek / OPS | D-I-18 |
| BULGU-T1-134 | CREATE INDEX CONCURRENTLY hiç yok, lock_timeout hiçbir yerde yok, SET statement_timeout=0 34/195 — büyümede tek koruma yazılı bir vardiya kuralı | S3 | K1 | migration | D-J-13 |
| BULGU-T1-135 | CLAUDE.md `prisma migrate dev`'i normal komut olarak listeliyor; MIGRATION-DEPLOY.md onu bu şemada YASAK ilan ediyor | S3 | K1 | dokümantasyon / migration | D-J-14 |
| BULGU-T1-136 | İki backfill scripti parçalı değil; backfill-record-provenance dry-run'ı kayıtları listelemiyor, yalnız sayı basıyor | S3 | K1 | scripts | D-J-15 |
| BULGU-T1-137 | 20260611084953_native_uuid_pk_fk dolu bir veritabanında veri kaybı üretir; yeni müşteri kurulumunda 'önce içe aktar sonra migrate' sırası bunu tetikler | S3 | K1 | migration | D-J-16 |
| BULGU-T1-138 | Üretim-DB kapısı yalnız koşucuda, host ADINA bakıyor ve kendi kapsamı hakkındaki sayıları %33 eksik beyan ediyor | S3 | K1 | ops/test | D-K-19 |
| BULGU-T1-139 | Eşzamanlılık sondalarının 24/33'ü N=2 ve hiçbirinde gecikme enjeksiyonu yok — dar pencerede yeşil kalabilirler (bekçilerin kendi itirafı) | S3 | K1 | Eşzamanlılık altyapısı | D-K-21 |
| BULGU-T1-140 | Negatif sonda kanıtı YORUMDA yaşıyor (20/366 dosya, %5,5); yeniden koşulabilir öz-sınama yalnız 5 bekçide var | S3 | K1 | test kültürü | D-K-22 |
| BULGU-T1-141 | Sessiz temizlik deseni sistematik (150 dosya / 669 `catch(()=>{})`); RESTRICT FK'lı `rollVariance` kuralı CLAUDE.md'de yazılı ama mekanik bekçisi yok — bugün 2 fason testinde eksik | S3 | K1 | ops/test | D-K-24 |
| BULGU-T1-142 | specMatch birebir kopyalanmış (return.service) — kaynağı zaten export'lu ve iki kopyanın eşitliğini ölçen bekçi yok | S3 | K1 | İade / Sevkiyat | D-L-08 |
| BULGU-T1-143 | Çuval metrajı aynı serviste iki farklı kümeyle hesaplanıyor — sevkiyat önizlemesi hayalet topları süzmüyor | S3 | K1 | Çuval / Sevkiyat | D-L-10 |
| BULGU-T1-144 | StationColor ölü yazma yolu: panel hâlâ yazıyor/okuyor, hiçbir iş kuralı okumuyor (prod'da 49 satır) | S3 | K2 | Ana veri / İstasyon | D-L-12 |
| BULGU-T1-145 | Ölü kod mekanik olarak yakalanmıyor — 19 gün önceki knip listesinin 19/19'u hâlâ ölü, ölü bir import derlemeden geçiyor | S3 | K2 | Çekirdek / Süreç | D-L-13 |
| BULGU-T1-146 | `finalizeWarehouseCut`'un idempotency yorumu var olmayan bir mekanizmayı anlatıyor; paralel tekrar 409, sıralı tekrar başarı dönüyor | S3 | K1 | Tambur / depo kesimi | D-L-14, KYY-2-14 |
| BULGU-T1-147 | `setFeatureFlags` transaction'sız ~50 bağımsız yazım + istemci TAM nesne gönderiyor: bayat sayfadan kaydeden ikinci admin koruma bayraklarını sessizce geri kapatıyor | S3 | K1 | Sistem ayarı | KYY-1-07 |
| BULGU-T1-148 | `reasonPreset.duplicate` sıra kaydırması idempotent değil ve `nextFreeCode` transaction dışında: eşzamanlı çoğaltmada aynı `sortOrder`'da iki satır doğuyor | S3 | K1 | Sebep kataloğu | KYY-1-08 |
| BULGU-T1-149 | İade ucunda `clientToken` yok — zaman aşımı sonrası tekrar 409 veriyor, operatör 'kaydolmadı' sanıyor | S3 | K1 | İade | KYY-2-15 |
| BULGU-T1-150 | Batch.batchNumber bilinçli olarak tekil değil (saha'da 92 tekrar grubu) ama 'onunla lookup yapma' kuralının mekanik bekçisi yok | S4 | K2 | Parti | D-B-12 |
| BULGU-T1-151 | device.announce upsert'ü include taşıyor; atomik DB-upsert dışına düşerse kimliksiz uçta çakışma teknik 409 üretir | S4 | K1 | Cihaz | D-B-13 |
| BULGU-T1-152 | Mutasyona uğrayan beş tabloda updatedAt yok — 'ne zaman değişti' yalnız olay kolonundan okunabiliyor | S4 | K2 | Çekirdek | D-C-11 |
| BULGU-T1-153 | Çeki listesi çuval metrajını float += ile topluyor — kardeş uç Decimal _sum kullanıyor (prod verisinde 39 çuvalın 16'sı ayrışıyor) | S4 | K2 | Sevkiyat / Çuval | D-C-12 |
| BULGU-T1-154 | GET donmuş-belge yolu lazy-init ile YAZIYOR ve snapshot'ı transaction dışında kuruyor | S4 | K1 | Belge | D-D-12 |
| BULGU-T1-155 | Retry-After gönderiliyor ama CORS exposedHeaders listesinde yok — başlık renderer'a görünmez (belgeli, bugün zararsız) | S4 | K1 | Çekirdek | D-F-12 |
| BULGU-T1-156 | Masaüstü erişim kapısı gövdeden gelen `clientType`'a bakar — güvenlik sınırı değil, istemci nezaketi; kod ve arayüz aksini söylüyor | S4 | K1 | Kimlik | D-G-20 |
| BULGU-T1-157 | Swagger kapısı `NODE_ENV`, morgan `APP_ENV ?? NODE_ENV` — pm2 dışı bir başlatmada `/api-docs` kimliksiz açık kalır | S4 | K1 | Çekirdek | D-G-22 |
| BULGU-T1-158 | `requirePermission(undefined)` 403 değil 500 üretir; bugün bu değeri üretebilen yol yok ama davranışı ölçen bekçi de yok | S4 | K0 | Çekirdek | D-G-23 |
| BULGU-T1-159 | 85 yabancı anahtar kolonunun indeksi yok — hepsi *ById iz kolonları; bugün zararsız ama zararsızlığın sebebi hiçbir yerde yazılı değil | S4 | K2 | Şema geneli | D-H-11 |
| BULGU-T1-160 | Sistem kendi sorgu maliyetini ölçemiyor: pg_stat_statements yok, kopyadaki indeks istatistikleri geçersiz — 'hangi indeks işe yaramıyor' sorusu bugün cevaplanamaz | S4 | K2 | OPS | D-H-12 |
| BULGU-T1-161 | Swagger şeması üretimde de import anında kuruluyor ve bellekte tutuluyor — /api-docs hiç mount edilmediği hâlde | S4 | K2 | Çekirdek / boot | D-H-14 |
| BULGU-T1-162 | İstek yolundaki küçük senkron/tavansız noktalar: latency flush N+1, HTTP handler'ında readFileSync, listDbCopies her GET'te cluster'ı tarıyor | S4 | K1 | OPS / mobil güncelleme / telemetri | D-H-15 |
| BULGU-T1-163 | verifyToken iki bağımsız sorguyu sırayla koşuyor — bilinçli tasarımın ölçülmemiş yarısı (K12'nin yeniden-ölçüm talebi kapatılıyor) | S4 | K2 | Çekirdek / Kimlik | D-H-16 |
| BULGU-T1-164 | TravelerCard.contentDirty: ~20 yazma noktası, sıfır tüketici — iki backend yorumu hâlâ 'istemci rozeti bu alandan basar' diyor | S4 | K1 | Belge / Refakat kartı | D-L-15 |
| BULGU-T1-165 | AppError.isOperational hiç okunmuyor; audit çağrılarında 42 gereksiz .catch(() => undefined) katmanı | S4 | K1 | Çekirdek / Hata | D-L-17 |
| BULGU-T1-166 | Aynı büyüklüğü basan yardımcılar üç kez kopyalanmış — aynı metraj belgeden belgeye 1 veya 2 ondalık basılıyor | S4 | K1 | Belge | D-L-18 |
| BULGU-T1-167 | Tolerans nedeniyle COMPLETED olan siparişin açık kalemi tüm talep yüzeylerinden düşüyor | S4 | K2 | Sipariş | D-L-19 |
| BULGU-T1-168 | Ölü Teks-Erp/yedekle.sh repoda duruyor — sahadaki yedekle.ps1 ile karıştırılmaya açık, farklı saklama ve panelin göremeyeceği bir biçim | S4 | K1 | yedek | D-J-17 |

## Birleştirilen kümeler (51 küme)

| Yeni id | Kaynak | Kaynaklar | Birleştirme gerekçesi |
|---|---|---|---|
| BULGU-T1-001 | 3 | D-A-01, D-E-08, KYY-2-01 | Aynı fonksiyon+satır (inventory.service.ts:3783/3866/3932), aynı kusur: mutlak metraj yazımı + pinsiz claim. K3 repro'lu KYY-2-01 esas alındı. |
| BULGU-T1-002 | 2 | KYY-3-01, D-K-20 | KYY-3-01 kod hatası, D-K-20 aynı yolun bekçi eksikliği — tek düzeltme paketi. |
| BULGU-T1-003 | 2 | KYY-1-01, D-A-10 | tambur-undo WO kilidinin yokluğu — D-A-10 ABBA ayağını, KYY-1-01 K3 repro ile diriltme ayağını gösteriyor; aynı düzeltme (touchWorkOrderTx ilk ifade). |
| BULGU-T1-005 | 3 | KYY-1-02, D-B-03, D-A-07 | Aynı satırlar (subcontractor.service.ts:2348/2677), aynı kusur: predicatesiz withBarcodeRetry + clientToken P2002 ele alınmıyor. |
| BULGU-T1-006 | 4 | D-B-01, KYY-2-07, KYY-2-08, D-K-05 | Aynı kök neden farklı dosyalarda: replay dalında statü kapısı yok (KK1, sipariş, sevkiyat, çuval, açık kumaş) + bekçi eksikliği. |
| BULGU-T1-007 | 4 | D-B-02, KYY-1-03, D-A-12, D-B-08 | Aynı kök neden: master-data tekillik guardları (ad ve katlanmış kod) kilitsiz check-then-act; advisory yalnız item.service'te. |
| BULGU-T1-008 | 5 | D-F-04, D-B-04, D-D-04, KYY-2-13, D-K-23 | Aynı satırlar (import.service.ts:447/552), aynı kusur: ImportRun sonda yazılıyor; beş denetçi aynı yeri farklı yönlerden gördü. |
| BULGU-T1-009 | 3 | D-D-01, D-A-08, KYY-2-04 | Aynı satırlar (workorder.service.ts:3251-3285/3367), aynı kusur: fason kararı ana txten önce ve telafisiz. |
| BULGU-T1-010 | 2 | D-E-01, KYY-3-03 | Aynı kusur (kapasite kilit öncesi okunuyor); KYY-3-03 K3 repro getiriyor. |
| BULGU-T1-015 | 2 | D-K-01, D-J-01 | Aynı satır (ci.yml:9-13), aynı kusur: adnansahin CI'sız. |
| BULGU-T1-016 | 2 | D-K-02, D-G-18 | Aynı bekçinin bugünkü kırmızısı (test_route_auth_coverage) — D-G-18 kapsamı, D-K-02 kök nedeni. |
| BULGU-T1-019 | 2 | KYY-3-07, D-J-11 | Aynı dosya (reset-operational.ts), aynı kusur: kapı/dry-run yok. |
| BULGU-T1-025 | 4 | KYY-3-05, D-A-02, D-E-12, D-A-05 | Aynı kilit protokolü ihlali (order.service üç çağıran); D-A-02/D-E-12 lost-update kolunu, D-A-05 iki-parti edinimini, KYY-3-05 K3 deadlock ölçümünü getiriyor. |
| BULGU-T1-026 | 3 | D-A-03, KYY-3-06, D-I-04 | Aynı kök neden: SQLSTATE (40P01/57014) haritası yok → sınıflandırılmamış 500. |
| BULGU-T1-027 | 3 | D-A-04, KYY-3-09, KYY-2-10 | Aynı kök neden: 8022 sabit anahtar + WO kilit sırasının iki yönlü olması (attachRolls, manualMove, split, tambur-manual, fason). |
| BULGU-T1-028 | 2 | KYY-2-03, D-A-06 | Aynı kusur: çuval/sevkiyat kilitlerinin kanonik sıralanmaması; KYY-2-03 K3 deadlock ölçümü. |
| BULGU-T1-029 | 2 | D-A-09, KYY-1-04 | Aynı fonksiyon (updateTargetProperties): kilit/claim/statü guardı yok. |
| BULGU-T1-030 | 3 | D-D-05, KYY-2-06, D-A-11 | Aynı satırlar (workorder.service.ts:988-989 + 1002/5505): tx açıkken havuz clientı. |
| BULGU-T1-031 | 3 | D-A-13, KYY-1-05, D-K-18 | Aynı kök neden: tek-process invariantına yaslanan korumalar + bekçi yokluğu (D-K-18) + ölçülmüş çift yedek (D-A-13/KYY-1-05). |
| BULGU-T1-033 | 3 | D-C-03, D-E-04, KYY-3-14 | Aynı kök neden farklı dosyalarda: CANCELLED yazan altı yol iptal izini yazmıyor; KYY-3-14 ek olarak append-only silmeyi getiriyor. |
| BULGU-T1-034 | 3 | D-C-04, D-G-07, KYY-3-08 | Aynı koruma (audit tamper GUC) — D-C-04 FK ayağını, D-G-07/KYY-3-08 GUC ve bekçi ayağını gösteriyor. |
| BULGU-T1-035 | 2 | KYY-3-11, D-C-07 | Aynı kök neden: tombstone soy bağı korunmuyor (guard sayımı + SET NULL FK). |
| BULGU-T1-037 | 2 | D-D-03, KYY-3-10 | Aynı fonksiyon (bulkDispatchStep SEPARATE): sessiz kısmi başarı. |
| BULGU-T1-038 | 2 | D-I-08, D-D-11 | Aynı satırlar (subcontractor.service.ts:3269-3283): changeWidth catchi sessiz. |
| BULGU-T1-040 | 2 | D-E-05, KYY-3-13 | Aynı fonksiyon (cancelReturn): 8023 kilidi ve statü okuması yok; KYY-3-13 yarışı çürütüp yazılı kural eksikliğini ölçüyor. |
| BULGU-T1-041 | 2 | D-E-06, D-L-04 | Aynı kusur: fason yolları recomputeStepStatus yerine kendi yüklemini yazıyor. |
| BULGU-T1-044 | 2 | D-E-10, D-I-03 | Aynı kök neden: sedsiz invariant + mutabakatın elle koşması (D-E-10 ölçülen 2 satır, D-I-03 otomasyon eksikliği). |
| BULGU-T1-045 | 2 | D-F-01, D-L-05 | Aynı satır (app.ts:141): global 1 MB parser route-seviyesi 10 MB'ı ölü bırakıyor. |
| BULGU-T1-046 | 2 | D-F-02, D-I-10 | Aynı dal (error.middleware dal 9) + aynı kusur: statü taşıyan http-errors tanınmıyor. |
| BULGU-T1-049 | 2 | D-F-06, D-D-08 | Aynı kusur: seedRollLabelSnapshot {seeded:false} sessiz + labelDirty yine temizleniyor (sunucu ve istemci ayakları). |
| BULGU-T1-050 | 2 | D-F-07, D-G-13 | Aynı uç (PUT /admin/settings/:key): allowlist + tip/aralık doğrulaması yok. |
| BULGU-T1-052 | 2 | D-G-04, KYY-3-12 | Aynı guard (son-admin): tetikleyici pencereye bakmıyor + grantPermission'da hiç koşmuyor. |
| BULGU-T1-059 | 2 | D-I-01, D-J-12 | Aynı kök neden: /health alanlarının tüketicisi yok (auditGuard dahil) + bekçi metin araması. |
| BULGU-T1-066 | 2 | D-J-08, D-K-03 | Aynı kök neden: yumuşak kapı enforce edilmedi → test_db_invariants kalıcı kırmızı. |
| BULGU-T1-071 | 2 | D-K-09, D-L-01 | Aynı kusur: günlük seri NET, özet BRÜT (D-L-01 kod ayağı, D-K-09 bekçi ayağı). |
| BULGU-T1-073 | 2 | D-K-11, D-L-09 | Aynı kök neden: fason tek-kaynak AST bekçisi ham SQL kopyalarını görmüyor. |
| BULGU-T1-074 | 2 | D-K-12, D-L-11 | Aynı alan: advisory namespace envanteri/sıra bekçisi (D-K-12 bekçi, D-L-11 bayat yorum). |
| BULGU-T1-078 | 2 | D-K-17, D-K-16 | Aynı alan: parti no koruma modeli (D-K-17 paralel sonda yok, D-K-16 bekçi yorumları kodun tersi). |
| BULGU-T1-084 | 2 | KYY-3-04, KYY-2-17 | Aynı kusur: dispatchShipment guardları tx dışı; KYY-3-04 K3 repro. |
| BULGU-T1-089 | 2 | D-B-05, D-B-09 | Aynı kök neden: replayde payload kimlik karşılaştırması yok (içe aktarım + çuval + sevkiyat + açık kumaş + fason makbuz). |
| BULGU-T1-092 | 2 | D-A-16, KYY-2-11 | Aynı satırlar (db-copy.service.ts): blob read-modify-write, kuyruk yalnız bir çağrıda. |
| BULGU-T1-093 | 2 | D-H-04, D-A-17 | Aynı kök neden: barkod/parti sayacı kilidi uzun tx içinde + bekçinin döngü körlüğü. |
| BULGU-T1-095 | 2 | D-B-11, KYY-1-06 | Aynı satırlar (printed-document.service.ts:331-347): freezeForSource max+1, P2002 yakalanmıyor. |
| BULGU-T1-099 | 4 | D-C-09, D-L-16, D-G-12, KYY-2-12 | Aynı kök neden: enum/statü kümeleri tip düzeyinde exhaustive değil (RollStatus listeleri, entryTitle, variance kind, STATION_KIND_PERM). |
| BULGU-T1-106 | 2 | D-E-11, KYY-3-15 | Aynı fonksiyon (archivePrintedVersionTx upsert) + aynı akışın sürüm yarışı. |
| BULGU-T1-108 | 2 | D-F-09, D-H-10 | Aynı kök neden: toplu yazma şemalarında dizi tavanı eksik (kartela/parti/istasyon/şablon + applyAttributeToRolls). |
| BULGU-T1-109 | 2 | D-F-10, D-I-14 | Aynı kök neden: ham err.message 200 gövdesindeki uyarı alanlarına akıyor (~16 nokta). |
| BULGU-T1-118 | 2 | D-G-19, KYY-3-16 | Aynı uç (devices/announce): hız sınırı yok + tavan check-then-act. |
| BULGU-T1-119 | 2 | D-I-19, D-G-21 | Aynı kök neden: log/audit içeriğinde kişisel veri ve rotasyon doğrulanamıyor. |
| BULGU-T1-131 | 2 | D-I-16, KYY-2-16 | Aynı kök neden: boot joblarının iz asimetrisi (installation-identity + reason-preset-catalog vs permission-catalog). |
| BULGU-T1-146 | 2 | D-L-14, KYY-2-14 | Aynı fonksiyon (finalizeWarehouseCut): yorum var olmayan mekanizmayı anlatıyor + paralel/sıralı cevap ayrışması. |

## Modül dağılımı

| Modül | Adet |
|---|---|
| Çekirdek | 7 |
| ops/test | 5 |
| OPS | 5 |
| Fason | 4 |
| Kimlik | 4 |
| Belge / Etiket | 4 |
| İçe aktarım | 3 |
| migration | 3 |
| Belge | 3 |
| yedek/ops | 2 |
| İş emri | 2 |
| Envanter | 2 |
| Kimlik / Yetki | 2 |
| Çekirdek / Envanter | 2 |
| Raporlar / Sevkiyat | 2 |
| OPS / Çekirdek | 2 |
| Raporlar / Kalite | 2 |
| Eşzamanlılık altyapısı | 2 |
| Parti | 2 |
| Sevkiyat | 2 |
| Ops / Yedek | 2 |
| Ops / DB kopyası | 2 |
| Sipariş | 2 |
| Belge / Refakat kartı | 2 |
| Çekirdek / OPS | 2 |
| Envanter (Roll) / Tambur | 1 |
| Tambur / envanter | 1 |
| Üretim / Tambur | 1 |
| İş emri / envanter | 1 |
| KK1 · Sipariş · Sevkiyat · Çuval · Açık kumaş | 1 |
| Ana veri (BaseService + Item + Color + Fason) | 1 |
| İş emri / Fason | 1 |
| Sevkiyat / Sipariş | 1 |
| Envanter / Tambur | 1 |
| Üretim / Envanter | 1 |
| ops/test · yetki | 1 |
| Sevkiyat · Fason · İş emri · Sipariş | 1 |
| Fason · ops/test | 1 |
| Scriptler / audit | 1 |
| deploy + yedek | 1 |
| yedek/kurtarma | 1 |
| Sipariş / Sevkiyat | 1 |
| Çekirdek / hata yolu | 1 |
| Parti / Fason / İş emri | 1 |
| Çuval / Paketleme / Sevkiyat | 1 |
| İş emri / Üretim karakteristiği | 1 |
| Ops / Süreç / Yedek | 1 |
| Raporlar (karneler) / Envanter | 1 |
| Envanter / Üretim / Fason | 1 |
| Audit / Ops | 1 |
| Ana veri / Mükerrer paneli | 1 |
| Sipariş / İş emri | 1 |
| Sevkiyat / İade | 1 |
| Fason / Üretim | 1 |
| Üretim (Kurşun/KK2) | 1 |
| Kimlik / Sevkiyat | 1 |
| Üretim / Envanter / Ops | 1 |
| İçe aktarım / Çekirdek | 1 |
| Tanımlar / master-data | 1 |
| Üretim / İş emri | 1 |
| Çekirdek / Sistem ayarı | 1 |
| Belge / Üretim | 1 |
| Etiket | 1 |
| deploy | 1 |
| migration / ana veri / ops-test | 1 |
| migration / bekçi | 1 |
| sürüm politikası | 1 |
| Kurşun / KK2 | 1 |
| Fason / Raporlar | 1 |
| Tüm yazma yolları | 1 |
| Raporlar / Parti | 1 |
| Üretim / Ürün Dengesi | 1 |
| Sevkiyat / muhasebe izi | 1 |
| Envanter (Roll) / yetki | 1 |
| İş emri ↔ sipariş bağı | 1 |
| İçe aktarım / Sipariş | 1 |
| İçe aktarım / Çuval / Sevkiyat / Fason | 1 |
| Etiket / Belge | 1 |
| Üretim / Fason / Envanter | 1 |
| Fason makbuz iptali / İade iptali | 1 |
| Donmuş belge | 1 |
| Ops / bekçi | 1 |
| Çekirdek / Envanter / Çalışma oturumu | 1 |
| Üretim (Tambur) | 1 |
| Ana veri / merge | 1 |
| İş emri / Refakat kartı | 1 |
| İş emri / Sipariş | 1 |
| Kartela / Parti / Tanımlar / İş emri | 1 |
| İçe aktarım / Fason / İş emri / Ops | 1 |
| çapraz (Üretim/Sevkiyat/Envanter) | 1 |
| Arama | 1 |
| Kimlik / Cihaz | 1 |
| Çekirdek / Cihaz | 1 |
| Raporlar / Sipariş | 1 |
| OPS / audit | 1 |
| Ana veri | 1 |
| OPS / teşhis | 1 |
| Etiket / Baskı | 1 |
| OPS / telemetri | 1 |
| OPS / Tanımlar | 1 |
| Tanımlar / merge | 1 |
| Üretim | 1 |
| OPS / Boot job'ları | 1 |
| OPS / Yedek | 1 |
| dokümantasyon / migration | 1 |
| scripts | 1 |
| test kültürü | 1 |
| İade / Sevkiyat | 1 |
| Çuval / Sevkiyat | 1 |
| Ana veri / İstasyon | 1 |
| Çekirdek / Süreç | 1 |
| Tambur / depo kesimi | 1 |
| Sistem ayarı | 1 |
| Sebep kataloğu | 1 |
| İade | 1 |
| Cihaz | 1 |
| Sevkiyat / Çuval | 1 |
| Şema geneli | 1 |
| Çekirdek / boot | 1 |
| OPS / mobil güncelleme / telemetri | 1 |
| Çekirdek / Kimlik | 1 |
| Çekirdek / Hata | 1 |
| yedek | 1 |

## Notlar

- `dropped_as_seen` **boş**: `seen` listesi boş verildi, hiçbir bulgu 'zaten kayıtlı' diye elenmedi.
- Şiddet enflasyonu yapılmadı; kanıt seviyeleri kaynaklardaki EN YÜKSEK değerdir.
- K3 (repro kanıtlı) bulgular çürütme turunda öncelikli: 001, 002, 003, 004, 005, 006, 007, 008, 010, 025, 026, 028, 040, 045, 046, 084, 086, 089.
- Aynı düzeltme dokunuşunu paylaşan kümeler (planlama için): {004, 027, 086, 003} touchWorkOrderTx ilk ifade · {001, 085} claim pin genişletmesi · {026, 046, 155} error.middleware dal düzeni · {005, 089, 006} replay sözleşmesi · {019, 018, 138} productionDbGate ortak yardımcı · {015, 016, 076} CI/bekçi kapısı · {021, 022, 024, 168} yedek zinciri · {034, 043, 059} audit_guard ops adımı.
