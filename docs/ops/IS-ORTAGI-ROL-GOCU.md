# RUNBOOK — İş ortağı rol modeli göçü (`migrate_partner_roles.ts`)

> Fason profillerini cari kartıyla tek kimliğe bağlayan GÖÇ. **Kullanıcı koşar**, dry-run
> varsayılandır ve hiçbir adım geri alınamaz değildir — ama `--apply` sonrası geri dönüş yolu
> yedekten restore'dur. Faz planı: `docs/design/` iş ortağı rol modeli dilimi D2.

## Sıra (değişmez)

1. **YEDEK AL.** Bu adım atlanırsa geri dönüş yolu YOKTUR.
2. `npx tsx scripts/migrate_partner_roles.ts` — **kuru koşum**, hiçbir şey yazmaz. Raporu OKU.
3. Rapordaki **ÖNERİ** satırlarını kullanıcıyla birlikte karara bağla (aşağı bak).
4. `npx tsx scripts/migrate_partner_roles.ts --apply [--canli-onay] [--baglan=<subId>:<custId> …]`
5. Aynı komutu **ikinci kez** koş: `DEĞİŞİKLİK: 0` görmelisin (idempotent).

## Hedef kapıları

| Hedef | Kuru koşum | `--apply` |
|---|---|---|
| `*_test` / fixture adları | koşar | koşar |
| Fabrika / dev kopyası | koşar (hedefi adıyla basar) | **`--canli-onay` ŞART** |
| `tekserp` · `tekserp_prod` · `adnansahin_db` | RED | RED (onayla bile) |

Hedef adı **her koşumda** ekrana basılır. Kuru koşum fixture dışı hedeflerde de çalışır: raporu
görmeden `--apply` demek zaten yanlış sıradır.

## ÖNERİ satırları — otomatik bağlanmayanlar

Betik **hiçbir profili tahminle bağlamaz**. İki durumda ÖNERİ basar ve DOKUNMAZ:

- **ÖNERİ (aynı ad):** katlanmış adı aynı olan bir kart var. *Aynı ad aynı firma demek
  değildir*; yanlış bağ iki firmanın defterini birleştirir ve geri alınamaz.
- **ÖNERİ (vergi no):** profilin vergi numarası başka bir kartta kayıtlı. Bu, addan **daha
  güçlü** bir "aynı firma" kanıtıdır — ama kararı yine kullanıcı verir. Kart zaten başka bir
  profile bağlıysa satır bunu söyler: o durumda bağ değil **vergi numarası düzeltmesi** gerekir.

Karar verilince: `--baglan=<subId>:<custId>` (satırda hazır yazılı, kopyala-yapıştır).

## Ne yapar

- **(a)** Bağsız profil → yeni kart (`MUS+GGAAYY+NNNN`, kod backend üretir), roller
  **Tedarikçi + Fason** (Müşteri DEĞİL), `type` türetilir. Ad kartta servis kanoniğinde
  (BÜYÜK HARF) görünür — profil adının birebir kopyası değildir.
  Birleştirilmiş (tombstone) profiller ATLANIR.
- **(b)** Fasona bağlı cari hesap → kartın hesabına. Kartın hesabı yoksa hesap TEK UPDATE ile
  çevrilir; varsa hareketler taşınır, **bakiyeler TOPLANIR**, eski hesap **pasife** çekilir
  (silinmez). Defter satırının İÇERİĞİNE dokunulmaz; taşımanın izi audit'tedir.
- **(c)** Rapor: etkilenen her kayıt + karşılaştırılabilir ÖZET (kart/öneri/hesap sayıları,
  kart rolleri M/T/F, bakiye önce/sonra).

## Beklenen (15 Eyl saha dump'ı)

11 fason profili → 11 kart, ad çakışması 0, 1 cari hesap taşınır (hareketsiz). **Vergi no
çakışması ölçülmedi** — çıkarsa ÖNERİ satırı olarak görünür ve kart sayısı o kadar düşer; bu
bir arıza değil, karar bekleyen satırdır.

## Bekçi

`npx tsx scripts/test_migrate_partner_roles.ts` (fixture DB gerektirir) — göçün beş senaryosunu
ve iki değişmezini ölçer. Göç betiğine dokunan her değişiklikten sonra koşulur.
