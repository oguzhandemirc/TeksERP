# Test ve derleme — ne zaman ne koşar

Bu dosya **kadansı** tarif eder: hangi kapı hangi anda koşar ve neyi garanti eder. Bekçi yazma sözleşmesinin tamamı `Teks-Erp/CLAUDE.md` § "Bekçi (test) yazma sözleşmesi"nde; alan → bekçi haritası `Teks-Erp/docs/BEKCI-HARITASI.md`'de.

Kural biçimi: [`README.md`](README.md).

---

## 1 · Kadans

| An | Ne koşar | Ölçülen süre | Kapı |
|---|---|---|---|
| Düzenleme sırasında | hiçbir şey | — | — |
| Değişiklik bitince | dokunulan alanın bekçileri + o projede tip kontrolü | 1–3 dk | model disiplini · `/bekci-kos` |
| **Commit** | değişen alt projede tip + lint + lint tavanı; Electron/mobil değiştiyse o projenin hızlı test paketi; migration/bekçi dokunulduysa hijyen; `.md` dokunulduysa doküman kapısı | 15–145 sn | `.githooks/pre-commit` |
| PR / push öncesi | backend tam bekçi paketi | **6 dk 28 sn** | `npm test` |
| CI | docs · backend (lint + tavan + tip + tam paket) · Electron (lint + tavan + tip + vitest) · mobil (lint + tavan + tip + jest) | uzun | `.github/workflows/ci.yml` |
| Sürüm | sürüm notu kapısı + paketleme kapıları | — | `scripts/check-surum-notlari.mjs`, `deploy/*` |

- **[TD-01]** Backend tam paketi commit kadansında DEĞİLDİR; PR/push öncesindedir · zorlama: hook:`.githooks/pre-commit` (backend testi listede yok) · kanıt: ölçüm 6:28 — commit başına ödenemez
- **[TD-02]** "`npm test` saatler sürer" cümlesi YANLIŞTIR ve tam paketi koşmamanın gerekçesi olarak kullanılmaz · zorlama: insan:cümle bir belge iddiasıdır, koddan ölçülmez · kanıt: 2026-09-05 ölçümü — 453 dosya, 369 sn koşum + 28 sn tip geçidi
- **[TD-03]** Electron `vitest run` 23 sn, mobil `jest --runInBand` 29 sn — ikisi de commit kadansına sığar ve o yüzden hook'tadır · zorlama: hook · kanıt: ölçüm 2026-09-05 — üç proje birden değiştiğinde kapı 13 adım / 142 sn, tek proje değiştiğinde 30-50 sn

## 2 · Commit kapısı

```bash
node scripts/hooks-kur.mjs           # kur (git config core.hooksPath .githooks)
node scripts/hooks-kur.mjs --durum   # kurulu mu
TEKSERP_HOOK_SKIP=1 git commit …     # bilerek atla
```

- **[TD-04]** Kapı `core.hooksPath` ile kurulur, `.git/hooks`'a kopyalanmaz — `.git/hooks` versiyonlanmaz, her klon kapısız başlar ve kimse fark etmez · zorlama: hook · kanıt: 2026-09-05 ölçümü (yerelde hiç hook yoktu; main'de 9 tip hatası ve 7 kırmızı test bir gün durdu)
- **[TD-05]** Kapı **değişene orantılıdır**: yalnız staged dosyaların ait olduğu alt projede koşar · zorlama: hook:`scripts/hooks/lib/staged.mjs` · kanıt: proje çözümü tek kaynak (Claude'un Bash hook'u da aynı modülü kullanır)
- **[TD-06]** Kaçış (`TEKSERP_HOOK_SKIP=1` / `--no-verify`) bir karardır: kırmızıyı bilerek geçiyorsan commit mesajında söyle · zorlama: insan:kaçışın meşru olup olmadığı yalnız niyetten bilinir · kanıt: emsal `cdcb73f4` — kapı aynı staged küme üzerinde 13/13 yeşil ölçüldükten sonra üçüncü kez koşturmamak için atlandı ve gerekçe commit mesajında yazılı

