# Anlama Turu — Tarama Planı ve Kontrol Listesi (2026-09-05)

Amaç: Kök `CLAUDE.md` + arşiv + alt `CLAUDE.md`'ler + bekçiler + belge katmanı için
**kanıtlı** bir envanter çıkarmak. Çıktı bir yeniden yapılandırma ÖNERİSİDİR; bu turda
repoya tek dosya yazılmaz.

## 0. İlke: ajan yorumlamaz, doğrular

- Her iddia bir kanıta bağlanır: `dosya:satır` ya da grep sonucu. Kanıtsız iddia "BELİRSİZ".
- "BELİRSİZ" meşru bir cevaptır; tahmin yasak.
- Parçalama ve kimliklendirme ajana bırakılmaz, script yapar (ön geçiş). Ajan hazır parçayı
  alır, şemaya doldurur.
- Silme yönündeki her karar (not EZİLDİ · belge ÖLÜ · bekçi BAYAT) ayrı bir hakem tarafından
  ÇÜRÜTÜLMEYE çalışılır. Asimetri bilinçli: yanlış "canlı" token yer, yanlış "ölü" ileride hata
  doğurur. Şüphede KALIR.
- Bir şeyin yorumda geçmesi "var" demek değildir; varlık = kodda tanım/kullanım.

## 1. Ön geçiş (script, LLM yok) — kesinliğin yarısı burada

Scratchpad'e JSON üretilir; ajanlar bunları okur.

| Çıktı | Nasıl | Neden |
|---|---|---|
| `notes.json` | Kök `CLAUDE.md` dizin maddeleri `- **TARİH — Başlık:**` kalıbından bölünür; `id = tarih + slug`; sınıf etiketi (`[ÇEKİRDEK]`/`[PROFİL]`/yok) okunur | Ajanlar aynı kimlikle konuşsun, birleştirme mümkün olsun |
| `archive-sections.json` | Arşiv başlıklarına göre bölünür; tarih+başlık benzerliğiyle `notes.json`'a eşlenir; eşleşmeyenler AYRI listelenir | Kök özeti ↔ tam metin bağı; eşleşmeyen arşiv notu "kökte hiç yok" sinyali |
| `identifiers.json` | Dört `CLAUDE.md` + arşivdeki tüm backtick tanımlayıcılar (dosya yolu, fonksiyon, bayrak anahtarı, bekçi adı, enum) çıkarılır; her biri repoda grep'lenir → `exists / missing / count / firstHit` | "Yanlış mı" sorusunun mekanik yarısı; ajan halüsinasyonu sıfırlanır |
| `guards.json` | 453 `test_*.ts`: ilk 40 satır + import edilen servis/route listesi + git ilk commit tarihi | Ajan 453 dosya açmaz, başlıkları okur |
| `docs.json` | Repodaki tüm `.md`: boyut, son commit, gelen atıf sayısı (kim ona link veriyor), tarihli mi | "Fazla mı" sorusunun mekanik yarısı |
| `clusters.json` | Notlar anahtar kelime/anchor ortaklığıyla konu kümelerine bölünür (ilk taslak script, düzeltme Faz C hakemine) | Çelişki avı küme İÇİNDE kronolojik okumayla yapılır |

Kontrol: `notes.json` madde sayısı = kökteki dizin satırı sayısı (elle sayımla eşleşmeli).
`guards.json` = 453. Uyuşmazsa workflow başlamaz.

## 2. Faz A — Not envanteri (Opus · high · pipeline, ~8 not/ajan, parçalar 1 not örtüşür)

Her not için şema:
```
id, date, title, class, scope[backend|electron|mobil|ops|docs|karma]
status: CANLI | EZİLDİ | KISMEN | BELİRSİZ
supersededBy: [note id]        // yalnız metinde açık işaret varsa; yoksa boş, Faz C karar verir
rules: [ { text (tek cümle, emir kipi, kendi başına anlaşılır), class, anchors[] } ]
anchors: [ { ident, kind, exists (identifiers.json'dan), note } ]
guards: [ dosya adı ]
migrations: [ ]
archiveMatch: id | null
summaryOneLine: ≤ 140 karakter, dizin satırı adayı
```
Ajan kuralı: `rules` çıkarımı ÖZET değil AYRIŞTIRMA — bir notta 6 kural varsa 6 satır.
`exists=false` anchor'ı olan kural "YANLIŞ ADAY" işaretlenir (silme değil, düzeltme adayı).

