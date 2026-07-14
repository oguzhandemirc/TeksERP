# Mutation Testing (Stryker) — Electron paneli

Mutation testing, testlerimizin **gerçekten bir şey yakalayıp yakalamadığını**
ölçer. Stryker kaynağa küçük bozmalar (mutant) enjekte eder (`>` → `>=`,
`&&` → `||`, string/sayı değiştirme, dal silme…) ve testleri koşar. Testler
mutanttan dolayı **fail ederse** mutant "öldürülmüş" (killed) sayılır — iyi.
Mutant **hayatta kalırsa** (survived), o davranışı doğrulayan bir test yok
demektir → test boşluğu.

**Mutation score = killed / (killed + survived)**. %100 hedef değil; düşük skor
"şu satırı kimse test etmiyor" sinyalidir.

## Son ölçüm (referans)

`npm run test:mutation` — bu snapshot alındığında 3 dosya mutasyona uğruyordu
(~1dk 53sn, 2.38 test/mutant). **`roll-name.ts` sonradan silindi (624f7d9,
"roll-name şablon üretimi kaldırıldı")**; güncel çalışmada yalnız
`query-builder.ts` + `station-colors.ts` mutasyona uğrar. `stryker.conf.json`
hâlâ silinen dosyayı `mutate` listesinde tutuyor → temizlenmeli. Aşağıdaki tablo
silinmeden önceki referans ölçümdür:

| Dosya | Skor (total) | Skor (covered) | killed | survived |
|---|---|---|---|---|
| `query-builder.ts` | %38.4 | **%74.7** | 56 | 19 |
| `roll-name.ts` | %58.3 | %61.8 | 21 | 13 |
| `station-colors.ts` | %23.6 | %23.6 | 21 | 68 |
| **Tümü** | **%36.2** | %49.5 | 98 | 100 |

**Yorum:** `query-builder.ts` covered skoru (%74.7) anlamlı sinyal — testlerin
dokunduğu URL-kurma mantığı iyi öldürülüyor. Hayatta kalanların büyük kısmı
`station-colors.ts`'teki **className string literal** mutantları (`"bg-primary/10"`
→ `""`): testler ton nesnesini kimlik (`===`) ile doğruluyor, className
metninin içeriğini değil → string'i boşaltmak hiçbir testi düşürmüyor. Bunlar
pratikte düşük değerli/eşdeğere yakın mutantlar (Tailwind sınıfı = sabit veri,
mantık değil). Skoru yükseltmek istenirse: ya className içeriğini doğrulayan
test eklenir, ya da bu sabit-tablo dosyası `mutate` listesinden çıkarılır.
"total" ile "covered" farkı = hiç test edilmeyen export'lar (`STATION_TONE`
tablosunun tek tek alanları gibi).

## Nasıl çalıştırılır

```bash
cd Electron
npm run test:mutation        # = stryker run
```

Sonra HTML raporu aç:

```
Electron/reports/mutation/mutation.html
```

(clear-text özeti terminale de basılır.)

## Hangi dosyalar mutasyona uğruyor (ve neden sadece bunlar)

`stryker.conf.json` → `mutate` yalnız **saf, deterministik ve testi olan** lib
dosyalarını hedefler:

| Dosya | Test | Neden uygun |
|---|---|---|
| `src/lib/query-builder.ts` | `query-builder.test.ts` | Saf string/URL kurma; tarih/IO/random yok |
| `src/lib/station-colors.ts` | `station-colors.test.ts` | Saf enum→ton eşlemesi |

> **Not:** `stryker.conf.json`'daki `mutate` listesi hâlâ `src/lib/roll-name.ts`'i
> içeriyor ama o dosya 624f7d9'da (şablon üretimi kaldırıldı) silindi — hem
> dosya hem `roll-name.test.ts` artık yok. Config girişi temizlenmeli.

**Neden React bileşenleri / `code-generator.ts` dahil değil:**

- React bileşenleri jsdom + render gerektirir → mutant başına çok yavaş; ayrıca
  çoğu mutant (className stringleri vb.) "eşdeğer mutant" üretir (davranışı
  değiştirmez), skoru gürültüye boğar.
- `code-generator.ts` `new Date()` + `Math.random()` kullanır → çıktı
  deterministik değil; aritmetik mutantları test ile güvenilir biçimde
  öldürülemez (eşdeğer/flaky mutant).

Yeni saf bir util + güçlü testi yazıldığında `mutate` listesine eklenebilir.

## Neden CI'da DEĞİL

- **Yavaş:** her mutant için test takımını yeniden koşar; küçük dosya kümesinde
  bile dakikalar sürer, tüm renderer'a açılırsa CI bütçesini patlatır.
- **On-demand araç:** test kalitesini periyodik denetlemek için elle çalıştırılır,
  her push'ta kapı bekçisi olarak değil. CI hızlı kalmalı (`tsc` + `vitest run`).
- `thresholds.break: null` → skor düşse bile süreç fail etmez (rapor amaçlı).

Bu yüzden `ci.yml`'a eklenmedi; yalnız `package.json`'da `test:mutation`
script'i olarak durur.