## 3 · Bekçi paketi — mekanik gerçekler

- **[TD-07]** Test altyapısı `scripts/test_*.ts`; jest/vitest **backend'de yoktur ve kurulmaz** · zorlama: bekçi:`run-all-tests.ts` yalnız `test_*.ts` toplar · kanıt: 458 dosya (2026-09-06). ⚠️ Gerekçe "vitest bunu koşamaz" DEĞİLDİR — koşardı (`fileParallelism:false` + `globalSetup` + `pool:'forks'` üç geçidi ve sıralılığı karşılar). Gerekçe dönüşüm bedeli: 458 dosya / ~134k satır ve mock kültürü riski. Kazancın kaynağı framework'süzlük değil MOCK YOKLUĞU: 392 dosya (%85,8) gerçek Postgres'e yazar ve test edilen şeyler (DEFERRABLE FK, partial UNIQUE sed, `pg_advisory_xact_lock`, DB CHECK, trigger damgası) mock'lanamaz
- **[TD-08]** Paket **sıralı** koşar: bekçiler aynı dev veritabanını paylaşır, paralel koşum fixture çakışması üretir · zorlama: insan:sıralılık koşucunun tasarımıdır, kural olarak ölçülecek bir şey yok · kanıt: `run-all-tests.ts` başlığı
- **[TD-09]** Paket üç geçitten geçer ve üçü de FAIL-CLOSED: üretim-DB kapısı → tip kontrolü (~28 sn) → **migration durumu** · zorlama: bekçi:`run-all-tests.ts` · kanıt: migration kapısı olmadığında 453'ün 134'ü kırmızı veriyordu ve teşhis `TableDoesNotExist` stack'i olarak bırakılıyordu (2026-09-05)
- **[TD-10]** Tek bekçi `npx tsx scripts/run-all-tests.ts <ad-parçası>` ile koşulur — doğrudan `npx tsx scripts/test_x.ts` üretim-DB kapısını ATLAR · zorlama: insan:hangi yolun kullanıldığı çağıranın kararıdır · kanıt: `productionDbGate` koşucunun kapısıdır
- **[TD-25]** Bekçi özet satırını koşucunun TANIDIĞI formatta basar (`=== Sonuç: N geçti, M başarısız ===`; `kaldı` ve `N/T geçti` de tanınır). Tanınmayan format kontrol sayısını GİZLER — koşucu "geçti (exit 0)" yazar ve sayı sıfıra düşse bile fark edilmez · zorlama: bekçi:`test_bekci_sozlesmesi.ts` (körlük zemini 400 dosya, muafiyet listesi iki yönlü) · kanıt: ölçüm 2026-09-06 — üç dosya ihlal ediyordu (`test_manual_move_backflush` + `test_manual_move_qc_reversal` İngilizce `N passed, M failed`, `test_depo_roll_cancel_permission` "düştü") ve 46 kontrol görünmüyordu

## 4 · Yeşil ≠ kapsandı

- **[TD-11]** Sunucu isteyen bekçi bölümünü atlarsa bunu ÇIKTIDA söyler ve koşucu özeti atlanan kontrol sayısını basar · zorlama: bekçi:`run-all-tests.ts` (`⚠️ N atlandı`) · kanıt: ölçüm — 8 dosyada 65 kontrol sessizce atlanıyordu (`test_superadmin` tek başına 21)
- **[TD-11a]** Atlanan kontrol sayısı **ÖZET SATIRINDA** beyan edilir (`=== Sonuç: N geçti, M başarısız, K atlandı ===`); serbest metindeki "atlandı" kelimesi bir sayaç DEĞİLDİR · zorlama: bekçi:`run-all-tests.ts` regex'i `Sonuç:` satırına DEMİRLİ · kanıt: ölçüm 2026-09-06 — serbest regex üç dosyada HAYALET sayı üretiyordu (`test_label_bulk_seed` hiçbir şey atlamadan "3 atlandı", `test_finance_flag_off` gerçek 6 iken "5", `test_label_dirty_sources` gerçek 1 iken "7")
- **[TD-12]** Ayrı sunucu isteyen bekçiler kendi portunu bekler: finance 4100 · module_flag_off 4101 · superadmin 4104 · settings_password 4112 · module_profile 4122. Sunucu `PORT=<port> npx tsx src/server.ts` ile ayrı bir süreçte kaldırılır; `pkill` YASAK · zorlama: hook:`bash-guard.mjs` · kanıt: `Teks-Erp/CLAUDE.md`
- **[TD-13]** Her sayım bekçisi **körlük zemini** taşır: "0 bulgu" ile "hiç bakılmadı" ayrımını kendisi ölçer · zorlama: insan:zeminin GERÇEK bir körlük ölçüsü olup olmadığı anlamla bilinir · kanıt: `test_station_quality_capability` (dosya bazlı ilk yazım kördü, sayım bazlıya çevrildi)

