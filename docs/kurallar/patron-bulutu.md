# Patron bulutu · Eşitleme · Rapor isteği

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Alan 2026-09-29'da doğdu (Plan B, patron bulutu). Hikâye, ölçüm ve gerekçe arşivde (`docs/history/CLAUDE-NOT-ARSIVI.md`, 2026-09-29 notları); burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.
> Tasarım: `docs/design/PATRON-BULUTU.md` (plan, kullanıcı kararları) · sözleşme `docs/design/PATRON-BULUTU-ESITLEME.md` (B1 · B3 protokolleri; sapmalar §14) · imza biçimi `docs/design/LISANS-PROTOKOLU.md`. Fabrika kodu `Teks-Erp/src/cloud-sync/` + `Teks-Erp/src/jobs/cloud-sync.job.ts`; katalog tek kaynak `src/cloud-sync/projections.ts`. Kod adları İngilizce, tel anahtarları ve kod DEĞERLERİ Türkçe.

## Fabrika eşitlemesi

### Değişmezler

- **[ÇEKİRDEK]** Bulut hesap yapmaz: türetilmiş her alan (açık miktar, bakiye, gecikmiş, brüt metre) fabrikada liste ekranının çağırdığı TEK KAYNAK yardımcıyla hesaplanıp projeksiyona girer; türetilmiş alanın okuduğu her tablo kökte, değişiklik kaynağında, tetikleyici işaretinde ya da gerekçeli kapsama listesindedir. · bekçi: `test_bulut_projeksiyon_allowlist (§4 türetilmiş · §5d yaşlandırma çekirdeği)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kolon listesi OPT-IN'dir: katalogda yazmayan kolon gitmez; serbest not, katlama ikizi, sır ve fabrika kullanıcı kimliği hiçbir projeksiyonda yoktur; iletişim/keşideci gibi kişisel alanlar yalnız `<ad>.kisisel`, tutarlar yalnız `<ad>.finans` alt satırında gider; anlık kayıtlar katı tel şemasından geçer. · bekçi: `test_bulut_projeksiyon_allowlist (§3 sızıntı · §5 canlı kurulum · §6 anlık)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Eşitleme ön koşulu FAIL-CLOSED'dur: kullanılabilir HAK URETIM ∧ `patron-bulut` hakkı ∧ kirada abonelik bitişi gelecekte ∧ kirada aralık ∧ DEVREDİLDİ değil ∧ lisans GEÇERLİ; belirsizlik de geçersizlik de göndermez, lisans kademesi göndermeyi durdurmaz; aralık ve aç/kapa yerel ayardan değil KİRADAN gelir. · bekçi: `test_bulut_filigran (§1 ön koşul · §10e abonelik)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Değişiklik tespiti audit'ten türetilmez: `(filigran, eşitlik bozucu)` taraması GÜVENLİ UFUKLA (açık tx'lerin en eskisinin başlangıcı − pay) okunur ve filigran YALNIZ bulutun `kabul` listesiyle ilerler; ret, 5xx ve ağ hatası konumu ilerletmez, ağ tekrarı aynı paket kimliğiyle gider. · bekçi: `test_bulut_filigran (§4 güvenli ufuk · §5 kabul · §6 eşitlik bozucu)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Silme tespiti DB'ye bağlıdır: her katalog kök tablosunda AFTER DELETE tetikleyicisi `sync_marks`a aynı tx'te SILINDI yazar (kaskad dahil); topun/çuvalın ESKİ ebeveyni ve `shipment_orders` kümesi KIRLI işaretlenir; kök tablo listesi ↔ migration ↔ DB iki yönlü ölçülür. · bekçi: `test_bulut_silme_damgasi (§1 envanter · §2 aynı tx · §3 kaskad · §4 ayrılma · §7 tüketim)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** `sync_marks` TELEMETRİ'dir (defter değil): bulutun onayladığı zincirin gerisinde kalan ve 7 günden eski işaret budanır, eşitleme durmuşsa 30 günden eskisi de; budayan tek dosya `src/cloud-sync/marks-pruning.ts`. · bekçi: `test_bulut_silme_damgasi (§8 budama)`, `test_telemetri_defter_degil (§3 budayan beyanlı)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Katalog tablolarına `updatedAt` YAZMAYAN her ham UPDATE beyanlıdır (`scripts/lib/bulut-ham-update-beyan.ts`): birleştirme ailesi `merge_operations` defterinden görülür, diğerleri türetmenin okumadığı kolona yazar; opt-in kolona `updatedAt`siz ham yazım yoktur (`payment-allocation` sayaçları `updatedAt=NOW()` yazar). · bekçi: `test_bulut_ham_update (§2 · §3 · §4)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Günlük uzlaştırma (fabrika saatiyle 03:30 sonrası) kümeyi son ONAYLI ufuktan önce doğmuş satırlarla, kapsam yükleminin SQL ikiziyle ve bulutun saklama ufkuyla özetler; uyuşmazlık o projeksiyonu TAM gönderime sokar, TAM ilk parçasında zinciri sıfırdan kurar ve bulut işaretle-süpür yapar. · bekçi: `test_bulut_uzlastirma (§1 biçim · §2 kapsam ikizi · §3 döngü · §4 onay sınırı · §5 saklama)` <sub>(arşiv:2026-09-29)</sub>

### Kararlar

- **[ÇEKİRDEK]** Zamana bağlı türetilmiş alan (`gecikmis`, `vadesiGecti`) bulutta hesaplanmaz: termin/efektif vade (önceki konum, ufuk] aralığına düşen kökler geçiş kaynağıyla yeniden gönderilir. · bekçi: `test_bulut_projeksiyon_allowlist (§4a geçiş kaynağı)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Rapor isteği fabrikanın KENDİ parametre şemasıyla doğrulanır (tanınmayan → `PARAMETRE_GECERSIZ`), `audit/*` ve kişi adı taşıyan rapor buluttan istenemez (`RAPOR_BILINMIYOR`), kapalı rapor ve kapalı modül buluta da kapalıdır; standart dönem görüntüleri saatlik ve içerik değişmedikçe tekrar gitmez. · bekçi: `test_bulut_filigran (§9 rapor isteği · §10 iş)`, `test_bulut_projeksiyon_allowlist (§9 uzak raporlar)` <sub>(arşiv:2026-09-29)</sub>
- **[ÇEKİRDEK]** Kapı zili tek SSE aboneliğidir: `lisans` konusu lisans yoklamasında kalır, diğer konular (`ozet` · `rapor` · `gelen-kutusu`…) `jobs/doorbell-topics.ts` dağıtıcısına gider; zil içerik taşımaz, sahte zil yalnız fazladan tur yaptırır (anlık tur 30 sn'de en çok bir). · bekçi: `test_bulut_filigran (§8c · §8d zil)` <sub>(arşiv:2026-09-29)</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (kendi `_test` DB'si; sahte bulut döngü adresinde düz HTTP). Ağır koşum `node scripts/agir-is.mjs -- …` ile.

**Ne ölçtükleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → `## patron-bulutu` bölümü.**

Backend: `test_bulut_filigran`, `test_bulut_silme_damgasi`, `test_bulut_uzlastirma`, `test_bulut_projeksiyon_allowlist`, `test_bulut_ham_update`

Yeni patron bulutu bekçisi doğduğu commit'te bu listeye VE haritanın `## patron-bulutu` bölümüne birlikte eklenir. Katalog ya da tetikleyici değişince `test_db_invariants` (TRIGGERS/EXPECTED_FUNCTIONS) de koşulur.

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-29 · Patron bulutu: B-turları kararları (Plan B) — 2026-09-01 bulut ayna reddi KISMEN GEÇERSİZ
- 2026-09-29 · Patron bulutu eşitlemesi (B1-kod): katalog kodda, silme tetikleyiciyle, filigran güvenli ufukla, fail-closed ön koşul
