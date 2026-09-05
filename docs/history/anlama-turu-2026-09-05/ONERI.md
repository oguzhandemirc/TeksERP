# Yeniden Yapılandırma Önerisi — TeksERP belge katmanı (2026-09-05)

> Anlama turunun sonucu. Henüz hiçbir dosya değişmedi. Bu belge onaylanınca Tur 1 (yazma) başlar.
> Dayanak: `TARAMA-RAPORU.md` (tam rapor, ~156k token) + ekler (envanter · kurallar · bekçi haritası · sözlük/yasaklar · çürütme).

## 1. Teşhis — tek cümle

Kök `CLAUDE.md` bir kural kitabı değil, tarih sırasıyla yığılmış bir karar günlüğü: 104 madde, ~42k token, her oturumda yükleniyor; içindeki 892 canlı kuralın yalnız ~35'i her oturumda gerekli, gerisi alan değişmezi. Aynı kural üç kümede tekrar ediyor, 125 yerde bir not sonrakiyle ezilmiş (13'ü tamamen), 47 yerde iki not birbirine ters düşüyor (45'i kodla çözüldü, karar kodda belli).

## 2. Ölçülen gerçekler (kanıtlı)

| Bulgu | Sayı | Anlamı |
|---|---|---|
| Kökteki not, kendi metninde "kaldırıldı / değişti / açık kaldı" diyen | 16 + 1 mükerrer | Model bugün yürürlükte olmayan cümleleri okuyor |
| Notlar arası ezilme (Faz C) | 125 (13 tam, 112 kısmi) | En riskli: P2 gizlilik (600 kelime tarihsel), "şablon karta donar", "kilit ≠ gizleme", `admin:*` route kilidi |
| Çelişki (kodla çözülmüş) | 45 / 47 | Örn. "ERP fatura KESMEZ" ↔ `finance.enabled` açıkken taslak fatura doğuyor; "Ortak Konvansiyonlar tamamı ÇEKİRDEK" ↔ altında iki PROFİL bayrağı |
| Kodda karşılığı olmayan tanımlayıcı | 32 yok + 13 yeniden adlandırılmış | `RelabelDialog`, `assertRouteCoversTargets`→`collectRouteCoverageWarnings`, `batch.requiredEnabled`→`autoCreateEnabled`, `deploy/profiller/*.json` hiç yok |
| Alt `CLAUDE.md` notu kökle aynı kuralı taşıyan | 39 | Aynı kural iki dosyada, biri bayatlayınca çelişki |
| Bekçi: notlarda hiç anılmayan | 321 / 453 | Model hangi testi koşacağını bilemiyor |
| Bekçi: bayat şüphesi | 106 (17'si özsel) | Örn. `test_superadmin` kaldırılmış gizleme davranışını hâlâ ölçüyor; `test_field_address` makine yoksa YEŞİL çıkıyor |
| Belge: taşınmalı / ölü aday / güncellenmeli | 119 / 29 / 40 | Kök `audit/` klasörü (82 dosya) iki denetim kampanyasının kalıntısı; 7 tasarım belgesinin banner'ı "uygulanmadı" derken uygulanmış |
| Koddan belgeye boşluk (9 prosedür) | 99 | APK yayın yolu sürüm-notu kapısını atlıyor; backend sürüm hattı belgesiz; dev DB'nin kurulumu hiçbir yerde yazmıyor; README `migrate dev` öneriyor, CLAUDE.md yasaklıyor |
| "Dört kapı" adı | kodda 3 farklı anlam | Feature flag reçetesi güvenilmez |

## 3. Hedef mimari

**İlke:** Her oturumda yüklenen şey = her alanda geçerli ÇEKİRDEK + alan haritası. Alan bilgisi alan dosyasında, o alana dokununca okunur. Hikâye ve ölçüm arşivde.

```
CLAUDE.md (kök)  ~10k token  ← bugün 42k
├─ Kimlik · üç proje · dallanma · ÇEKİRDEK/PROFİL sorusu            0.5k
├─ Üretim akışı (profil referansı, 8 satır)                          0.6k
├─ ÇEKİRDEK değişmezler (~35 kural, tek cümle, kanıtsız)             4.5k
├─ Yasaklar (30 satır)                                               1.5k
├─ ALAN DİZİNİ (24 satır: kural dosyası + arşiv tarihleri + bekçiler) 2.0k
└─ Çalışma düzeni (dev döngüsü · bekçi haritası · reçeteler · sürüm) 1.0k

docs/kurallar/<alan>.md  × 24        alan değişmezleri (~35k toplam, TALEP ÜZERİNE)
docs/KOD-KURALLARI.md                 teknik desenler: F221, atomik claim, Zod↔mutationFn,
                                      details.code, readIdCondition, kilit sırası, negatif sondalı bekçi   ~8k
docs/RECETELER.md                     "X eklerken şu N yer": bayrak · enum · route+izin · migration ·
                                      bekçi · Electron sayfa · mobil ekran · sürüm · belge kolonu          ~6k
docs/SOZLUK.md                        83 terim                                                            ~4k
docs/GELISTIRME-DONGUSU.md            env/DB/tek bekçi/tsc/sunucu restart/Electron+mobil dev              ~2k
Teks-Erp/docs/BEKCI-HARITASI.md       alan → bekçi (453 + 292), üretilmiş                                ~15k
Teks-Erp/CLAUDE.md                    yalnız backend-geneli (~50 kural)  ~5k   ← bugün 19k
Electron/CLAUDE.md                    yalnız panel-geneli                ~4k   ← bugün 9k
mobil/CLAUDE.md                       yalnız tablet-geneli               ~4k   ← bugün 11k
docs/history/CLAUDE-NOT-ARSIVI.md     tam metinler + kökten inen 135 not; ezilen notlara "GEÇERSİZ → tarih" başlığı
```

Backend'de çalışan bir oturum bugün ~65k token talimatla başlıyor; hedefte ~15k + dokunduğu alanın dosyası (~1.5k).

**Seçenek (Tur 4):** `docs/kurallar/*.md` dosyaları `.claude/rules/` altına yol kapsamlı taşınırsa (örn. sevkiyat kuralları yalnız `shipping*`, `Sevkiyat/**` dosyalarına dokununca yüklenir) okuma adımı da kalkar. Önce mekanizma doğrulanır, sonra taşınır.

## 4. Ne nereye gidiyor (Faz C hakem kararları, tekilleştirme öncesi)

| Hedef | Kural | ~Token | Not |
|---|---|---|---|
| kök ÇEKİRDEK | 248 → ~35 kesişen | 4.5k | Kalan ~180'i alan dosyalarına iner (refakat kartı, çuval, fason çekme, keşif…); ~15% küme arası tekrar |
| kök dizin tetiği | 57 + 210 satır → 24 alan satırı | 2k | Not başına değil ALAN başına satır |
| kod kuralları | 110 | 8k | yeni belge |
| reçeteler | 45 + 9 prosedür | 6k | yeni belge |
| yasaklar | 30 (+100 normalize) | 1.5k | kökte tek satırlık; tam liste ekte |
| alt-backend | 187 | 15k → 5k genel + alan dosyaları | |
| alt-electron / alt-mobil | 93 / 103 | 8k / 8k → 4k + alan | |
| yalnız arşiv | 135 not | — | kökte satırı bile kalmaz |
| sil | 4 kural (Faz D onayıyla) | — | BLE yolu, `admin:*` route kilidi, eski model sayıları, açık test listesi |

## 5. Belge kararları

- **Taşınacak:** kök `audit/` → `docs/history/denetim-2026-08-{10,28}/` (82 dosya, tek hareket); kök `PLAN-BRIEF.md`, `SAHA-NOTLARI-2026-08-09.md`, `VERI-BUTUNLUGU-DENETIMI.md` → `docs/history/`.
- **Silinecek (Faz D onayı ile):** 29 ölü aday — çoğu tek seferlik denetim promptu ve tamamlanmış plan; her biri için "başka yerde var" kanıtı raporda.
- **Güncellenecek (40):** 7 tasarım belgesinin durum banner'ı ("uygulanmadı" → "uygulandı, tarih"), `ARCHITECTURE.md` (~114 migration → 232), `API_TEST_GUIDE.md`, `README.md` hızlı başlangıcı (`migrate dev` YASAK), `docs/ops/URETIM-KONTROL-LISTESI.md` (159 → 453 bekçi), `deploy/README.md` md5 satırı.
- **Kanonik kalan (31):** dört `CLAUDE.md`, `DEPLOY-RUNBOOK`, `KURULUM`, `MIGRATION-DEPLOY`, canlı tasarımlar (CUVAL-HAVUZU, PARTI-MODELI, MODUL-BAYRAK…), ops reçeteleri.

## 6. Yeni belgeler — gerekçesi ölçülmüş boşluklar

| Belge | Neyi kapatır |
|---|---|
| `docs/RECETELER.md` | 9 prosedürde 99 yazılmamış adım; "dört kapı" adının üç anlamı; enum değeri eklerken 13 elle güncellenen yer; APK yolunda sürüm-notu kapısı |
| `docs/GELISTIRME-DONGUSU.md` | Dev DB nasıl kalkar (yazılı değil), `seed:fixtures` zorunluluğu, sunucu restart'ın doğru yolu, tek bekçi koşumu, tsc 28 sn |
| `docs/SOZLUK.md` | 83 terim; 1'i hiçbir yerde tanımsız, çoğu yalnız kod yorumunda |
| `docs/KOD-KURALLARI.md` | 110 teknik desen bugün 24 hikâyenin içinde gömülü |
| `Teks-Erp/docs/BEKCI-HARITASI.md` | 321 bekçi hiçbir notta anılmıyor |
| `docs/history/...` "GEÇERSİZ" başlıkları | 13 tam ezilme, 112 kısmi ezilme arşivde işaretsiz |

## 7. Turlar (her biri ayrı onay)

1. **Kök `CLAUDE.md` + arşiv** — kök yeniden yazılır (~10k), 135 not arşive iner, ezilenler arşivde işaretlenir, alan dizini kurulur, 24 alan dosyası doğar. Bekçi: `check-docs.mjs`e kök için token tavanı (12k) kapısı.
2. **Backend** — `Teks-Erp/CLAUDE.md` 5k'ya iner; `KOD-KURALLARI`, `RECETELER`, `BEKCI-HARITASI`, `GELISTIRME-DONGUSU` doğar; 17 özsel bayat bekçi + 89 kozmetik başlık düzeltilir; `README` `migrate dev` satırı düşer.
3. **Mobil + Electron** — alt `CLAUDE.md`'ler 4k'ya iner, alan dosyalarına dağılır; `SEGMENTED_BUTTONS`, izin aynası, `mutationFn` allowlist'i kod kurallarına.
4. **Harness** — `.claude/settings.json` hook'ları (yasak komut kapısı: `pkill -f tsx`, `migrate reset|dev`, toplu `DELETE`; commit öncesi tsc), `.claude/skills/` (sürüm çıkar · not yaz · bekçi koş · reçete uygula), `.claude/rules/` denemesi.
5. **Yorum politikası** — altı sıcak serviste tarihli/ölçüm yorumları arşiv çapasına indirilir; yeni kural: yorum 1–3 satır NEDEN, tarih yok.

## 8. Senden karar istenenler

1. Kök için ~10k hedefi ve "alan dosyası talep üzerine okunur" modeli uygun mu? (Alternatif: 24 alan dosyası yerine 6 büyük alan; daha az dosya, daha çok token.)
2. 4 "sil" kuralı ve 29 ölü belge: Faz D çürütmesinden geçenler silinsin mi, yoksa yalnız arşive mi insin? (Önerim: belge silinmez, `docs/history/`e iner; kural silinir.)
3. `audit/` klasörü tek hamlede `docs/history/`e taşınsın mı? (82 dosya, hiçbirine atıf yok.)
4. Tasarım belgelerinin banner'larını ben mi güncelleyeyim, yoksa yalnız listeleyeyim?
5. `.claude/rules/` yol kapsamlı yükleme denemesi Tur 4'te mi, Tur 1'de mi?

_Faz D (çürütme) ve Faz E (tamlık eleştirmeni) sonuçları geldiğinde §4 "sil" satırı ve §5 silme listesi kesinleşir; bu belge güncellenir._