## 5 · Yeni bekçi

- **[TD-14]** Yeni bekçi **negatif sondayla** yazılır: korunan davranış kasten bozulunca KIRMIZI verdiği ölçülür ve kaç kontrol/kaç sonda olduğu commit mesajına yazılır · zorlama: insan:sondanın kendisi mekanik ölçülemez · kanıt: `docs/RECETELER.md` § bekçi
- **[TD-15]** Sondanın kendisi kataloğa girebilecek GERÇEK bir kod/değer kullanmaz — kullanırsa sonda değil, veri üretir · zorlama: insan:sondanın 'gerçek kod kullanıp kullanmadığı' kataloğu bilmeyi ister · kanıt: 2026-08-13 kat kataloğu vakası
- **[TD-16]** Fixture **business-key** ile kurulur, `TEST-`/`TST-` ön ekiyle damgalanır ve **damga ADI da kapsar**: ad üzerinde canlı partial UNIQUE sedleri vardır (`colors_nameFoldColor_key`, `items/customers/subcontractors_nameFold_key`), damgasız ad yarım kalan bir koşumdan sonra ikinci koşumu P2002'ye düşürür · zorlama: insan:fixture'ın adının da damgalı olup olmadığını ölçen bir kapı YOK — `test_master_data_name_dup §10/§10a-d` SEDDİN kendisini ölçer (hangi `nameFold` tablosunda partial UNIQUE var, ısırıyor mu), bekçilerin fixture adlandırmasını değil · kanıt: sed envanteri `Teks-Erp/scripts/test_master_data_name_dup.ts:418-499`, ısırma ispatı `:499-568`; 2026-09-05'te dört bekçi tam bu yüzden kırmızıydı
- **[TD-17]** Bekçi ortamdaki veriye bağımlı olmaz: "herhangi bir kayıt bul" (`findFirst`) üstüne kurulan test temiz CI veritabanında düşer ya da vakumen yeşil kalır — sayım kontrolleri kendi fixture'ını süzer · zorlama: insan:'ortam verisi mi fixture mı' ayrımı sorgunun niyetinde · kanıt: `test_field_address` / `test_fason_visibility` emsali
- **[TD-18]** Temizlik `finally` içinde ve FK sırasına göre yapılır; fason kabulü yapan her temizlik `rollVariance.deleteMany` içerir (RESTRICT FK) · zorlama: insan:FK sırası şemadan türetilebilir ama temizliğin TAMLIĞI türetilemez · kanıt: 2026-08-21 (23 dosya güncellendi)
- **[TD-19]** Yarış bekçisi elle açık tutulan bir transaction ile kurulur; henüz `await` edilmemiş gate promise'ine no-op `.catch` konur — yoksa unhandled rejection süreci Sonuç satırı basılmadan öldürür (en sessiz kırmızı) · zorlama: insan:pencerenin gerçekten açıldığı yalnız koşumla görülür · kanıt: `test_payment_allocation §12m`
- **[TD-20]** Kod değişikliği ve bekçisi AYNI commit'te gelir · zorlama: insan:aynı commit kuralı git geçmişinde ölçülür, kodda değil · kanıt: ölçüm — src'ye dokunan commit'lerin %78'i aynı commit'te test de değiştiriyor
- **[TD-26]** Bekçi iş verisini `seed`den değil `seed:fixtures`tan ya da kendi fixture'ından çözer; `npm run seed` yalnız TEMİZ FABRİKA iskeletini kurar (müşteri/renk/ürün YOK) · zorlama: bekçi:`ci.yml` ayrı `seed:fixtures` adımı · kanıt: `.github/workflows/ci.yml` — adım eksikken 73 bekçi "Seed fixture eksik: PATOS" ile düştü ve ~2 hafta görülmedi
- **[TD-27]** Paylaşılan yardımcı/fixture dosyasına `test_` ön eki VERİLMEZ (`fixture-*.ts` kalıbı) — koşucunun süzgeci `^test_.*\.ts$` onu bir bekçi sanır · zorlama: bekçi:`run-all-tests.ts` süzgeci · kanıt: `Teks-Erp/scripts/fixture-test-user.ts`; bugün 5 dosya bu kalıpta
- **[TD-28]** Yeniden deneme YALNIZ altyapı arızasında yapılır (DB bağlantısı); assertion hatası ASLA yeniden denenmez ve "ikinci denemede geçti" satırı yeşil değil BORÇTUR · zorlama: bekçi:`run-all-tests.ts` `looksInfrastructural` deseni + flake listesi · kanıt: koşucu gerekçesi — paket sırayla 458 havuz açar, `connectionTimeoutMillis=5s` ara sıra aşılır
- **[TD-29]** Bir bekçi, ölçtüğü davranış kalktığında AYNI commit'te SİLİNİR ve sebebi commit mesajına yazılır; "ihtimale karşı" bırakılan bekçi bir NİYETTİR · zorlama: insan:davranışın gerçekten kalktığı yalnız anlamla bilinir · kanıt: bugün politika yok — `BEKCI-HARITASI.md` 455 sayarken dizinde 458 var (2026-09-06)
- **[TD-30]** Kapsam (coverage) bu repoda ÖLÇÜLMEZ ve hedef konmaz; güvence ölçüsü negatif sonda ([TD-14]) + körlük zeminidir ([TD-13]) · zorlama: insan:beyan · kanıt: ölçüm 2026-09-06 — üç projede de coverage aracı/konfigürasyonu YOK (grep 0 isabet)

