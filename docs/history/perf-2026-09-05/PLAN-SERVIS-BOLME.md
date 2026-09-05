# Plan — dev servisleri bölme

Ölçüm 2026-09-05. Bu bir **teklif**tir, uygulama kararı ayrı.

---

## 1 · Önce dürüst çerçeve

**Bu iş hızlandırmaz.** Çalışma zamanına etkisi sıfır. Kazanç tek yerde: **okuma maliyeti**. Bir metodu değiştirmek için bugün 7.000 satırlık dosyayı açmak gerekiyor; hem senin hem yapay zekânın bütçesi oraya gidiyor. Senin bu işe başlarken söylediğin hedef de buydu.

**Kendi kuralımızla gerilim var.** `docs/standart/ILKELER.md` `[IL-22]`: *"Bölme fırsatçıdır — dokunulan bölüm çıkarılır, dokunulmayan yerinde kalır. Mega servisi bölmek ayrı bir iştir."* Yani 29.000 satırlık bir kampanya, iki hafta önce yazdığımız kuralın tersidir. Bu planın çözümü: **kampanya değil, ölçülü pilot.** Bir küme çıkarılır, kazanç ölçülür, devam kararı ondan sonra verilir.

## 2 · Beş dosya, iki ayrı problem

| Dosya | Satır | Dışa açık | Kim import ediyor | Sınıf |
|---|---|---|---|---|
| `subcontractor.service.ts` | 7.143 | 4 | 3 | A |
| `workorder.service.ts` | 6.898 | 7 | 2 | A |
| `inventory.service.ts` | 5.511 | 14 | 7 | A |
| `shipping.service.ts` | 4.860 | 4 | 1 | A |
| `system-setting.service.ts` | 5.021 | **156** | **54** | **B** |

**Sınıf A — domain servisi.** Sınıf + metotlar, dışa açık yüzey dar, az yerden çağrılıyor. Bölme = metot kümesini taşımak. Patlama yarıçapı küçük.

**Sınıf B — `system-setting`.** Bu bir servis değil, **ayar kataloğu + okuyucular**: 99 fonksiyon, 34 sabit, 22 tip; 54 dosya import ediyor. Kendi kuralımız `[IL-23]` katalog dosyalarının bölünmemesini söylüyor. **Bu planın kapsamı dışında.** Ayrı ölçüm ister ve muhtemelen cevap "bölme, ayır" olur (ör. ayar anahtarları ve okuyucular birbirinden ayrılabilir), ama o başka bir tartışma.

## 3 · Repo bu işi zaten yapmış — tarif hazır

En önemli bulgu: **tekerlek icat edilmeyecek.** `workorder` beş kardeşe, `tambur` ikiye zaten bölünmüş:

```
workorder-batch-drop.service.ts      565
workorder-fason-quick.service.ts     236
workorder-link.service.ts          1.039
workorder-manual-move.service.ts     937
workorder-split.service.ts           732
tambur-manual.service.ts           1.535
tambur-undo.service.ts             1.840
```

Kalıbı okudum, üç kuralı var:

1. Kardeş dosya `<alan>-<konu>.service.ts` adını alır; kendi sınıfı ve dışa açık örneği olur.
2. **Kardeş, ana servisi import ETMEZ.** Döngü yok. Ortak mantık `helpers/` altına iner.
3. **Route/controller kardeşi DOĞRUDAN çağırır** (`workorder.controller.ts` → `workOrderLinkService`). Ana servis kardeşi yalnız gerçekten kendi içinde kullanıyorsa import eder (`WorkOrderSplitService` emsali).

## 4 · Kümeler hazır duruyor

`subcontractor.service.ts` metot adları sekiz temiz küme gösteriyor:

| Küme | Metotlar | Kabaca satır |
|---|---|---|
| Sevk | `dispatch` · `bulkDispatchStep` · `transferToNextFason` · `previewDownstreamFasonCeki` · `cancel` · `cancelBulk` | ~1.640 |
| Kabul | `receive` · `reopenRemainder` · `closeRemainder` | ~1.270 |
| Bekleyen dönüş | `listPendingReturns` · `getPendingReturnGroupDetail` | ~510 |
| Okuma/liste | `listDispatches` · `getDispatch` · `listReceipts` · `getReceipt` · `getDispatchDyeOverlay` | ~460 |
| Düzenleme/iptal | `updateInstruction` · `getCancelPreview` · `cancelReceipt` | ~620 |
| Geri alma | `getUndoTransferPreview` · `undoTransfer` | ~460 |
| Belge | `getReceiptPrintSnapshot` | ~80 |
| **Doğrudan sevk** | `previewDirectShip` · `executeDirectShip` | **~900** |

