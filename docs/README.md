# Doküman Haritası

Kanonik kaynak **kod + `CLAUDE.md` dosyaları**dır. 2026-09-05 yeniden yapılandırmasıyla belge katmanı üç kata ayrıldı: her oturumda yüklenen ÇEKİRDEK (kök `CLAUDE.md`, ~6k token), alana dokununca okunan kural dosyaları (`docs/kurallar/`), istenince okunan hikâye/gerekçe (`docs/history/`).

## Nereye bakılır

| İhtiyaç | Dosya |
|---|---|
| Her alanda geçerli değişmezler, yasaklar, alan dizini | kök `CLAUDE.md` |
| Bir alanın bugün geçerli kuralları + bekçileri + arşiv tarihleri | `docs/kurallar/<alan>.md` (dizin: `docs/kurallar/README.md`) |
| Teknik desenler (F221, atomik claim, Zod↔mutationFn, `details.code`…), yorum politikası, tam yasak listesi | `docs/KOD-KURALLARI.md` |
| Rutin yazım konvansiyonları (servis metodu, model, sayfa, ekran nasıl yazılır; boyut tavanı, kütüphane seçimi, test kadansı) | `docs/standart/` (giriş: `docs/standart/README.md`) |
| "X eklerken şu yerleri güncelle" (bayrak, enum, route+izin, migration, bekçi, Electron sayfası, mobil ekran, sürüm) | `docs/RECETELER.md` |
| Yerel geliştirme (env, DB, tek bekçi, sunucu) | `docs/GELISTIRME-DONGUSU.md` |
| Alan → bekçi (test) haritası | `Teks-Erp/docs/BEKCI-HARITASI.md` |
| Domain terimleri | `docs/SOZLUK.md` |
| Alt proje çalışma düzeni | `Teks-Erp/CLAUDE.md` · `Electron/CLAUDE.md` · `mobil/CLAUDE.md` |
| Karar notlarının TAM metni, gerekçe, ölçüm | `docs/history/CLAUDE-NOT-ARSIVI.md` (ezilen notlar `⚠️ GEÇERSİZ/KISMEN` bloğu taşır) |
| Derin mimari referans | `Teks-Erp/ARCHITECTURE.md` (§7–§10 canlı; envanter sayıları bayat) |

## Klasörler

| Klasör | İçerik | Güncellik |
|---|---|---|
| `kurallar/` | Alan kural dosyaları (24 + README) — üretildi 2026-09-05, sonra elle bakılır | Canlı |
| `standart/` | Kod yazım standardı (giriş `standart/README.md`, dosya listesi orada): `ILKELER` · `BACKEND` · `VERITABANI` · `VERITABANI-MIGRATION` · `ESZAMANLILIK` · `ESZAMANLILIK-ENVANTER` · `ELECTRON` · `MOBIL` · `KUTUPHANELER` · `TEST-VE-DERLEME` · `TEST-VE-DERLEME-SINIRLAR` · `OLCUM-DISIPLINI` · `OLCUM-DISIPLINI-KAPI` · `OLCUM-DISIPLINI-SINIFLAR` · `OLCUM-DISIPLINI-ARAC` · `OLCUM-DISIPLINI-CIKARIM`. Olay-türevi kural değil, RUTİN konvansiyon; her kural `[kimlik] · zorlama · kanıt · devralınan` taşır | Canlı |
| `design/` | Domain tasarımları (19) — yalnız CANLI olanlar; her birinin durum banner'ı 2026-09-05'te koda karşı doğrulandı. `SEKTOR-YOL-HARITASI.md` (2026-09-11) bir ÜRÜN belgesidir: 90 doğrulanmış eksik defter, karar bekliyor | Canlı |
| `ops/` | Deploy/runbook/kurulum reçeteleri (24) — yalnız TEKRAR KOŞULAN olanlar | Operasyonel, bakımlı |
| `qa/` | Manuel kabul senaryoları | Bakımlı |
| `history/` | Arşiv (salt-okunur): karar notları tam metni, harcanmış tek-seferlik deploy/devir notları, tamamlanmış planlar, eski incelemeler, `denetim-2026-08/` (kök `audit/` kampanyası), `anlama-turu-2026-09-05/` | Donmuş; sayılar/satır referansları bayat |

