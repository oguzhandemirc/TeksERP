# İlkeler — üç projede de geçerli

Katman-üstü kurallar. Alan kuralları buradan türer; çelişirse **bu dosya kazanmaz** — alan kuralı daha spesifiktir, ama çelişkinin kendisi bir arızadır ve düzeltilir.

Kural biçimi ve zorlama etiketleri: [`README.md`](README.md).

---

## 1 · Tek kaynak

- **[IL-01]** Aynı soruyu cevaplayan koşul TEK yerde yaşar; ikinci bir kopya yazmak yerine var olanı import et · zorlama: bekçi:`test_fason_open_dispatch_single_source` + 7 AST bekçisi · kanıt: `helpers/fason-open-dispatch.helper.ts`, `K18_DEAD_STATUSES` (`batch.service.ts:55`, 40 kullanım / 5 servis) · devralınan: yok
- **[IL-02]** Bellek-içi yüklem ile Prisma `where` parçası **boğaz ikizdir**: aynı dosyada, yan yana, `satisfies` ile tanımlanır ve birlikte değişir · zorlama: insan:AST bekçisi çift-başına yazılır, jenerik kural yok · kanıt: `helpers/quality-station.helper.ts:88,97` (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`)
- **[IL-03]** Saf yüklem `where`'e GİREMEZ — girerse atomik claim'i check-then-act'e çevirir · zorlama: insan:tip sistemi ayrımı ifade edemiyor · kanıt: `quality-station.helper.ts` başlık notu
- **[IL-04]** Bir sabit listesi (statü kümesi, izin kümesi, kilit uzayı) elle kopyalanmaz; tek modülden export edilir ve kapsamı bir bekçiyle — körlük zeminiyle birlikte — ölçülür; elle saymak sessizce bayatlar · zorlama: bekçi:`test_module_flags §1a` (`MODULE_FLAG_KEYS`) · `test_document_template_permission` (`DOCUMENT_DESIGN_*`) · `test_advisory_lock_namespaces` (kilit uzayı envanteri, iki yönlü) · kanıt: `Teks-Erp/scripts/test_module_flags.ts:54,139,143`, `Teks-Erp/scripts/test_document_template_permission.ts:38-41,313`

## 2 · Fail-closed

- **[IL-05]** Tanınmayan değer 400'e düşer; yerleşiğe/varsayılana SAPMAZ · zorlama: bekçi · kanıt: `inventory.service.ts:1547` (`rollScope` bilinmeyen kapsam → `AppError.badRequest`)
- **[IL-06]** Bir kapı yalnız açık bilgiyle açılır: bilgi yoksa kapalıdır. Önbellekte **TTL tazeliktir, geçerlilik değil** — dolmuş TTL bayat listeyi düşürmez (bayat döner + arka planda tazeler), ama önbellek HİÇ dolmadıysa fail-closed kalır · zorlama: bekçi:`test_reason_presets §3b/c/d` · kanıt: `reason-preset.service.ts:176-190`, `remote-access.middleware.ts:212`
- **[IL-07]** Kapı takarken sor: "bu malın/verinin çıktığı BAŞKA yol var mı?" — kardeş bayrağın kapsam listesine bakılarak cevaplanır · zorlama: insan:kapsam sorusu mekanik değil · kanıt: 2026-09-03 Dilim 2 (fason doğrudan sevk, `block` rejimi)

## 3 · Sessiz düşme yasağı

Bu repodaki arızaların en pahalı sınıfı **sessizce yutulan** koddur: kural doğruydu, çağrılmadı; alan gönderildi, allowlist eledi; sorgu koştu, koşul düştü.

- **[IL-08]** İstek gövdesini elle kuran her istemci katmanı bir allowlist'tir — alan iki uçta birlikte eklenir; Zod tanımadığı anahtarı sessizce siler · zorlama: insan:sözleşme iki repoda · kanıt: 2026-08-13 "kesimde kat sessizce düşüyordu"
- **[IL-09]** Yeni bir yüzey eklerken "kaç kapıdan geçiyor" sorusu ÖNCE sorulur: enum değeri · davranış bayrağı · izin kodu · rota+izin — hepsi çok-kapılı ve reçetelidir · zorlama: bekçi:`test_feature_flag_contract`, `test_permission_catalog` · kanıt: `docs/RECETELER.md`
- **[IL-10]** Bir sayım/kapsam listesi "0 bulgu" verdiğinde bu "hiç bakılmadı" da olabilir → her sayım bekçisi **körlük zemini** taşır (ölçtüğü kümenin boş olmadığını da ölçer) · zorlama: bekçi · kanıt: `Teks-Erp/CLAUDE.md` § bekçi sözleşmesi; `scripts/check-lint-baseline.mjs` `EN_AZ_DOSYA`
- **[IL-11]** Bir yeteneğin "VAR" sayılması için üçü birden gerekir: motor + en az bir çıkış yüzeyi + izin ataması · zorlama: insan:üç ayağın varlığı üç ayrı katmanda, tek bir AST'de görünmez · kanıt: 2026-08-26 yarı mamul (üç ucu birden açık kalmıştı: rota yok · izin 0 kullanıcıda · masaüstü çıkışı yok)

## 4 · Ölç, sonra karar ver

- **[IL-12]** Bir yasak yazmadan önce mevcut kodda kaç meşru kullanımı olduğunu ÖLÇ; ölçüm yasağı çürütürse yasak yazılmaz ve **gerekçe kayda geçer** · zorlama: insan:ölçüm kararı sayının kendisi değil, sayının ne anlattığıdır · kanıt: `Teks-Erp/eslint.config.mjs` başlığı (`toLocaleUpperCase("tr")`: 59 kullanım, bir kısmı zorunlu → kural reddedildi)
- **[IL-13]** "Şu dosyada şu var / şu bekçi yeter" cümleleri **varsayımdır**; kanıt dosya:satır ya da koşulmuş komuttur · zorlama: insan:iddianın kanıtlı olup olmadığı metinden ölçülemez · kanıt: 2026-08-25 prod notu turu (6 cümle ölçümle düzeltildi)
- **[IL-14]** Yerleşim/görünüm hatasında tahmin değil ölçüm: `adb exec-out screencap` + `uiautomator dump` · zorlama: insan:teşhis yöntemi bir süreç kuralıdır, kod şekli değil · kanıt: 2026-08-25 `SegmentedButtons` vakası (ilk teşhis yanlıştı)
- **[IL-15]** Bir davranış bayrağının varsayılanı = BUGÜNKÜ davranış ve bu cümle **ölçülmeden yazılmaz** · zorlama: bekçi:`test_feature_flag_contract` · kanıt: 2026-09-03 Dilim 2 (üç çıkışsız kapı ölçümle bulundu)

## 5 · İsimlendirme

- **[IL-16]** Tanımlayıcılar **İngilizce ve ASCII**; kullanıcıya görünen metin, hata mesajı, yorum, belge ve commit mesajı **Türkçe** · zorlama: eslint:`no-restricted-syntax` (Türkçe karakterli `Identifier`) + `@typescript-eslint/naming-convention` · kanıt: 13.589 tanımlayıcının ~7'si Türkçe (ölçüm 2026-09-05) — kural gerçeği korur, değiştirmez
- **[IL-17]** Sabit `UPPER_SNAKE` · tip ve sınıf `PascalCase` · geri kalan `camelCase`; boolean `is/has/can/should` ön eki alır; async fonksiyon adı fiille başlar · zorlama: eslint:`@typescript-eslint/naming-convention` · kanıt: `Teks-Erp/eslint.config.mjs` `NAMING_CONVENTION` — üç kademeli daraltmayla 43 → 37 → 2 ihlal ölçüldü; kalan 2 düzeltildi · devralınan: bilinçli kaçışlar (`__xForTests`) allow-deseninde
- **[IL-18]** Dosya adı türü söyler: backend `x.service.ts` · `x.helper.ts` · `x.routes.ts` · `x.controller.ts` · `x.middleware.ts` · `x.job.ts` · bekçi `test_x.ts`; Electron `XPage.tsx` + 5-dosya kalıbı; mobil `XScreen.tsx` · zorlama: insan:ad kalıbı AST'den ölçülmez · kanıt: `BACKEND.md`, `ELECTRON.md`, `MOBIL.md`
- **[IL-19]** `$transaction` closure parametresi **DAİMA `tx`** — ESLint'in "tx içinde `Promise.all` yasak" guard'ı isim tabanlıdır, başka bir ad kuralı KÖR eder · zorlama: eslint:`no-restricted-syntax` (dolaylı) · kanıt: `eslint.config.mjs` `TX_PROMISE_ALL`; 196 `$transaction`ın 183'ü açık `(tx)` biçimi
- **[IL-20]** Fiil sözlüğü sabittir: `assertX` (void + throw guard) · `resolveX` (tek değer türet) · `buildX` · `loadX` · `collectX` · `normalizeX` · `computeX`; çağıranın transaction'ında koşmak ZORUNDA olan fonksiyon `*Tx` ile biter ve ilk parametresi `tx: Prisma.TransactionClient`'tır · zorlama: insan:fiilin doğru seçilip seçilmediği anlamı bilmeyi ister · kanıt: `settings-password.service.ts:107`, `sack-tag.service.ts:499`

## 6 · Boyut

Boyut bir kalite ölçüsü değil, **bir dikkat sinyalidir**: 400 satırlık bir servis dosyası kötü değildir, ama 400 satırı geçen YENİ bir dosya "bu iki iş mi?" sorusunu hak eder.

**Satır = kod satırı.** Yorum ve boş satır sayılmaz. Bu repoda yorum bir değerdir — karar kaydı koruduğu kodun yanında yaşar (`period-guard.helper.ts`'in ilk 55 satırı saf gerekçedir) ve onu boyuta saymak standardın en iyi kalıbını cezalandırırdı.

| Birim | Hedef | Uyarı (baseline'lı) | Yeni dosyada asla |
|---|---|---|---|
| Fonksiyon (üç proje) | ≤ 60 | 80 | 150 |
| Backend servis / route / controller dosyası | ≤ 400 | 300 | 600 |
| Backend helper | ≤ 300 | 300 | — |
| Electron dosya · `*Page.tsx` · `*FormDialog.tsx` | ≤ 300 · 200 · 200 | 300 | 600 |
| Mobil: ekran kabuğu · görünüm · ekran-hook · saf mantık · servis | 250 · 500 · 400 · 200 · 400 | 300 | 600 |
| Fonksiyon parametresi | ≤ 4 | `max-params` 4 — mobil `error`, backend/Electron `warn` + tavan | fazlası `opts` nesnesi |
| Yeni Prisma modeli · migration | ≤ 120 · ≤ 200 satır | — | — |
| Yeni bekçi dosyası | ≤ 400 | — | 600 → dosyalara böl |

"Uyarı" sütunu ESLint `max-lines` tavanıdır ve **üç projede de 300**'dur (`npx eslint --print-config` ile ölçüldü: `Teks-Erp/eslint.config.mjs` `BOYUT_KURALLARI` · `Electron/eslint.config.mjs` `BOYUT_KURALLARI` · `mobil/eslint.config.js`); Electron'da adlı `*Page.tsx`/`*FormDialog.tsx` bloğu 200'e iner. "Hedef" sütunundaki birim-başına sayılar İNSAN kuralıdır — tek bir `max-lines` sayısı onları ifade edemez.

- **[IL-21]** Sınırlar **yeni ve dokunulan kodda** zorunludur; devralınan dosyalar `lint-baseline.json`'da donar ve tavan yalnız düşer · zorlama: eslint:`max-lines`/`max-lines-per-function` (warn) + `scripts/check-lint-baseline.mjs` · kanıt: ölçülen dağılım — backend fonksiyon p50 14 / p90 59, dosya p50 236 / p90 1.001
- **[IL-22]** Bölme **fırsatçıdır**: dokunulan bölüm helper'a/bileşene çıkarılır, dokunulmayan yerinde kalır. Mega servisi bölmek ayrı bir iştir ve bu turda YAPILMAZ · zorlama: insan:hangi bölümün 'dokunulan' olduğu diff'in niyetiyle bilinir · kanıt: `README.md` § bilinen borç
- **[IL-23]** Muafiyet sınıfı gerekçelidir: katalog/registry dosyaları (hook çağırmayan, çoğunluğu veri olan tablolar) bölünmez — bölmek zarar verir · zorlama: insan:muafiyet ADLIDIR; heuristik ölçüt yanlış dosyaları süpürür (ölçüldü) · kanıt: `Electron/src/pages/GeneralSettings/settings-config.ts` 1.445, `Electron/src/routes/content-routes.tsx` 1.218

## 7 · Yorum

Politika `docs/KOD-KURALLARI.md` § Yorum politikası'nda; burada yalnız özeti:

- **[IL-24]** Yorum 1–3 satır **NEDEN** söyler ve koruduğu satırın hemen üstünde durur; tarih ve ölçüm anlatısı arşive gider, kodda en fazla tek satırlık çapa kalır · zorlama: insan:uzunluk mekanik ölçülebilir ama "NEDEN mi NE mi anlatıyor" ölçülemez · kanıt: `docs/KOD-KURALLARI.md` § Yorum politikası; ölçüm — backend servislerinin %25'i yorum, 793 tarihli yorum satırı, 10.803 blokun %61'i zaten 1-3 satır · devralınan: ileriye dönük kural, toplu temizlik YAPILMAZ
- **[IL-25]** Dosya bir `// ====` banner'ı ile açılır: ne olduğu + NEDEN'i, 3–10 satır · zorlama: insan:banner'ın NEDEN söyleyip söylemediği ölçülemez · kanıt: `sack-tag.service.ts:1-18`

## 8 · Sözleşme değişikliği

- **[IL-26]** **Backend ÖNCE**, panel ve tablet sonra · zorlama: insan:deploy sırası · kanıt: kök `CLAUDE.md` § Dağıtım
- **[IL-27]** Altı tetikten biri varsa "eski istemci ne yapar?" açıkça cevaplanır: uç kaldırma · alan adı · tip/birim · zorunlu parametre · enum değeri · izin · zorlama: bekçi:`test_client_policy` · kanıt: `config/client-version-policy.ts:74-77`
- **[IL-28]** `minVersion` yalnız gerçek kırılmada yükselir ve **sahadaki sürümden büyük olamaz** — o durumda en güncel istemci bile kapıda kalır ve indirecek bir şey yoktur · zorlama: bekçi:`test_client_policy` · kanıt: `client-version-policy.ts:90` (bugün `1.0.0`, bilinçli pasif)

## 9 · Sır ve canlı veri

- **[IL-29]** Süperadmin parolası/PIN'i/TOTP'si ve ayar şifresi repoya, log'a, sürüm notuna, audit yüküne GİRMEZ; `.env` uyarısı yalnız **anahtar adını** basar · zorlama: bekçi:`test_superadmin_provision §5` (sır audit'e/DB'ye/dosyaya sızmıyor — körlük zeminiyle) + `§8` (ölü `.env` satırı uyarısı: anahtar ADI evet, DEĞER asla) · kanıt: `Teks-Erp/scripts/test_superadmin_provision.ts:455,457,495` ve `:727`; kural kök `CLAUDE.md` § Sır hijyeni
- **[IL-30]** `migrate reset` / reseed / toplu `DELETE` yasaktır; migration geri alınamaz kabul edilir; toplu düzeltme script'i dry-run varsayılandır ve `--apply` öncesi etkilenen her kaydı listeler · zorlama: hook:`scripts/claude-hooks/bash-guard.mjs` · kanıt: kök `CLAUDE.md` § Veri ve defter
- **[IL-31]** Dev veritabanı fabrikanın verisinin **kopyasıdır**: test temizliği yalnız kendi damgasıyla eşleşen satırlara dokunur (`TEST-` / `TST-` ön ekleri), ön eksiz satır silinmez · zorlama: insan:bekçi sözleşmesi · kanıt: `Teks-Erp/CLAUDE.md` § bekçi yazma sözleşmesi
