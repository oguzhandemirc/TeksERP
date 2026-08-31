# Kapanan bulgular — düzeltme turu kaydı

> **Bu dosya git'ten TÜRETİLİR, elle tutulmaz.** Kaynak: `adnansahin` dalındaki
> commit mesajlarında geçen `BULGU-…` kimlikleri. Amacı tek: bir sonraki oturum
> `findings.json`'ı açıp **zaten kapanmış** bir bulguyu yeniden düzeltmeye
> kalkmasın.
>
> ⚠️ **`findings.json` bir FOTOĞRAFTIR, canlı durum değil.** Bu turda birebir
> yaşandı: `BULGU-T1-020` (kur.ps1 `ecosystem.config.js`i eziyor) kaydı hâlâ
> "açık" görünüyordu, oysa aynı programın erken bir turunda `560f74f0` ile
> kapatılmıştı — kaydın mekanizması doğrulanıp *düzelten kodun o anki hâli*
> okunmadığı için yanlış çerçeveli bir commit yazıldı ve `27af3a06` ile
> düzeltildi. **Bulguyu düzeltmeden önce ilgili dosyanın BUGÜNKÜ hâlini oku.**

## Kapanan bulgu kimlikleri (27)

| Bulgu | Commit(ler) |
|---|---|
| BULGU-T1-016 | `c644de0f` |
| BULGU-T1-001 | `3f600703` · `1dcb5adc` |
| BULGU-T1-085 | `3f600703` |
| BULGU-T1-020 | `560f74f0` · `edbeaf07` |
| BULGU-T1-024 | `ce9a71ea` |
| BULGU-T1-015 | `6b6c6b66` |
| BULGU-T3-001 | `68486d3b` · `62262fb6` |
| BULGU-T2-002 | `1dcb5adc` |
| BULGU-T2-016 | `1dcb5adc` |
| BULGU-T1-005 | `6aa5c2f2` |
| BULGU-T1-009 | `b7718ff8` · `d12f4abb` |
| BULGU-T1-010 | `81ee79bd` |
| BULGU-T3-003 | `81ee79bd` |
| BULGU-T3-002 | `56a28b26` |
| BULGU-T1-006 | `aa6f1d93` |
| BULGU-T1-002 | `c2af089d` |
| BULGU-T1-045 | `3877d956` |
| BULGU-T1-011 | `94b937c0` · `d12f4abb` |
| BULGU-T1-008 | `56ccf218` |
| BULGU-T2-011 | `2db06682` |
| BULGU-T2-003 | `5f654890` |
| BULGU-T2-007 | `1d527d61` |
| BULGU-T1-007 | `0c09d94f` |
| BULGU-T2-004 | `14d11ff7` |
| BULGU-T1-019 | `c126eff0` |
| BULGU-T4-003 | `1693fec0` |
| BULGU-T1-053 | `8aab44b4` |

## Kronoloji