> **Kural:** Tek seferlik bir belge (sürüm deploy notu, devir notu, tamamlanmış plan, harcanmış prompt) işi bitince `history/`e taşınır — `design/` ve `ops/` yalnız bugün okunacak belgeleri taşır. 2026-09-05'te 24 belge taşındı, 13 belge silindi (12'si komşu `PLAN.md §7`'den birebir üretilebilen denetim promptu, biri yanlış bilgi veren eski `TICARET-KURULUM` kopyası).

## Yeni karar notu nasıl yazılır

1. Tam metin `docs/history/CLAUDE-NOT-ARSIVI.md`'ye (tarih + `[ÇEKİRDEK]`/`[PROFİL]`).
2. İlgili `docs/kurallar/<alan>.md`'ye TEK kural satırı (emir kipi, kanıt anchor'ı).
3. Her alanda geçerli bir değişmezse kök `CLAUDE.md` § Çekirdek değişmezler'e tek satır.
4. Bir kural iptal edilince eski cümle silinir, arşivdeki nota `⚠️ GEÇERSİZ` bloğu konur.

## `.claude/` harness

- `.claude/rules/<alan>.md` — yol kapsamlı (`paths:`) İNCE işaretçiler: eşleşen dosyaya dokunulunca "önce `docs/kurallar/<alan>.md` oku" der (~100 token). Kural buraya YAZILMAZ; `paths` olmayan bir rules dosyası her oturumda yüklenir ve sadeleştirmeyi boşa çıkarır.
- Katman işaretçileri aynı biçimde standarda bağlanır: `backend-standart.md` (`Teks-Erp/src/**`) · `electron-standart.md` (`Electron/src/**`) · `mobil-standart.md` (`mobil/src/**`) · `kutuphane.md` (`**/package.json`).
- `.claude/skills/` — `surum-cikar` · `bekci-kos` · `karar-notu` (alt projelerin kendi skill'leri `Electron/.claude/skills/`).
- `scripts/claude-hooks/bash-guard.mjs` — PreToolUse kapısı: yasak komutları (sunucu süreçlerini toplu öldürme, `migrate reset|dev`, `db push`, WHERE'siz `DELETE`, `TRUNCATE/DROP`, `push --force`, ham `build:win`, elle `gradlew`) engeller; `git commit`te commit kapısını KENDİ ÇALIŞTIRMAZ, `scripts/hooks/pre-commit.mjs`i çağırır (adım listesi tek yerde: tip · lint · lint tavanı · o projenin hızlı testi). Git'in kendi kapısı kuruluysa (`node scripts/hooks-kur.mjs`) susar — aynı adımlar iki kez koşmaz. Kaçış yalnız kullanıcı kararıyla `TEKSERP_HOOK_SKIP=1` ya da `--no-verify`. ⚠️ Kapı komut METNİNE bakar: yasak dizeyi içeren bir açıklama/heredoc bile engellenir — böyle metni Edit/Write ile yaz.
- Anlama turu raporu ve ekleri: `docs/history/anlama-turu-2026-09-05/`.

## Bayatlık bekçisi (CI)

`scripts/check-docs.mjs` (`cd Teks-Erp && npm run check:docs`): ölü doküman-link **GATE**; kaldırılmış-sembol atfı advisory; **belge boyut tavanı GATE** (kök `CLAUDE.md` ≤ 36 KB, alt `CLAUDE.md`'ler ve `docs/standart/*.md` ≤ 24 KB — sadeleştirmenin geri şişmemesi için; standart dosyaları taranarak bulunur, yeni dosya tavansız doğmaz). Yeni sembol kaldırıldığında `REMOVED_SYMBOLS`'e ekle.
