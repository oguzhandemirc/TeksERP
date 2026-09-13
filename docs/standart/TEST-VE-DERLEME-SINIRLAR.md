# Bekçi paketi — bilinen sınırlar ve bilerek kırmızılar

[`TEST-VE-DERLEME.md`](TEST-VE-DERLEME.md)'nin §7'si; 2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 745 bayt kalmıştı, tavan yükseltilmedi). Ayrım çizgisi bugünkü diğer üç bölmeyle aynı: **kural kalır, ENVANTER ayrılır.** §8 bu turda yeni açıldı.

⚠️ **Bölüm numarası KORUNDU** — `TEST-VE-DERLEME.md §7` diye işaret eden çapalar hedefini bulmalıdır.

Kadans, commit kapısı, paket gerçekleri ve derleme orada kaldı; "yeşil ≠ kapsandı" (§4) ile yeni bekçi yazımı (§5) [`TEST-VE-DERLEME-BEKCI.md`](TEST-VE-DERLEME-BEKCI.md)'de: `docs/standart/TEST-VE-DERLEME.md`.

---

## 7 · Bilinen sınırlar

Bunlar bilinçli açıklardır; kapatılmaları ayrı iştir.

- **Paket sıralıdır. Paralelleştirme ÖLÇÜLDÜ ve BU TURDA YAPILMADI (2026-09-06).** Şema izolasyonu yetmez — `pg_advisory_xact_lock` veritabanı kapsamlıdır (`batch.service.ts:126` 8022, `master-data-merge.service.ts` 8030, `permission-management.service.ts:699` 8025) ve 8 bekçi şema adını `'public'` sabitler. DB-per-worker bu ikisini de kaldırır ve **prova edildi**: 6 işçi DB'si (`migrate deploy` + `seed` + `seed:fixtures`) paralel **15 sn**de kuruldu, tam paket **333 sn → 144 sn** (2,3×; iki koşumda aynı kırmızı kümesi, deterministik). Yapılmama gerekçesi kazancın küçüklüğü değil bedelin şekli: (1) kadans PR/push başına, yani kazanç ~3 dk × günde birkaç koşum; (2) koşucu bizim olduğu için işçi havuzu, çıktı tamponlama, N+1 kapı doğrulaması ve işçi-DB sağlaması ELLE yazılır (~150-200 satır); (3) **kalıntı sorununu ÇÖZMEZ** — 458/6 ≈ 76 bekçi hâlâ aynı DB'de ardışık koşar, `TEST-` damgası ve `finally` temizliği aynen gerekir; (4) önce aşağıdaki 12 ortam-bağımlı bekçi düzelmeli.
- **~~12 bekçi ortamdan besleniyor~~ → ONİKİSİ DE ONARILDI (2026-09-06).** Temiz DB ölçümünün ortaya çıkardığı kümenin tamamı kapatıldı ve kök nedenler **dört sınıfa** ayrıldı: ① **ön koşulu varsayma** — `finance`/`iplik`/`ticaret` bayrağının ortamda açık olduğunu sanmak (üçü de artık kendi ön koşulunu kurup `finally`de geri yüklüyor; birinde etkin değer İKİ bayrağın ÇARPIMIYDI). ② **başka bir bekçinin teardown'ı migration verisini silmişti** — dört modül anahtarı satırı geri yüklendi (`depo.multiEnabled` VERİDEN türetilir). ③ **ortamda fixture arama** — `test_record_provenance` auditsiz kayıt/ikinci kullanıcı/`createdById`li iş emri, `test_kanban_card_projection` en az bir top, `test_scrap_grade_label` `skipLabel` kademeli toplar arıyordu; dördü de artık fixture'ını KENDİ yaratıyor. ④ **ortamdaki kayıt SAYISINA bağımlılık** — `test_sack_customer_gate` liste sayfasına (≈101 satır) sığacağını varsayıyordu; artık kendi öneğiyle süzüyor. **⑤ GRANÜLARİTE UYUŞMAZLIĞI (2026-09-13)** — ön koşul kontrolü VAR ama gövdenin ihtiyacından KABA: yeşil verir, gövdeyi taşımaz (`test_module_profile` §7a "en az BİR modül satırı" soruyordu, gövde BELİRLİ BİR satır varsayıyordu → P2025). ①'den farkı: orada kontrol YOK, burada kontrol YANLIŞ ÇÖZÜNÜRLÜKTE. ⚠️ `test_scrap_grade_label` fixture'ı yazarken bir ders daha çıktı: kapı kademeyi İLİŞKİDEN değil ESKİ `qualityGrade` METİN kolonundan çözüyor — yalnız `qualityGradeId` yazmak §5'i çalıştırıp §6'yı SESSİZCE geçiriyordu.
- **İşçi/test veritabanının adı `_test` ile BİTMELİ** (`tekserp_w1_test` ✔ · `tekserp_test_w1` ✘). `scripts/db-guard.ts` izinli son ekleri (`_dev`/`_test`/`_local`/`_demo`) `endsWith` ile eşler; yanlış adda `assertGelistirmeVeritabani()` çağıran bekçiler ilk ifadede durur (`test_manual_move_fason_receive` bu şekilde düştü).
- **e2e ve load-test job'ları `continue-on-error`** — sinyal üretirler, kapı kurmazlar (`ci.yml`).
- **Stryker (mutation testi) CI'da hiç koşmuyor**; config'e son dokunuş 2026-06-14. `Electron/CLAUDE.md`'deki komut listesi onu bir kapı gibi göstermez.
- **`check-migrations.mjs`'in değeri yereldedir**: CI'da temiz checkout yüzünden "untracked migration / eksik migration.sql" kapıları yapısal olarak hep yeşildir. Bu yüzden commit kapısındadır.
- **13 kural `docs/KOD-KURALLARI.md`'de "bekçi: yok" etiketiyle** durur — beyan edilmiş, ölçülmemiş. Etiket bilerek oradadır: ölçülmemiş kural bir NİYETTİR.
- **Backend bekçilerinin 153'ü 300 satırdan uzun** (p50 217 / p90 524 / max 1.914). Devralınan; yeni bekçi ≤400 satır, 600'ü geçen bölümlere değil DOSYALARA bölünür.

