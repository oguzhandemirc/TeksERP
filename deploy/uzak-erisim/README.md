# Uzaktan erişim — fabrika sunucusuna gelen port açmadan

Patron modülünün taşıyıcısı. Fabrikada koşan `cloudflared` **dışarı doğru**
bağlanır; fabrika güvenlik duvarında **tek bir gelen port açılmaz**.

| Dosya | Ne |
|---|---|
| `config.yml.ornek` | `cloudflared` ingress şablonu (müşteriye göre doldurulur) |
| `cf-worker-hata-sayfasi.js` | Cloudflare Worker — tünel kapalıyken kullanıcıya Türkçe hata sayfası |

**Kurulum reçetesi:** [`../../docs/ops/UZAK-ERISIM-KURULUM.md`](../../docs/ops/UZAK-ERISIM-KURULUM.md)

⚠️ Tünel kimlik dosyası (`<tünel-id>.json`) ve tünel token'ı **depoya girmez** —
o dosya, fabrikanın tüm verisine erişim anlamına gelir.
