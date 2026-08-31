# Kapanan bulgular — düzeltme turu kaydı

> **Bu dosya git'ten TÜRETİLİR, elle tutulmaz.** Kaynak: `adnansahin` dalındaki
> commit mesajlarında geçen bulgu kimlikleri. Amacı tek: bir sonraki oturum
> `findings.json`'ı açıp **zaten kapanmış** bir bulguyu yeniden düzeltmeye
> kalkmasın.
>
> ⚠️ **`findings.json` bir FOTOĞRAFTIR, canlı durum değil.** Bu turda birebir
> yaşandı: `BULGU-T1-020` hâlâ "açık" görünüyordu, oysa aynı programın erken bir
> turunda `560f74f0` ile kapatılmıştı — kaydın mekanizması doğrulanıp *düzelten
> kodun o anki hâli* okunmadığı için yanlış çerçeveli bir commit yazıldı ve
> `27af3a06` ile düzeltildi. **Bulguyu düzeltmeden önce ilgili dosyanın BUGÜNKÜ
> hâlini oku.**
>
> ⚠️ **Denetimin TAVSİYESİ de ölçülür.** Bu turda beş kez yanlış çıktı: T2-007'nin
> bekçi önerisi (aynadaki ikizi doğururdu) · T2-004'ün sorgusu (siparişsiz sevkleri
> sayıyordu) · T1-020'nin "bilgi yalnız audit'te" iddiası · T1-007'nin "kalan
> tablolara sed ekle"si (kapsamlı tekilliği ve guard'sız tabloları ayırmıyordu) ·
> T3-019'un bekçi önerisi (doğru uygulamayı kırmızı yapardı). Ayrıca T3-016'nın
> KANITI (repro) kusuru hiç ölçmüyordu: doğan toplar renksiz doğuyordu.

## Kapanan bulgu kimlikleri (39)

| Bulgu | Commit(ler) |
|---|---|
| BULGU-T1-001 | `3f600703` · `1dcb5adc` |
| BULGU-T1-002 | `c2af089d` |
| BULGU-T1-003 | `69376d70` |
| BULGU-T1-004 | `69376d70` |
| BULGU-T1-005 | `6aa5c2f2` |
| BULGU-T1-006 | `aa6f1d93` |
| BULGU-T1-007 | `0c09d94f` |
| BULGU-T1-008 | `56ccf218` · `86634046` |
| BULGU-T1-009 | `b7718ff8` · `d12f4abb` · `c4c9fde5` |
| BULGU-T1-010 | `81ee79bd` |
| BULGU-T1-011 | `94b937c0` · `86634046` · `d12f4abb` |
| BULGU-T1-013 | `db49d6dd` |
| BULGU-T1-015 | `6b6c6b66` |
| BULGU-T1-016 | `c644de0f` |
| BULGU-T1-019 | `c126eff0` |
| BULGU-T1-020 | `560f74f0` · `edbeaf07` · `27af3a06` · `294b5389` |
| BULGU-T1-023 | `aba11d23` |
| BULGU-T1-024 | `ce9a71ea` |
| BULGU-T1-045 | `3877d956` |
| BULGU-T1-053 | `8aab44b4` |
| BULGU-T1-085 | `3f600703` |
| BULGU-T2-002 | `1dcb5adc` |
| BULGU-T2-003 | `5f654890` |
| BULGU-T2-004 | `14d11ff7` |
| BULGU-T2-007 | `1d527d61` |
| BULGU-T2-011 | `2db06682` |
| BULGU-T2-012 | `db49d6dd` |
| BULGU-T2-013 | `a0331f6e` |
| BULGU-T2-016 | `1dcb5adc` |
| BULGU-T3-001 | `68486d3b` · `62262fb6` |
| BULGU-T3-002 | `56a28b26` |
| BULGU-T3-003 | `81ee79bd` |
| BULGU-T3-007 | `7f57b7cc` |
| BULGU-T3-009 | `83eca55b` |
| BULGU-T3-010 | `4415439b` |
| BULGU-T3-016 | `7f57b7cc` |
| BULGU-T3-017 | `81b7b41b` |
| BULGU-T3-019 | `80a22490` |
| BULGU-T4-003 | `1693fec0` |

## Kronoloji

