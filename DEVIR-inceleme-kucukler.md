# DEVİR — inceleme küçükleri (PR #902, dal `fix/inceleme-kucukler`)

Görev: `~/.tekserp/seyitoglu-desen-1125/NOT-KARSILASTIRMA.md` Not 9, 10b, 6, 5, 2, 4, 11 küçük düzeltmeleri (migration yok).

## Durum
- Kod commit `1d9e91493` (yedi madde de YAPILDI; ayrıntı ve kararlar PR #902 açıklamasında).
- PR #902 açık; CI izleniyordu (sonuç henüz okunmadı). `gh pr checks 902`.
- Bağlam sınırı nedeniyle burada durdu.

## Kalan adımlar (sırayla)
1. `gh pr checks 902` → yeşilse `gh pr merge 902 --merge`. Kırmızıysa yalnız ilgili bekçiyi düzelt.
2. `~/.tekserp/onizleme/onizle.sh main`.
3. Ekran kontrolü (YAZMA YOK — betik giriş dışı POST/PUT/PATCH/DELETE'i tarayıcıda keser):
   `node /private/tmp/claude-501/-Users-demirci-Documents-Projeler-Teks-Erp/e419cd19-5aca-44b9-837c-b32e162fad92/scratchpad/ekran-kontrol.cjs 1440 <çıktı-dizini>` ve `1920` ile. (Scratchpad silindiyse: `~/.tekserp/onizleme/f5-dene.cjs` kalıbından yeniden yaz.) Bakılacak: ürün listesi Birim sütunu "m"; ürün penceresi "Mamul en (cm)" + Dokuma ayrıntıları altında "Metretül … g/mt · En çekmesi %"; sipariş → Kumaş seç → Yeni → Tip "Kumaş" kilitli + ⓘ; çözgü kartı "Tarak ve dizilim" notu + ⓘ metinleri; desen kartı "Rapor boyu (cm)" + şeritte "Çerçeve sayısı" (Armür). Önizleme DB'de 3 ürün / 2 desen / 1 çözgü azalmamalı.
4. Temizlik: `~/.tekserp/thinkpad/tdb.sh sil tekserp_kucukduzeltme_test` (worktree içinden), sonra `git worktree remove --force Teks-Erp-wt/kucuk-duzeltme` + `git worktree prune` (ana ağaçtan; ana ağaçta commit yok).

## Notlar
- Worktree `.env` yalnız test değerleri (ana .env kopyalanmadı); `Teks-Erp/node_modules` seçici bağ + kendi Prisma kopyası (generate kopyaya yapıldı, ana client mtime değişmedi).
- Koşulan bekçiler: `test_kumas_hesaplanan_gramaj` 25/25 (negatif sonda §8c/§8d/§8e kırmızı gördü), `test_desen_karti_servis`, `test_etkin_yapi_tek_kaynak`, `test_tablet_etkin_yapi`, `test_desen_siniflama` yeşil; panel 114 dosya/800 test yeşil; typecheck + lint tavanı temiz; commit kapısı yeşil.
- Karar notu (`docs/kurallar/dokuma.md` tek satır: "en sırası mamul ≤ ham ≤ tarak UYARIR, reddetmez; tek kaynak fabric-width.helper") yazılmadı — istenirse `/karar-notu`.