---

## 8 · Bilerek kırmızı bekçiler — tek liste

**Neden tek liste:** paket kırmızı verdiğinde ilk soru *"bu gerçek mi"*dir. Cevabı her seferinde yeniden aramak pahalıdır ve daha kötüsü, **dördüncü GERÇEK kırmızı *"herhalde o bilinenlerden"* diye geçilir** — liste tam da engellemek için kurulduğu şeyi üretir.

**Bu yüzden `kim kapatabilir` alanı ZORUNLUDUR.** Aşağıdaki dört satırın sahipliği üç ayrı sınıfta: biri kullanıcının iş kararı, biri bir config satırı, ikisi kurulum verisi. Sahibi yazılmamış bir satır listeye GİRMEZ — çünkü "bilerek kırmızı" demek "kimsenin işi değil" demek değildir.

| Bekçi · bölüm | Sebep | Kim kapatabilir | Kapanınca |
|---|---|---|---|
| `test_hook_config` **§2** | `.claude/settings.json` komut kapısını GÖRELİ yolla çağırıyor (`node scripts/claude-hooks/bash-guard.mjs`, `:23`). Kabuk kökten çıktığı an node dosyayı bulamaz, Claude Code hatayı NON-BLOCKING sayar ve **kapı sessizce yok sayılır**. Ölçüldü: 4.962 ölü-kapı olayı, 24 ayrı yanlış dizin (36 oturum günlüğü, `toolUseID` ile kesin eşleme). | **YALNIZ KULLANICI.** Düzeltme `.claude/settings.json`dadır ve o dosya kullanıcının ajanlar üzerindeki DENETİM YÜZEYİDİR — hiçbir ajan düzenleyemez. Önerilen satır: `"command": "node \"${CLAUDE_PROJECT_DIR}\"/scripts/claude-hooks/bash-guard.mjs"` | §2 kendiliğinden yeşile döner (9/0); elle bir şey yapılmaz |
| `test_consistency` **§1c/§1d**<br>⚠️ yalnız **fabrika verisinde** | Sevk edilen malın bir kısmı sipariş defterine yazılmıyor — bu fabrikada KUSUR DEĞİL, bilinçli tercih (2026-09-11 kullanıcı kararı, `docs/kurallar/sevkiyat.md`). Sayının BÜYÜMESİ de alarm değildir. | **Kullanıcı** (iş kararı). Onarım modülü koşulmaz; `scripts/tahsis_teshis.ts` yalnız ölçmek için durur. | Karar değişmedikçe kapanmaz — kalıcı kırmızı. ⚠️ **CI'da YEŞİL** (2026-09-13): taze fikstürde 0 sevkiyat var, yüklem hiç basılmıyor. Aynı satır yerelde kırmızı, uzakta yeşil — bekçi × VERİ ekseni |
| `test_db_invariants` **§1** (nameFold) | `customers` · `items` · `subcontractors` ad seddi partial UNIQUE'i, mükerrer taşıyan DB'de YUMUŞAK KAPI tarafından ATLANIR; satır "enforce bekliyor" der (`test_db_invariants.ts:335-339`). | **Kurulum verisi** — o kurulumdaki ad mükerrerlerini temizleyen kişi | Temizlik sonrası migration yeniden koşar, index kurulur, satır yeşile döner |
| `test_db_invariants` **§5** (renk seddi) | Aynı yumuşak kapı mekanizması, renk ad seddi ifade-UNIQUE'i için (`:531`, `:541`). ⚠️ Bu satır 2026-09-13 listesinde YOKTU, ölçülerek eklendi. | **Kurulum verisi** (aynı sınıf) | aynı |

