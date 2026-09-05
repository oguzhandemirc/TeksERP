# Sürüm 2026-08-09 — Deploy Notu (raporlar sıfırdan yazıldı)

> **Bu doküman KENDİ BAŞINA yeterli DEĞİLDİR.** Genel sıra ve yasaklar
> `DEPLOY-RUNBOOK.md`'de. Burada yalnız **bu işe özgü** olanlar var.

## TL;DR — deploy eden için üç cümle

1. **Tek migration** (`20260809090000_roll_production_timestamps`), metadata-only, vardiya içinde uygulanabilir.
2. **Migration'dan sonra `backfill` script'i koşulmalı** — atlanırsa üç rapor geçmişsiz başlar (aşağıda tam etkisi). Telafi edilebilir, kriz değil.
3. **Yeni izin YOK, elle atama YOK, APK YOK.** Backend + Electron aynı pencerede gider.

## Neden

Rapor menüsü denetlendi. Kök sorun: **her dönem-bazlı rapor "bu top ne zaman
bitti" sorar ve bu bilgi şemada HİÇ YOKTU.**

| Bulgu | Ölçüm |
|---|---|
| `Roll`'da bitiş damgası yok | yalnız `createdAt` / `updatedAt` / `cancelledAt` / `labelPrintedAt` |
| Hareketten türetilemiyor | bitmiş topların **hiçbirinde** kapanmış `RollMovement` yok (Tambur kesim çocuğu + elle eklenen top hiç hareket görmez) |
| Geriye kalan tek seçenek `updatedAt` ve o **yasaklı** | etiket yeniden basımı da onu günceller → fire yanlış güne düşüyordu |
| Kalite verisi hiç raporlanmıyordu | `Roll.qualityGradeId` dolu ama okuyan tek rapor yoktu |
| `RollReturn` hiç raporlanmıyordu | zengin tablo (neden/müşteri/kumaş), Raporlar altında hiçbir yüzey yok |

## Ne getiriyor

Menü **20 → 13** (17 rapor kaldırıldı, 8 yeni yüzey eklendi).

| Yeni yüzey | Yol |
|---|---|
| Kalite Karnesi | `/reports/quality/scorecard` |
| Fire Karnesi | `/reports/quality/scrap-scorecard` |
| İade Karnesi | `/reports/sales/return-scorecard` |
| Sevk & Termin (OTIF) | `/reports/sales/shipment-scorecard` |
| Fason Karnesi | `/reports/subcontract/scorecard` |
| Nerede Takıldı (WIP) | `/reports/production/wip` |
| Parti İzleme | `/reports/production/batch-trace` |
| Stok & Ölü Stok | `/reports/inventory/scorecard` |

Hepsinde dönem karşılaştırma (önceki dönem / geçen yıl / özel) + Excel · PDF · Yazdır.

## Migration — 1 adet, metadata-only

`20260809090000_roll_production_timestamps`:

- `Roll.finalizedAt` + `Roll.statusChangedAt` (ikisi de **nullable timestamptz**)
- `rolls_finalizedAt_idx` — PARTIAL (`WHERE "finalizedAt" IS NOT NULL`)
- `rolls_stamp_production_timestamps` — **BEFORE INSERT OR UPDATE trigger**

**Nullable ve DEFAULT'suz kolon PG11+'ta tablo yeniden yazmaz** (ölçüldü: dolu
`rolls` üzerinde 6 ms). Partial index de küçük. Vardiya içinde uygulanabilir.

> **Neden trigger:** `Roll.status`'e yazan 40+ çağrı noktası var; birini atlamak
> raporda **sessiz eksik** demekti (hata yok, log yok, o toplar hiçbir dönemde
> görünmez). Trigger atlanamaz — ham SQL bile geçemez — ve tek satır uygulama
> kodu değişmediği için mevcut yolların hepsi bayt-bayt aynı kaldı.

## ⚠️ BACKFILL — migration'dan sonraki adım

```bash
cd Teks-Erp
npx tsx scripts/backfill_roll_production_timestamps.ts           # DRY-RUN — hiçbir şey yazmaz
npx tsx scripts/backfill_roll_production_timestamps.ts --apply   # yazar
```

Trigger yalnız **kendinden sonraki** statü geçişlerini görür. Migration'dan önce
üretimi bitmiş toplar `NULL` kalır. Script o geçmişi `system_logs`'tan geri kurar.

