# Yedek şifreleme (`.tkenc`) — runbook

> Kural satırı: `docs/kurallar/deploy-kurulum.md` · karar notu: `docs/history/arsiv/2026-09.md` (2026-09-29 — Yedek şifreleme) · plan: Faz 0 dilim 0.2.
> Kod: `Teks-Erp/src/lib/backup-crypto/` · araç `Teks-Erp/scripts/yedek-sifrele.ts` (pakette `app\dist\tools\yedek-sifrele.cjs`) · bekçi `test_yedek_sifreleme` · senaryo `Teks-Erp/scripts/senaryo-yedek.ts`.

## 1. Ne yapar, ne yapmaz

- Gece yedeği (`yedekle.ps1`), panelden elle alınan yedek (backend) ve kurulum öncesi `premigrate_` yedeği **doğrulandıktan sonra** şifrelenir: `tekserp_<damga>.dump.tkenc`. Düz döküm nihai adı hiç almaz; E: kopyası ve Drive (offsite) aynı şifreli dosyayı alır — yeniden şifreleme yok.
- Biçim: X25519 + AES-256-GCM akış (age kalıbı), dosya başına **N alıcı** — alıcılardan HERHANGİ biri dosyayı tek başına açar. Kurcalama, kesme, parça takası ve başlık değişikliği çözmede **reddedilir**.
- Şifreleme için parola GEREKMEZ (yalnız açık anahtarlar kullanılır) — gece görevi etkileşimsiz koşar.
- **Anahtar dizini yoksa hiçbir şey değişmez:** yedekler bugünkü gibi düz `.dump`.
- Eski düz yedekler geri yüklenebilir kalır.

## 2. Üç alıcı

| Alıcı | Açık yarı | Özel yarı | Ne için |
|---|---|---|---|
| `yerel` | `<kök>\yedek-anahtar\yerel.tkpub` | Sunucuda `yerel.tkkey`, **yedek parolasıyla** (scrypt) sarılı | Rutin geri yükleme · önizleme · kopyaya geri yükleme · `kur.ps1 -GeriAl` |
| `musteri` | `<kök>\yedek-anahtar\musteri.tkpub` | Müşterinin USB'si + kâğıt (`tksec1:…` tek satır) | Sunucu ölürse/çalınırsa bağımsız erişim; K5 "verilerimi al" dosyası |
| `etkili` | `<kök>\yedek-anahtar\etkili.tkpub` | Etkili Yazılım, çevrimdışı | Destek/kurtarma. **Tören kullanıcıda — henüz yok;** eklenene dek yedekler iki alıcılıdır |