## 6 · Derleme

- **[TD-21]** Tip kontrolü projenin kendi `typecheck` script'iyle koşulur; Electron'da çıplak `npx tsc --noEmit` **hiçbir dosyayı derlemez** (kök `tsconfig.json` `files:[]` + `references`, `-b` yok) · zorlama: hook + CI · kanıt: 2026-09-05 — CI'ın "Type-check" adımı bu yüzden no-op'tu ve 9 tip hatası main'de bir gün durdu
- **[TD-22]** `tsc` çıktısı boruda renklidir: "temiz" hükmü ÇIKIŞ KODUNDAN verilir, grep'lenecekse `*:plain` varyantı kullanılır · zorlama: insan:hüküm çıkış kodundadır; metin taramasıyla ayırt edilemez · kanıt: `Teks-Erp/CLAUDE.md`
- **[TD-23]** Backend lint kapsamı `Teks-Erp/src` + `Teks-Erp/scripts` + `Teks-Erp/prisma` (2026-09-05'te açıldı; `scripts/` 554 dosya ve seed'ler hiç lint edilmiyordu); kapsam değişirse lint script'i, `scripts/check-lint-baseline.mjs` ve CI **birlikte** güncellenir · zorlama: bekçi:`scripts/check-lint-baseline.mjs` (depo KÖKÜ — `Teks-Erp/scripts/` altında DEĞİL) `EN_AZ_DOSYA` körlük zemini · kanıt: aynı boşluk tsc'de yaşandı (`scripts/` hiçbir tsconfig'in include'unda değildi → 87 tip hatası birikmişti)
- **[TD-24]** Lint uyarıları sessizce birikmez: tavan `lint-baseline.json`'da ve yalnız düşer · zorlama: bekçi:`scripts/check-lint-baseline.mjs` (depo KÖKÜ; üç projeyi birden okur, `--proje=<ad>` ile daraltılır) · kanıt: Electron 37 / mobil 136 uyarıyla yeşil geçiyordu