**Dry-run etkilenecek HER kaydı tek tek listeler** (canlı veri kuralı). İzi
bulunamayan toplar ayrıca **"KAPSAM DIŞI"** başlığıyla listelenir — o sayı,
raporun ne kadarına güvenilebileceğini belirler.

### Atlanırsa ne olur

8 yüzeyin **3'ü** etkilenir, 5'i hiç etkilenmez:

| Etkilenen | Çıpa | Sonuç |
|---|---|---|
| Kalite Karnesi | `finalizedAt` | Mevcut üretim geçmişi görünmez; rapor deploy gününden itibaren birikir |
| Fire Karnesi | `finalizedAt` | aynı |
| Stok & Ölü Stok | `statusChangedAt` | Raftaki tüm mal "yaşı bilinmiyor" kovasına düşer, yaş dağılımı boş kalır |

Etkilenmeyenler: İade · Sevk & Termin · Fason · WIP · Parti İzleme (hepsi başka
çıpa kullanıyor).

**Sessiz bir eksiklik DEĞİL:** Kalite Karnesi'nde *"N top üretim tarihi
bilinmediği için hiçbir döneme dahil edilmedi"* uyarı bandı, Stok'ta benzeri
çıkar. Kullanıcı yanlış rakam görmez, eksik olduğunu okur.

### Ne kadar acil

**Aylarca telafi edilebilir.** `archive-scheduler` denetim kayıtlarını 6 ayda bir
taşıyor (`MONTHS_TO_KEEP=6`); en eski `ROLL` audit kaydı 2026-07-16 → o satırlar
yaklaşık **2027-01** civarında arşive düşer. O tarihten sonra kurtarılamaz.

Script **idempotent ve yalnız NULL'ları doldurur** → istediğiniz zaman, birden
çok kez koşulabilir; trigger'ın yazdığı damgalara dokunmaz.

## Deploy sırası

```
1. git pull
2. npm ci                       (backend)
3. npm run prisma:migrate       # = migrate deploy
4. npm run prisma:generate
5. npx tsx scripts/backfill_roll_production_timestamps.ts          # önce DRY-RUN, çıktıyı oku
6. npx tsx scripts/backfill_roll_production_timestamps.ts --apply
7. pm2 restart <backend>
8. Electron build → kullanıcılara dağıt   ← 7'nin hemen ardından
```

### ⚠️ 7 ile 8 arasındaki pencereyi kısa tut

12 eski rapor ucu **silindi**. Bu pencerede:

- Eski Electron + yeni backend → o eski rapor ekranları **404** verir
- Yeni Electron + eski backend → yeni karneler **404** verir

İkisi de görünür hata üretir (yanlış rakam değil), ama pencereyi uzatmak
gereksiz şikâyet doğurur. Mümkünse vardiya dışında yapın.

## GEREKMEYENLER (kontrol edildi)

| | Durum |
|---|---|
| Yeni izin | **Yok** — 8 yüzeyin hepsi mevcut `report:*` izinlerini kullanıyor |
| Elle izin ataması | **Gerekmiyor** — izin/rol katalogları hiç değişmedi |
| Yeni APK | **Gerekmiyor** — mobil hiç dokunulmadı |
| Feature flag / ayar | Yok |
| Ek migration | Yok |

## Geri alma

`prisma migrate deploy` geri alınmaz (bkz. `DEPLOY-RUNBOOK.md`). Ama bu
migration'ın geri alma ihtiyacı **düşük**: iki nullable kolon + bir trigger
ekliyor, mevcut hiçbir davranışı değiştirmiyor. Sorun çıkarsa trigger tek başına
düşürülebilir:

```sql
DROP TRIGGER IF EXISTS "rolls_stamp_production_timestamps" ON "rolls";
```

Kolonlar kalır (zararsız), raporlar yeni damga üretmez. Envanter bekçisi
(`scripts/test_db_invariants.ts` §6) bu durumda **kırmızı verir** — bilinçli:
trigger'ın kaybı sessiz kalmamalı.

## Doğrulama (deploy sonrası)

```bash
npx tsx scripts/test_db_invariants.ts        # trigger + partial index yerinde mi
npx tsx scripts/test_quality_scorecard.ts    # rapor + trigger birlikte
```

Ekranda: Raporlar → Kalite → Kalite Karnesi açılıyor mu, "1. Kalite oranı" kartı
dolu mu, Excel/PDF indiriliyor mu.