## 3. Faz B — Paralel envanterler (Opus · high)

- **B1 Bekçi haritası** (15 parti × ~30 dosya): `{file, areas[], measures (1 cümle), referencedByNotes[],
  staleSuspect: {reason} | null}`. Bayatlık şüphesi ölçütü: kaldırılmış sembol import ediyor,
  ya da ölçtüğü davranış sonraki bir notta TERS çevrilmiş (Faz C sonucu gelince ikinci geçiş).
  Electron `vitest` + mobil `jest` listeleri de aynı şemayla (küçük).
- **B2 Alt `CLAUDE.md`'ler** (3 ajan): Faz A şeması + `duplicatesRoot: [note id]` alanı.
- **B3 Belge envanteri**: `docs.json` üstünden her `.md` için `{role: kanonik|tasarım|runbook|rapor|arşiv,
  inbound, lastTouch, verdict: CANLI|ÖLÜ ADAY|TAŞINMALI, reason}`.
- **B4 Boşluk avcıları** (9 ajan, kod → belge yönü). Her biri bir prosedür için KODDAN gerçek
  adımları çıkarır, sonra "bu nerede yazıyor" diye belgeleri arar:
  1. yeni route + izin + Electron/mobil izin aynası
  2. yeni feature flag (dört kapı) + profil
  3. yeni enum değeri (kaç yerde elle güncellenir)
  4. yeni migration (prod kuralı, yumuşak kapı, prova)
  5. yeni bekçi yazma standardı (fixture damgası, cleanup, negatif sonda, env-override)
  6. yeni Electron sayfası (karo, route, palet, izin)
  7. yeni mobil ekran (OTA mı APK mı, izin, offline kuyruk)
  8. sürüm çıkarma (not kapısı, etiket, kanal)
  9. geliştirme döngüsü (env, DB, tek bekçi, tsc süresi, sunucu restart)
  Çıktı: `{procedure, stepsFromCode[], documentedAt[] | [], gaps[], checkedLocations[]}`.
- **B5 Sözlük çıkarıcı**: şema enum'ları + not sözcük dağarcığından domain terimleri;
  her terim için kodda karşılığı (`Roll`, `Sack`, …) ve belgede tanımı var mı.
- **B6 Yasaklar toplayıcı**: notlarda "YASAK / YAZILMAZ / DOKUNULMAZ / KULLANMA" geçen her cümle,
  anchor'ıyla; tek liste.

## 4. Faz C — Çelişki ve ezilme hakemleri (Fable · xhigh · küme başına 1 ajan)

Kümeyi KRONOLOJİK okur (Faz A çıktısı + arşiv tam metni). Çıktı:
```
cluster, notesInOrder[], supersessions: [{older, newer, what (alıntı), scope: tam|kısmi}],
contradictions: [{a, b, quoteA, quoteB, resolution | "BELİRSİZ"}],
liveRuleSet: [rule]     // kümenin bugün geçerli kural kümesi
```
Faz A'daki `supersededBy` ile çakışırsa hakem kazanır, çakışma loglanır.
Kümeler (taslak, script düzeltir): süperadmin/gizlilik · modül bayrakları/profiller · refakat kartı ·
parti no · fason (kısmi kabul, çekme, sevk) · sevkiyat/brüt/storno · top düzeltme/iptal/fire ·
kalite/istasyon yeteneği · rota/renk/kapsama · yarı mamul · mükerrer paneli · belge/etiket ·
sebep katalogları · keşif/cihaz · sürüm/deploy/paketleme · kurşun planlama/bypass · KK1/idempotency ·
finans sağlamlık sınıfları.

