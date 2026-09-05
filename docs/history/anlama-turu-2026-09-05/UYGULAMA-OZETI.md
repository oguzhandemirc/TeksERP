# Anlama turu + Tur 1–4 uygulaması — özet (2026-09-05)

> Kullanıcının dört hedefi: bayat notları güncelle · modelin daha az hata yapmasını sağla · daha hızlı çalışmasını sağla · teknik kod yazım kurallarını geliştir. Beşinci başlık (yorum politikası) tarama sırasında eklendi. Karar yetkisi kullanıcı tarafından devredildi ("karar alma yeteneğini kullan ve devam et"); **commit atılmadı**, her şey çalışma ağacında. Önceki sürüm: git `6695afc2`.

## Ne değişti

| Katman | Önce | Sonra |
|---|---|---|
| Kök `CLAUDE.md` | 104 madde, ~42k token, her oturumda | Kural kitabı ~6k token: çekirdek değişmezler (7 grup) + kısa yasaklar + 24 satırlık alan dizini + çalışma düzeni |
| `Teks-Erp/CLAUDE.md` · `Electron/` · `mobil/` | 19k · 9k · 11k | 4.1k · 2.6k · 2.8k (yalnız alt-proje geneli; alan kuralları alan dosyalarına indi) |
| Alan kuralları | yok (hikâyelerin içinde) | `docs/kurallar/<alan>.md` ×24 + README — Faz C hakemlerinin canlı kural kümesinden üretildi; her dosya: değişmezler/yasaklar/tuzaklar/reçeteler/kararlar (katman: ortak/backend/panel/tablet), geçersiz kılınan kurallar (çürütme rozetli), çözülmüş çelişkiler, açık sorular, bekçi listesi, arşiv tarihleri |
| Teknik desenler | dağınık | `docs/KOD-KURALLARI.md` (113 desen + yorum politikası + 130 normalize yasak) |
| Reçeteler | yok | `docs/RECETELER.md` (8 prosedür koddan çıkarılmış adımlarla; ⚠️ = o güne dek belgesiz adım) |
| Sözlük · geliştirme döngüsü · bekçi haritası | yok | `docs/SOZLUK.md` (94 terim) · `docs/GELISTIRME-DONGUSU.md` · `Teks-Erp/docs/BEKCI-HARITASI.md` (745 test, alan→dosya) |
| Arşiv | tam metinler | + 33 ezilen nota `⚠️ GEÇERSİZ/KISMEN` bloğu (çürütmeden geçmeyenler çıkarıldı) + kökten inen 37 tam metin + başlık notu |
| Belge hijyeni | kök `audit/` (82 dosya), kökte 3 tarihli not, 29 belgede bayat iddia | `docs/history/denetim-2026-08/`, `docs/history/`; **29 belgenin bayat iddiaları GERÇEKTEN düzeltildi** (28'inde not kaldırıldı, 1'i daraltıldı) |
| Belge sayısı | 149 taranan `.md` | 126 — 24 harcanmış belge `history/`e taşındı, 13 silindi (12 üretilebilir denetim promptu + 1 yanlış bilgi veren `TICARET-KURULUM` kopyası) |
| Kapılar | `check-docs` yalnız ölü link | + `CLAUDE.md` boyut tavanı (kök 36 KB, alt 24 KB) · `scripts/claude-hooks/bash-guard.mjs` PreToolUse (yasak komutlar + `git commit`te tsc; 14 senaryo test) |
| Harness | yalnız izin listesi | `.claude/rules/<alan>.md` ×25 yol kapsamlı işaretçi · `.claude/skills/{surum-cikar,bekci-kos,karar-notu}` · `README.md` `migrate dev` düzeltmesi |

Backend'de çalışan bir oturumun açılış bağlamı ~65k token'dan ~10k'ya indi; alana dokununca o alanın dosyası (3–13k) okunur.

## Nasıl yapıldı (yöntem)

LLM'siz ön geçiş (not kimlikleme, arşiv eşleme, 3.641 tanımlayıcının token indeksiyle varlık kontrolü, bekçi başlıkları, belge atıf sayımı) → Faz A/B 76 Opus-high ajan (not envanteri, bekçi haritası, belge kararları, 9 boşluk avcısı, sözlük, yasaklar) → Faz C 25 küme hakemi (11 Fable-xhigh, 14 Opus-high; 5'i limit düşüşünden kurtarılan dosyadan doğrulandı) → Faz D 24 çürütücü (TEK Opus oyu — bütçe kararı, plan iki oy diyordu) → Faz E Fable eleştirmen (15 bulgu) → kayıp-kural doğrulaması (eski↔yeni CLAUDE.md; kök Fable, alt Opus). Plan: `TARAMA-PLANI.md`; rapor: `TARAMA-RAPORU.md` + ekler; öneri: `ONERI.md` (yazıldığı anki durum — sonrasında uygulandı).

