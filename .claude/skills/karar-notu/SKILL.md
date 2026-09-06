---
name: karar-notu
description: Yeni bir karar/saha bulgusu/tasarım kararını belge katmanına doğru yere yazar — tam metin arşive, tek kural satırı alan dosyasına, yalnız her alanda geçerliyse kök CLAUDE.md'ye; ezilen eski kuralı işaretler. "not yaz", "CLAUDE.md'ye ekle", "bunu belgele", "karar notu" dendiğinde kullan.
---

# karar-notu

Kök `CLAUDE.md` her oturumda yüklenir ve boyut kapısı vardır (`scripts/check-docs.mjs`: kök ≤ 36 KB). Hikâye köke GİRMEZ.

## Üç kat, üç yazım

1. **Arşiv — tam metin:** `docs/history/CLAUDE-NOT-ARSIVI.md` sonuna `## YYYY-MM-DD — Başlık [ÇEKİRDEK|PROFİL]`. İçerik: saha sorusu/ölçüm → karar → gerekçe → kod çapaları (`dosya:satır`) → bekçi → migration/izin/APK gerekiyor mu (üç kapı). Sınıf ölçütü: defter semantiği, veri bütünlüğü, idempotency, kilit sırası, fail-closed, sır hijyeni = ÇEKİRDEK; rota/istasyon/bayrak/sayısal ayar = PROFİL (`docs/design/MODUL-BAYRAK-TASARIM.md` §11).
2. **Alan dosyası — tek kural satırı:** `docs/kurallar/<alan>.md` ilgili bölüme (Değişmezler/Yasaklar/Tuzaklar/Reçeteler/Kararlar): `- **[ÇEKİRDEK]** <emir kipinde tek cümle, kendi başına anlaşılır> · bekçi: \`<dosya>\` <sub>(arşiv:YYYY-MM-DD)</sub>`. Alan yoksa `docs/kurallar/README.md` tablosuna yeni satır + yeni dosya.
3. **Kök `CLAUDE.md` — yalnız her alanda geçerli değişmez:** § Çekirdek değişmezler'e tek satır. Alan dizinindeki özet satırı gerekiyorsa güncelle (≤160 karakter). Kök büyüyorsa bir şey alan dosyasına inmelidir.

## Eski kural ezildiyse
- Alan dosyasında eski cümleyi SİL (yan yana iki cümle bırakma); "Geçersiz kılınan kurallar" bölümüne `ESKİ → YENİ: ne değişti` satırı.
- Arşivdeki eski notun başlığının hemen altına `> ⚠️ **GEÇERSİZ/KISMEN (YYYY-MM-DD)** — … → bkz. <yeni not>` bloğu.
- Kod yorumu hikâye taşıyorsa çapaya indir: `// bkz. arşiv YYYY-MM-DD <başlık>`.

## Teknik desen / reçete / yasak ise
`docs/KOD-KURALLARI.md` (desen, yasak) · `docs/RECETELER.md` ("X eklerken şu N yer") · `docs/SOZLUK.md` (yeni terim).

## Bitirmeden
`node scripts/check-docs.mjs` (ölü link + boyut kapısı) yeşil. Kullanıcıya: nereye ne yazıldı, hangi eski kural işaretlendi.
