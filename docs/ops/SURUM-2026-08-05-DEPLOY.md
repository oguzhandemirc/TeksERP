# Sürüm 2026-08-05 — Deploy Notu (belge kimliği: parti no + kart bayat bayrağı + belge listesi)

> **Bu doküman KENDİ BAŞINA yeterli DEĞİLDİR.** Genel sıra ve yasaklar
> `DEPLOY-RUNBOOK.md`'de. Burada yalnız **bu sürüme özgü** olanlar var.
>
> ⚠️ Bu sürümün commit'i (`476b8bd`) **birden fazla çalışma akışının birleşik
> anlık görüntüsüdür** — aynı ağaçta paralel çalışılmış ve dosya içi karışıklık
> yüzünden ayrılamamıştır. Aşağıdaki kontrol listesi **yalnız belge işini**
> kapsar; aynı commit'te gelen kurşun planlama, mobil Yeni Sipariş,
> `settings:workstation`, KK1 mükerrer koruması vb. için ilgili kendi notlarına
> bakın.

## Ne getiriyor

| Değişiklik | Nerede görünür |
|---|---|
| **Parti no fason sevk çekisinde** | Fason sevk irsaliyesi (KUMAŞ İRSALİYESİ) başlığı |
| **Parti no fason kabul makbuzunda** (çoğul) | Fason kabul makbuzu bilgi kutusu |
| **Parti no fasondan doğrudan sevk irsaliyesinde** | Belge başlığı |
| **Parti no müşteri sevk irsaliyesinin çeki tablosunda** | Yeni "PARTİ NO" kolonu (top başına) |
| **Refakat kartı "güncel değil" rozeti** | Electron Belgeler diyaloğu · mobil iş emri detayı |
| **İş emri Belgeler listesi** — kart + fason sevk + **kabul makbuzu** + **doğrudan sevk** | Electron Belgeler diyaloğu · mobil "Belgeler" |
| **Sevk irsaliyesi revizyonu artık BRÜT** | `reissue` / ilk kez açılan eski belgeler |

## ⚠️ ÜÇ İSTEMCİ AYNI PENCEREDE GİTMELİ

Backend + Electron + **APK** birlikte çıkmalı. Sebebi tek ve somut:

- Kartın "güncel değil" işaretini **yalnız** `POST /api/traveler-cards/:id/print-event`
  temizler. Bu ucu **eski APK / eski Electron çağırmaz.**
- Sonuç: backend yeni, istemci eski ise operatör kartı basar, rozet **kalıcı olarak
  takılı kalır** ve hiçbir yerde sebebi yazmaz. Hata da log da çıkmaz.

Kısmi deploy zorunluysa **backend'i EN SON** al (eski backend + yeni istemci
yalnız 404 verir, sessiz takılma olmaz).

## Sunucuda sıra

```bash
cd <repo>/Teks-Erp
git pull
npm install                  # package.json değiştiyse
npm run prisma:generate
npm run prisma:migrate       # = migrate deploy — RESTART'TAN ÖNCE
pm2 restart <backend>
```

Bu sürümün migration'ı: **`20260804213714_traveler_card_content_dirty`**
(`traveler_cards`'a `contentDirty BOOLEAN NOT NULL DEFAULT false`).
PG11+'ta sabit varsayılanlı kolon ekleme **metadata-only**'dir — tablo yeniden
yazılmaz, kilit anlıktır, `traveler_cards` zaten WO başına tek satır. **Vardiya
saati kısıtı bu migration için geçerli DEĞİL.**

> Aynı commit'te başka akışların migration'ları da var
> (`roll_entry_station`, `roll_client_entered_at`, `shipment_undo_and_return_group`).
> `migrate deploy` hepsini sırayla uygular; onların notlarını ayrıca okuyun.

## Restart ŞART (yalnız migration yetmez)

`shipping:undo-dispatch` gibi yeni izinler **boot-time uzlaştırma** ile DB'ye
yazılır (`jobs/permission-catalog.job.ts`). Restart edilmezse izin DB'de olmaz ve
Admin dışı kullanıcılar sebebi görünmeyen 403 alır. Boot log'unda
`[permission-catalog] ...` satırını **gözle doğrulayın**.

## Geçiş kontrolleri (sahada, sırayla)

1. **Fason çeki** — bir iş emrinden fason sevk yap, çekiyi bas.
   → Başlıkta `Parti No: P…` **görünmeli**.
2. **Eski belge korunuyor mu** — 2026-08-05 ÖNCESİ bir fason sevkin irsaliyesini bas.
   → Parti no satırı **ÇIKMAMALI** (donmuş belge değişmez). Çıkıyorsa geriye dönük
   doldurma olmuş demektir → **durdurun**.
3. **Kart rozeti** — bilgisayardan iş emri aç, kartı bas (rozet yok), sonra top bağla.
   → Belgeler'de kartın yanında **"Güncel değil"** çıkmalı. Kartı yeniden bas →
   rozet **sönmeli**. Sönmüyorsa istemci `print-event` çağırmıyordur (eski APK/Electron).
4. **Belge listesi** — fason kabulü olan bir iş emrinin Belgeler'ini aç.
   → **Fason Kabul Makbuzu** listede olmalı ve **basılabilmeli**. Satır görünüp
   basılmıyorsa izin hizası bozulmuştur (`DOC_PERMISSIONS`).
5. **Müşteri çeki kolonu** — bir sevk irsaliyesi bas.
   → Çeki listesinde **PARTİ NO** kolonu görünmeli. İstenmiyorsa
   *Tanımlar → Belge Şablonları → Sevk İrsaliyesi → Çeki Listesi* → kolonu gizle.
6. **İade + revizyon** — iadesi olan bir sevkiyatın irsaliyesini **revize et**.
   → Yeni versiyon **BRÜT** (iade öncesi metraj) çıkmalı. Net çıkıyorsa
   `collectShipmentDocContent` brütleştirmesi devre dışıdır → **durdurun**.

## Geri alma

- **Kod:** önceki sürüme dön + `pm2 restart`. Kolon DB'de kalır; kimse okumaz,
  zararsızdır (`contentDirty` yalnız bu sürümün kodunca kullanılır).
- **Migration geri alınmaz** (proje kuralı: rollback = yedekten restore). Kolonu
  düşürmek GEREKMİYOR; düşürülürse eski koda dönmüş olsanız bile `prisma generate`
  ile üretilmiş istemci uyuşmazlığı riski doğar.
- **Belge içeriği:** parti no alanı yalnız YENİ donan/revize edilen belgelerde var.
  Geri alındığında eski belgeler zaten etkilenmemiştir.

## Bilinen sınır (bu sürümde KAPSAM DIŞI)

`sack-search` / çuval etiketi yeniden basımı hâlâ **canlı** `sack.rolls` okur —
iadeden sonra o yüzey NET gösterebilir. Ayrı iş; bu sürümde dokunulmadı.