Anahtar dizini **yedek klasörünün DIŞINDADIR** (offsite süpürücü `backups\`i makine dışına kopyalar). Niyetin TEK kaynağı `app\.env`teki `BACKUP_KEY_DIR`dir: backend onu pm2 açılışında ortamdan, gece görevi (`yedekle.ps1`) her koşumda dosyadan okur; satır yoksa gece görevi `<kök>\yedek-anahtar` VARSA şifreler. Satır beyanlı ama dizin yoksa gece görevi düz yedeği korur ve kırmızı (çıkış 3) biter. İki taraf farklı karar verirse `/api/admin/health` → `backupCryptoIntent.warning` söyler (tipik sebep: satır eklendi, `pm2 restart` yapılmadı). `kur.ps1` bugün hâlâ yalnız `<kök>\yedek-anahtar`a bakar (Faz 2b).

## 3. Anahtar töreni (ilk kurulum)

Mesai dışı, önce thinkpad-1'de (kural: önce kendi sunucumuz). Yönetici PowerShell, **paketin kökünden**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ilk-kurulum.ps1 -YedekSifreleme `
  -YedekMusteriAnahtarCikti E:\musteri-yedek-anahtari.txt `
  -YedekEtkiliAcikAnahtar D:\etkili.tkpub          # tören sonrası; yoksa bu satırı verme
```

1. **Yedek parolası** terminalde gizli iki kez sorulur (en az 10 karakter). Komut satırına, loga, sürüm notuna YAZILMAZ.
2. `musteri` özel yarısı USB dosyasına (ya da parametre yoksa **ekrana bir kez**) yazılır → kâğıda yazılır, USB müşteriye teslim edilir, **sunucuda bırakılmaz** (dosya USB'de; sunucuya kopyalanmışsa silinir).
3. `.env`'e `BACKUP_KEY_DIR="C:/TeksERP/yedek-anahtar"` eklenir (`.env` oluştuktan sonra; dizin önceden kurulmuşsa `-YedekSifreleme` verilmese de) → backend'in görmesi için `pm2 restart`. Yedek parolası konsolda ya da `ssh -t` (PTY) oturumunda sorulur; PTY'siz SSH'ta ve zamanlanmış görevde sorulamaz, yerel anahtar açık iş olarak kalır.
4. Adım sonunda `durum` çıktısı basılır: `durum: acik`, üç (ya da iki) alıcı, `yerel anahtar: …\yerel.tkkey`.

Etkili Yazılım anahtarı sonradan: açık yarıyı `<kök>\yedek-anahtar\etkili.tkpub` olarak koy — bir sonraki yedekten itibaren alıcı olur (eskiler yeniden şifrelenmez).

Doğrulama:

```powershell
node C:\TeksERP\app\dist\tools\yedek-sifrele.cjs durum --anahtar-dizini C:\TeksERP\yedek-anahtar
Start-ScheduledTask TeksERP-DB-Backup ; Get-Content C:\TeksERP\backups\backup.log -Tail 3   # "OK ... sifreli"
```

## 4. Parolanın saklanması

- Yedek parolası **tek başına bütün geçmiş yedekleri** (sunucudaki `yerel.tkkey` ile birlikte) açar. İki yerde durur: müşteri yöneticisinde + Etkili Yazılım kasasında. Başka hiçbir yerde (e-posta, sohbet, bilet, repo) yazılmaz.
- Ayar şifresi ile AYNI olmak zorunda değildir; ayar şifresi isteğe bağlıdır ("hash yok → uyur") ve ona dayanılmaz.
- Parola değişimi: yeni `yerel.tkkey` üretmek (eski anahtar dosyası kasaya) — yeni yedekler yeni yerel alıcıya gider; eski yedekler eski anahtar + eski parola ya da müşteri anahtarıyla açılır.

## 5. Geri yükleme

**Panel (Yedekler → Geri yükle):** şifreli yedekte önizleme yedek parolasını ister (bir kez, hatırlanmaz); parola doğruysa içerik tam doğrulanır. "Komutu kopyala" bloğu yedeği önce `…\backups\<ad>.dump.coz-elle.part`a çözer — **parola sunucudaki PowerShell penceresinde ayrıca sorulur**, bloğa/panoya yazılmaz — `pg_restore` bu kopyayı okur, kopya sonda koşulsuz silinir. Şifreleme açıksa güvenlik yedeği de sonda şifrelenir.

**Kopyaya geri yükleme (DB Geri Yükleme ekranı):** şifreli yedek seçilince parola alanı çıkar; backend geçici kopyaya çözer, kurar, doğrular, kopyayı siler.

**Elle (sunucuda):**

```powershell
node C:\TeksERP\app\dist\tools\yedek-sifrele.cjs coz --girdi C:\TeksERP\backups\tekserp_X.dump.tkenc `
  --cikti C:\TeksERP\backups\tekserp_X.dump.coz-elle.part --anahtar-dizini C:\TeksERP\yedek-anahtar
# parola sorulur; sonra pg_restore ... "C:\TeksERP\backups\tekserp_X.dump.coz-elle.part" ; bitince Remove-Item
```

**Kurulum geri alma:** `kur.ps1 -GeriAl` kodu geri alır; en yeni `premigrate_` yedeği şifreliyse sonunda "şimdi çözülsün mü" diye sorar ve çözülmüş kopyanın `pg_restore` komutunu basar.

**Başka makinede (sunucu yok):** Node 22 + paketin `dist\tools\yedek-sifrele.cjs`i yeter (bağımlılık yok):
`node yedek-sifrele.cjs coz --girdi X.dump.tkenc --cikti X.dump --anahtar E:\musteri-yedek-anahtari.txt`

Teşhis: şifreli dosyada `pg_restore --list` başarısız olur — bu **bozuk değil "şifreli — çöz"** demektir (panel de böyle der). Bütünlük: `… dogrula --girdi X.dump.tkenc --anahtar-dizini <dizin>` (parola sorar; anahtarsız koşum yalnız yapıyı denetler).

Araç çıkış kodları: `0` tamam · `1` kullanım/genel · `2` yanlış anahtar/parola · `3` bozuk/kurcalanmış/yarım.

### 5b. Hızlı PIN / personel kartı anahtarı (yeni makineye dönüş)

PIN ve kart kodları DB'de yalnız özet olarak durur; özetin anahtarı DB'de değil `LICENSE_DIR\kisa-kimlik-anahtarlari.json` halkasındadır ve yedek alıcılarına MÜHÜRLÜ kopyası (`short_credential_key_escrows`) her dökümün içindedir. **Aynı makinede** geri yükleme (panel, kopya, `kur.ps1 -GeriAl`) anahtara dokunmaz — bir şey yapılmaz. **Yeni makinede** (arıza/DR/taşıma) PIN/kart girişi "kısa kimlik anahtarı uyuşmuyor" der; kullanıcı adı + şifre çalışır. Geri koyma:

- **Panel:** Kullanıcılar → **Kısa Kimlikler** → yedek parolası → "Anahtarı yedekten geri koy" (yeni makinede eski `yerel.tkkey` anahtar dizinine konmuş olmalı).
- **Sunucu konsolu (kâğıt anahtarla):** `node C:\TeksERP\app\dist\tools\kisa-kimlik.cjs anahtar-geri-yukle --anahtar=E:\musteri-yedek-anahtari.txt --canli-onay` (`.tkkey` verilirse parola sorulur; parola argümandan alınmaz). Durum: `… kisa-kimlik.cjs durum`.
- **Emanet yoksa** (yedek şifrelemesi kapalıydı): Kısa Kimlikler → Toplu hızlı PIN sıfırlama (doğrulanamayanlar), yeni PIN listesini yazdırıp dağıtın; kartlar kullanıcı başına "Yeniden bas".

Güncelleme sonrası düz PIN'lerin özete çevrilmesi: kullanıcı ilk başarılı girişinde otomatik; kalanlar `kisa-kimlik.cjs donustur` (kuru) → onay → `donustur --apply --canli-onay` → ikinci koşum 0. Geri dönüş yalnız `premigrate_` yedeğinden.

## 6. Kayıp ve kriz senaryoları

| Olay | Sonuç | Yapılacak |
|---|---|---|
| Yedek parolası unutuldu | Sunucu şifreli yedeği kendisi açamaz | Müşteri USB/kâğıt anahtarıyla ya da Etkili anahtarıyla aç; yeni `yerel.tkkey` üret (yeni parola) |
| Sunucu diski öldü / sunucu çalındı | `yerel.tkkey` gitti ya da saldırganda (parolasız işe yaramaz) | Drive/E: kopyasını müşteri anahtarıyla aç; yeni kurulumda yeni anahtarlar |
| Drive token'ı ya da E: diski sızdı | Yalnız şifreli dosyalar — okunamaz | Token'ı iptal et; anahtar değişimi gerekmez |
| Müşteri USB'si kayboldu | Yedekler hâlâ yerel + Etkili ile açılır | Yeni müşteri anahtarı üret (`anahtar-uret --ad musteri`), eski `musteri.tkpub`'ı kaldır; eski yedekler eski anahtara bağlı kalır |
| Anahtar dizini silindi/bozuldu | Backend düz yedeği şifreleyemez; görev **çıkış 3**, düz yedek yerelde kalır, makine dışına ÇIKMAZ; panel "GEÇERSİZ yapılandırma" der | Dizini yedeğinden geri koy ya da yeniden tören; `durum` ile doğrula |
| Etkili anahtarı henüz yok | Yedekler iki alıcılı | Tören sonrası `etkili.tkpub` ekle |
| Yeni makinede PIN/kart "anahtar uyuşmuyor" | Kısa kimlik anahtarı LICENSE_DIR'de kaldı | §5b: emanetten geri koy ya da toplu PIN sıfırla |

## 7. Sınır ve borçlar

- Şifreleme **ileriye dönüktür**: devreye alınmadan önceki düz yedekler (yerel/E:/Drive) düz kalır; makine dışındaki eski düz kopyaların silinmesi ayrı, kullanıcı onaylı iştir.
- Pre-restore güvenlik yedeği yalnız geri yükleme **tamamlandıktan sonra** şifrelenir; o ana dek yerelde düzdür (şifreleme niyeti varken offsite'a gitmez).
- `kur.ps1 -GeriAl` ve `ilk-kurulum.ps1 -YedekSifreleme`nin PowerShell 5.1/TTY kısmı Mac'te ölçülemedi — thinkpad-1 provasında (Senaryo Y6d) koşulur.
