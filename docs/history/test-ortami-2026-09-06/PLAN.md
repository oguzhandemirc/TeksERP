# Test ortamı — araştırma, ölçüm ve plan (2026-09-06)

Soru: *"test ortamımız nasıl olmalı"*. Yöntem bu repoda zaten yazılı: **ölç, sonra karar ver.**
Üç ajan salt-okunur envanter çıkardı (ham JSON bu dizinde), ana oturum iki kesin deney koştu.

---

## 1 · Bugün ne var

| | Backend | Electron | mobil |
|---|---|---|---|
| Araç | **yok** (bilinçli, `[TD-07]`) | vitest 3 + Testing Library + jsdom | jest-expo + RNTL |
| Dosya | 458 `scripts/test_*.ts` | 213 dosya / 2.290 test | 86 suite / 859 test |
| Süre | ~333–390 sn, **sıralı** | 23–42 sn, paralel | 27–29 sn, `--runInBand` |
| Koşucu | kendi yazdığımız `run-all-tests.ts` (407 satır) | vitest | jest |

Üç fail-closed geçit: üretim-DB kapısı → tip kontrolü (~28 sn) → migration durumu.

---

## 2 · İki deney

### Deney A — tam paket, SIFIRDAN kurulmuş temiz veritabanında

`migrate deploy` (235 migration) **4 sn** · `seed` + `seed:fixtures` sorunsuz · paket **333 sn**.

**Sonuç: 446/457.** Yani bekçilerin **%97,6'sı gerçekten veriden bağımsız.** Kalan 11'i değil.

### Deney B — DB-per-worker paralel koşum

6 işçi veritabanı (`tekserp_w1_test` … `w6_test`) paralel **15 sn**de kuruldu.
Tam paket **144 sn** (2,3×). İkinci koşum **aynı 12 kırmızı** → deterministik, rastgele değil.

| | seri (paylaşılan DB) | seri (temiz DB) | 6 işçi (temiz DB) |
|---|---|---|---|
| Süre | 345 sn | 333 sn | **144 sn** |
| Kırmızı | 0 | 11 | 12 |

---

## 3 · Hüküm: paralelleştirme ŞİMDİ DEĞİL

Kazanç gerçek (~3 dk) ama bedelin şekli yanlış:

1. **Kadans.** Tam paket commit başına değil **PR/push başına** koşuyor (`[TD-01]`). Kimseyi bekletmiyor.
2. **Her parça elle yazılır.** Koşucu bizim: işçi havuzu, çıktı tamponlama, N+1 kapı doğrulaması, işçi-DB sağlama betiği ≈ 150–200 satır yeni yüzey. vitest/jest'te bedava olan hiçbir şey burada bedava değil.
3. **Kalıntı sorununu ÇÖZMEZ.** 458 / 6 ≈ 76 bekçi hâlâ aynı DB'de ardışık koşuyor. `TEST-` damgası ve `finally` temizliği aynen gerekli. "Paralelleştirirsek temizlikten kurtuluruz" ölçümle YANLIŞ.
4. **Önce 12 bekçi düzelmeli.** Aksi halde paralel koşum her seferinde 12 kırmızıyla başlar ve gürültü sinyali gömer.

**Ama deney boşa gitmedi** — asıl ürünü hız değil, aşağıdaki iki ölçülmüş bulgu.

### Bulgu 1 — ortamdan beslenen 12 bekçi (isimleriyle)

`test_auto_draft_shipment` · `test_fold_catalog` · `test_goods_receipt_invoice` ·
`test_kanban_card_projection` · `test_module_grandfathering` · `test_module_profile` ·
`test_order_cancellation` · `test_record_provenance` · `test_roll_po_line_trace` ·
`test_scan_code_case` · `test_scrap_grade_label` · `test_wip_scorecard`

Bunlar `[TD-17]`'nin ölçülmüş listesi: kırmızı/yeşil ayrımı koddan değil ortamdan doğuyor.
Bugün `tekserp_demo` üzerinde yeşiller çünkü o DB'de 5 günlük birikmiş test artığı var
(`work_orders`'ın %94,2'si, `rolls`'un %35,2'si).

### Bulgu 2 — işçi/test DB adı `_test` ile BİTMELİ

`scripts/db-guard.ts` izin listesini `endsWith` ile eşliyor. `tekserp_test_w1` **reddedildi**,
`tekserp_w1_test` **geçti**. Kapı doğru çalışıyor; isimlendirme bir tasarım kısıtı.

---

## 4 · Bu turda YAPILANLAR

Hepsi ölçüldü, hepsinin negatif sondası var.

| # | İş | Önce | Sonra |
|---|---|---|---|
| 1 | Atlanan-kontrol sayacı `Sonuç:` satırına demirlendi | **6 dosyada 63** — 3'ü hayalet, 3 gerçek atlama gizli | **8 dosyada 58**, hepsi gerçek |
| 2 | `test_finance_flag_off` atlanan sayısı beyan edildi | "5" (yanlış, metinden kazınma) | **6** (gerçek) |
| 3 | `test_label_dirty_sources` atlanan sayısı beyan edildi | "7" (yanlış) | **1** (gerçek) |
| 4 | Üç bekçinin özet formatı düzeltildi | `geçti (exit 0)` — **46 kontrol görünmüyordu** | 9 + 5 + 25 kontrol görünür |
| 5 | Yeni meta-bekçi `test_bekci_sozlesmesi.ts` | çıktı sözleşmesinin kapısı yoktu | 4 kontrol, körlük zemini 400 dosya |
| 6 | `.claude/rules/bekci-standart.md` | 457 bekçinin **173'ü hiçbir kural yüklemiyordu** | bekçi dosyasına dokunan sözleşmeyi görüyor |
| 7 | `TEST-VE-DERLEME.md` §3/§4/§5/§7 | 24 kural | **31 kural** (TD-11a, TD-25…TD-30) + ölçülen sınırlar |
| 8 | `.claude/skills/bekci-kos/SKILL.md` | "npm test **saatler** sürer" | "~6,5 dakika" (`[TD-02]` ile çelişki kalktı) |