## 7 · Bilinen sınırlar

Bunlar bilinçli açıklardır; kapatılmaları ayrı iştir.

- **Paket sıralıdır. Paralelleştirme ÖLÇÜLDÜ ve BU TURDA YAPILMADI (2026-09-06).** Şema izolasyonu yetmez — `pg_advisory_xact_lock` veritabanı kapsamlıdır (`batch.service.ts:126` 8022, `master-data-merge.service.ts` 8030, `permission-management.service.ts:699` 8025) ve 8 bekçi şema adını `'public'` sabitler. DB-per-worker bu ikisini de kaldırır ve **prova edildi**: 6 işçi DB'si (`migrate deploy` + `seed` + `seed:fixtures`) paralel **15 sn**de kuruldu, tam paket **333 sn → 144 sn** (2,3×; iki koşumda aynı kırmızı kümesi, deterministik). Yapılmama gerekçesi kazancın küçüklüğü değil bedelin şekli: (1) kadans PR/push başına, yani kazanç ~3 dk × günde birkaç koşum; (2) koşucu bizim olduğu için işçi havuzu, çıktı tamponlama, N+1 kapı doğrulaması ve işçi-DB sağlaması ELLE yazılır (~150-200 satır); (3) **kalıntı sorununu ÇÖZMEZ** — 458/6 ≈ 76 bekçi hâlâ aynı DB'de ardışık koşar, `TEST-` damgası ve `finally` temizliği aynen gerekir; (4) önce aşağıdaki 12 ortam-bağımlı bekçi düzelmeli.
- **12 bekçi ortamdan besleniyor — temiz DB'de kırmızı veriyorlar (ölçüldü 2026-09-06, iki koşumda aynı).** Sıfırdan kurulmuş DB'de 446/457 geçti; paylaşılan `tekserp_demo` yerine temiz işçi DB'sinde koşunca şunlar düşüyor: `test_auto_draft_shipment` · `test_fold_catalog` · `test_goods_receipt_invoice` · `test_kanban_card_projection` · `test_module_grandfathering` · `test_module_profile` · `test_order_cancellation` · `test_record_provenance` · `test_roll_po_line_trace` · `test_scan_code_case` · `test_scrap_grade_label` · `test_wip_scorecard`. Bu [TD-17]'nin ölçülmüş listesidir; kırmızı/yeşil ayrımı koddan değil ORTAMDAN doğuyor.
- **İşçi/test veritabanının adı `_test` ile BİTMELİ** (`tekserp_w1_test` ✔ · `tekserp_test_w1` ✘). `scripts/db-guard.ts` izinli son ekleri (`_dev`/`_test`/`_local`/`_demo`) `endsWith` ile eşler; yanlış adda `assertGelistirmeVeritabani()` çağıran bekçiler ilk ifadede durur (`test_manual_move_fason_receive` bu şekilde düştü).
- **e2e ve load-test job'ları `continue-on-error`** — sinyal üretirler, kapı kurmazlar (`ci.yml`).
- **Stryker (mutation testi) CI'da hiç koşmuyor**; config'e son dokunuş 2026-06-14. `Electron/CLAUDE.md`'deki komut listesi onu bir kapı gibi göstermez.
- **`check-migrations.mjs`'in değeri yereldedir**: CI'da temiz checkout yüzünden "untracked migration / eksik migration.sql" kapıları yapısal olarak hep yeşildir. Bu yüzden commit kapısındadır.
- **13 kural `docs/KOD-KURALLARI.md`'de "bekçi: yok" etiketiyle** durur — beyan edilmiş, ölçülmemiş. Etiket bilerek oradadır: ölçülmemiş kural bir NİYETTİR.
- **Backend bekçilerinin 153'ü 300 satırdan uzun** (p50 217 / p90 524 / max 1.914). Devralınan; yeni bekçi ≤400 satır, 600'ü geçen bölümlere değil DOSYALARA bölünür.
