# F-OPS-VER-001 — `.env` git'te: düzeltme reçetesi

Durum: **doğrulandı, düzeltilmedi.** Karar sizin — aşağıdaki üç adımın ikisi geri alınamaz.
Tarih: 2026-08-09.

---

## Neden ben uygulamadım

Çalışma ağacı **şu anda paylaşımlı**. `git status` başka bir oturumun aktif işini gösteriyor
(Electron Quality Scorecard: 7 değiştirilmiş + 6 izlenmeyen dosya, ayrıca yeni bir migration
ve `schema.prisma` değişikliği). `git rm --cached` bir **staged deletion** üretir ve bu,
başka bir oturumun `git commit -am` / `git add -A` çağrısına **süpürülebilir** — sizin
belleğinizde kayıtlı olan tuzağın ta kendisi (`paylasimli-agac-git-add-tuzagi`).

Bu yüzden index'e dokunmadım. Aşağıdaki komutlar ağaç sakinken, tek oturumda koşulmalı.

---

## Tehdit modeli — önce bunu netleştirelim

Dosya beş anahtar taşıyor: `PORT`, `DATABASE_URL`, `JWT_SECRET`,
`BACKUP_DIR`, `BACKUP_OFFSITE_DIR`. Risk **eşit değil**:

| Anahtar | Repodaki değer | Gerçek risk |
|---|---|---|
| `DATABASE_URL` | `postgresql://oad@localhost:5432/adnansahin_db` — **geliştirme** bağlantısı, şifresiz, localhost | Düşük. Saha DB'sine erişim vermiyor. |
| `JWT_SECRET` | 45 karakter | **Kritik — ama yalnız sahadakiyle AYNIYSA.** Repodan cevaplanamaz. |
| `BACKUP_*` | Yerel yollar | İhmal edilebilir (dizin adı sızıntısı). |

Yani asıl soru tek: **sahadaki `JWT_SECRET` ile repodaki aynı mı?**

Sunucuda (`C:\Etkili-Yazilim\tekserp\Teks-Erp\.env`) şunu koşturun ve **değeri buraya
yapıştırmayın** — yalnız karşılaştırma sonucunu:

```powershell
# Sunucuda (yönetici PowerShell)
$saha = (Get-Content .env | Select-String '^JWT_SECRET=').ToString().Split('=',2)[1].Trim('"')
[System.Security.Cryptography.SHA256]::Create().ComputeHash(
  [Text.Encoding]::UTF8.GetBytes($saha)) | ForEach-Object { $_.ToString("x2") } | Join-String
```

```bash
# Geliştirme makinesinde, aynı hash'i repodaki değer için üret
grep '^JWT_SECRET=' Teks-Erp/.env | cut -d= -f2- | tr -d '"' | tr -d '\n' | shasum -a 256
```

Hash'ler **eşitse** → Adım 2 (rotasyon) **zorunludur**.
Hash'ler **farklıysa** → rotasyon gereksiz; yalnız Adım 1 ve (isterseniz) Adım 3.

Not: bu makinede `md5`/`python3` bozuk olduğu belleğinizde kayıtlı; yukarıda `shasum` kullanıldı.

---

## Adım 1 — Dosyayı izlemekten çıkar (GERİ ALINABİLİR, önce bunu yapın)

Ağaç sakinken:

```bash
cd /Users/oad/Documents/projeler/AdnanSahin

# 0) Ağacın sakin olduğunu doğrula — başka oturumun işi görünmemeli
git status --porcelain

# 1) Dosyayı index'ten çıkar (DİSKTEKİ DOSYA KALIR)
git rm --cached Teks-Erp/.env

# 2) Diskte durduğunu doğrula (backend bunsuz açılmaz)
test -f Teks-Erp/.env && echo "dosya yerinde"

# 3) Artık .gitignore'un etkili olduğunu doğrula
git check-ignore -v Teks-Erp/.env    # .gitignore satırını göstermeli

# 4) YALNIZ bu değişikliği commit'le (paylaşımlı ağaç: dosya dosya commit)
git commit -m "chore(guvenlik): .env izlemeden cikarildi (sir dosyasi repoda tutulmaz)" -- Teks-Erp/.env
```

