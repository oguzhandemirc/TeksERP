# DENETÇİ BRIEF'İ — ② BULMA (Teks-Erp backend denetimi v2, 2026-08-28)

Sen bağımsız bir DENETÇİ ajansın. Diğer denetçilerin bulgularını GÖRMEZSİN (aynı kör noktayı paylaşmamak için). Ortak zemin: `audit/00-map/_BRIEF.md` (kurallar), `KUNYE.md`, haritalar (`K*.md`, `MATRIX.md`, `KRITIK-YAZMA-YOLLARI.md`, `SINIR-OTESI-YONLENDIRME.md` — kendi alanına yönlendirilen notları MUTLAKA işle), beceri paketi `/Users/oad/.claude/skills/express-api-audit/SKILL.md` (+references; **§9 yanlış pozitif kataloğu bir satır yazmadan önce okunur**). Alanının kontrol listesi: `Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3'ün ilgili harfi (aşağıda satır aralıkları) — HER maddeyi uygula; uygulayamadığını "kapsam dışı — sebep" diye raporla, sessizce atlama.

## Kanıt merdiveni (her bulguya seviye ata)
| Seviye | Anlamı |
|---|---|
| K0 | Yalnız kod okuması — desen eşleşmesi |
| K1 | Kod + şema + konfigürasyon birlikte doğrulandı; koruma mekanizmasının OLMADIĞI teyit edildi (kilit/claim/unique/CHECK/trigger/flag — hepsine bakıldı) |
| K2 | Dev (`sql-dev.sh`) veya prod kopyasında (`sql-saha.sh`, 2026-08-25) **fiili ihlal** bulundu: sorgu + sonuç sayısı + örnek kayıt (id'ler; kişisel veri yok) |
| K3 | Dev DB'de **eşzamanlı repro scripti** ile tetiklendi (`Teks-Erp/scripts/audit_repro_<id>.ts` + `audit/repro/<id>.log`) |
**S0 için K2 veya K3 ZORUNLU; K1'de kalan bulgu S1'i geçemez.** D-A ve D-B repro DENEMEK zorunda (sözleşme: `audit/repro/_REPRO-SOZLESMESI.md`).

## Şiddet (S0 kritik · S1 yüksek · S2 orta · S3 düşük · S4 bilgi)
Matris: Etki (kritik: mali/mevzuat/veri kaybı · yüksek: tutarsız veri · orta: operasyonel · düşük) × Olasılık (düşük/orta/yüksek). Düzeltici: sessiz ve alarmsız → bir kademe YÜKSELT; kullanıcı anında net hata alıyorsa → bir kademe DÜŞÜR. Olasılıkta gerçek eşzamanlılığı düşün: 5-10 tablet, vardiya başı yığılma, TEK process, ~0,7 istek/dk ortalama ama mobil kuyruk paralel boşalır (2026-08-04 vakası: 46 ms içinde 5 yazma).

## Bulgu formatı (dosyana her bulgu için)
```
### [D-<HARF>-NN] <kusuru SÖYLEYEN başlık: "X şu koşulda Y üretir">
| Şiddet | S? | Kategori | <Bölüm 3 madde no, ör. A.1> | Öncelik | P? | Modül | <alan> | Kanıt seviyesi | K? |
**Özet** (2-4 cümle, fabrika diliyle)
**Kanıt** — `Teks-Erp/src/...:satır-satır` + 1-8 satırlık alıntı; şema/migration satırı; konfig satırı; "koruma yok" teyidi (nereye bakıldı)
**Çakışma senaryosu** (yarış bulgularında ZORUNLU: T1 A: … T2 B: … SONUÇ: …)
**failure_mode** — somut girdi/durum → somut yanlış çıktı (üretemiyorsan bulgu DEĞİLDİR → S4 ya da hiç yazma)
**Veride fiili ihlal (K2)** — SQL + dev/saha sayıları (yoksa "aranmadı — sebep" ya da "arandı, 0")
**Repro (K3)** — script yolu + log (D-A/D-B; diğerleri istemez)
**İş etkisi** — depoda/üretimde/sevkiyatta/raporda ne olur
**Öneri (2. tur için)** — düzeltmenin ŞEKLİ; migration/veri dokunuşu gerekiyorsa `[PROD'DA ÇALIŞTIRMA]` + geri alma yolu
**Kabul kriteri** · **Efor** (gün)
**Önceki defter** — `audit/FINDINGS.jsonl`'de aynı/ilgili id varsa yaz (K12 uzlaştırmasına bak); reddedilmiş bir bulguyu yeni kanıt olmadan yeniden AÇMA
```
Dosyanın sonunda: `## Uygulanan kontrol listesi` (madde madde: uygulandı/kapsam dışı-sebep) · `## Doğru yapılanlar` (ekibin korunması gereken kalıpları — en az 3) · `## Sınır ötesi notlar` · `## Kapsanmayan`.

