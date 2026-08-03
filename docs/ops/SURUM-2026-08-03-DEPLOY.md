# Sürüm 2026-08-03 — Deploy Notu (kurşun bypass + Tambur saha düzeltmesi)

> **Bu doküman KENDİ BAŞINA yeterli DEĞİLDİR.** Genel sıra ve yasaklar
> `DEPLOY-RUNBOOK.md`'de; bu sürümün en riskli parçası olan saat dilimi dönüşümü
> `SURUM-2026-07-31-DEPLOY.md §1b`'de ayrıntılı anlatılır ve **oradan okunmalıdır**.
> Burada yalnız **o notlardan SONRA eklenenler** ve sunucuya çekerken atlanmaması
> gereken adımlar var.

## Ne getiriyor

| Özellik | Nerede görünür |
|---|---|
| **Kurşun bypass** — fason dönüşü iş emrini fiziksel kurşun makinesine atama | Electron: İşlemler → Kurşun Dağıtım · Mobil: Kurşun Dağıtım ekranı |
| **Tambur saha düzeltmesi** — takılı topu Tambur'a al, elle top ekle | Mobil Tambur ekranı (yetkili kullanıcıda) |
| **Tambur "Manuel Ekle" modu** — refakat kartı OLMADAN bitmiş top üretme | Mobil Tambur ekranındaki mod anahtarı |
| **Fason kabul yönlendirmesi** — "yanlış istasyon" yerine ne yapılacağını söyleyen mesaj | Mobil Fason Kabul |
| **Saat dilimi kök çözümü (O-11)** | Tüm tarihler; rapor rakamları değişir |
| **İzin kataloğu otomasyonu** | Yeni izinler artık elle INSERT istemiyor |
| Sevkiyat fatura işareti (`shipping:invoice`) | Electron muhasebe sevk ekranı |

## Sunucuda sıra — bu ÜÇ adım ve BU SIRAYLA

```bash
cd <repo>/Teks-Erp
git pull
npm install                  # package.json değiştiyse
npm run prisma:generate
npm run prisma:migrate       # = migrate deploy — RESTART'TAN ÖNCE
pm2 restart <backend>
```

**Sırayı bozma.** `20260801040000_timestamptz_conversion` ile
`src/lib/pg-session.ts` **birlikte** çalışmak zorundadır:

- Kodu almadan migration uygularsan → havuz oturumu UTC değil, Istanbul sunucusunda
  **okunan her tarih 3 saat ileri, yazılan her tarih 3 saat geri** kayar.
- Migration'sız restart edersen → kolonlar hâlâ tz'siz, aynı sapma ters yönden gelir.

İkisinde de **hata da log da çıkmaz** — bu sürümün tek sessiz bozulma yolu budur.
Gerekçe ve ölçümler: `SURUM-2026-07-31-DEPLOY.md §1b` + `Teks-Erp/CLAUDE.md` O-11.

## Uygulanacak migration'lar (11 adet)

`20260731120000_add_kursun_bypass_assignment` · `20260731120000_audit_check_hardening` ·
`20260731150000_sack_shipment_client_token` · `20260731160000_lowprio_unique_hardening` ·
`20260731210000_kursun_bypass_machine_assignment` ·
`20260801020000_kursun_bypass_permission_catalog` ·
`20260801030000_sack_customer_fk_setnull` · **`20260801040000_timestamptz_conversion`** ·
`20260801050000_system_log_daily_stats_tz` · `20260802183530_shipment_invoice_tracking` ·
`20260803060000_roll_entry_source_tambur_manual`

Uygulamadan önce hangilerinin beklediğini **gör** (salt-okunur):

```bash
npx prisma migrate status
```

**Vardiya dışında koş.** `timestamptz` dönüşümü 183 kolonu yeniden yazar ve tablo
kilidi alır; süre satır sayısıyla doğrusaldır (dolu dev DB'sinde ≈2,1 sn, fabrikada
veri az olduğu için daha da kısa — ama `roll_movements` büyüdükçe dakikalara çıkar).

