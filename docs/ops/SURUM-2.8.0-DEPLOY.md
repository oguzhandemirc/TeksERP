# Sürüm 2.8.0 — Sunucu Deploy Notu

> **Bu dosya deploy sırasında SATIR SATIR takip edilir.** Genel prosedür:
> `docs/ops/DEPLOY-RUNBOOK.md`. Buradaki adımlar bu sürüme ÖZELDİR.
>
> Kaynak: `adnansahin` dalı · fabrika-v2.7.3'ten beri **31 commit**

---

## 0. Önce oku — bu sürümde ne değişti

| Alan | Değişiklik |
|---|---|
| **Kayıt künyesi** | 27 modele "kim oluşturdu / kim son değiştirdi" kolonu. ⓘ düğmesi artık kolondan okuyor (audit'ten değil) |
| **Audit derinliği** | Alan-bazlı değişiklik kaydı (`changes`), kayıt-bazlı geçmiş sorgusu, cihaz/IP damgası |
| **Yetki** | Ekran manifestosu + atama ekranında "Ekrana göre" görünümü + mobil/masaüstü sekmeleri |
| **Tambur** | Müşteri adı düzeltme yetkileri, "Bizde: X" referans satırı |
| **Refakat kartı** | Basılan her sürüm arşivleniyor (versiyon geçmişi) |
| **Okutma** | Barkod büyük/küçük harf duyarsız (saha hatası) |
| **Arama** | Türkçe-duyarsız arama + ad normalizasyonu (diğer oturum) |

---

## 1. Yedek (atlanamaz)

```powershell
# Gece yedeği bugünkü dosyayla mevcutsa yeterli; değilse:
pg_dump -Fc -d tekserp -f C:\yedek\premigrate_2.8.0_%date%.dump
```
`premigrate_` ön eki **rotasyon dışıdır** — silinmez.

## 2. Kod + bağımlılık

```powershell
cd C:\...\TeksERP
git fetch origin
git checkout adnansahin
git pull

cd Teks-Erp
npm install              # package.json değişti (sürüm 2.8.0)
npm run prisma:generate  # ZORUNLU — 27 modelde yeni kolon var
```

## 3. Migration — 9 adet

```powershell
npm run prisma:migrate   # = migrate deploy
```

⚠️ **`migrate dev` KULLANMA.** Bu depoda her diff'te iki DEFERRABLE composite
FK'yı düşürmek ister; `deploy` yalnız dizindeki dosyaları sırayla koşar.

| # | Migration | Ne yapar | Risk |
|---|---|---|---|
| 1 | `fabrika_talep_2026_08_17` | `SEMI_FINISHED` enum + 2 bool kolon | Yok |
| 2 | `wo_cancel_trail` | İş emri iptal izi (3 kolon + FK) | Yok |
| 3 | `traveler_card_doc_versions` | `TRAVELER_CARD` enum değeri | Yok |
| 4 | `record_provenance` | 17 modele künye (34 nullable kolon) | Yok |
| 5 | `record_provenance_a2` | 10 modele künye (22 nullable kolon) | Yok |
| 6 | `systemlog_drop_updatedat` | **KOLON DÜŞÜRÜR** — aşağıya bak | Düşük |
| 7 | `systemlog_changes` | `changes` JSONB kolonu | Yok |
| 8 | `systemlog_device` | `deviceId` kolonu | Yok |
| 9 | `search_fold` | Arama katlama kolonları (diğer oturum) | Yok |

**Hepsi nullable kolon ekler → tablo yeniden yazımı YOK, anlık.** Index eklenen
migration yok, yani `statement_timeout` tuzağı ve "vardiya dışında deploy"
kuralı bu sürümde **geçerli değil**.

### ⚠️ 6 numara hakkında (tek kolon düşürme)
`system_logs.updatedAt` düşürülüyor. Veri kaybı YOK: kolonu okuyan/yazan kod
yolu yoktu ve canlıda `updatedAt > createdAt` olan **0 satır** vardı (yani
hiçbir audit satırı hiç güncellenmemişti). Arşiv tablosundaki kolon DURUYOR.

## 4. Restart

```powershell
pm2 restart tekserp-backend
pm2 logs tekserp-backend --lines 40
```

**Boot log'unda görülmesi gerekenler:**
- `[permission-catalog] … izin kodu güncel` (yeni izin YOK, satır yine basar)
- `[role-templates] …` → **Tambur rolleri güncellenmiş olmalı** (aşağıya bak)

## 5. BACKFILL — bu sürümün tek elle adımı ⏳ ZAMANA DUYARLI

Künye kolonları geçmiş kayıtlarda **boş doğar**. Geçmişi audit'ten doldurmak
için bir kez koşulmalı:

```powershell
cd Teks-Erp
npx tsx scripts/backfill-record-provenance.ts            # DRY-RUN — hiçbir şey yazmaz
npx tsx scripts/backfill-record-provenance.ts --apply    # yazar
```

⚠️ **Neden acele:** kaynak veri `system_logs`'ta duruyor ve **6 ayda arşive**
taşınıyor. Script arşivi de tarıyor ama ne kadar erken koşulursa o kadar
eksiksiz olur. Dev'de 1.490 kayıt dolduruldu.

Eşleşme bulunamayan kayıt `null` KALIR — uydurma yapılmaz, bu doğru davranış.

## 6. Elle yapılacak yetki ataması (unutulursa özellik çalışmaz)

Rol kataloğu izni DB'ye **getirir ama kimseye ATAMAZ** ("katalog koda, atama
panele"). Tambur'daki müşteri-adı düzeltme için:

**Yönetim → Erişim → Kullanıcılar → Osman → Yetkiler →** "Mobil — Tambur
Operatörü" rolünü **yeniden uygula** (ya da `label:edit` + `customer-alias:write`
işaretle).

