# TeksERP — Docker ile Kurulum (Alternatif)

Bu, `installer/windows/` altındaki **native (setup.exe) kuruluma ALTERNATİF** yoldur.
Burada PostgreSQL + backend **Docker container'ları** olarak çalışır. Tek script:
`yonet.ps1` (Windows) veya kökteki `baslat.sh` (Mac/Linux/Git Bash).

> **Hangisini seçmeli?**
> - **Sunucu Windows ise → `installer/windows/` (setup.exe) önerilir.** Docker
>   Desktop headless Windows sunucuda kırılgan + lisans derdi olabilir; native
>   kurulumda Postgres/backend gerçek Windows servisi (oturumsuz boot).
> - **Sunucu Linux ise veya Docker'a zaten hakimsen → bu yol** çok temiz:
>   `restart: unless-stopped` + tek komut.

---

## Mimari

| Bileşen | Container / Servis | Detay |
|---|---|---|
| PostgreSQL 16 | `postgres` | Container-içi `5432`; **dışarı açılmaz** (yalnız backend erişir) |
| Backend (Node) | `backend` | Host `0.0.0.0:4000` — fabrika ağına açık |

- **Migration + seed** container ilk açılışında **otomatik** çalışır (`docker/entrypoint.sh`).
  `migrate deploy` her açılışta (idempotent); **seed yalnız ilk kez** (`/app/data/.seeded`).
- **Veri** Docker **volume**'lerinde: `pg_data` (veritabanı), `app_data`. Container'ı
  silsen/güncellesen de **veri kalır**. `docker compose down` volume'e dokunmaz;
  `down -v` ise SİLER (dikkat).
- İlgili dosyalar (Teks-Erp kökünde): `docker-compose.yml`, `Dockerfile`,
  `docker/entrypoint.sh`, `.env.docker` (ilk `up`'ta üretilir).

---

## Ön gereksinim
**Docker Desktop** (Windows/Mac) veya **Docker Engine** (Linux):
- Windows: https://docs.docker.com/desktop/install/windows-install/
- Linux: https://docs.docker.com/engine/install/

Docker Desktop **açık** ve **açılışta başlat** ayarı işaretli olmalı (sunucu reboot
sonrası container'lar `restart: unless-stopped` ile geri gelir).

---

## A) İlk kurulum

Windows PowerShell (yönetici gerekmez, ama Docker erişimi olan kullanıcı):
```powershell
cd Teks-Erp\installer\docker
powershell -ExecutionPolicy Bypass -File .\yonet.ps1 up
```
Mac/Linux:
```bash
cd Teks-Erp && ./baslat.sh
```

Bu komut: `.env.docker` yoksa **rastgele şifre + JWT** üretir → container'ları
build edip başlatır → migration + seed otomatik çalışır → erişim adreslerini yazar.

**Erişim:**
- Bu sunucuda: `http://localhost:4000`
- Fabrika ağında: `http://<sunucu-ip>:4000`
- Giriş: **admin / 123123**

> Swagger (`/api-docs`) **üretimde kapalıdır** (`NODE_ENV=production`); yalnız
> geliştirme ortamında açık.

> Panel (Electron) API adresini `http://<sunucu-ip>:4000` yap.

---

## B) Günlük yönetim (`yonet.ps1`)

```powershell
.\yonet.ps1 status                 # container durumu + sağlık
.\yonet.ps1 logs                   # backend loglarını CANLI izle (Ctrl+C ile çık)
.\yonet.ps1 logs -Tail 200         # son 200 satırdan başla
.\yonet.ps1 restart
.\yonet.ps1 down                   # durdur (VERİ KORUNUR)
.\yonet.ps1 backup                 # backups\ içine .dump al
.\yonet.ps1 restore -BackupFile tekserp_20260716_030000.dump
```

Manuel Docker karşılıkları (istersen):
```powershell
docker compose --env-file .env.docker logs -f backend    # loglar
docker compose --env-file .env.docker ps                 # durum
docker compose --env-file .env.docker down               # durdur
```

### Loglara bakma 📋
1. **Canlı:** `.\yonet.ps1 logs` (veya `docker compose ... logs -f backend`).
2. **Panelden (sunucuya girmeden):** iş/veri hataları admin panelinde de görünür —
   **Sistem → Sistem Kayıtları** (backend 5xx + stack), **Sistem → Aktivite Günlüğü**.
3. Docker logları container'da tutulur; kalıcı dosya isteği için compose'a
   logging driver eklenebilir (varsayılan `json-file`, `docker logs` ile erişilir).

---

## C) Yeni sürüm (güncelleme)

```powershell
git pull                              # yeni kodu al
cd Teks-Erp\installer\docker
.\yonet.ps1 update                    # yeniden build + başlat
```
- Migration'lar entrypoint'te **otomatik** uygulanır.
- **Seed atlanır** (`.seeded` var) → **veriler korunur.**
- Veri volume'de durduğu için container yeniden build edilse de kaybolmaz.

---

## D) Yedek / geri yükleme

- `.\yonet.ps1 backup` → `backups\tekserp_<zaman>.dump` (+ `env_<zaman>.txt` = o anki
  `.env.docker` kopyası — geri yükleme için şifreler gerekir).
- `.\yonet.ps1 restore -BackupFile <ad>.dump` → mevcut veriyi o yedekle değiştirir.

> ⚠️ **Makine dışı yedek:** `backups\` diskle aynı yerde. Düzenli olarak başka bir
> makineye/diske kopyala (NAS, harici disk). Ayrıca **`.env.docker`'ı sakla** —
> kaybolursa mevcut DB'ye bağlanılamaz (şifreler orada).

---

## E) Kaldırma / temiz başlangıç

```powershell
docker compose --env-file .env.docker down          # sadece durdur (veri kalır)
docker compose --env-file .env.docker down -v       # VERİ DAHİL her şeyi sil (geri alınamaz)
```
Test verisini silip **tertemiz** başlamak için (fabrikaya geçişte): `down -v` sonra
`.\yonet.ps1 up` → boş DB + temiz seed.

---

## F) Sorun giderme

| Belirti | Çözüm |
|---|---|
| `up` başında Docker hatası | Docker Desktop açık mı? `docker info` çalışıyor mu? |
| Backend cevap vermiyor | `.\yonet.ps1 logs` — hata stack'ini oku. |
| Port 4000 dolu | Başka bir servis 4000'i tutuyor; onu kapat ya da `docker-compose.yml`'de backend port eşlemesini değiştir. |
| Migration ortada takıldı | `logs`'a bak; `entrypoint.sh` `CREATE INDEX CONCURRENTLY` için otomatik retry içerir. |
| Reboot sonrası gelmedi | Docker Desktop "açılışta başlat" + oturum açık mı? (Windows'ta headless için native kurulum daha sağlam.) |

---

## Güvenlik
- Postgres **dışarı açılmaz** (yalnız compose ağı); sadece backend 4000 açık.
- Şifreler + JWT ilk `up`'ta **rastgele** üretilir (`.env.docker`). Bu dosyayı
  git'e **commit'leme** (zaten `.gitignore`'da) ve güvenli sakla.
