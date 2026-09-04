# Fabrika sunucusu — sürüm yükseltme (2026-09-04)

> **Bu bir YÜKSELTMEdir.** `C:\Etkili-Yazilim` altındaki çalışan kurulumun
> üzerine yeni sürüm konur. Veritabanı yerinde kalır, `.env` korunur.
>
> Sıfırdan kurulum değildir — o `ilk-kurulum.ps1` ister ve burada gerekmez.

---

## Gönderilecek dosyalar

| Dosya | Ne için |
|---|---|
| `tekserp-backend-20260904_161136-e9e4a4bd.zip` | Sürüm paketi — **2.9.2**, 232 migration |
| `kur.ps1` | Kurulum aracı. ⚠️ **Pakette GELMEZ**, elden taşınır |
| `FABRIKA-KURULUM-2026-09-04.md` | Bu dosya |

İsteğe bağlı:
- `YAN-YANA-KURULUM.md` — eski sürümü durdurmadan denemek isterseniz
- `uzak-erisim/` — Cloudflare tüneli (sonraya bırakılabilir, kuruluma bağlı değil)

**Gerekmeyenler:** `ilk-kurulum.ps1` (sıfırdan kurulum aracı) ·
`OKU-ONCE.md` ve `PROVA-CEVAP-*.md` (ev provasına ait) ·
`KURULUM.md` (tam referans; yalnız bir şey ters giderse)

---

## Kurulum

**YÖNETİCİ PowerShell'de**, sunucuda:

```powershell
C:\Etkili-Yazilim\kur.ps1 -Paket "C:\...\tekserp-backend-20260904_161136-e9e4a4bd.zip"
```

`-Kok` vermeye gerek yok — varsayılanı `C:\Etkili-Yazilim`.

Script dokuz adımda ilerler ve **onay sorar**. Beklenen kritik satırlar:

```
[1/9]  OK dosya sayisi beyanla uyusuyor
       OK node <sürüm> (zemin: >=22)
       OK paket saglam (232 migration klasoru)
[3/9]  OK premigrate_<damga>.dump (... MB) - dogrulandi
[5/9]  OK .env + ecosystem.config.js (SUNUCUNUNKI) tasindi
[7/9]  Migration'lar uygulaniyor  (GERI ALINAMAZ ESIK)
[9/9]  API UP / DB UP / surum 2.9.2
```

⚠️ `[3/9]` **yedeği alamazsa kurulum İPTAL olur** — doğru davranış, zorlamayın.

⚠️ `[7/9]` **geri alınamaz eşiktir.** Ondan sonraki bir hatada script otomatik
geri almaz; komutları yazar, kararı insan verir.

⚠️ `app\` klasörü üzerinde **açık terminal / Explorer penceresi / editör
bırakmayın** — dosya kilidi taşımayı düşürür. (Ev provasında tam bu yüzden bir
kez düştü.)

---

## Kurulumdan sonra

```powershell
curl http://localhost:4000/health      # surum 2.9.2 demeli
```

**Satıcı hesabı zaten kuruluysa dokunmayın.** Kurulu değilse:

```powershell
cd C:\Etkili-Yazilim\app
npm run superadmin:kur
```

⚠️ **Gerçek terminal ister** (uzaktan bağlanıyorsanız konsol oturumu; `ssh -t`).
Boru/otomasyon içinde gürültülü hata verip çıkar. Parola/PIN/TOTP **bir kez**
gösterilir — kaydedin.

---

## İstemciler

Sunucudan sonra dağıtım gerekmez, ikisi de kendiliğinden gelir:

- **Panel 1.2.6** — yayında. Beklemek istemezseniz: Sistem → Güncelleme →
  "Şimdi kontrol et"
- **Tablet 1.0.5 (OTA)** — yayında. Açılışta ya da ~10 dk içinde alır.
  APK kurmaya gerek YOK (native değişmedi).

⚠️ **SIRA ÖNEMLİ: backend ÖNCE.** Panel 1.2.6 çuval izi uçlarını çağırıyor;
eski backend'de o uçlar yok ve panel 404 alır. Paneller güncellemeyi çoktan
almış olabilir — bu yüzden sunucuyu bekletmeyin.

---

## Bu sürümde ne var

Çuval izleri (renkli etiket, toplu bırakma/kaldırma, ize göre süzme, sevkte
otomatik temizlik, çeki listesi ve irsaliyede opt-in gösterim) · paketlemede
cari seçerken tüm cariler · Müşteri Karnesi'nde kalem/sipariş ayrımı · uzaktan
bağlanılan özet görünümüne menü · kaydırma çubukları · birkaç arayüz düzeltmesi.

Operatöre gösterilen tam liste güncelleme sonrası panelde açılır.

---

## Bir şey ters giderse

```powershell
C:\Etkili-Yazilim\kur.ps1 -GeriAl
```

Eski kod `app.eski-<damga>` klasöründen geri gelir. Script adayı **doğrular**;
çalıştırılabilir bir sürüm bulamazsa hiçbir şeye dokunmadan durur.

⚠️ **Migration'lar geri ALINMAZ.** Eski kod yeni şemayla koşar. Şema
uyumsuzluğu çıkarsa veritabanını `[3/9]`'daki yedekten geri yüklemek gerekir:
`C:\Etkili-Yazilim\backups\premigrate_<damga>.dump`

pm2 komutlarını **yükseltilmiş kabuktan** verin; yönetici daemon + yetkisiz
istemci `EPERM` verir ve bu "uygulama yok" gibi okunur.
