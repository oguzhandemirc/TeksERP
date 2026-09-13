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
- **[TD-09]** Paket DÖRT geçitten geçer ve dördü de FAIL-CLOSED: hedef kapısı (host + ad + hacim, [TD-10b]) → tip kontrolü (~28 sn) → **migration durumu** · zorlama: bekçi:`run-all-tests.ts` · kanıt: migration kapısı olmadığında 453'ün 134'ü kırmızı veriyordu ve teşhis `TableDoesNotExist` stack'i olarak bırakılıyordu (2026-09-05)
- **[TD-10b]** Bekçi/paket koşumunun hedefi FİXTURE DB'dir ve kapı ÜÇ AYAKLIDIR: (1) host yerel mi (2) ad `_test` ile bitiyor mu (3) hedefteki top sayısı fabrika eşiğinin (500) altında mı — üçünden biri düşerse koşucu DURUR; kaçış `BEKCI_HEDEF_ONAY=1` ve hedef adı + top sayısı log'a basılır; **hacim ÖLÇÜLEMEZSE de DURUR** ("ölçemedim" yokluk değil yanlış-hedef riskidir — fabrikanın `..._test` adlı bir kopyası ad ayağından geçer ve tek gerçek koruma hacimdir) · silen temizlik yolları (`clean_test_residue.ts`) aynı kapıdan geçer ve `--apply` verilmeden de durur · zorlama: bekçi:`test_script_guards.ts §6–§8` (her ayak iki yönlü) · gerekçe: ortak ağacın `.env`i fabrikanın canlı yedeğini gösteriyor, host kapısı onu yerel sayıyor ve `db-guard` `_dev`i geliştirme hedefi sayıp geçiriyordu
- **[TD-10c]** HTTP ayaklı bekçi SABİT PORTU VARSAYAMAZ ve kullanıcısını KENDİ yaratır: hedef kapısı (`lib/http-bekci-kapisi.ts`) sunucu yoksa BEYAN EDİLMİŞ ATLAMA döner (gerçek kontrol sayısı sayaca eklenir, `atla()` yalnız birini sayar), sunucu ayakta ama az önce Prisma ile yaratılan fixture kullanıcısıyla giriş reddediliyorsa KIRMIZI döner (porttaki sunucu başka veritabanına bakıyor demektir — "ölçtüm" yalanı); `TEKSERP_STRICT=1` koşumunda yokluk da kırmızıdır ve "yeşil = kapsandı" ancak orada iddia edilir · zorlama: bekçi:`test_script_guards.ts §9` (kapısız HTTP bekçisi düşer) · gerekçe: `p2test`i repoda yaratan tek satır yoktu ve beş bekçi 19 kontrolü "sunucu yok" sanılan bir sebeple atlıyordu (gerçek kayıp ≈23; ölçüldü 2026-09-12)
- **[TD-10d]** Hedefini KENDİ kuran betik (`new Pool(` · `new PrismaClient(` · `DATABASE_URL` ataması) bir kapı çağırmak, `--apply` alan her betik de hedef veritabanını ADIYLA basmak zorundadır — geri alınamaz yazma yapan yolun izi, yalnız okuyan yolunkinden zayıf olamaz · zorlama: bekçi:`test_script_guards.ts §10–§11` (tavan yalnız düşer, muaf listesi iki yönlü) · gerekçe: koşucunun kapısı yalnız `run-all-tests` yolunu korur, `npx tsx scripts/test_x.ts` doğrudan koşulduğunda hiçbir ayak çalışmaz (2026-09-12 07:19 vakası bu yoldan geldi)
- **[TD-10]** Tek bekçi `npx tsx scripts/run-all-tests.ts <ad-parçası>` ile koşulur — doğrudan `npx tsx scripts/test_x.ts` üretim-DB kapısını ATLAR · zorlama: insan:hangi yolun kullanıldığı çağıranın kararıdır · kanıt: `productionDbGate` koşucunun kapısıdır
- **[TD-25]** Bekçi özet satırını koşucunun TANIDIĞI formatta basar (`=== Sonuç: N geçti, M başarısız ===`; `kaldı` ve `N/T geçti` de tanınır). Tanınmayan format kontrol sayısını GİZLER — koşucu "geçti (exit 0)" yazar ve sayı sıfıra düşse bile fark edilmez · zorlama: bekçi:`test_bekci_sozlesmesi.ts` (körlük zemini 400 dosya, muafiyet listesi iki yönlü) · kanıt: ölçüm 2026-09-06 — üç dosya ihlal ediyordu (`test_manual_move_backflush` + `test_manual_move_qc_reversal` İngilizce `N passed, M failed`, `test_depo_roll_cancel_permission` "düştü") ve 46 kontrol görünmüyordu