| Commit | Tarih | Bulgu | Başlık |
|---|---|---|---|
| `c644de0f` | 2026-08-29 | T1-016 | fix(bekçi): rota kimlik bekçisi tam yol anahtarı kullanıyor + client-policy mu |
| `3f600703` | 2026-08-29 | T1-001, T1-085 | fix(envanter): "Düzelt" claim'i statüyü ve okunan metrajı pinliyor — kesim art |
| `560f74f0` | 2026-08-29 | T1-020 | fix(kurulum): kur.ps1 sunucunun ecosystem.config.js'ini KORUYOR, paketinkiyle  |
| `ce9a71ea` | 2026-08-29 | T1-024 | fix(yedek): bayatlık yalnız GECE yedeğinden ölçülüyor + hüküm alanı eklendi |
| `6b6c6b66` | 2026-08-29 | T1-015 | fix(ci): otomatik testler sahaya çıkan `adnansahin` dalında da koşuyor |
| `68486d3b` | 2026-08-29 | T3-001 | fix(mobil): ekransız çakışma artık duyuruluyor — kuyruktan düşen KK1 kaydı ses |
| `1dcb5adc` | 2026-08-29 | T1-001, T2-002, T2-016 | fix(tambur): depo kesimi giriş metrajına (initialQty) dokunmuyor — üç kusur bi |
| `6aa5c2f2` | 2026-08-29 | T1-005 | fix(fason): eşzamanlı kabulde aynı fiş iki kez düşülüyordu (S1/K3) |
| `b7718ff8` | 2026-08-29 | T1-009 | fix(is-emri): iptal, fason sevki kapatılamadığında da devam ediyordu (S1/K3) |
| `81ee79bd` | 2026-08-29 | T1-010, T3-003 | fix(sevkiyat): aynı talep iki kez sevk edilebiliyordu + iptal siparişe tahsis  |
| `56a28b26` | 2026-08-29 | T3-002 | fix(sevkiyat): tabletten çıkan sevkiyat sipariş defterine yazılmıyordu (S1) |
| `aa6f1d93` | 2026-08-29 | T1-006 | fix(idempotency): iptal edilmiş kaydın token'ı "başarılı" dönüyordu (S2/K3) |
| `a0331f6e` | 2026-08-29 | T2-013 | fix(bekçi): test_audit_followups aktörü hedeften ayrıldı (T2-013 sonrası) |
| `c2af089d` | 2026-08-29 | T1-002 | fix(tambur): eşzamanlı aşım kesimi yoktan kumaş üretiyordu (S2/K3) |
| `3877d956` | 2026-08-29 | T1-045 | fix(içe-aktarım): rota seviyesindeki 10 MB limiti hiç koşmuyordu (S2/K3) |
| `94b937c0` | 2026-08-29 | T1-011 | fix(tambur): geri almayla iptal edilen parça diriltilebiliyordu (S1/K3) |
| `56ccf218` | 2026-08-29 | T1-008 | fix(içe-aktarım): zaman aşımından sonra "Tekrar Dene" dosyayı ikinci kez yazıy |
| `86634046` | 2026-08-29 | T1-008, T1-011 | dok(denetim): briefing — iki S1 daha kapandı (T1-011, T1-008) |
| `d12f4abb` | 2026-08-29 | T1-009, T1-011 | fix(iş-emri): fason kalanı sert engel DEĞİL AÇIK KARAR — 2026-08-17 desenine d |
| `c4c9fde5` | 2026-08-29 | T1-009 | feat(iş-emri): iptal diyaloğu fasondaki kalanı ÖNDEN soruyor (T1-009 arayüz ay |
| `69376d70` | 2026-08-29 | T1-003, T1-004 | fix(eşzamanlılık): iş emri terminale düşerken canlı top bağlanıyordu (T1-003 + |
| `2db06682` | 2026-08-29 | T2-011 | fix(audit): birleştirme izi fiziksel tablo adına yazılıyordu (S2) |
| `5f654890` | 2026-08-29 | T2-003 | feat(audit): sevk defterinin izi yazılıyor — "neden siparişten düşmedi" cevapl |
| `aba11d23` | 2026-08-30 | T1-023 | dok(ops): yedekten geri yükleme TATBİKAT reçetesi (T1-023) |
| `62262fb6` | 2026-08-31 | T3-001 | test(mobil): T3-001 düzeltmesinin TELİ de ölçülüyor (iki uç yeşilken tel kopab |
| `1d527d61` | 2026-08-31 | T2-007 | fix(fason): kısmi kabulde replay kimliği gerçekten çalışıyor (BULGU-T2-007) |
| `0c09d94f` | 2026-08-31 | T1-007 | fix(ana-veri): ad-mükerrer yarışı DB seddiyle kapatıldı — 8 tablo (BULGU-T1-00 |
| `14d11ff7` | 2026-08-31 | T2-004 | fix(mutabakat): §1c — defterin KENDİSİNİN eksikliği artık görülüyor (BULGU-T2- |
| `edbeaf07` | 2026-08-31 | T1-020 | fix(yedek): gece yedeğinin SAHİBİ görünür oldu + deploy kontrol maddesi (BULGU |
| `c126eff0` | 2026-08-31 | T1-019 | fix(betik): yıkıcı betiklere ortam kapısı — TRUNCATE artık prod'a bakamaz (BUL |
| `1693fec0` | 2026-08-31 | T4-003 | fix(idempotency): "aynı token, FARKLI gövde" kapısı dört uçta daha (BULGU-T4-0 |
| `27af3a06` | 2026-08-31 | T1-020 | düzeltme(T1-020): kur.ps1 ZATEN düzeltilmişti — iki metin gerçeğe çekildi |
| `8aab44b4` | 2026-08-31 | T1-053 | fix(güvenlik): `.env` git izlemesinden çıkarıldı + mekanik bekçi (BULGU-T1-053 |
| `294b5389` | 2026-08-31 | T1-020 | docs(denetim): kapanan bulgu kaydı — findings.json bir FOTOĞRAFTIR |
| `db49d6dd` | 2026-08-31 | T1-013, T2-012 | fix(yetki): PIN okuma izsizdi + yetki atamasının kaynağı görünmüyordu (T1-013, |
| `7f57b7cc` | 2026-08-31 | T3-007, T3-016 | fix(yarış): birleştirme × KK1 girişi ve fason kabulü × renk değişikliği (T3-00 |
| `83eca55b` | 2026-08-31 | T3-009 | fix(sevkiyat): tahsis SEVK ANINDA yeniden hesaplanıyor + artan metraj görünür  |
| `4415439b` | 2026-08-31 | T3-010 | fix(sevkiyat): iptal edilmiş sevkiyatın token replay'i 'kuruldu' diyordu (BULG |
| `80a22490` | 2026-08-31 | T3-019 | fix(mobil): Fason Kabul onay gelmeden yeşil basıyordu (BULGU-T3-019) |
| `81b7b41b` | 2026-08-31 | T3-017 | fix(fason): "kalan gelmeyecek" artık geri alınabilir + önizleme dürüst (BULGU- |

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
