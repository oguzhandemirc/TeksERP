# e-İrsaliye v1 — Mali müşavir / GİB doğrulama listesi ve kullanıcı onay listesi

> Durum: 2026-10-25, v1 kodu main'de (E1–E7). Bu listedeki **⚠** maddeler doğrulanmadan e-İrsaliye CANLI kullanılmaz (GİB'e gerçek belge gönderilmez); dışa aktarım + entegratör TEST ortamı denemesi serbesttir. Kaynak: plan `docs/design/E-IRSALIYE-PLAN.md` §1, §2, §6, §7 · kod sabitleri `Teks-Erp/src/constants/e-irsaliye.ts` (12 madde). Mevzuat bilgisi blog/entegratör kaynaklıdır; GİB kılavuzu ve XSD paketi DOĞRUDAN okunmadı.
>
> Kullanım: her maddeye cevap + kaynak (tebliğ/kılavuz sayfası) yazılır; cevap koddan farklıysa "Etki" sütunundaki yer değişir (tek kaynak) ve arşive not düşülür.

## A. Mali müşavir / GİB doğrulaması (V1)

| # | Soru | v1'de bugün ne yapıyoruz | Etki (yanlışsa) |
|---|---|---|---|
| M1 ⚠ | Zorunluluk eşiği: e-Fatura mükellefi + brüt satış hasılatı ≥ 10 M TL (VUK 509, 2026 tutarı) doğru mu? | Hesaplamıyoruz; fabrika kendisi yapılandırır | Satış/keşif metni |
| M2 ⚠ | Belge başına özel usulsüzlük cezası tutarı (2026 aktarımı ~17.000 TL?) | Yalnız gerekçe metninde geçer | Satış/eğitim metni |
| M3 ⚠ | **Alıcı vergi dairesi** e-İrsaliyede zorunlu mu? | Basılmıyor (müşteri kimliğinde vergi dairesi alanı yok) | Zorunluysa K-B işi: `Customer.taxOffice` + `CariAccount.taxOffice` tek kaynak (master veri + finans) |
| M4 ⚠ | **Numara biçimi**: 3 karakter seri + 4 hane yıl + 9 hane sıra (`EIR2026000000001`); yıl başında sıfırlama; yıl ortası geçişte kaldığı sıradan sürme | Böyle üretiyoruz; başlangıç değeri yalnız içinde bulunulan yıl, ilk numaradan önce | Seri katalog satırı + `series-fixed-shape.helper` |
| M5 ⚠ | Numara **boşluğu** (üretilmiş ama GİB'e gitmemiş kaydın iptali) cezalı/yasak mı? | Boşluk oluşabilir; iptal önizlemesi söyler | İptal yolu (plan R3) |
| M6 ⚠ | **`confirmedNo` / `confirmedEttn` anlamı**: entegratör portalı numarayı veya ETTN'yi değiştirir mi; değiştirirse resmi olan hangisi? | Elle kayıtta entegratörün bildirdiği no/ETTN ayrı alanda tutulur, bizimki ezilmez | E1 şeması + E5 elle kayıt |
| M7 ⚠ | HATA'dan yeniden üretim: aynı numara + YENİ ETTN kabul mü? | Böyle (patron kararı E5) | E5 yeniden üretim |
| M8 ⚠ | Gönderilmiş e-İrsaliye **iptal edilemez** mi; portaldaki "iptal talebi"nin mevzuat karşılığı? | İptal yok; storno 409, kâğıt revizyon kilitli | E6 storno kapısı |
| M9 ⚠ | İrsaliye Yanıtı süresi (7 gün?) ve alıcı yanıt vermezse durum | Yanıt elle kaydedilir, süre takibi yok | E5 yanıt kaydı |
| M10 ⚠ | Alıcı e-İrsaliye sistemine kayıtlı değilse (kâğıt çıktı mı, kâğıt irsaliye mi) | Her yurt içi alıcıya üretime izin + bilgi satırı | Panel kartı |
| M11 ⚠ | İhracat (EXPORT) sevkiyatı akışı | v1'de 400 / "desteklenmiyor" | v1.1 kapsamı |
| M12 ⚠ | Düzenleme anı ile fiili sevk anı arası izin verilen fark; "sevkten önce düzenlenir" kuralı | v1 yalnız DISPATCHED sonrası üretir (K-E) | Sevk öncesi üretim ayrı tasarım |
| M13 ⚠ | Taşıma bilgisi: (plaka + şoför) YA DA taşıyıcı (unvan + VKN) yeter mi | Taşıyıcı serbest metinden | `constants/e-irsaliye.ts` md. 6 |
| M14 ⚠ | `CustomizationID` tam değeri (`TR1.2` / `TR1.2.1`), `ProfileID` = TEMELIRSALIYE, tip = SEVK yeterli mi; MATBUDAN gerekir mi | Sabitlerde | md. 1 |
| M15 ⚠ | ETTN harf büyüklüğü; imzasız belgede `cac:Signature` yer tutucusu; boş `UBLExtensions` | Sabitlerde / yazıcıda | md. 2–4 |
| M16 ⚠ | Kimlik şema adları (VKN, TCKN, MERSISNO, TICARETSICILNO, PLAKA, DORSEPLAKA); satır `OrderLineReference`; sipariş no'nun `Note`ta durması; GTİP/fiyat/ürün kodu basılmaması; teslim adresi = alıcı adresi | Sabitler + eşleme | md. 5, 7–9 |
| M17 ⚠ | UBL öğe sırası ve metin uzunluk sınırları GİB XSD'siyle uyumlu mu | Ezberden yazıldı; altın örneklerle korunuyor | V3 XSD bekçisi |

## B. Kullanıcı onay listesi

| # | Karar | Durum |
|---|---|---|
| U1 | **Entegratör seçimi** (fabrikanın kullandığı: Logo/Mikro/Foriba/Uyumsoft …) — v2 bağdaştırıcısı buna göre yazılır | AÇIK (KARARLAR E-IRS: v2 kullanıcı seçince) |
| U2 | **Entegratör test hesabı** — v1'de yalnız portal TEST ortamına XML yükleme denemesi için; kimlik bilgisi repoya/log'a girmez | AÇIK |
| U3 | Mali müşavir görüşmesi (A bölümü) — canlı kullanım ön koşulu | AÇIK |
| U4 | GİB UBL-TR XSD paketinin repoya alınması (lisans) + CI imajına `libxml2-utils` (V3); onaysızsa XSD bekçisi "ATLANDI" | AÇIK |
| U5 | Yeni paket (V4): varsayılan YOK, `xmlbuilder2` yalnız ölçülmüş gerekçe + onayla | KAPALI (paket eklenmedi) |
| U6 | K-B alıcı vergi dairesi alanı (M3'e bağlı) | AÇIK |
| U7 | K-D (v2): entegratöre giden istekler "dışarı giden her istek kurulum anahtarıyla imzalanır" kuralının istisnası mı | AÇIK (v2) |
| U8 | K-E sevkten önce (PLANNED) üretim | AÇIK (talep gelirse ayrı tasarım) |
| — | K-A kâğıt revizyonu | KAPANDI: kilitli (patron kararı E6, 2026-10-25) |
| — | K-C varsayılan `adapter: yok`, profile girmez | KAPANDI: uygulandı (E3-AYAR) |
| — | Ticaret rolü yalnız `eirsaliye:read` · XML yalnız `POST …/download` | KAPANDI (patron kararı E5) |
