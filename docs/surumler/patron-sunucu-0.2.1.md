# Patron bulut sunucusu `0.2.1`

**Durum:** VDS'TE (2026-11-01 23:01Z `patron`; 23:10Z `patron-hazirla` + `patron-yedek` hizalandı) — kullanıcı onayı
2026-11-02 01:46 "Tam yap" (bulut yükseltme + deneme tesisi + patron hesabı + emülatör). Kayıt
`docs/ops/PATRON-BULUTU-KURULUM.md` §13f. Bu belge `test_surum_belgesi` kapsamı dışındadır (yalnız `backend-*.md`).
**Sürüm kimliği:** imaj etiketi `6c2dfb2738f3` (commit sha'sı). `patron/sunucu/package.json` **0.2.0 bırakıldı**:
çalışan imajın içindeki değer 0.2.0'dır; dosyayı yükseltmeden SONRA değiştirmek imajla çelişirdi. "0.2.1" yalnız bu
belgenin adıdır; sonraki yükseltmede `package.json` imajdan ÖNCE çıkarılır.
**İmaj etiketi:** `tekserp-patron:6c2dfb2738f3` · `tekserp-patron-yedek:6c2dfb2738f3` (linux/amd64; kaynak `origin/main`
@ `6c2dfb273`, temiz worktree; imaj kimliği `sha256:d9fba02b…` · yedek `sha256:54ead705…`, iki uçta aynı)
**Arşiv SHA256:** `a7d4c2f027f6c971d31b3e0c483f1abb04f6ccda706816380b9c69daa1b1011e`
(`~/.tekserp/patron-imaj/tekserp-patron-6c2dfb2738f3.tar.gz`, 324 020 870 bayt)
**Önceki saha sürümü:** `tekserp-patron:5156f26d2259` (0.2.0, §13e) — merkez ve tesis DB'si 10 göç, tek tesis
(`8716286a…`).

## 1. Özet

Neden: 0.2.0 bulutu fabrikanın yeni iki ANLIK projeksiyonunu (`ozet-masraf` #347, `karlilik-ozet` #373) tanımıyordu;
eşitleme paketindeki bu girdiler `PROJEKSIYON_BILINMIYOR` ile reddedildi, fabrika turu KISMI kaldı ve fabrikada
`anlik|ozet-masraf` filigranı hiç doğmadı (ölçüldü). Patron uygulamasının Finans › Masraf / Kârlılık segmentleri bu
yüzden boştu. Bu sürüm katalogu fabrikayla hizalar. Kapsam: `git log 5156f26d2..6c2dfb273 -- patron/ deploy/patron`
(13 commit; sunucu 14 dosya +596/−15, uygulama 36 dosya +1366/−29). Göç YOK; `deploy/patron` farkı YOK.

## 2. Ne değişti (sunucu)

- **Anlık projeksiyonlar:** `ozet-masraf` (izin `bulut:kasa:oku`, #347) · `karlilik-ozet` (izin `bulut:maliyet:oku`,
  #373).
- **Uzak raporlar:** `production/makine-duruslari` (`bulut:uretim:oku`, #294) · `maliyet/karlilik`
  (`bulut:maliyet:oku`, #373).
- **Liste anahtar süzgeci:** `LIST_KEY_FILTERS` (`kategoriAnahtari`, kasa hareketleri kategori süzgeci, #374);
  beyansız projeksiyonda ya da azamiden uzun değerde 400 (fail-closed). `/api/oturum` `liste` alanına opsiyonel
  `anahtarSuzgecleri`.
- **Bildirim:** `cari-kilit` türü (#314; kaynak `cari-hesap`, izin `bulut:cari-bakiye:oku`); durum bildirimi olduğu için
  saklama budamasından hariç. Ayar gövdesinde eksik tür varsayılandan doldurulur (eski uygulama 400 almaz);
  tanınmayan tür yine 400.
- `wire/api.ts` aynası (iş emri sevke hazırlık #321, cari kilidi #314, kârlılık/masraf tel tipleri).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Yeni katalog satırları, opsiyonel yanıt alanı, yeni sorgu parametresi; var olan uçların alan
  kümesi aynı.
- **N/N−1:**
  - Yeni fabrika → eski bulut (0.2.0): yeni anlıkları `PROJEKSIYON_BILINMIYOR` ile REDDEDER → tur KISMI (bu
    yükseltmenin nedeni).
  - Eski fabrika → yeni bulut: yeni projeksiyonları göndermez → etkisiz (satır boş kalır, uygulama boş durum).
  - Eski uygulama → yeni bulut: `anahtarSuzgecleri`ni tanımaz; bildirim ayarında yeni türü göndermez → varsayılan.
  - Sonuç: **bulut önce**; fabrika sırası serbest.
- **`minVersion`:** gerekmez.

## 4. Migration

YOK (`git diff 5156f26d2 6c2dfb273 -- patron/sunucu/prisma deploy/patron` boş). Göç profili koşuldu: `No pending
migrations` · roller · `PATRON_TESIS_GOC tesis=1 hata=0`.

## 5. Doğrulama (yapıldı)

- `patron` sağlıklı 8 sn'de, `PATRON_DINLIYOR … web=acik`, `RestartCount` 0; `patron-hazirla` (`PATRON_HAZIRLA izliyor
  aralik=10s`) ve `patron-yedek` (aralık 24 sa · saklama 30 gün · en az 7) aynı etikette.
- Deneme fabrikası eşitlemesi: `/v1/esitle` 200; KISMI 0; bulutta `ozet-masraf` satırı ve fabrikada `anlik|ozet-masraf`
  filigranı doğdu.
- Patron uygulaması (emülatör, gerçek bulut): giriş (parola + TOTP) → Pano · Üretim · Siparişler · Finans (Kasa /
  Masraf / Kârlılık) açıldı; değerler tesis DB'sindeki projeksiyon satırlarıyla aynı.
- Açık: `karlilik-ozet` henüz GELMEDİ — fabrika üretmiyor (bulut artık kabul eder); uygulama "Fabrikadan kârlılık
  özeti henüz gelmedi" boş durumunu gösterir. Fabrika tarafı ayrı iş.

## 6. Geri alma

`ssh tekserp-vds 'cd /opt/stack/apps/tekserp-patron-uretim && cat ~/p10-env-yedek-5156f26d2259 > .env && docker compose
up -d'` (göç yok; eski imaj VDS'te) → `deploy/vds-dogrula.sh` çıkış 0. Geri alınırsa yeni fabrikaların turu yeniden
KISMI olur.
