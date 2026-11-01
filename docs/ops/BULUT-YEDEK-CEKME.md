# Bulut VDS'inin yedeğini makine dışına ÇEKME (yedek VDS'i çeker)

> Denetim 2026-11-01 K2. Betikler: `deploy/bulut/yedek-cek/` · bekçi `scripts/test_bulut_yedek_cek.mjs` ·
> kabul ölçümü `deploy/bulut/barindirma-kontrol.sh` ("son makine dışı çekim N saat önce").
> Sunucu adımları elle yapılır. Bu belge komutları verir, hiçbir sunucuya kendiliğinden bağlanmaz.

## Neden çekme, neden gönderme değil

| | Gönderme (rclone, müşteri VDS'i iter) | **Çekme (bu belge)** |
|---|---|---|
| Müşteri VDS'inde uzak hedefin kimliği | Var (SFTP anahtarı) | **Yok** |
| Müşteri VDS'ini ele geçiren | Hedefe yazabilir, `gelen/` dizinini doldurabilir | Hiçbir şeye bağlanamaz. Yalnız çıkış dizinindeki dosyaları değiştirebilir |
| İmajda yeni paket | `rclone` (onay ister) | **Yok.** Konakta `rsync` var, `rrsync` rsync ≥ 3.2.4 ile gelir |
| Var olan uzak kopyanın bozulması | Hedef korumasına bağlı | `--ignore-existing`: aynı adla gelen bozuk dosya eskisini ezmez |

Gönderme yolu (`offsite-backup.helper`, `YEDEK-VPS-KURULUM.md`) Windows/LAN kurulumunda olduğu gibi kalır. Bu belge yalnız **barındırılan** VDS içindir.

## Akış

```
müşteri VDS (root zamanlayıcı)          müşteri VDS (sshd)                    yedek VDS (kendi kullanıcısı)
yedek birimi ──cikis-hazirla.sh──▶ /srv/tekserp-cikis ◀──rrsync -ro── cek-kapisi.sh ◀──ssh── yedek-cek.sh ──▶ /srv/yedek-cekilen/<musteri>
 (.dump.tkenc + sihirli bayt)       (0640 root:tekserp-cek, 7 gün)          (damga: son-cekim)        (90 gün, en yeni 14 korunur)
```

Düz `.dump` hiçbir aşamada geçmez. Hazırlayıcı yalnız sihirli baytı tutan `*.dump.tkenc` dosyalarını kopyalar. Çekici de yalnız `*.dump.tkenc` ister ve sihirli baytı tutmayanı karantinaya alır.

## Kurulum — müşteri VDS'i (root)

```bash
# 1) Çekme kullanıcısı: kabuk yok, parola yok, yalnız anahtar + zorunlu komut
useradd --system --create-home --shell /usr/sbin/nologin tekserp-cek
install -d -m 0750 -o root -g tekserp-cek /srv/tekserp-cikis
install -d -m 0750 -o tekserp-cek -g tekserp-cek /var/lib/tekserp-cek
install -m 0755 deploy/bulut/yedek-cek/cek-kapisi.sh /usr/local/sbin/tekserp-cek-kapisi
install -m 0755 deploy/bulut/yedek-cek/cikis-hazirla.sh /usr/local/sbin/tekserp-cikis-hazirla
command -v rrsync || ls /usr/share/doc/rsync/scripts/   # rsync >= 3.2.4 (Ubuntu 24.04: /usr/bin/rrsync)

# 2) Yedek VDS'inin AÇIK anahtarını tek satırla yetkilendir (anahtar yedek VDS'te üretilir, aşağıda)
install -d -m 0700 -o tekserp-cek -g tekserp-cek ~tekserp-cek/.ssh
echo 'command="/usr/local/sbin/tekserp-cek-kapisi",restrict ssh-ed25519 AAAA... yedek-vds' \
  > ~tekserp-cek/.ssh/authorized_keys
chown tekserp-cek: ~tekserp-cek/.ssh/authorized_keys && chmod 0600 ~tekserp-cek/.ssh/authorized_keys
# sshd'de AllowUsers kullanılıyorsa (D5) tekserp-cek eklenir; ufw'de SSH portu yedek VDS'in IP'sine açık olmalı.

# 3) Çıkış hazırlayıcı: gece yedeğinden sonra, saatte bir
PROJE=<compose projesi>
KAYNAK=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJE}_yedek")
echo "15 * * * * root /usr/local/sbin/tekserp-cikis-hazirla --kaynak $KAYNAK >> /var/log/tekserp-cikis.log 2>&1" \
  > /etc/cron.d/tekserp-cikis
```

## Kurulum — yedek VDS'i (müşteri başına ayrı anahtar)

```bash
sudo useradd --create-home --shell /bin/bash yedekcek     # bir kez
sudo -u yedekcek ssh-keygen -N '' -f ~yedekcek/.ssh/cek_<musteri> -C "yedek-vds <musteri>"   # OpenSSH ≥ 9.5 varsayılan türü (Ubuntu 24.04)
# Açık yarıyı (cek_<musteri>.pub) müşteri VDS'indeki authorized_keys satırına koy (yukarıda 2).
sudo -u yedekcek ssh -i ~yedekcek/.ssh/cek_<musteri> -p <port> tekserp-cek@<musteri-vds> true  # known_hosts'a ilk kayıt (parmak izini doğrula)
sudo install -d -m 0700 -o yedekcek /srv/yedek-cekilen/<musteri>
sudo install -m 0755 deploy/bulut/yedek-cek/yedek-cek.sh /usr/local/bin/tekserp-yedek-cek

# Önce KURU: ne çekileceğini listeler, yazmaz
sudo -u yedekcek tekserp-yedek-cek --kaynak tekserp-cek@<musteri-vds>: --hedef /srv/yedek-cekilen/<musteri> \
  --anahtar ~yedekcek/.ssh/cek_<musteri> --port <port> --kuru

# Zamanlayıcı: 6 saatte bir (gece yedeği 03:00, hazırlayıcı :15)
echo "30 */6 * * * yedekcek /usr/local/bin/tekserp-yedek-cek --kaynak tekserp-cek@<musteri-vds>: --hedef /srv/yedek-cekilen/<musteri> --anahtar /home/yedekcek/.ssh/cek_<musteri> --port <port>" \
  | sudo tee /etc/cron.d/tekserp-yedek-cek-<musteri>
```

Çıkış kodları: 0 tamam · 2 yapılandırma · 3 çekim başarısız · **4 en yeni şifreli yedek 26 saatten eski** · 5 başka çekim sürüyor. 3 ve 4 alarma bağlanır (O8 dış izleme; o gelene dek cron e-postası ya da gözcü). Günlük: `<hedef>/.cekim.log`.

## Doğrulama (kabul)

1. Müşteri VDS'inde `bash barindirma-kontrol.sh --proje <proje>` çalıştırılır. "son makine dışı çekim N saat önce" maddesi YEŞİL olmalı (≤ 26 sa). Damga yoksa madde KIRMIZI'dır.
2. Yedek VDS'inde `ls -l /srv/yedek-cekilen/<musteri>`: yalnız `*.dump.tkenc` dosyaları görünmeli, hepsi `0400` olmalı.
3. Saldırı benzetimi, yalnız test VDS'inde: müşteri VDS'inde çıkış dizinindeki bir dosya bozulur ya da silinir. Sonraki çekimden sonra yedek VDS'indeki kopyanın `sha256sum` değeri değişmemiş olmalı.
4. Kapı reddi: yedek VDS'inden `ssh -i … tekserp-cek@<musteri-vds> id` komutu "yalnız rsync çekimi kabul edilir" yanıtıyla düşmeli.

## Sınırlar

- Ele geçirilmiş müşteri VDS'i geçmiş kopyaları bozamaz. Ama **yeni** sahte `.tkenc` üretebilir; geri yüklemede imza değil şifre çözme doğrular. Sahte dosya alıcı anahtarlarıyla açılmaz ya da TKENC doğrulamasından geçmez. Bu yüzden geri yüklemeden önce `yedek-sifrele.cjs dogrula` koşulur.
- Kaynak birden çok sahte "yeni" dosyayla saklamanın en-az kotasını doldurabilir. Saklama yalnız `SAKLAMA_GUN`den (90) eski dosyaları siler. Geliş anı yerel saattir, kaynaktan alınmaz. Yani gerçek kopyalar 90 gün boyunca kalır.
- RPO hâlâ gece yedeğidir (≤ 24 sa). Daha kısa RPO için WAL arşivi gerekir; bu bir iş kararıdır (denetim K2 Nasıl-7).