**Migration'lardan HEMEN ÖNCE yedek al** — `DEPLOY-RUNBOOK.md §3`. Geri alma =
yedekten restore; migration'lar geri-alınamaz kabul edilir. (`timestamptz`
dönüşümünün ters script'i Istanbul oturumunda **patlar** — sebebi
`SURUM-2026-07-31-DEPLOY.md §1b`'de yazılı.)

## Restart sonrası — üç kontrol

```bash
pm2 logs <backend> --lines 40 | grep permission-catalog   # 1) izinler geldi mi
psql tekserp -c "SHOW timezone;"                          # 2) DB oturumu
curl -s localhost:4000/health | head -c 300               # 3) ayakta mı
```

1. `[permission-catalog]` satırı görünmeli. Backend **her açılışta** katalogla DB'yi
   karşılaştırır ve eksik izinleri yazar — **elle INSERT YOK** (bu sürümün kalıcı
   düzeltmelerinden biri; ayrıntı `Teks-Erp/CLAUDE.md` → "Yeni izin eklemek").
2. Uygulamanın havuzu bilinçli olarak UTC oturumu açar; buradaki değer ayrı bir
   şeydir (psql'in kendi oturumu) ve UTC olmak **zorunda değildir**.
3. Bir siparişin tarihi panelde doğru saatle görünüyor mu — gözle bak.

## ⚠️ İzinler gelir ama ATANMAZ

Katalog uzlaştırması izin **satırlarını** yaratır; kullanıcıya **atamaz**
(atama ortama özgüdür: bir kurulumda planlamacı Ahmet, diğerinde Mehmet).
Deploy'dan sonra panelden ata, yoksa ekran **hiç görünmez** ve sebebi hiçbir yerde
yazmaz:

| İzin | Kime |
|---|---|
| `workorder:distribute` | Kurşun dağıtımını yapan planlamacı (Electron) |
| `mobile:kursun-dagitim` | Aynı kişi, mobil kullanacaksa |
| `mobile:tambur-duzelt` | Tambur'da elle düzeltme yetkisi verilecek **seçili** kişiler |
| `shipping:invoice` | Muhasebe |

**Atadıktan sonra o kullanıcılar yeniden giriş yapmalı** — JWT'deki izin listesi
bayattır. Ekran hâlâ yoksa sırayla bak: satır DB'de mi → kullanıcıya atanmış mı →
yeniden giriş yapıldı mı.

## Mobil APK aynı pencerede

Kurşun Dağıtım ekranı, Tambur saha düzeltmesi ve "Manuel Ekle" modu **mobil
tarafta** yaşar; yalnız backend güncellenirse bu özelliklerin hiçbiri sahada
görünmez (backend uçları çalışır ama onları çağıran ekran yoktur). Ayrıca
`SURUM-2026-07-31-DEPLOY.md §0a`'daki `clientToken` zorunluluğu hâlâ geçerli:
**eski APK ile Hızlı Sipariş 400 alır.**

APK derleme ve gömülü sunucu adresinin doğrulanması: `mobil/CLAUDE.md` →
"APK derleme". Adresi tahmin etme, paketin içinden **oku**:

```bash
cd mobil && npm run build:apk:verify
```

## Operatöre önceden söylenecek

- **Rapor rakamları değişir** (saat dilimi düzeltmesi). Gece vardiyasının
  00:00–03:00 arası olayları artık **doğru güne** yazılıyor; eskiden bir önceki
  güne düşüyordu. Günlük sayaçlar bu yüzden dünle birebir tutmayabilir —
  bu bir hata değil, düzeltmedir. Ayrıntı: `SURUM-2026-07-31-DEPLOY.md §1c`.
- **Eski hareketlerin süre raporu hâlâ şişkin.** Geçmiş satırlar bilinçli olarak
  DÜZELTİLMEDİ (canlı veriye dokunmama kararı); düzeltme yalnız ileriye dönüktür.
- **Kurşun bypass açıkken Tambur'da onay ekranı ÇIKMAZ** — kart okutulur, adım
  sessizce tamamlanır. Gerekçe: `KURSUN-BYPASS-DEPLOY.md`.
- **Tambur'da elle eklenen top envanterde ayırt edilir** — top detayında giriş
  yeri "Tambur (Manuel)" yazar (`entrySource=TAMBUR_MANUAL`). Listede ayrı kolon
  YOK; bilgi detay panelinde.
