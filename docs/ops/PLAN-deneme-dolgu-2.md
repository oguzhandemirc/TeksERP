# PLAN — deneme kurulumu dolgu-2 (boş menüler)

> Hedef: `deneme.etkiliyazilim.com` (2.15.9) 2026-10-20 müşteri sunumunda boş/az menüler gerçekçi veriyle dolu görünsün.
> Araç: `scripts/deneme-veri/` (yalnız panel API'si, hizmet hesabı `demoveri`, idempotent). Dolgu-1 `dv:` ad alanında,
> dolgu-2 `dv2:` ad alanında. Bekçi: `scripts/test_deneme_veri.mjs` §10.

## 1. Ölçüm (deneme, `demoveri`, yalnız GET, 2026-10-19)

Kapalı modül yok (finance/ticaret/iplik/depoMulti/tezgah/devere/dokuma/emanet açık).

| Durum | Menü (kayıt) |
|---|---|
| DOLU | anasayfa · siparişler 793 · iş emirleri 806 · kumaş stoğu 358 · sevkiyatlar 200 (136 DISPATCHED, 178 faturasız, fiyat 0) · dokuma/duruş/levent · fason sevk/kabul · kurşun kuyruğu 71 · raporların çoğu |
| BOŞ | stok sayımı 0 · kartela sevk/kabul/stok/olay 0 · swatch 0 · iş emri şablonları 0 · iade karnesi (60 gün) 0 · mutabakat mektubu 0 · dönem kapanışı 0 · alarm sorumluları 0 · makine kartları 0 · duruş kodu eşleme 0 · donanım 0 · Sevk Kapısı 0 |
| AZ | faturalar 3 · tahsilat 4 · çek 4 · kasa/banka 2/2 · mal kabul 3 · alış sipariş 3 · depo transferi 1 · iplik stoğu 3 · hata tipleri 3 · tezgah alarmı 1 |
| ÖLÇÜLEMEDİ (izin yok) | etiket şablonları (`label-template:read`) · serbest belgeler · denetim raporu (`report:audit`) |

## 2. Dolgu tasarımı (dört adım, `doldur.mjs` ADIMLAR'da `finans`tan sonra)

| Adım | Ne doğar | İdempotency |
|---|---|---|
| `depo` | 4 alış siparişi (teslim alınan · kısmi · sarf/bekleyen · termini geçmiş) + 2 mal kabul, 3 iplik üretime çıkışı, 2 AÇIK sayım (iplik deposu: sayım girildi, bir bobin farkı · mamul B: yarıda) | sipariş/kabul `dv2:` token; iplik hareketi ve sayım nottaki `[DV2-…]` işaretiyle ara-yoksa-yarat; sayım satırı canlı satırdan karar |
| `kalite` | 7 dokuma hata tipi · 4 iş emri şablonu (rota istasyon türü dizisinden; kat değeri kurulumun KAT kataloğundan) · 3 müşteri iadesi (çapa−60…çapa sevk edilmiş toplardan, sevkiyat başına bir belge) | ad ile ara-yoksa-yarat; iade notundaki `[DV2-IADE:<sevk no>]` |
| `kartela` | 2 KK1 topu → kumaş başına iş emri (KK2 → Tambur, toptan 4,5 m parça) → 2 kartela sevki → biri kabul (36 kartela stoka) · diğeri firmada bekler | top/iş emri `dv2:` token; geçişler canlı top durumundan |
| `finans-gecmis` | çapa−60…çapa−1 sevk edilmiş sevkiyatlardan en çok 24 satış faturası (tarih = sevk günü, vade 60 gün; fiyat 0 ise kalem başına belirlenimli 95–185 TL/m) · ≥20 gün eski faturaların 3'te 2'sine havale tahsilatı + kapama · 5 çek (portföy/bankada/tahsil) · mal kabule bağlı 2 alış faturası · 5 kasa gideri · iade başına satış iade faturası (`returnGroupId` ile iadeye bağlı) · 2 mutabakat mektubu | fatura/tahsilat/çek/gider `dv2:` token; onay/kapama canlı durumdan; mektup nottaki `[DV2-MUTABAKAT-n]` |

Seçim kuralları (deneme verisine karşı ölçülerek):
- Dış muhasebe izi (`invoiceNo`) taşıyan ama iç faturası olmayan sevk faturalanmaz — onay o izle çakışır (409).
- Döviz carisinin sevki faturalanmaz (kur uydurulmaz); yalnız TL.
- Başkasının elle tahsil ettiği fatura (ödenen ≠ bizim tutar) tahsilata alınmaz.
- Tek sevkin kesin 4xx'i adımı durdurmaz, `⚠` satırıyla görünür kalır; token çakışması durdurur.
- Tokenlı gövdeler çapadan türer (saatten değil) ⇒ aynı `--cap` ile ikinci koşum replay'e düşer. Çapa değişirse `dv2:` gövdeleri `CLIENT_TOKEN_COLLISION` verir — deneme için çapa `2026-10-16` sabittir.

## 3. Doldurulmayanlar ve nedenleri

| Menü | Neden |
|---|---|
| Sevk Kapısı | yalnız `shipmentConfirmationEnabled` açıkken PLANNED dolar; deneme profilinde kapalı |
| Stok sayımı TAMAMLAMA | tamamlama `roll:manual-adjust` (SoD) ister; hizmet hesabında yok — sayımlar DRAFT "sayım sürüyor" kalır (DRAFT depoyu kilitlemez) |
| Dönem kapanışı | `finance:close`, geri dönüşü ağır; sunumda elle gösterilir |
| Makine kartları · donanım · duruş kodu eşleme | gerçek cihaz/toplayıcı ister; uydurma cihaz kaydı keşif ekranını yanıltır |
| Alarm sorumluları | kullanıcı ataması — admin işi, hizmet hesabının değil |
| Tezgah alarmı | sinyal kaynaklı (toplayıcı); API'den üretilmez |
| Etiket şablonları · serbest belgeler · denetim raporu | hizmet hesabının okuma izni yok; ölçülmedi |

## 4. Doğrulama

- Yerel (`tekserp_dolgu_test`, çapa = bugün): iki koşum, ikinci koşumda "yeni" 0 ve DB sayımı birebir aynı; `duman.mjs` yeni menülerin okuma uçlarını (stok sayımı, kartela sevk, swatch, iade, şablon, hata tipi, mutabakat) 200 + kayıt > 0 ile ölçer.
- `node scripts/test_deneme_veri.mjs && node scripts/test_deneme_veri.mjs --sonda` — §10: her adım dosyası ADIMLAR'da kayıtlı · token öneki tek dosyanın · salon/dokuma dışında saat okuması yok (N10–N12).
- Deneme önizlemesi: `doldur.mjs --kuru` (yalnız GET; yazımlar sayılır, gönderilmez — `lib/kuru.mjs`). Sahte kimlikte duran zincir halkaları (KK2/tambur/kartela sevk-kabul, sayım satırları, iade faturaları) önizlemede sayılmaz; sayılar alt sınırdır.

### Deneme kuru koşu (2026-10-19, `--cap 2026-10-16`, 193 GET, 0 yazım gönderildi)

| Adım | Öngörülen yazım | Zincirde ayrıca (sahte kimlikte durur) |
|---|---|---|
| `ana-veri` | 0 (OTHER istasyonu pasif — "Katlama Masası 1" eklenmez) | — |
| `depo` | 1 cari (Marmara Ambalaj) · 4 alış siparişi · 2 mal kabul · 3 iplik çıkışı · 2 sayım | sayım satırı işaretleri (iplik deposu kalemleri + mamul B topları) |
| `kalite` | 7 hata tipi · 4 şablon · 3 iade | — |
| `kartela` | 2 KK1 topu · 2 iş emri | 2 KK2 + adım bitir · 2 tambur · 2 kartela sevki · 1 kabul (36 kartela) |
| `finans-gecmis` | 24 satış faturası + 24 onay · 4 tahsilat + 4 kapama · 5 çek + 1 bankaya + 1 tahsil · 5 kasa gideri · 2 mutabakat | 2 alış faturası (mal kabule bağlı) · 3 iade faturası |

`ana-veri` düzeltmesi: dolgu-1 adımı pasif istasyona makine eklemeye çalışıyordu (denemede "KATLAMA VE PAKETLEME" pasif); artık
pasif istasyonun makinesi atlanır.

## 5. Uygulama (KULLANICI ONAYIYLA, deneme sunucusu)

```
node scripts/deneme-veri/doldur.mjs --url https://deneme.etkiliyazilim.com --sir tekserp/deneme-demoveri-parola --cap 2026-10-16 --adim depo,kalite,kartela,finans-gecmis
node scripts/deneme-veri/duman.mjs  --url https://deneme.etkiliyazilim.com --sir tekserp/deneme-demoveri-parola --cap 2026-10-16
```

429 hız sınırında istemci ≥21 sn bekleyip aynı gövdeyle yeniden dener (uzun sürebilir). Yarıda kalırsa aynı komut yeniden koşulur.