⚠️ **Etki (`test_hook_config` §2):** `npm test` ve CI backend yolu kırmızı. Paket gününe kadar düzelmezse **paketleme kapısını durdurur**. Kullanıcı düzeltmeyi reddederse satır ADVISORY'ye indirilir — ama indirme de bir KARARDIR ve buraya yazılır.

### Listenin ilk gerçek sınavı — 2026-09-13 CI koşumu

Uzak kapı 34 gün kapalı kaldıktan sonra ilk kez koştu (`OLCUM-DISIPLINI-KAPI-OLUMU.md` § Kapının ölüm biçimleri ⑧). Sonuç, listenin ne işe yaradığını ölçtü:

| Job | Sonuç |
|---|---|
| Backend (`tsc` + paket) | **501/505 dosya · 871 sn** — 4 kırmızı |
| Mobil (`tsc` + jest) | **866/867 test** — 1 kırmızı |
| Electron · Electron E2E · Yük testi · Doküman bekçisi | yeşil |

Backend'in dört kırmızısından **yalnız biri listede** (`test_hook_config` §2). Kalan üçü listede olmadığı için tek tek sahiplendirildi — **ve üçü üç ayrı sınıf çıktı:**

| Kırmızı | Hüküm | Dayanak |
|---|---|---|
| `test_fold_catalog` 24/1 | **GERÇEK** | *"araç yok, kanıtlanamaz"* diye kapatılmıştı; araç eksikliği bilginin sınırı sanılmıştı (`OLCUM-DISIPLINI-ARAC.md` § "Ölçemiyoruz" ile "aracı kurmadık"). Koşucu düzeltmesi inince CI kırmızı yüklemin ADINI basacak |
| `test_scan_code_case` 18/1 | **ORTAM, gerçek değil** | PostgreSQL planlayıcısı küçük tabloda index seçmez, Seq Scan'e düşer; CI'ın DB'si taze ve küçük. Yerelde tam migre DB'de yeşil. "Hangi veride" alanı eksikti, hüküm değil |
| `test_script_guards` 43/1 | **ZATEN DÜZELTİLDİ** | `71f59957` (`scripts/test_script_guards.ts` +2). CI `8f68c367`'yi koştu, düzeltme ondan SONRA indi — sonraki turda yeşile döner |

Mobil kırmızısı da listede değil ve gerçek: `mobil/src/test/update-feed-url.test.ts:76`, kod imzalama sertifikası dosyası yok.

⚠️ **"Hangi VERİDE" bir liste alanıdır.** Üç hükmün ikisi ortamın verisine bağlıydı; veri yazılmadan hüküm taşınamaz.

⚠️ İki ölçüm daha aynı koşumdan çıktı: paket CI'da **871 sn** sürüyor (yerelde ölçülen ~390 sn'nin iki katından fazla — farkın kendisi ayrı bir ölçüm kalemidir), ve koşucu **3 dosyada 5 atlanan kontrol** bildirdi. Atlama sayısı koşmayan yüklem sayısı DEĞİL, bir alt sınırdır (`OLCUM-DISIPLINI-CIKARIM.md` § "Atlanan" sayısı).

### İki kırmızı sınıfı: BİLEREK ↔ KUYRUK

Bu listedeki her satır ikisinden biridir ve **ayrımı karıştırmak pahalıdır**:

| | **BİLEREK** | **KUYRUK** |
|---|---|---|
| Neyin sonucu | bir **KARARIN** | bir **SIRANIN** |
| Kapanması için | karar DEĞİŞMELİ | beklemek YETER |
| Tarihi var mı | yok — karar sürdükçe sürer | **VAR**, ve tarih geçince anlamı değişir |
| Satır ne taşır | kararı ve sahibini | **beklenen kapanma ölçüsünü** |

*(1e/d9)* Bir KUYRUK satırı tarihini geçirirse artık kuyruk değildir: ya karar olmuştur
(bilerek), ya da unutulmuştur — ikisi de yeniden hüküm ister.

> **Bayat KIRMIZI, bayat yeşilden pahalıdır** (`OLCUM-DISIPLINI-KAPI-OLUMU.md` § Kırmızıyı
> sınıflandırma): bayat kırmızı **var olmayan bir işi kuyruğa koyar** ve bir oturumu
> ona bağlar. Bu listenin var olma sebebi tam olarak budur.

**Listeye satır eklerken:** bekçi · bölüm · sebep (ölçümle) · **kim kapatabilir** · kapanış koşulu · **sınıf (BİLEREK / KUYRUK)** ve kuyruksa **tarih**. Altısı eksiksiz değilse satır yazılmaz.