Bu yapılmazsa Tambur'da ad düzeltme kartı **hiç görünmez**.

## 7. Doğrulama (5 dakika)

| # | Kontrol | Beklenen |
|---|---|---|
| 1 | `curl localhost:4000/health` | `status: UP`, `db: UP` |
| 2 | Bir müşteri aç → ⓘ | "… oluşturdu · son değişiklik …" görünür, **boş değil** |
| 3 | ⓘ → "Tüm geçmiş →" | Değişiklik listesi açılır |
| 4 | Bir kumaşın adını değiştir → ⓘ → Tüm geçmiş | **"Ad: eski → yeni"** satırı görünür |
| 5 | Aynı kaydı değiştirmeden kaydet | **Yeni satır OLUŞMAZ** (gürültü kısma) |
| 6 | Yönetim → Erişim → Kullanıcılar → Yetkiler | "Ekrana göre" sekmesi açılır |
| 7 | Tabletten bir top okut | Küçük harf gelse de **bulunur** |

## 8. Geri alma

Kod: `git checkout fabrika-v2.7.3 && pm2 restart`.

⚠️ **Migration'lar geri alınamaz kabul edilir** (depo kuralı). Şema geri
alınacaksa yol yedekten restore'dur — ama bu sürümde tüm eklenen kolonlar
**nullable** olduğu için eski kod yeni şemayla **sorunsuz çalışır**; yalnız
düşürülen `system_logs.updatedAt` istisnadır ve onu da kimse okumuyordu.
Yani pratikte kod-geri-alma tek başına yeterlidir.

---

## Sonraki adımlar (bu deploy'un parçası DEĞİL)

- **Electron build** — yeni yetki ekranı ve ⓘ geçmişi ancak onunla görünür
- **APK 2.7.9** — barkod düzeltmesi ve yazıcı tahliye kuyruğu için
- Yazıcı kablo testi sonucu (Tambur — PC kablosunu çıkarma denemesi)
