# DENETİM BRIEF'İ — Teks-Erp backend denetimi v2 (2026-08-28)

Sen çok-ajanlı, SALT-OKUNUR bir denetimin ajanısın. Görevin ayrıca verildi; bu dosya ortak bağlam ve kuralları taşır. **Önce bunu, sonra `audit/00-map/KUNYE.md`'yi oku.**

## Yollar (mutlak)
- Repo kökü: `/Users/oad/Documents/projeler/AdnanSahin` · Backend: `Teks-Erp/` (`src/` 367 ts dosyası / 136k satır; `prisma/`; `scripts/`)
- Denetim çıktıları: `audit/` → `00-map/` (haritalar) · `01-find/` (bulgular) · `02-refute/` · `03-verify/` · `data/` (SQL + sonuç) · `repro/` (script logları) · `tours/`
- Proje kuralları: kök `CLAUDE.md` (karar notları özeti — TAM metinler `docs/history/CLAUDE-NOT-ARSIVI.md`), `Teks-Erp/CLAUDE.md`, `Teks-Erp/ARCHITECTURE.md` (1061 satır), `Teks-Erp/DB-MIMARI-DENETIM.md`
- **Beceri paketi — ZORUNLU OKU (yanlış pozitif kataloğu §9 dahil):** `/Users/oad/.claude/skills/express-api-audit/SKILL.md` ve `references/concurrency-patterns.md`, `references/layering-and-boundaries.md`, `references/state-and-scheduler.md`
- Önceki denetim (2026-08-09, **19 gün eski — kod çok değişti**; yalnız kapsama kontrol listesi olarak kullan, her şeyi güncel koddan yeniden türet): `audit/surface/*.md`, `audit/FINDINGS.jsonl` (geçerli satır = id'nin SON satırı; `jq -s 'group_by(.id)|map(.[-1])'`), `audit/PLAN.md`

## Kurallar (ihlali denetimi geçersiz kılar)
1. **SALT-OKUNUR.** `Teks-Erp/src`, `prisma`, `scripts`, `Electron`, `mobil` altında HİÇBİR dosyayı değiştirme/oluşturma. Yalnız sana söylenen `audit/...` çıktı dosyasını yaz (Write/Bash heredoc).
2. **DB erişimi yalnız iki araçla:** `audit/tools/sql-dev.sh` (dev `adnansahin_db`) ve `audit/tools/sql-saha.sh` (prod'un 2026-08-25 kopyası `tekserp_saha_0825`; 190/195 migration — son 5 migration'ın kolonları/tabloları orada YOK). İkisi de oturumu `default_transaction_read_only=on` ile açar; yazma sunucuda reddedilir. Kullanım: `audit/tools/sql-saha.sh -Atc "SELECT ..."` ya da `-f dosya.sql`. Canlı prod'a erişim yok; başka bağlantı kurma. Uzun sorgulardan kaçın (statement_timeout 120 sn).
3. **Kanıt zorunlu:** her iddia `dosya:satır` (repo köküne göre yol) ile. Emin olmadığını `[VARSAYIM]` etiketiyle yaz. Bir kontrol maddesini uygulayamıyorsan sessizce atlama — "kapsam dışı — sebep" yaz.
4. **grep disiplini:** `grep -rn "..." Teks-Erp/src --include='*.ts'` (tırnaklı include; zsh). Sayı ver, "temiz" deme. Generic tip argümanlı `new Map<...>()` gibi desenleri kaçırma.
5. **Sınır ötesi not:** kendi alanın dışında gördüğün her şeyi çıktının sonunda `## SINIR ÖTESİ NOTLAR` altında bırak (ilgili ajana yönlendirilecek).
6. **Sır/kişisel veri kopyalama:** `.env`, JWT secret, telefon/VKN vb. rapora girmez; yerini belirt.
7. Çıktı Türkçe; tablolar tercih edilir; dosya sonunda `## KAPSANMAYAN / ERİŞİLEMEYEN` bölümü zorunlu.

## Alan sözlüğü
Roll = top (kumaş topu; `RollStatus`: STOCK ham · IN_PRODUCTION · WAREHOUSE bitmiş depo · A1_STOCK 2. kalite · AT_SUBCONTRACTOR fasonda · SUBCONTRACTOR_CONSUMED · SHIPPED · SCRAP fire · CANCELLED iptal · AT_KARTELA/KARTELA_CONSUMED) · WorkOrder = iş emri (İE no) · WorkOrderStep = rota adımı · Batch = parti (P01…P99 dönen, benzersiz DEĞİL) · Station (RAW_QC=KK1 ham giriş · PROCESS_QC=Kurşun+KK2 · Tambur=kesim/kalite kararı · fason=EXTERNAL) · SubcontractorDispatch/Receipt = fason sevk/kabul (kısmi kabul var) · Sack = çuval (depo nesnesi) · Shipment = sevkiyat (PLANNED→DISPATCHED; SackAllocation; storno = undo-dispatch; RollReturn = iade) · Order/OrderLine = sipariş (İstenen|Sevk|Açık) · TravelerCard = refakat kartı (iş emriyle doğar, barkod okutulur) · Kartela/Swatch = kartela fasonu · RollVariance = sapma defteri · RollPlanDeviation = plan-sapma defteri · ReasonPreset = hazır sebep kataloğu · SystemLog = audit · Label/PPLB = etiket baskı · Metraj = metre (currentQty/initialQty), kg, en (width), adet.
Kritik proje kuralları: PRODUCTION CANLI; soft delete; her CUD → audit (best-effort, tx dışında); belge no `PREFIX+GGAAYY+NNNN` backend-authoritative (`nextDailySeq` + `withBarcodeRetry` P2002); idempotency `clientToken @unique`; durum geçişleri atomik claim (`updateMany WHERE {id, beklenen}` + `count===0 → 409`).