**Kontrol:** `git ls-files | grep -c 'Teks-Erp/.env$'` → **0** olmalı.

⚠️ Bu adım geçmişi TEMİZLEMEZ. Secret hâlâ eski commit'lerde durur. Adım 1'in kazancı:
bundan sonraki commit'lerde sızmaz ve `.gitignore` nihayet işini yapar.

---

## Adım 2 — JWT_SECRET rotasyonu (yalnız hash'ler eşitse; GERİ ALINAMAZ ETKİ)

**Etki:** rotasyon **tüm aktif oturumları geçersiz kılar.** Sahadaki her tablet ve her
Electron istemcisi yeniden giriş yapmak zorunda kalır. `verifyToken` her istekte
`session.findUnique` yaptığı için iptal anlıktır — yani vardiya ortasında yapılırsa
operatörler o anda dışarı düşer.

**Ne zaman:** vardiya dışında (gece yedeğinden sonra, üretim durmuşken).

```bash
# 1) Yeni secret üret (>= 32 karakter; auth.service.ts:35-45 bunu boot'ta doğruluyor)
openssl rand -base64 48

# 2) Sunucuda .env içindeki JWT_SECRET satırını değiştir
# 3) Yeniden başlat
pm2 restart tekserp-backend

# 4) Doğrula: eski bir token ile
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <ESKI_TOKEN>" \
  http://192.168.1.250:4000/api/auth/me     # 401 beklenir
```

**Ön koşul:** JWT_SECRET 32 karakterden kısaysa backend **açılışta patlar**
(`auth.service.ts` fail-closed). Yeni değeri koymadan restart etmeyin.

---

## Adım 3 — Git geçmişinden temizleme (YIKICI, en son ve isteğe bağlı)

Bu adım **tüm klonları bozar** (herkes yeniden klonlamalı) ve commit SHA'larını değiştirir.
Yalnız şu iki koşuldan biri varsa değer:

- Depo **public** ise → secret zaten dünyaya açık; rotasyon şart, temizleme kozmetik.
- Depo **private** ve erişim listesi daralacaksa → temizleme anlamlı.

**Deponun görünürlüğünü ben doğrulayamıyorum** (repodan cevaplanamaz).
`gh repo view oguzhandemirc/TeksERP --json visibility` ile bakın.

```bash
# git-filter-repo (BFG alternatifi) — ÖNCE tam yedek al
git clone --mirror git@github.com:oguzhandemirc/TeksERP.git tekserp-mirror-yedek.git

git filter-repo --path Teks-Erp/.env --invert-paths
git push --force --all
git push --force --tags
```

⚠️ Force push sonrası **her klon bozulur**. Ekipteki herkes yeniden klonlamalı;
yeniden klonlamadan çalışan biri eski geçmişi geri getirebilir.

---

## Karar tablosu

| Hash eşit mi? | Depo public mi? | Yapılacak |
|---|---|---|
| Hayır | fark etmez | **Adım 1** yeterli |
| Evet | Hayır (private) | **Adım 1 + Adım 2**; Adım 3 isteğe bağlı |
| Evet | Evet (public) | **Adım 1 + Adım 2 acil**; Adım 3 önerilir ama rotasyonun yerini tutmaz |

---

## Tekrarı önleme

`.gitignore` zaten `.env`, `.env.bak*`, `.env.backup*`, `.env.save`, `.env.orig` kalıplarını
taşıyor ve bu iyi kurulmuş (bir `.env.bak-*` vakasından sonra eklenmiş, yorumu dosyada yazılı).
Adım 1'den sonra bu kalıplar nihayet etkili olur.

**Denetimde ayrıca bakılacak** (C2 oturumu, `PLAN.md §7`): `ecosystem.config.js` git'te ve
sır TAŞIMIYOR — bu ayrım bilinçli ve doğru kurulmuş. Ama aynı dizinde `.env` izleniyordu,
yani ayrım fiilen çürümüştü. Adım 1 sonrası tasarım niyetiyle gerçek örtüşür.