| Commit | Tarih | Bulgu | Başlık |
|---|---|---|---|
| `c644de0f` | 2026-08-29 | T1-016 | fix…  rota kimlik bekçisi tam yol anahtarı kullanıyor + client-policy |
| `3f600703` | 2026-08-29 | T1-001, T1-085 | fix…  "Düzelt" claim'i statüyü ve okunan metrajı pinliyor — kesim art |
| `560f74f0` | 2026-08-29 | T1-020 | fix…  kur.ps1 sunucunun ecosystem.config.js'ini KORUYOR, paketinkiyle |
| `ce9a71ea` | 2026-08-29 | T1-024 | fix…  bayatlık yalnız GECE yedeğinden ölçülüyor + hüküm alanı eklendi |
| `6b6c6b66` | 2026-08-29 | T1-015 | fix…  otomatik testler sahaya çıkan `adnansahin` dalında da koşuyor |
| `68486d3b` | 2026-08-29 | T3-001 | fix…  ekransız çakışma artık duyuruluyor — kuyruktan düşen KK1 kaydı  |
| `1dcb5adc` | 2026-08-29 | T1-001, T2-002, T2-016 | fix…  depo kesimi giriş metrajına (initialQty) dokunmuyor — üç kusur  |
| `6aa5c2f2` | 2026-08-29 | T1-005 | fix…  eşzamanlı kabulde aynı fiş iki kez düşülüyordu (S1/K3) |
| `b7718ff8` | 2026-08-29 | T1-009 | fix…  iptal, fason sevki kapatılamadığında da devam ediyordu (S1/K3) |
| `81ee79bd` | 2026-08-29 | T1-010, T3-003 | fix…  aynı talep iki kez sevk edilebiliyordu + iptal siparişe tahsis  |
| `56a28b26` | 2026-08-29 | T3-002 | fix…  tabletten çıkan sevkiyat sipariş defterine yazılmıyordu (S1) |
| `aa6f1d93` | 2026-08-29 | T1-006 | fix…  iptal edilmiş kaydın token'ı "başarılı" dönüyordu (S2/K3) |
| `c2af089d` | 2026-08-29 | T1-002 | fix…  eşzamanlı aşım kesimi yoktan kumaş üretiyordu (S2/K3) |
| `3877d956` | 2026-08-29 | T1-045 | fix…  rota seviyesindeki 10 MB limiti hiç koşmuyordu (S2/K3) |
| `94b937c0` | 2026-08-29 | T1-011 | fix…  geri almayla iptal edilen parça diriltilebiliyordu (S1/K3) |
| `56ccf218` | 2026-08-29 | T1-008 | fix…  zaman aşımından sonra "Tekrar Dene" dosyayı ikinci kez yazıyord |
| `d12f4abb` | 2026-08-29 | T1-009, T1-011 | fix…  fason kalanı sert engel DEĞİL AÇIK KARAR — 2026-08-17 desenine  |
| `2db06682` | 2026-08-29 | T2-011 | fix…  birleştirme izi fiziksel tablo adına yazılıyordu (S2) |
| `5f654890` | 2026-08-29 | T2-003 | feat…  sevk defterinin izi yazılıyor — "neden siparişten düşmedi" ceva |
| `62262fb6` | 2026-08-31 | T3-001 | test…  T3-001 düzeltmesinin TELİ de ölçülüyor (iki uç yeşilken tel kop |
| `1d527d61` | 2026-08-31 | T2-007 | fix…  kısmi kabulde replay kimliği gerçekten çalışıyor (BULGU-T2-007) |
| `0c09d94f` | 2026-08-31 | T1-007 | fix…  ad-mükerrer yarışı DB seddiyle kapatıldı — 8 tablo (BULGU-T1-00 |
| `14d11ff7` | 2026-08-31 | T2-004 | fix…  §1c — defterin KENDİSİNİN eksikliği artık görülüyor (BULGU-T2-0 |
| `edbeaf07` | 2026-08-31 | T1-020 | fix…  gece yedeğinin SAHİBİ görünür oldu + deploy kontrol maddesi (BU |
| `c126eff0` | 2026-08-31 | T1-019 | fix…  yıkıcı betiklere ortam kapısı — TRUNCATE artık prod'a bakamaz ( |
| `1693fec0` | 2026-08-31 | T4-003 | fix…  "aynı token, FARKLI gövde" kapısı dört uçta daha (BULGU-T4-003) |
| `8aab44b4` | 2026-08-31 | T1-053 | fix…  `.env` git izlemesinden çıkarıldı + mekanik bekçi (BULGU-T1-053 |

## Kapanmayanlar hakkında

`findings.json` 250+ kayıt taşıyor; yukarıdakiler dışındakiler AÇIKTIR ama
hepsi "yapılacak" demek değil — bir kısmı ölçümle şiddeti düşmüş, bir kısmı iş
kararı bekliyor. Sıradakini seçerken kural: **önce `curutme.sonuc` alanını oku**
(`ayakta` / `ayakta-siddet-dustu` / `curutuldu`), sonra ilgili kodun bugünkü
hâlini doğrula.

### Bu turda BİLEREK yapılmayanlar (karar kullanıcının)

| Konu | Neden bırakıldı |
|---|---|
| `ecosystem.config.js` ayarlarının `.env`'e taşınması (T1-020 şık A/B/C) | İş kararı; ayrıca C şıkkı deploy script'i değiştirir ve **pwsh olmadan doğrulanamaz** |
| `JWT_SECRET` rotasyonu (T1-053) | Tüm canlı oturumları düşürür → vardiya dışı, saha erişimi ister |
| Git geçmişinden sır temizliği (T1-053) | Paylaşımlı ağaç + yayın dalı; rotasyondan sonra geçmişteki değer zaten ölü |
| Fason kabulünde SUNUCU tarafı gövde kapısı (T4-003 muaf listesi) | Kimlik = `returns` kümesi + `receivedQty`'ler; kısmi teslimatta meşruen tekrar eden top kümesiyle çakışmamalı — ayrı ve dikkatli iş |
| 5 sevkiyatın sipariş defteri onarımı (T2-004) | `setShipmentOrders` hazır; hangi siparişe bağlanacağı **iş kararı** |
| `stations` / 4 tabloya ad seddi (T1-007) | Fixture damgalaması + "iki müşterinin de 'Merkez' şubesi olabilir mi" sorusu |

---

# Bayatlık taraması — 2026-08-31

Kullanıcı kararı: "önce listeyi temizle". Açık görünen 40 S1/S2 bulgusundan
ölçülebilenler ölçüldü. **Yöntem sırası:** ① bulgunun `repro_script`i varsa
KOŞTURULDU (kesin cevap) · ② yoksa mekanizma bugünkü kodda arandı · ③ ikisi de
yoksa "taranmadı" olarak bırakıldı.

⚠️ Ölçüm sırasında bir tuzağa düştüm ve kayda geçiyorum: repro'ları önce
`timeout 300 npx tsx …` ile koşturdum — **macOS'ta `timeout` komutu YOK**, on
script de "çıktı yok" verdi ve bu sessizce "hepsi kapalı" gibi okunabilirdi.
Toplu ölçümde her zaman "hiç mi koşmadı" sorusunu ayrıca sor.

## ZATEN KAPALIYMIŞ (iş yapılmadı — 6)

| Bulgu | Kanıt |
|---|---|
| T1-003 | `tambur-undo.service`te `lockAndAssertWorkOrderLive` üç tx'in de ilk ifadesi |
| T1-004 | `touchWorkOrderTx` hem `workorder.service` hem `workorder-manual-move`ta · repro `KYY-3-04` → 0 ihlal |
| T1-012 | `tambur.service`: "Parent kısalıyor — YALNIZ `currentQty` düşer, `initialQty` DOKUNULMAZ" |
| T2-013 | `assertNoSelfEscalation` üç çağrı noktasından koşuyor, kural denetimin önerisiyle birebir |
| T3-004 | repro `S-3-02` → 0 kırmızı |
| T3-011 | repro `S-3-01` → 0 kırmızı |

## BUGÜN KAPATILDI (2)

`T1-013` (PIN okuma: iki izin + audit izi) · `T2-012` (atamanın kaynağı görünür +
ops betikleri token tazeliyor). Bkz. commit `db49d6dd`.

## ÖLÇÜLDÜ, AÇIK (12)

| Bulgu | Ölçüm | Not |
|---|---|---|
| T3-007 | repro `S-1-03` → **4 kırmızı** | KK1 ham girişi ürün/renk doğrulamasını tx DIŞINDA yapıyor |
| T3-016 | repro `S-4-01` → **4 başarısız** | Fason kabul commit ederken "Rengi Değiştir" mal–plan bekçisini atlatıyor |
| T3-017 | repro `S-4-02` → **3 başarısız** | "Kalan gelmeyecek" kısmi kabulün iptalini kalıcı kilitliyor |
| T3-009 | repro `KYY-3-01` → **4 ihlal** | Sevk anında tahsis yeniden hesaplanmıyor (storno'nun bıraktığı PLANNED) |
| T3-010 | repro `S-2-04` → **2 başarısız** | İptal edilmiş sevkiyatın token replay'i "Sevkiyat kuruldu" diyor |
| T3-019 | repro `S-4-05` → **2 başarısız** | Fason Kabul sunucu onayı gelmeden yeşil basıp formu sıfırlıyor |
| T1-014 | `login-lockout.ts` kilidi `new Map()` — bellek içi, kalıcı/kullanıcı-anahtarlı değil | PIN politikası KARAR ister |
| T1-018 | `test_manual_move_fason_receive.ts` kendi fixture'ını yaratmıyor (0 eşleşme) | Gerçek fason sevkinde kabul yapıyor |
| T2-010 | `base.service`te pasife almada bağımlılık kontrolü yok | |
| T3-006 | Yazıcı arıza sinyali kodda yok | |
| T1-022 | Offsite MEKANİZMASI var (`rclone`, 27 referans) ama **RPO/RTO hiçbir dokümanda yazılı değil**; sahada yapılandırılmamış | Denetimin "makine dışı kopya yok" ifadesi kod için YANLIŞ, saha için doğru |
| T1-023 | Tatbikat REÇETESİ yazıldı (`docs/ops/YEDEK-GERI-YUKLEME-TATBIKATI.md`); tatbikatın kendisi kullanıcı işi | |

## TARANMADI (~18)

Kalan S2/P2–P3 bulguları (`T1-036`, `T1-039`, `T1-049`, `T1-051`, `T1-060`,
`T1-074`, `T2-005`, `T2-008`, `T2-014`, `T2-015`, `T3-012`…`T3-022` vb.) bu
turda ölçülmedi. Repro'su olmadığı için her biri elle kod okuması ister.
