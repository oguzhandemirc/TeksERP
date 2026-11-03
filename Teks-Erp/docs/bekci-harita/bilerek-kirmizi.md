## bilerek-kirmizi — (bekçi × VERİ) listesi

> ⚠️ **Bu bir BEKÇİ listesi değil, bir (bekçi × VERİ) listesidir.** Aynı bekçi bir veritabanında kırmızı, ötekinde yeşildir ve **ikisi de doğrudur**. Ölçüldü 2026-09-13: aynı ağaçta üç oturum üç FARKLI kırmızı listesi çıkardı (`tekserp_e2e_test` · `tekserp_ea_test` · fabrika yedeği). Bu yüzden her satır **hangi veride görünür** alanını taşır; o alan olmadan liste doğru satırlar/yanlış bağlam olur — biri fikstürde koşup "demek düzelmiş" der.
>
> **Niçin var:** bilerek-kırmızıların sayısı kabile bilgisi hâline gelirse, DÖRDÜNCÜ gerçek kırmızı "herhalde o bilinenlerden" diye geçilir.
>
> **Bu tablo bir ANIN fotoğrafıdır.** Kırmızı kümesi yalnız veriye değil **ZAMANA** da bağlı: 2026-09-13'te `test_identity_ledger` sabah yeşildi (koruduğu dosya henüz doğmamıştı), öğleden sonra o dosya yazılınca kırmızıya dönecekti, harita satırı eklenince yine yeşil oldu. **Aynı ağaç, aynı DB, üç farklı saat, üç farklı sonuç.** Bu yüzden her satır tarihlidir.
>
> **Yeniden ölçme:** `cd Teks-Erp && DATABASE_URL=<fikstür> npm test` → çıkışın sonundaki `❌` satırları + `⚠️ ATLANAN KONTROL` bloğu. Liste bayatsa **bu komutun çıktısı kazanır**, aşağıdaki tablo değil.
>
> ⇒ Tam ölçüt dört boyutlu: **(bekçi × VERİ × REJİM × AN)**. "Veri" = bekçinin okuduğu her yapılandırılabilir durum (DB · şablon · ayar · profil · bayrak).
>
> ---
>
> ⚠️ **"Negatif sonda" SÜTUNUNUN SÖZLEŞMESİ (d9, 2026-09-14):** sütun bir ✓ değil bir **SINIF + SAYI** taşır, çünkü iki ayrı şey aynı kelimeyle anılıyordu ve biri denetlenemez:
> · **`✓K<n>`** — **KALICI** sonda: dosyada yaşar, her koşumda (ya da `--sonda` ile) yeniden koşar, okuyan DOĞRULAYABİLİR. Emsal: `test_snapshot_kolonlari` `✓K3` (her koşumda üç sonda) · `test_gun_anahtari_kaynagi` `✓K6` · `test_yerel_ayar_bagimliligi` `✓K3`.
> · **`✓B<n>` + sha** — **BİR KEZLİK** mutasyon zinciri: dosya DIŞINDA koşuldu, ısırdı, GERİ ALINDI. Kanıtı yalnız commit mesajıdır ⇒ **sha atfı ZORUNLUDUR**; atıfsız bir `B` iddiası doğrulanamayan bir cümledir.
> ⛔ **Yalnız `K` için mekanik bir "harita bayat mı" kapısı yazılabilir**; `B` için yazılamaz ve yazılmış gibi davranmak sahte yeşil üretir.
> ⚠️ **`<n>`İN BİRİMİ (d9, 2026-09-14 — sözleşmeyi yazarken TANIMSIZ bırakmıştım; 01 ile aynı sütuna iki farklı birim yazdığımız ortaya çıktı: ben KONTROL saydım, o ZİNCİR):** `n` = **kaç AYRI İDDİANIN ısırdığı ölçüldü**. Ne üretilen kırmızı SATIR sayısı, ne de mutasyon OTURUMU sayısıdır. Bir mutasyon zinciri tek bir şeyi iddia ediyorsa `1`'dir; dosya içi bir sonda bölümü yirmi ayrı şey iddia ediyorsa `20`'dir. *"Yakalanmaz"* yönündeki sondalar da AYRI iddiadır ve sayılır — yanlış-pozitif kontrolü bir iddiadır.
> ⚠️ Ve sayarken: ***sayma birimi iddianın birimiyle aynı olmalı*** — `test_snapshot_kolonlari`da ham `§6` satırı **4**, sonda **3**'tür (dördüncüsü bir ön koşul); ham sayım beni "harita bayat" demeye götürüyordu.
>
> **Altı sınıf karıştırılmaz:** **bilerek** (karar verildi, kapanmayacak ya da kapatan belli) · **devralınan** (borç, bir dilim bekliyor) · **ortam** (veri/sunucu eksikliği; ürün kusuru DEĞİL) · **artık** (başka bir bekçinin bıraktığı veri; faturası onu ÜRETENE çıkmaz — ⚠️ **İKİ AYRI SEBEP, iki ayrı panzehir**, 2026-09-13'te 6e ölçtü: **(a) sessiz başarısız temizlik** — temizlik YAZILMIŞTI ama bir adımı düşüyordu ve hata `.catch(() => {})` ile yutuluyordu (`test_tambur_cut_concurrency` `warehouseMovement` silmiyordu, 88 top birikti) ⇒ *temizliğin son adımı susturulmaz*; **(b) kapsamını yitirmiş ayırt edici** — temizlik EKSİK DEĞİLDİ, kimi sileceğini artık bilmiyordu: fikstürü GERÇEK servisten kuran bekçi topa ÜRETİM formatında barkod verir (`T130926F2770`), `TEST-` ön ekine bakan süzgeç onu CANLI VERİ sanar ⇒ *imza barkodda değil kalem kodunda* (`scripts/lib/fikstur-imzasi.ts`, `fikstursuzTopWhere()`). ⭐ Kök tarif: ***ayırt edici sorunu yalnız kimliğin YENİDEN KURULDUĞU yerde vardır; HATIRLANDIĞI yerde yoktur*** — yarattığın id'yi tutan bekçi (`{ id: { in: yarat.roll } }`) bağışıktır, DB'yi tarayıp ön ekten kimlik çıkaran bekçi değildir. ⇒ **KAPANMA ÖLÇÜSÜ artık "temizliği düzelt" DEĞİL:** *ayırt ediciyi kimliğin HATIRLANDIĞI yere taşı* — bir artık satırı, temizlik kodu değişmeden de kapanabilir) · **aralıklı** (aynı ağaçta iki ardışık koşum iki farklı cevap; sebep BİLİNMİYOR) · **kuyruk** (kırmızı bir kusuru değil, BEKLEYEN BİR İŞİ gösterir) · **ortak ağaç / yarım düzenleme** (bekçi, başka bir oturumun O ANDA yazdığı dosyayı okudu; sebep BİLİNİR ve tekrarlanabilir — `aralıklı`dan farkı budur).

| Bekçi + § | Sınıf | Kim kapatabilir | Hangi veride görünür | Hangi ÖLÇÜM bunu söylüyor |
|---|---|---|---|---|
| `test_consistency` §1c/§1d — siparişe yazılmayan sevk | bilerek | **hiç kapanmayacak** (fabrikanın çalışma biçimi; onarım YAPILMAYACAK, sayının büyümesi de alarm değildir) | **yalnız fabrika verisi** — fikstürde 0 sevkiyat olduğu için tezahür etmez | 2026-09-11 kullanıcı kararı, commit `d0d4c638`; fabrika yedeğinde 45 sevkiyat / 11.855,3 m + 5 sevkiyat. Kural satırı: `docs/kurallar/sevkiyat.md` [PROFİL] |
| `test_hook_config` §2 — PreToolUse kanca yolu GÖRELİ | **KAPANDI** (`a8ce49ca`: kanca yolu `${CLAUDE_PROJECT_DIR}` çapalı) | kapandı (kullanıcı) | her ikisi (veriden bağımsız, config okur) | 2026-09-13 d5 ölçtü ve indirdi: kabuk kökten çıkınca kanca SESSİZCE ölür · 2026-09-30 I9 yeniden ölçtü: `test_hook_config` 41/0 (§2 yeşil) |
| `test_script_guards` §1 — `test_bash_guard_scope.ts` yıkıcı yazma kapıdan geçmiyor | devralınan | d5 (bir dilim) | her ikisi | 2026-09-13 tam paket; dosya commit'li (`df8cb41c`), ağaç temiz |
| `test_backup` §5 — paralel iki yedekten biri reddedilmeli | **ÜRÜN KUSURUYDU — KAPANDI** (`3460dba7`) | kapandı | Rejim B: `PG_BIN_DIR` dolu (istemci 18 ↔ sunucu 16.15) | ⚠️ **ÖNCE ARALIKLI SANILDI, DEĞİLDİ — ve YARIŞ da değildi.** Üç koşum üç toplam verdi (98/2 · 66/3 · 98/2) ve *aralıklı* etiketini hak eder görünüyordu. Gerçek sebep: sürüm kapısı `running = true`dan **ÖNCE bir `await`** koymuştu. Öncesinde `if (running)` kapısından bayrağa kadarki yol **tamamen SENKRONDU** — iki eşzamanlı çağrıdan biri geçip bayrağı dikiyor, ikincisi reddediliyordu. Araya bir `await` girince ikisi de geçti ⇒ **karşılıklı dışlama sessizce kayboldu**; bekçi doğru bağırıyordu. Bayrak öne alındı, üç ardışık koşum **64/8 · 64/8 · 64/8** (kararlı). ⭐ **İKİ DERS:** ① *senkron bir yolun verdiği karşılıklı dışlama, araya giren TEK bir `await` ile sessizce kaybolur* — sıra load-bearing ise bunu KODA yaz. ② *bir yüklem "yarış gibi" görünüyorsa, önce ürünün o garantiyi NASIL verdiğine bak — pencere kurmadan önce pencerenin GEREKLİ olup olmadığını ölç.* 6e'nin gate-tx pencere kalıbı (`68a0b06d`) burada **gereksizdi**; kursaydım ürünün kusurunu ölçüm arızası sanıp GİZLEMİŞ olurdum (6e'nin vakasında tersiydi: ürün doğru, ölçüm bozuk). ⚠️ **VE İLK ATFIM YANLIŞTI:** kontrol grubunu `if (false as boolean)` ile kurdum; bu kapının **KARARINI** kaldırdı ama **`await`ini YERİNDE BIRAKTI** ve asıl değişken oydu ⇒ *kararı kaldırıp yan etkiyi bırakan bir kontrol grubu, kontrol grubu değildir.* 6e'nin daha keskin hâli: ***sondadan sonra "ne değişti" sorusunu KOŞULA değil ÇIKTIYA sor*** — çıktı değişmediyse sonda hiç ısırmamıştır |
| `test_order_line_unit` §1a-d · §3b-d · §4a | **KUYRUK — KAPANDI 2026-09-13** | kapandı (9b, `OrderLine.unit` dilimi) | her ortamda (kolon yok, veriden bağımsız) | ⚠️ **Kırmızı bir KUSURUN değil, bir SIRANIN sonucuydu:** sonda `d1cf80e4`te indi, ölçtüğü davranış sonra indi. **Kapanma ölçüsü ÖNCEDEN yazılmıştı: `6 ✓ / 8 ✗` → `14 ✓ / 0 ✗` — ve BİREBİR tuttu** (9b'nin `test_order_line_unit_ledger` ikizi 23/0). Sonda dosyasına DOKUNULMADI; iddia doğru daraltılmış olduğu için düzeltme onu kendiliğinden yeşile çevirdi. §2 (MT dalı) pozitif kontroldü, yeşil kaldı. ⚠️ **VE KAPANIŞ BİR ÇÖKÜŞÜN ARKASINDA SAKLIYDI:** ilk ölçümümde sonda `500 "Sunucu yapılandırma hatası"` ile çöküyordu; sebep ürün değil **kendi test DB'm üç migration geride**ydi (`customer_default_destination` · `plan_deviation_revoke` · `weaving_order`). `migrate deploy` sonrası 14/0. ⭐ ***Bayat bir ortam, KAPANMIŞ bir kuyruğu KUSUR gibi gösterir*** — kuyruk satırını kapatmadan önce ortamın taban çizgisini (migration durumu) ölç |
| `test_identity_ledger` — harita ↔ bekçi kümesi hizası | **kuyruk** | **haritaya satırını yazan kişi** · kırmızı süresi = bekçinin DOĞUŞU ↔ satırının İNİŞİ | her ortamda (ağacın kendisine bağlı, veriye değil) | ⚠️ **Bu kırmızı bir KUSUR DEĞİL, bir KUYRUK GÖSTERGESİDİR:** *"ağaçta haritalanmamış bir bekçi var."* Ölçüldü 2026-09-13 gecesi — aynı bekçi **üç kez** aynı sebeple kırmızı verdi ve her seferinde **başka** bir dosya yüzünden (`test_kimlik_sizintisi` → `test_defter_ters_yol` → `test_kapi_kapsami` → `test_devralinan_tavan`). **Kuyruk aynı gece KAPANDI: 510 gerçek · 510 haritada, 3/0.** Dört satırın dördü de **bekçiyi YAZAN oturumdan metin alınarak** yazıldı. Satır olmadan bakan kişi **kusur arar**; o gece üç kez arandı, üçünde de kusur yoktu. ⚠️ Satırı **bekçiyi YAZAN kişi tarif eder**, taşıyan yalnız taşır. ⚠️ **Ve buradaki "ortam" bir DB değil, ÇALIŞMA KOPYASININ KİRLİ HÂLİDİR:** aynı bekçi, aynı commit, iki farklı çalışma kopyası → iki farklı ayrışma sayısı (2026-09-13: benim kopyamda 1, başka oturumunkinde 3/0 — fark, kimin hangi commit edilmemiş satırı taşıdığı). Ölçüldü: kendi diff'im kenara konunca ayrışma **1 → 4** çıktı, yani satırlar sebep değil ÇÖZÜMDÜ |
| `test_mobile_screen_permissions` | **ortak ağaç / yarım düzenleme** | **kimse — koşumu ağaç SAKİNKEN tekrarla** | ortak ağaçta, UZUN koşumda | ⚠️ **ARALIKLI SANILDI, DEĞİLDİ.** Ölçüm zinciri (2026-09-13): bekçi `Teks-Erp/src/routes`u da okur (`requireAnyPermission(...)` ayrıştırır) · `quality-grade.routes.ts` mtime **06:12:13** = strict paket koşumumun (05:58:50→06:13:26) TAM İÇİNDE · commit 17 sn SONRA. ⇒ Bekçi dosyayı **yazılırken** okudu. **Bulaşma sınırı ÖLÇÜLDÜ:** koşum penceresinde değişen tek `Teks-Erp/src` dosyası ile strict'siz koşumda kırmızı olmayan tek bekçi **aynı** ⇒ başka ölçüm etkilenmedi. ⚠️ *Uzun bir koşum, ortak ağaçta TEK BİR ağaç durumunu ölçmez* |
| `test_fold_catalog` — kat kataloğu | **ARALIKLI DEĞİLDİ — KAPANDI** (`675211b2`, 2026-09-13) | kapandı | her ikisi (bekçinin KENDİ fikstür değeri; veriden bağımsız) | Kök sebep bir ÜRÜN kusuru değil **bekçinin kendi yükleminin SINIRSIZLIĞI** idi: `!m.includes("9-KAT")` yüklemi, sonda değeri `TEST-KAT-${Date.now()}-KAT` damgası **9 ile bittiğinde** `…9-KAT` alt dizgisini içeriyordu ⇒ sıklık `Date.now() % 10 === 9`, yani **1/10**; CI'daki iki kırmızının (`8f68c367` 24/1 · öncesi) İKİSİNDE de damga 9 ile bitiyordu. Düzeltme: liste TOKEN olarak okunuyor, dört sonda eklendi (biri ESKİ yüklemin yanlışlığını belgeliyor). Ölçüldü 2026-09-13: damga zorla 9 ile bitirilerek koşuldu → 29/0 (düzeltme öncesi o koşul GARANTİLİ kırmızıydı) · 12 ardışık koşum → 0 kırmızı. ⭐ **HÜKMÜ DEFTER DEĞİL TEŞHİS VERDİ.** Bu satır için kurulan sıklık defteri (`Teks-Erp/scripts/lib/siklik-defteri.ts`) 10 kayıt biriktirdi ve onunu da **yeşil + yerel** ölçtü (7'si `wt-d9`, 3'ü ortak ağaç, üç ayrı DB — ölçüldü 2026-09-13); kırmızılar YALNIZ CI'daydı ve CI defteri commit'lemiyor ⇒ *bir sıklık defteri, ölçtüğü olayın gerçekleştiği REJİMDE kayıt tutmuyorsa penceresi dolsa da hüküm veremez.* Defterin kapsamı bu yüzden **"yerel rejim, tek ağaç"** diye daraltıldı (1e hükmü şık (b), 2026-09-13): her kayıt `rejim`/`agac` damgası taşır, iki ağacın kaydı TOPLANMAZ, **CI kırmızıları `gh run` ile ayrı sayılır**, ve tek yönlü 10 kayıt artık satırı KAPATMAZ — hükmü *"yerel rejimde üretilemedi"* olur, satır ARALIKLI kalır ve arama REJİM eksenine taşınır. İzlenen küme bugün BOŞ (konusu kapandı); alet sıradaki aralıklı satır için dormant bekler |
| `test_module_flag_off` §3 · `test_module_grandfathering` §2b — modül anahtarı satırı yok | **ortam** | — (kusur değil) | **yalnız geçmişi migration'dan SONRA dolan fikstür** | 2026-09-13 belirleyici kontrol: fabrikanın dev kopyası (5.813 top) → 6 anahtarın 6'sı VAR; `tekserp_e2e_test` (41 top) → 0. Damga migration'ı boş DB'de koştu, damgalayacak geçmiş yoktu |
| `test_scan_code_case` — tam eşleşme Seq Scan | **ortam** | — (kusur değil) | **yalnız küçük fikstür** | 2026-09-13: planlayıcı onlarca satırlık tabloda index kullanmaz. **CI KANITI** (`2e188894`): `Seq Scan on rolls (cost=0.00..1.02 rows=1)` — sınıflandırma tahmin değil, sorgu planıyla doğrulanmış |

⚠️ **Bu tabloya girmeyen bir sınıf daha var: ARTIK.** Bir bekçinin eksik temizliği başka bir bekçiyi kırar ve fatura **onu üretene çıkmaz**. 2026-09-13'te `test_consistency` §6 (çuval `seq` ↔ `shipmentId`) böyle kırmızıydı; kaynak bir ölçüm betiğinin düşen temizliğiydi, artık silinince §6 yeşile döndü. **Kırmızıyı listeye eklemeden önce "bu bir artık mı" diye sor** — satırın `createdAt`ını ölçtüğün sistemin saat diliminde oku (`timestamptz`, fabrika günü Europe/Istanbul), kendi sezginde değil.

### ÖLÇÜLMEMİŞ (atlanan) — ÖLÇÜLDÜ (2026-09-13)

> Bu yüklemler paket koşumunda **hiç basılmıyordu**. 2026-09-13'te altısı da kendi portunda sunucu kaldırılarak koşuruldu; aşağıdaki tablo **öncesi/sonrası ölçümdür**, tahmin değil.
>
> ⚠️ **Ve "atlanan" sayısı KOŞMAYAN YÜKLEM sayısı DEĞİLDİR — atlanan BÖLÜM sayısıdır.** `test_module_flag_off`ta 18 atlama, sunucu açılınca **24** yeni yüklem bastı: bir atlama satırı birden çok yüklem gizleyebilir. ⇒ Atlanan sayısı bir alt sınırdır; kapsam açığı **ondan büyüktür**.

| Bekçi | Port | Paket (sunucusuz) | Sunucu AÇIK | Yeni koşan | Sonuç |
|---|---|---|---|---|---|
| `test_superadmin.ts` | 4104 | 86 / 0 / **20 atlandı** | 103 / 0 / 3 | **+17** | hepsi YEŞİL |
| `test_module_flag_off.ts` | 4101 | 85 / 1 / **18 atlandı** | 109 / 1 / 0 | **+24** | yeni yüklemler yeşil; §3 kırmızısı ORTAM (yukarıdaki tabloda) |
| `test_settings_password.ts` | 4112 | 134 / 0 / **12 atlandı** | 146 / 0 / 0 | **+12** | hepsi YEŞİL |
| `test_finance_flag_off.ts` | 4100 | 5 / 0 / **6 atlandı** | 10 / 0 / 0 | **+5** | hepsi YEŞİL |
| `test_module_profile.ts` | 4122 | 58 / 0 / **4 atlandı** | 62 / 0 / 0 | **+4** | hepsi YEŞİL |
| `test_scrap_grade_label.ts` §5/§5b | — | 20 / 0 / **1 atlandı** | — | — | port değil **şablon** rejimi: aktif `ROLL_FINISHED` şablonu kalite/uyarı elemanı taşımıyor (akış modunda, kanvas varyantı yok); fabrika şablonu kanvasa taşıdığında kendiliğinden koşar |

**Kapanan:** beş port bekçisinin atlananları — geriye **dört** kalır: `test_superadmin` 3 + `test_scrap_grade_label` 1.

⚠️ **Kalan dördü "koşulamaz" değil, BAŞKA REJİM ister** — ve bu, *hangi veride* alanının bir üst hâlidir:

> ***Bazı bekçilerin TAM kapsamı tek koşumda ölçülemez; rejim başına bir koşum ister ve rejimler birbirini DIŞLAR.***

`test_superadmin` iki rejimli ve paket **ikisini de** koşturmuyordu:
```
sistem hesabı YOK → 103 / 0 / 3    (2026-09-13 ölçümü, tekserp_e2e_test)
sistem hesabı VAR → 126 / 0 / 16   (bekçinin kendi başlığındaki ölçüm, tekserp_modul_test)
```
Hesap VAR rejimi `npm run superadmin:kur` ister — **TTY ister ve sır hijyeni alanına girer**, o yüzden bir bekçi koşumu olarak kurulmaz; kullanıcı kararıdır.

### Nasıl koşulur (port bekçileri)
**Tek komut (tercih edilen):** `cd Teks-Erp && DATABASE_URL='postgresql://…/<ad>_test?schema=public' node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts [--tam] [süzgeç…]` — boş bir portta KENDİ sunucusunu açar (yalnız `_test` hedef, `.env` okunmaz), `httpBekciKapisi` çağıran bekçileri ya da `--tam` ile bütün paketi `TEST_API_URL`le koşar, atlamaları beyanlı/genel diye sebebiyle basar, yalnız kendi süreç grubunu kapatıp portun kapandığını ölçer. Elle yol:
```bash
cd Teks-Erp
PORT=<port> npx tsx src/server.ts &          # kendi PID'in
TEST_API_URL=http://localhost:<port> npx tsx scripts/<bekçi>.ts
```
⚠️ **SÜREÇ KAPATMANIN İKİ KURALI — birlikte uygulanır (ölçüldü 2026-09-13, ortak makine).**

1. ***"Kendi PID'in" = DİNLEYEN sürecin PID'i, spawn ettiğin DEĞİL.*** `npx` iki kademe ekler (`npx` → `tsx` → `node`); kaydedilen spawn PID'i öldürmek **dinleyiciyi ayakta bırakabilir** ve insanı `pkill -f tsx`e (YASAK) iter — yani kural, uygulanması pahalı olduğu için kendi ihlalini üretir.
2. ***Hedefi DESENLE değil SAHİPLİKLE seç.*** Ortak makinede bir desenle eşleşen her süreç senin değildir: `pkill -f <desen>` koşturmadan önce sahip ölçülür (`lsof -p <PID> -a -d cwd` + ata zinciri). Kök CLAUDE.md'nin *"`pkill -f tsx` YASAK"* satırı bir **liste** değil **ölçüt**tür — `tsx` yasaksa `python3` da aynı sınıftadır.

**Uygulama:** dinleyici `lsof -nP -iTCP:<port> -sTCP:LISTEN` ile bulunur → ata zinciri `ps -o pid,ppid,command` ile doğrulanır → süreçler **adıyla** kapatılır → **sonra portun kapandığı ÖLÇÜLÜR** (`nc -z`). Dördüncü adım atlanırsa "kapattım" bir beyandır, ölçüm değil.

⚠️ **`TEKSERP_STRICT=1` altında atlama kırmızı olur — AMA YALNIZ ONA UYAN BEKÇİDE, ve bugün o sayı BİR.**
Ölçüldü 2026-09-13: `strictMi()`/`TEKSERP_STRICT` **metnini içeren** iki dosya var ama biri (`test_script_guards`)
strict'e **uymuyor**, başka bir dosyanın kaynağında o dizgeyi **arıyor** — strict *hakkında* bir bekçi, strict'e
*uyan* değil. ⇒ ***bir dosyanın X'i ANMASI, X'e UYMASI değildir.***
Kalan atlamalar üç biçimde ve strict hiçbirini görmez:
· **basar ama saymaz** (`⏭️` yazıp özete katmaz — `test_backup` bu sınıfta: `pg_dump` yokken 77 yüklem düşer)
· **erken `return`** — kontroller hiç DOĞMAZ, sayıları yapısal olarak BİLİNEMEZ
· ⚠️ **`check("… atlandı", true)` — atlamayı GEÇTİ sayar**: kapsam kaybı sıfır değil **EKSİ**, yeşil yukarı şişer.
  Ölçüldü: **14 site / 9 dosya** (çok satırlı desenle; dar desen 1, orta desen 7 buluyordu — *sayı, deseninin
  genişliğidir*). ⚠️ **İki alt grup var ve YÖNÜ ters sandım — düzeltildi (d5'in ölçümü):** bir kısmı *"veri/fixture
  yok"* der (dürüst), bir kısmı *"DB seddi senaryoyu üretilemez kıldı"* der. İkincisini *"seddin kanıtı"*
  sandım; **değil.** O satırlar **çıplak `catch`** kullanıyor ve hata kodunu HİÇ okumuyor ⇒ bağlantı
  koptuğunda, fikstürde yazım hatası olduğunda ya da alakasız bir hata düştüğünde de aynı dala girip
  **yeşil** basıyor. ***Bir yokluğa mekanizma atfetmek, o mekanizmayı ÖLÇMEK değildir*** — ve değişkenin
  adı (`sedEngelledi`) bir İDDİADIR, kod onu hiçbir yerde denetlemiyor.
  ⇒ ***Fark gerçek ama yön ters: bu grup daha MEŞRU değil, daha az ÖLÇÜLMÜŞ.***
  Düzeltme atlama muhasebesi değil **EKSİK YÜKLEM**: hata kodu + **kısıta özgü ad** okunur, beklenmedikse
  `throw` edilir (ölçüldü: `P2002` tek başına yetmez — `tr_fold_color(name::text)` · `"nameFold"` ·
  `upper(code::text)` üç FARKLI kısıt, ve fikstürün kendi `code` çakışması da P2002 verir).