Format ihlali 3'tü, 2 değil: araştırma İngilizce basanı buldu, meta-bekçi üçüncüsünü
(`test_depo_roll_cancel_permission`, "düştü") buldu — 25 kontrol gizliydi.

**Ölçüm çürüttü, kural yazılmadı:** "kontrol atlayan bekçi sayıyı özet satırında beyan etmeli"
kuralı metinden ölçülemiyor — aday yüklem 458 dosyanın 52'sini işaretledi, çoğu bir check
etiketinde geçen kelimeydi. Gerekçe bekçinin başlığına yazıldı.

### Doğrulama

Tam paket paylaşılan dev DB'de **458/458 · 336 sn** (2026-09-06). Demirleme üç hayaleti sildi
**ve** onların maskelediği üç gerçek atlamayı ortaya çıkardı (`test_module_profile`,
`test_scrap_grade_label`, `test_subcontract_scorecard` — her biri 1 kontrol). Tip kontrolü,
lint (0 hata, tavan aşılmadı), doküman ve migration kapıları temiz.

---

## 5 · Sırada ne var (öncelik sırasıyla, hiçbiri yapılmadı)

1. **Paylaşılan dev DB'nin süpürgesi çalışmıyor.** `clean_test_residue.ts` 14 önek tutuyor;
   bugünkü 313 artık topun **0'ı** eşleşiyor. Kodda 406 farklı önek var. Envanter tutulmaz, desen tutulur
   → genel `TEST-%`/`TST-%` desenine çevir (ADA ASLA — güvenlik gerekçesi korunur).
2. **12 ortam-bağımlı bekçi** (yukarıda). Her biri ayrı bir teşhis; toplu düzeltme yok.
3. **`findFirst` / ham `admin` borcunu dondur.** 94 dosya "herhangi bir aktif kayıt", 127 dosya
   `username:"admin"`. AST bekçisi + tavan (lint-baseline deseninin aynısı) → borç donar, yeni sapma durur.
4. **Negatif sonda kapsamı.** 455 bekçinin 348'inde (%76,5) kayıtlı sonda yok. Toptan çözüm 60–115 saat,
   gerçekçi değil; ÇEKİRDEK alanlara (finans · sevkiyat · modül-bayrak · yetki-izin ≈ 50-60 dosya) sonda
   + sayıyı tavanla dondur.
5. **CI'da 53 atlanan kontrol.** Sunucu isteyen 5 bekçi CI'da da atlanıyor; CI zaten sıfırdan ortam
   kuruyor, 5 sunucuyu env'leriyle başlatmak orada doğal iş. Yerel koşucuya süreç yönetimi **sokulmaz**
   ("ikinci Node süreci yasak" + `pkill` yasağı).

---

## 6 · Kararı değişmeyen şey

**Backend'de jest/vitest kurulmaz — karar hâlâ doğru, ama gerekçesi düzeltildi.**
"vitest bunu koşamaz" DOĞRU DEĞİL (koşardı: `fileParallelism:false` + `globalSetup` + `pool:'forks'`).
Doğru gerekçe: dönüşüm 458 dosya / ~134k satıra dokunur ve mock kültürü riski taşır. Kazancın kaynağı
framework'süzlük değil **mock yokluğu** — test edilen şeylerin ağırlığı DB davranışı
(DEFERRABLE FK, partial UNIQUE sed, advisory kilit, DB CHECK, trigger damgası) ve bunlar mock'lanamaz.
`[TD-07]` bu gerekçeyle güncellendi.

**Piramit ters değil, iki kutuplu (T):** backend %85,8 entegrasyon, istemcilerde %70-76 saf birim,
ortada e2e fiilen yok (2 smoke, ikisi de `continue-on-error`). Fabrika yazılımında iş kuralı DB'de
yaşadığı için bu dağılım savunulabilir; değiştirmek güvenceyi AZALTIR.

---

## 7 · Ortalıkta bırakılanlar

Deney için 7 veritabanı yaratıldı: `tekserp_test_w1` (yanlış adlandırma, kapıya takılıyor) ve
`tekserp_w1_test` … `tekserp_w6_test`. Paralelleştirme yapılmadığına göre hiçbiri gerekli değil.

**Silinemediler — komut kapısı durdurdu, ve bu doğru davranış.**
`scripts/claude-hooks/bash-guard.mjs` veritabanı düşürmeyi canlı veri kuralı gereği yasaklıyor;
kaçış (`TEKSERP_HOOK_SKIP=1`) yalnız kullanıcı kararıyla açılır. Bu turda kapılar üç kez ısırdı:
① `db-guard.ts` yanlış adlandırılmış işçi DB'sini reddetti ② yeni meta-bekçi kendi negatif
sondasında kırmızı verdi ③ bu kapı benim temizliğimi durdurdu.

Silme kararı kullanıcınındır. Yeniden kurmak **15 sn** (ölçüldü), yani silmenin bedeli yok.
