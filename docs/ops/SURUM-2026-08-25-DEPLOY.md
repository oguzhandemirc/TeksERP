# SÜRÜM 2026-08-25 — DEPLOY REÇETESİ

> **Commit:** `32d71191` (dal `adnansahin`) · **APK:** 2.9.6 / vc53
> **Migration:** 2 bekliyor · **Yeni izin:** YOK · **Seed:** YOK
> **Sıra pazarlık dışı: BACKEND → ELECTRON → APK**
>
> ✅ **1) BACKEND SAHADA KURULDU — 2026-08-25 15:02, paket `dee217f`** (`32d71191` +
> yalnız `docs/`+`deploy/` commit'leri; backend kodu aynı), kesinti **18 sn**, 2 migration
> uygulandı, renk seddi kuruldu (0 mükerrer), boot uzlaştırması 6 sebep yazdı. Canlı DB'de
> bekçiler: `test_db_invariants` 91/91 · `test_schema_drift` 4/4 · `test_fold_contract` 40/40
> (kanıt: `docs/history/dev-gonderi-2026-08-25/kanit/`). Paket `D:\tekserp-build\tekserp`'ten
> üretildi — §0/§1 buna göre düzeltildi. **2) Electron ve 3) APK bekliyor.**

Sunucudaki oturum bu reçeteden başka bir şey görmez. Genel anlatım
`DEPLOY-RUNBOOK.md §3`; burada YALNIZ bu sürüme özgü olanlar var.

---

## 0) ÖN KOŞUL — `kur.ps1` sunucuda güncel mi? (ATLAMA)