Tek başına en büyük metot `receive` (~1.180 satır) — bölmenin asıl hedefi bu değil; o ayrı bir iş.

## 5 · Ölçülen risk

| Risk | Ölçüm | Nasıl bağlanır |
|---|---|---|
| Kaynak metni tarayan bekçiler | **38 bekçi** bu beş servisi adıyla anıyor; bir kısmının izin listesi **dosya yoluna anahtarlı** (`{"services/inventory.service.ts": 2}`) | Bunlar tehlike değil **emniyet ağı**: taşıma yanlışsa bağırırlar. Her adımda liste güncellenir. Bugün bu sınıf bir kez ısırdı ve yakalandı. |
| Modül yükleme sırası (TDZ) | Repoda belgeli tuzak: modül üst kapsamında Prisma enum'una dokunmak açılışta çökertiyor | Yeni dosya yalnız `zod`/`@prisma/client` gibi yaprak modüller import eder; açılış kontrolü zorunlu |
| `this` bağlanması | Sınıf metodu taşınırken paylaşılan özel durum kopabilir | Kardeş kendi sınıfı olur, ortak durum parametreyle geçer — emsal kalıp bu |
| Sessiz davranış değişikliği | — | Dışa açık yüzey **birebir korunur**; ana servis gerekiyorsa tek satırlık delege bırakır |

## 6 · Yol — pilot önce

**Adım 0 · Pilot: `subcontractor` → doğrudan sevk kümesi (~900 satır).**
Neden bu küme: dosyanın sonunda, sınırı temiz, iki metot, kendi rota ucu var.

1. `subcontractor-direct-ship.service.ts` açılır, iki metot taşınır, ortak parçalar `helpers/`e iner.
2. Rota/controller kardeşi doğrudan çağırır.
3. Ana servis yüzeyi **değişmez** (gerekirse delege satırı kalır).
4. Kapılar: `npm run typecheck` · `lint` · **fason bekçilerinin tamamı** · 38 taramalı bekçiden etkilenenler · açılış kontrolü (`PORT=… npx tsx src/server.ts` ile ayağa kaldır, `/health`).
5. **Ölçüm:** dosya satırı öncesi/sonrası, o kümeye dokunmak için okunması gereken satır sayısı öncesi/sonrası.

**Adım 1 · Karar noktası.** Pilot bittiğinde şu soru cevaplanır: *"okuma maliyeti gerçekten düştü mü, bekçileri güncellemek ne kadar sürdü?"* Cevap zayıfsa **durulur** ve `[IL-22]` (fırsatçı bölme) yürürlükte kalır.

**Adım 2 · Devam edilirse sıra:** `subcontractor` kalan yedi küme → `shipping` (en küçük, tek import) → `inventory` → `workorder` (zaten yarı bölünmüş, en az kazanç).

**Kapsam dışı:** `system-setting` (Sınıf B) ve `receive` gibi tek dev metotları bölmek.

## 7 · Maliyet

| Kapsam | Tahmini token | ≈ hafta % |
|---|---|---|
| Pilot (1 küme) | 300–500 bin | 1–1,5 |
| `subcontractor` tamamı (8 küme) | 1,5–2,5 milyon | 4–7 |
| Dört Sınıf A servisi | 5–8 milyon | 15–22 |

## 8 · Durma koşulları

Şunlardan biri olursa iş durur ve geri alınır:

- Bir bekçi kırmızı kalıyor ve sebebi anlaşılmıyor.
- Açılış kontrolü düşüyor (modül yükleme sırası tuzağı).
- Dışa açık yüzey değişmek zorunda kalıyor (o zaman bu artık bölme değil, tasarım değişikliği).
- Pilot ölçümü kazancı göstermiyor.