Sayılar: 311 not · 1.623 ayrıştırılmış kural · 943 canlı kural (hakem sonrası) · 139 ezilme · 49 çelişki (hepsi kodla çözüldü) · 745 test haritalandı · 223 belge · 99 belge boşluğu · 313 çürütme adayı (52 çürüdü: 25 belge, 11 bekçi, 9 not, 6 ezilme, 1 çelişki).

## Verilen kararlar (kullanıcı adına)

1. Kök ~6k, alan dosyaları talep üzerine; `.claude/rules` yalnız işaretçi (paths'siz rules açılışta yüklenir — tam içerik konsaydı bağlam yeniden şişerdi).
2. Silme ölçütü DAR: yalnız çürütmeden AYAKTA çıkan ve içeriği komşu dosyadan birebir üretilebilen ya da aktif yanlış bilgi veren belgeler silindi (12 denetim promptu + 1 eski `TICARET-KURULUM` kopyası). "Ölü aday" denen 25 belgenin silme iddiası çürüdü (kısa kimlikle atıf alıyorlar ya da açık backlog taşıyorlar) — onlar yerinde kaldı. Harcanmış tek-seferlik belgeler silinmedi, `history/`e taşındı.
3. `audit/` tek hamlede taşındı (git mv; kısa-kimlik atıfları klasör içinde çözülmeye devam eder, dış yol atıfları güncellendi).
4. Tasarım/runbook belgelerinde ÖNCE kanıtlı bayatlık notu kondu, SONRA (aynı gün, Opus turu) iddiaların kendisi düzeltildi ve not kaldırıldı. Düzeltme biçimi: tasarım banner'ı gerçek duruma çevrildi ve "aşağıdaki metin ORİJİNAL TASARIMDIR" şerhi eklendi (gerekçe korunur, yanlış durum işareti kalkar); envanter sayıları güncellendi ve yanlarına "kanonik kaynak" işaretçisi kondu (aynı sayı bir daha bayatlamasın); kaldırılmış akışlar (ör. `RelabelDialog`, top adı şablonu) senaryo tablolarında üstü çizili işaretlendi.
5. Hook'lar: her düzenlemede değil, commit anında tsc (kullanıcı tercihi).
6. Alt `CLAUDE.md`'ler elle yeniden yazıldı (eski dosyalar tam okunarak); kaynak damgası yok — kaybolan kural için ayrı doğrulama koşuldu.

## E eleştirmeni (15 bulgu) — ne yapıldı, ne kaldı

- Yapıldı: D sonuçlarının üretime yansımaması (regex + yeniden üretim); C hakemlerinin yasak/sözlük kuralları KOD-KURALLARI/SOZLUK'e birleştirildi; rapor sayıları güncel dosyalardan yeniden türetildi; model karışımı rapora yazıldı; hakemlerin açık soruları rapora eklendi; 21↔37 farkı açıklandı; "39 aynı kural" ifadesi düzeltildi.
- Kabul edilen sınır: Faz D tek Opus oyu (haftalık limit %42 — kullanıcı kararı); çürütme rozetleri "tek oy" olarak okunmalı.
- İkinci tura kalan: 42 çapraz-küme keepIn tutarsızlığı (alan dosyalarında aynı kural iki dosyada olabilir — zararsız, tekleştirme işi); 71 alt not hiçbir kümeye girmedi (alt CLAUDE'lar elle yazılırken okundu, ama kural izi yok); 4 kapsanmayan prosedür (yeni rapor · yeni belge tipi/şablon · yeni etiket türü · yeni istasyon türü); `notesInOrder` izi; `identifiers.json`a ajan verdikleri geri yazılmadı.

## Ertelenen işler (kod dokunuşu ister)

- 106 bekçide bayatlık şüphesi (17 özsel: `test_superadmin` kaldırılmış gizlemeyi ölçüyor, `test_traveler_template` başlığı ters çevrilmiş kuralı anlatıyor, iki test `npm run seed` yanlış tarif ediyor…) — liste `TARAMA-RAPORU.md` §4b; 11'i tek oyla çürüdü.
- Altı sıcak serviste yorum temizliği (politika `docs/KOD-KURALLARI.md`'de; kod dokunulmadı).
- ~~`admin.routes.ts:53` route'ta `prisma` import ihlali~~ ✅ giderildi (sorgu `AuthService.isSystemAccountUser`a taşındı; lint artık yeşil — **daha önce kırmızıydı ve kimse koşmuyordu**).
- ~~7 tasarım belgesinin banner'ı~~ ✅ yapıldı (Opus turu, aynı gün): 29 belgenin bayat iddiaları düzeltildi, notlar kaldırıldı; `docs/ops/YAN-YANA-KURULUM.md`'de not DARALTILDI (belge `FABRIKA-KURULUM-2026-09-04.md` ile aynı işi farklı portla anlatıyor — birleştirme ayrı karar).
- `.claude/rules` glob'ları geniş; sahada gürültü yaparsa daraltılır.
- `docs/ops/YAN-YANA-KURULUM.md` ile `FABRIKA-KURULUM-2026-09-04.md` birleştirmesi (iki belge aynı işi farklı portlarla anlatıyor).

## Kayıp-kural doğrulaması (eski ↔ yeni CLAUDE.md; kök Fable-xhigh, alt dosyalar Opus-high)

Dört dosyada da **ÇEKİRDEK kayıp yok**. Alan düzeyinde 11 kayıp (barkod = kimlik · bypass repoint · `dispatchWithoutColor` açık gönderim · P3a/b erteleme — arşivde de yoktu · `loadProducedBuckets` isActive · audit `MANUAL_ATTRIBUTE/RELABEL` · WO≠Parti tanımı · PDF yolu birleştirme kullanmaz · `primaryMeterFor` · `/health` yoklaması uyarıdır · restore kopyalarında retention yok) → ilgili `docs/kurallar/<alan>.md` "Doğrulama turu ekleri" bölümüne kalıcı yazıldı (`uret.py` `VERIFY_EK`). 15 zayıflama ve 15 yanlış cümle kökte/alt dosyalarda kanıtıyla düzeltildi; öne çıkanlar: `npm run dev` ts-node'dur (tsx değil; ajan yolu `PORT=<port> npx tsx src/server.ts`), `productionDbGate` koşucunun kapısıdır (bekçininki `hedefDbEngeli()`), beş HTTP bekçisi ayrı sunucu ister ve yoksa sessizce atlanır, `clientToken` 16 modelde, rota kapsaması yalnız KATEGORİ düzeyinde uyarır, refakat şablonu 404 / çuval şablonu 400, `updatedAt desc` istisnası Ham Stok + Yarı Mamul, OTA'da yükleme ayrı adım (`mobil-yayinla.mjs`), yeni kullanıcı üç mobil izinle doğar (`DEFAULT_OPERATOR_PERMISSION_CODES`), `screen-catalog` girdisi HER route için, `stationScreens.ts` `constants/` altında, Phase 1 donanım yasağının backend'e daraltıldığı artık kökte yazılı, advisory uzay envanteri 8021–8028 (merge 8027'yi paylaşıyor — açık iş).

## Ek tur — ESLint yasakları + alan dosyası inceltme (2026-09-05, Opus)

**Alan dosyaları %19 inceldi** (ortalama 24 KB → 19 KB): bekçi bölümündeki "ne ölçüyor" açıklamaları `Teks-Erp/docs/BEKCI-HARITASI.md`'de zaten vardı; alan dosyasında yalnız koşulacak dosya ADLARI + tek satır işaretçi kaldı (⚠️ bayatlık işareti korundu).

**Dört yasak ESLint'e indi** (`Teks-Erp/eslint.config.mjs`): `notIn: []` · `orderBy: { batchNumber }` · jenerik `requireModule("x")` · `'Europe/Istanbul'` literali (yalnız `constants/time.ts` muaf). Mevcut `tx.*`+`Promise.all` ve route'ta `lib/prisma` kurallarıyla birlikte altı yasak artık mekanik.

**Yöntem — ölçmeden kural eklenmedi.** Her aday önce `src/`de sayıldı:
- `notIn: []`, `orderBy batchNumber`, `requireModule(` → isabetlerin HEPSİ kuralı anlatan YORUM satırıydı; AST yorumu görmez, gerçek ihlal sıfır.
- `'Europe/Istanbul'` → **iki gerçek ihlal** bulundu (`import-coerce.ts`, `future-date-guard.helper.ts`) ve `FACTORY_TIMEZONE`a çevrildi.
- `toLocaleUpperCase("tr")` → 62 isabet, bazıları ZORUNLU (`query-parser.ts` Türkçe harf dönüşümü). Yasak DAR kapsamlıymış (yalnız koşullu etiket elemanı ↔ `QualityGrade.code`) — **kural yazılmadı**, gerekçe config başlığına işlendi.
- `.delete(`/`.deleteMany(` (153) ve Electron `pageSize: N` (36) → aynı sebeple reddedildi.

**Yan bulgu: lint zaten kırmızıydı.** `admin.routes.ts` katman ihlali mevcut bir kuralı ihlal ediyordu, yani `npm run lint` bir süredir düşüyordu ve koşulmuyordu. Sorgu servise taşındı, lint ve `tsc` yeşil.

**Yan bulgu: iki bekçi aynı kapıyı aynı kırılgan yazımla ölçüyordu.** `test_superadmin.ts` ve `test_superadmin_visible.ts` §5, kapıyı METİN tarayarak `isSystemAccount === true …` kalıbıyla arıyordu; refactor kapıyı `isSystemAccountUser(` biçimine çevirince ikisi de kırmızı verdi — koruma yerindeydi, yüklem eskimişti. İkisi de her iki yazımı kabul edecek şekilde genişletildi ve **negatif sondayla ölçüldü** (kapı kaldırılınca ikisi de kırmızı, geri gelince 37/37 ve 82/82). Ders: metin tarayan bekçi, ölçtüğü kodun ŞEKLİNE bağlıdır — meşru bir refactor onu kırar ve bu bir bekçi bakımıdır, kuralın iptali değil.