2026-08-25'te `kur.ps1` onarıldı: **eski sürüm, ilk taşıma takılırsa çalışan
kurulumu YEDEKSİZ siliyordu** (`app\`'a bakan açık bir Explorer/terminal yeter).
Sunucudaki kopya güncel değilse ÖNCE onu güncelle:

```powershell
cd D:\tekserp-build\tekserp         # BUILD klonu (tam). C:\Etkili-Yazilim\tekserp sparse + dar refspec — kullanma
git pull
Get-FileHash .\deploy\kur.ps1, C:\Etkili-Yazilim\kur.ps1 | Format-Table Path,Hash
# Hash'ler FARKLIYSA:
Copy-Item .\deploy\kur.ps1 C:\Etkili-Yazilim\kur.ps1 -Force
```

Ayrıntı: `deploy/README.md`. ⚠️ `kur.ps1` 2026-08-25'te bir kez daha değişti ("Son yedek:"
satırı `/health`'ten değil `backups\` klasöründen okur) → 15:02 kurulumundan sonra hash
**yine farklı** çıkar; kopyayı tekrarla. Bu adım her deploy'da koşar, atlanmaz.

---

## 1) BACKEND (yönetici PowerShell — pm2 daemon SYSTEM)

```powershell
cd D:\tekserp-build\tekserp                 # BUILD klonu; ağaç TEMİZ olsun (kirliyse paketle Read-Host'ta asılır)
git pull                                    # dalın ucu (15:02'de dee217f idi)
.\deploy\paketle.ps1 -Cikti C:\Etkili-Yazilim
C:\Etkili-Yazilim\kur.ps1 -Paket C:\Etkili-Yazilim\tekserp-backend-<damga>-<commit>.zip -Zorla
```

`kur.ps1` dokuz adımı yapar; **adım 3'te `premigrate_<damga>.dump` alır** (rotasyon
dışı), **adım 7'de `prisma migrate deploy`** koşar. Üç saha kuralı: `-Zorla` şart ·
çalışma dizini `app\` İÇİNDE olmasın · `npm ci` internet ister.

### Bu sürümde uygulanacak 2 migration

| Migration | Ne yapar | Beklenen |
|---|---|---|
| `20260825120000_color_name_unique_live` | Renk adı için DB seddi (`tr_fold_color` + partial unique) | Mükerrer renk YOKSA index kurulur. **Mükerrer varsa `NOTICE … ATLANDI` basıp GEÇER — bu HATA DEĞİL**, yumuşak kapı; temizlik sonrası aynı dosya yeniden koşulur |
| `20260825140000_reason_preset_rework_kind` | `ReasonPresetKind`'e `WORK_ORDER_REWORK` ekler | Tek `ALTER TYPE`. Satırlar migration'la GELMEZ — **boot uzlaştırması** yazar |

> Ölçüm (25.08 02:00 prod yedeği): mükerrer katlanmış renk **0** → index kurulmalı.

### Deploy sonrası ZORUNLU kontrol

```powershell
# a) Sağlık
curl http://localhost:4000/health

# b) Yeni sebep kataloğu geldi mi (boot uzlaştırması yazar — 6 satır beklenir)
& "C:\Etkili-Yazilim\pgsql\bin\psql.exe" -U tekserp -d tekserp -c ^
  "select code,label from reason_presets where kind='WORK_ORDER_REWORK' order by \"sortOrder\";"

# c) Renk seddi kuruldu mu (yumuşak kapı atlamadıysa 1 satır)
& "C:\Etkili-Yazilim\pgsql\bin\psql.exe" -U tekserp -d tekserp -c ^
  "select indexname from pg_indexes where indexname='colors_nameFoldColor_key';"
```

(b) BOŞ dönerse: pm2 log'unda `[reason-preset-catalog]` satırına bak, `pm2 restart
tekserp-backend` ile uzlaştırmayı tekrar tetikle.

**Yeni izin kodu YOK** — kimseye atama yapılmayacak.

---

## 2) ELECTRON (masaüstü)

```bash
cd Electron && npm ci && npm run build:win
```
Çıkan kurulumu masaüstü PC'lere dağıt. **Backend'den SONRA**: bu sürümde masaüstü
yeni uçları çağırıyor (`POST /rolls/:id/scrap`, `quick-start`).

---

## 3) APK — 2.9.6 / vc53

Hazır dosya: `TeksERP-2.9.6-vc53.apk` (SHA-256 `ee011235e551f569…`).
Kurulum: `adb install -r` ya da cihaza kopyalayıp aç.
⚠️ **KALDIRIP KURMA** — AsyncStorage ile birlikte çevrimdışı kuyruktaki GERÇEK
toplar silinir. versionCode 53 > 52 olduğu için üzerine kurulum sorunsuz.

---

## 4) Sürümde ne değişti (operatöre söylenecekler)

| Değişiklik | Nerede | Not |
|---|---|---|
| **Stoktan kaldırma ikiye ayrıldı** | Masaüstü → Envanter | "Kayıt hatası" (stok düşmez, fire sayılmaz) / "Mal vardı, fire" (stok düşer). Fire için `roll:manual-adjust` gerekir — sahada 6 kullanıcıda var |
| **Etiket onayı KALKTI** | Masaüstü + tablet | Etiketi basılı top artık tek tıkla kaldırılır; pencere hangi topların etiketli olduğunu BİLGİ olarak listeler |
| **İptal edilen toplar görünür oldu** | Sistem → Top Arşivi | Arama kutusu + "Kayıt Türü" filtresi eklendi. ⚠️ Arşiv `admin:settings` arkasında — depo personeli göremez |
| **İptali geri alma genişledi** | Top detayı | "Partiye kayıtlı" engeli kalktı (SAP'ta parti ters kaydı engellemez). Hareket görmüş/kesilmiş/sevk edilmiş top yine engelli |
| **"Fasona renksiz gitsin" artık çalışıyor** | Masaüstü + tablet | 8 gündür kutu vardı ama veri yolda düşüyordu |
| **Bitmiş topu yeniden üretime alma** | Masaüstü: Bitmiş Depo → "Yeniden Üretime Al" · Tablet: Hızlı İş Emri → "Bitmiş Depo" sekmesi | ⚠️ Fasona giden top KİMLİĞİNİ KAYBEDER: kabulde yeni barkodla döner, eski etiket sökülmeli (ekran uyarıyor) |
| **Fason Kabul boşluğu düzeldi** | Tablet | "Fasonda kalan var mı?" sorusu artık görünüyor; seçenekler "Hepsi geldi" / "Bir kısmı fasonda kaldı" |

---

## 5) ROLLBACK

- **Kod:** `C:\Etkili-Yazilim\kur.ps1 -GeriAl` (önceki `app.eski-<damga>` geri gelir)
- **DB:** adım 3'te alınan `premigrate_<damga>.dump` → `DEPLOY-RUNBOOK.md §5`
  (kopyaya geri yükleme ÖNERİLEN yol — canlının üstüne yazmaz)
- ⚠️ Migration'lar geri alınamaz kabul edilir; DB dönüşü = yedekten restore.

---

## UYGULANDI

- [x] 0) kur.ps1 güncel — 2026-08-25, sunucu Claude oturumu (SAHINSRV): hash eşit doğrulandı, Windows harness 12/12 ↔ orijinal 8/12. ⚠️ Aynı gün `kur.ps1` bir kez daha değişti (A maddesi) → sıradaki deploy'da §0 tekrar kopyalar.
- [x] 1) Backend + 2 migration + kontroller (a)(b)(c) — 2026-08-25 15:02, paket `dee217f`, kesinti 18 sn; geri dönüş `app.eski-20260825_145930` + `premigrate_20260825_145930.dump` (+ `D:\tekserp-build\app-guvenlik-kopyasi-20260825_145601`)
- [ ] 2) Electron dağıtıldı
- [ ] 3) APK kuruldu
- Tarih / kim: 0–1: 2026-08-25 15:02 — sunucu Claude Code oturumu (SAHINSRV\Administrator); 2–3: …