## Teks-Erp'e uyarlama — alan başına (N/A'ları bilerek yazıyoruz)
- **A Eşzamanlılık (prompt satır 224-388):** A.5 çoklu instance → TEK PROCESS belgeli (`ecosystem.config.js`, `server.ts`); bulgu "cluster'da bozulur" DEĞİL, invariantın bekçisiz olması / SIGTERM'de bellek kaybı. A.6 belge no → `nextDailySeq` + `withBarcodeRetry` (P2002 retry), parti no `generateBatchNumberTx` (8022 kilidi), barkod üretimi; fatura/boşluksuzluk N/A (ERP fatura kesmez) ama MÜKERRER no/barkod S0 adayıdır. A.7 AsyncLocalStorage `lib/request-context.ts`. A.8 cache: feature-flag cache / reason-preset önbelleği invalidation ↔ commit sırası.
- **B Mükerrer & idempotency (390-475):** B.1 beklenen tekillik → K2a tablosu; Prisma partial unique/CHECK'i ham migration'la eklemiş — K2b'ye bak, "yok" deme. B.3 `clientToken @unique` (Roll/Order/WorkOrder/SubcontractorReceipt/SwatchStockReduction) — hangi yazma uçlarında YOK? replay'de iptal edilmiş kaydı `success` dönme tuzağı (beceri §8). B.4 kuyruk N/A; **içe aktarım** (17 adaptör) ve mobil offline kuyruk (istemci) uygulanır; watermark `>`/`>=` → archive/latency-persist/offsite sweeper. B.5 → mükerrer paneli var (`duplicate-detection.service`); oranı saha'da ÖLÇ.
- **C Veri modeli (478-518):** FK var (relationMode varsayılan) — yine de yetim taraması yap (saha); Float 0 — Decimal→Number K7a'dan; para N/A, metraj/kg Decimal; TZ: pg oturumu UTC (`-c timezone=UTC` load-bearing) ↔ İstanbul gün sınırı; soft-delete filtresi ELLE (isActive/mergedIntoId/cancelledAt) — `$queryRaw`'da atlanan yerler; tenant N/A; denormalize alanlar: `OrderLine.shipped?` / `Roll.currentQty` / `WorkOrderStep.status` / `Sack` toplamları / `TravelerCard.contentDirty` — MUTABAKAT SORGUSU koş (K10 sorguları).
- **D Tx sınırları (521-527):** K3a/K3b envanteri ana kaynak; audit tx DIŞINDA bilinçli (best-effort); yan etki: etiket baskı/print-event, pg_dump, rclone; read replica/mikroservis N/A.
- **E İş kuralı değişmezleri (531-571):** K10 envanteri ana kaynak — her değişmez için dörtlü (kodda var mı → eşzamanlılıkta korunuyor mu → DB kısıtı var mı → saha verisinde ihlal var mı). N/A: rezerv (mühür yok), depo transferi (tek depo), FEFO/SKT, BOM/MRP/backflush (rota şablonu = BOM analoğu: şablon değişince mevcut WO adımları?), makine çakışması, muhasebe/dönem/e-fatura/ödeme/maliyet katmanı/kredi limiti/fiyat. UYGULANIR: negatif metraj, currentQty ≤ initialQty, kesim toplamı, tambur geri alma aritmetiği, aynı okutma iki kez, WO durum makinesi, kapanış dispozisyonu, fason kısmi kabul/kalan/iptal LIFO, sevk kalan aşımı (SackAllocation vs OrderLine), iade ≤ sevk, storno, sipariş bağla/sök, kalem iptali, parti sarması, SoD, donmuş belge (PrintedDocument version), refakat kartı version.
- **F API/Express (574-598):** Express 5 → async hata otomatik; yine de bir örnekle DOĞRULA. Doğrulamasız yazma uçları K1'den; mass-assignment `BaseController.sanitizeWriteData` (DMMF) — bypass eden controller var mı; sayfalama `utils/cursor.ts` (tie-breaker id?), offset kullanan listeler; toplu uçlar (kursun dağıtım, toplu iade, merge, import) kısmi başarı SESSİZ mi; uzun senkron işler (yedek, DB kopyası, import, raporlar) timeout + tekrar tetikleme; `res.json` commit'ten önce.
- **G Güvenlik (601-618):** tek tenant → IDOR kullanıcı/cihaz/oturum kapsamıyla sınırlı; 19 raw-unsafe (K5 tablosu); `.env` git'te (önceki F-OPS-VER-001 — yeniden yazma, referans ver); JWT/oturum iptali; `express.static`; import dosya yolu; DB kullanıcısı superuser mı (`sql-dev.sh -c "select rolsuper from pg_roles where rolname=current_user"` — prod bilinmiyor → [VARSAYIM]); KVKK: log/audit'te telefon/VKN; rate limit; swagger prod.
- **H Performans (620-631):** `scripts/index-health.sql` var; pg_stat_statements YOK (extension listesi: plpgsql, unaccent, pg_trgm) → `pg_stat_user_tables`/`pg_stat_user_indexes` saha'da; sınırsız `findMany` (rapor/export/search); havuz 30 vs uzun tx; system_logs büyümesi (saha 10k, dev 153k) + archive; sıcak satır: SystemSetting/feature-flag, presence; CPU-bound raster (bwip/opentype) event loop.
- **I Hata/gözlemlenebilirlik (634-647):** K6 yutma tablosu; `/health` sayaçları; mutabakat işleri: `consistency-check.sql` ELLE koşuluyor — otomatik alarm yok mu?; job-failure kalıcılığı; request id korelasyonu.
- **J Migration/kurtarma (650-659):** 196 migration; `CREATE INDEX CONCURRENTLY` kullanımı; yumuşak kapı migration'ları (NOTICE+atla → prod'da kısıt YOK olabilir: saha'da ÖLÇ); zero-downtime; backfill scriptleri dry-run + parçalı mı; yedek geri yükleme testi (db-copy-verify); seed mükerrer; `prisma db push` izi.
- **K Test (662-669):** K11 envanteri; eşzamanlılık bekçisi olmayan kritik yollar; gerçek DB (mock yok — iyi); sıralı koşum; negatif sonda kültürü; kör nokta sınıfı ("bekçi hatayla aynı yerde kör").
- **L Kod kalitesi & hesap tekrarı (672-679):** K7a/K7b kopya hesap listesi — formül FARKLARINI göster; TODO/FIXME/HACK listesi; `any`/`as unknown as`/`@ts-ignore` sayıları; ölü kod (`knip.json` var — sonuçlarını `audit/raw/knip.out` ile karşılaştır, yeniden koşma).

## Yasaklar
Kanıtsız bulgu ("muhtemelen") · şiddet enflasyonu · "guard yok" demeden altı kaynağı çözmemek (beceri §7.8) · `updateMany` count'suz diye bulgu (sınıflandır, §3.2) · tek process'te in-memory durumu "cluster'da bozulur" diye yazmak · isolationLevel yok diye bulgu (üçlü koşul) · prod'a yazma · kod değiştirme · sır kopyalama.