## 5. Faz D — Çürütücüler (Fable · xhigh · 2 oy, ikisi de "kalsın" derse kalır)

Her silme adayı için (EZİLDİ not · ÖLÜ belge · BAYAT bekçi · YANLIŞ ADAY kural):
"Bu hâlâ canlı/gerekli olabilir mi? Kodda hâlâ uygulanan bir kural mı? Reddetmek için kanıt bul."
Varsayılan: şüphede `refuted=true` (yani silme DÜŞER).

## 6. Faz E — Tamlık eleştirmeni (Fable · xhigh · 1 ajan)

"Ne eksik: okunmamış kaynak, doğrulanmamış iddia, hiç açılmamış küme, 453'ten eksik dosya?"
Bulduğu şey ikinci tur olur; loglanır, sessizce yutulmaz.

## 7. Sentez (ben, ana döngü)

Rapor `TARAMA-RAPORU.md` (scratchpad → onayla `docs/`):
1. Not envanteri tablosu (id · sınıf · durum · tek satır)
2. Çelişki/ezilme listesi (alıntılı)
3. Yanlış anchor listesi (`exists=false`)
4. Bekçi haritası + bayat şüphelileri
5. Belge kararları (kalır / arşiv / sil / taşın)
6. Boşluklar → yeni belge adayları (gerekçeli)
7. Kök `CLAUDE.md` için öneri: ne kalır (kural kitabı), dizin satırları, tahmini token
Sunmadan önce 5 rastgele "EZİLDİ" ve 5 rastgele "ÖLÜ" kararını elle kaynağından doğrularım.

## 8. Kabul ölçütleri (bitti diyebilmek için)

- [ ] Her not tam bir durum taşır; BELİRSİZ oranı ≤ %10, aksi hâlde ikinci hakem turu
- [ ] `identifiers.json`'da `missing` olan her tanımlayıcı bir nota bağlandı (kimsesiz yok)
- [ ] Bekçi haritası 453/453 + Electron + mobil testleri
- [ ] Her EZİLDİ/ÖLÜ/BAYAT kararı çürütme turundan geçti (2 oy)
- [ ] Her boşluk için "bakılan yerler" listesi var (negatif kanıt)
- [ ] Tamlık eleştirmeni bulgularının hepsi ya kapatıldı ya "ikinci tur" olarak listelendi
- [ ] Rapor sayıları `journal.jsonl` ile tutuyor (cache'lenmiş boş sonuç yok)

## 9. Bilinen tuzaklar (ajan prompt'larına girer)

- Parça sınırı notu ortadan bölebilir → parçalar 1 not örtüşür, `id` ile tekilleştirilir.
- Arşiv başlığı ≠ kök başlığı → eşleşmeyen çift "eşleşmedi" olarak kalır, uydurulmaz.
- "Yorumda geçiyor" ≠ "var" → `identifiers.json` yalnız tanım/kullanım sayar, yorum satırı hariç.
- Aynı gün iki not (P8 iki kez) → mükerrer tespiti `id` üstünden, biri "MÜKERRER" işaretlenir.
- Schema çıktısı şişerse ajan özetlemeye kayar → alan başına karakter tavanı.
- Ajan `null` dönerse (öldü/atlandı) → `filter(Boolean)` ve log'a "N parça eksik" — sessiz boşluk yok.
- Fable kotası → Opus okur (high), Fable yalnız C/D/E.

## 10. Orkestratör kontrol listesi (ben)

- [ ] Ön geçiş script'lerini koştur, sayıları elle doğrula (not sayısı, 453, md sayısı)
- [ ] Workflow'u `meta.phases` A–E ile kur; her `agent()` `phase` + `label` taşır
- [ ] Ajanlara SALT-OKUNUR talimat + kanıt zorunluluğu + Türkçe çıktı
- [ ] Bittiğinde `journal.jsonl`'i oku, boş/null dönüşleri say
- [ ] 10 rastgele kararı elle doğrula
- [ ] Raporu sun; onaysız repoya yazma