## 4 · Yeşil ≠ kapsandı · ## 5 · Yeni bekçi → ayrı dosya
Bir bekçinin **GÜVENCESİ** (yeşilin ne kanıtladığı, körlük zemini, negatif sonda) ve
**YAZIMI** (fixture, temizlik, yarış, taban/tavan, silme) tek ailedir ve birlikte
[`TEST-VE-DERLEME-BEKCI.md`](TEST-VE-DERLEME-BEKCI.md)'de yaşar — **bölüm numaraları
KORUNDU** (§4, §5), `[TD-xx]` kimlikleri değişmedi.


## 6 · Derleme

- **[TD-21]** Tip kontrolü projenin kendi `typecheck` script'iyle koşulur; Electron'da çıplak `npx tsc --noEmit` **hiçbir dosyayı derlemez** (kök `tsconfig.json` `files:[]` + `references`, `-b` yok) · zorlama: hook + CI · kanıt: 2026-09-05 — CI'ın "Type-check" adımı bu yüzden no-op'tu ve 9 tip hatası main'de bir gün durdu
- **[TD-22]** `tsc` çıktısı boruda renklidir: "temiz" hükmü ÇIKIŞ KODUNDAN verilir, grep'lenecekse `*:plain` varyantı kullanılır · zorlama: insan:hüküm çıkış kodundadır; metin taramasıyla ayırt edilemez · kanıt: `Teks-Erp/CLAUDE.md`
- **[TD-23]** Backend lint kapsamı `Teks-Erp/src` + `Teks-Erp/scripts` + `Teks-Erp/prisma` (2026-09-05'te açıldı; `scripts/` 554 dosya ve seed'ler hiç lint edilmiyordu); kapsam değişirse lint script'i, `scripts/check-lint-baseline.mjs` ve CI **birlikte** güncellenir · zorlama: bekçi:`scripts/check-lint-baseline.mjs` (depo KÖKÜ — `Teks-Erp/scripts/` altında DEĞİL) `EN_AZ_DOSYA` körlük zemini · kanıt: aynı boşluk tsc'de yaşandı (`scripts/` hiçbir tsconfig'in include'unda değildi → 87 tip hatası birikmişti)
- **[TD-24]** Lint uyarıları sessizce birikmez: tavan `lint-baseline.json`'da ve yalnız düşer · zorlama: bekçi:`scripts/check-lint-baseline.mjs` (depo KÖKÜ; üç projeyi birden okur, `--proje=<ad>` ile daraltılır) · kanıt: Electron 37 / mobil 136 uyarıyla yeşil geçiyordu
- **[TD-42]** Sonda rotayı PROFİLDEN kurar, fikstürden DEĞİL: istasyon kataloğu + rota şablonu tek kaynaktır (`docs/kurallar/rota-renk.md`), sonda "Tambur adımı vardır / KK2 yoktur / kurşun kapalıdır" varsayamaz · zorlama: insan (kapı YOK, aday: prova koşumu) · kanıt: ölçüm 2026-09-13 şema provası — fabrika klonunda (4.556 top) YEDİ bekçi fikstür rotasını varsaydığı için hiç koşmadı: `test_production_flow_api` (409 "kurşun dağıtımı açık") · `test_order_line_unit` · `test_quality_role_catalog` · `test_stock_ledger_warehouseless` · `test_warehouse_fail_open` (400 "Top Tambur adımında değil (PROCESS_QC)") · `test_traveler_card_a5_batches` · `test_quickstart_dispatch` (belge şablonu). ⇒ *Fabrikada koşmayan bir bekçi, fabrikayı korumuyor.* Ürün kusuru değil BEKÇİ KAPSAMI kusuru; düzeltme ayrı kalem (d5).

## 7 · Bilinen sınırlar → ayrı dosya · ## 8 · Bilerek kırmızı bekçiler

İkisi de [`TEST-VE-DERLEME-SINIRLAR.md`](TEST-VE-DERLEME-SINIRLAR.md)'de (`docs/standart/TEST-VE-DERLEME-SINIRLAR.md`) — bu dosya boyut tavanına 745 bayt kalmıştı; tavan YÜKSELTİLMEDİ, dosya BÖLÜNDÜ. §7 numarası orada da aynı.

**Paket koşarken kırmızı gördüysen ÖNCE şu dört ada bak** — dördü de BİLEREK kırmızı, hiçbiri kod kusuru değil:
`test_hook_config` §2 · `test_consistency` §1c/§1d · `test_db_invariants` §1 (nameFold) ve §5 (renk seddi).
Adı listede OLMAYAN her kırmızı GERÇEKTİR. Sahibi, sebebi ve kapanış koşulu §8'de.
