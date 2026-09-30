// dotenv'den SONRA yüklenir: `.env`de olmayan yollar hizmet düzeninin varsayılanıyla dolar
// (pm2 düzeninde ecosystem env bloğunun yaptığı iş; `.env` her zaman kazanır). pm2/geliştirmede no-op.
import fs from "node:fs";
import {
  SERVICE_NAME_ENV,
  applyServiceDefaults,
  isServiceNameInvalid,
  relativePathSettings,
  resolveServiceRoot,
  serviceName,
} from "./hizmet-duzeni";
import { SYSTEM_CA_AT_STARTUP } from "./hizmet-duzeni-once";
import { bilgi, hata, uyari } from "./logger";

const { root } = resolveServiceRoot(process.env);
if (root) {
  const envFile = process.env.DOTENV_CONFIG_PATH ?? "";
  try {
    // dotenv okuyamadığı dosyayı sessizce atlar; sırsız açılmak DB/JWT'de anlaşılmaz hata verirdi.
    // `accessSync` Windows'ta ACL'e bakmaz — gerçek açma denenir.
    fs.closeSync(fs.openSync(envFile, "r"));
  } catch (err) {
    hata("hizmet-duzeni", `yapılandırma dosyası okunamıyor: ${envFile}`, err);
    process.exit(1);
  }
  const applied = applyServiceDefaults(process.env, root);
  bilgi("hizmet-duzeni", `kök ${root} · .env ${envFile} · varsayılan: ${applied.length ? applied.join(", ") : "yok"}`);
  const relative = relativePathSettings(process.env);
  if (relative.length) {
    uyari("hizmet-duzeni", `göreli yol ayarı sürüm dizinine göre çözülür, mutlak yazın: ${relative.join(", ")}`);
  }
  if (isServiceNameInvalid(process.env)) {
    uyari("hizmet-duzeni", `${SERVICE_NAME_ENV} geçersiz karakter taşıyor — komutlarda '${serviceName(process.env)}' kullanılır`);
  }
  if (!SYSTEM_CA_AT_STARTUP) {
    uyari("hizmet-duzeni", "NODE_USE_SYSTEM_CA konak ortamında yok — kurumsal proxy TLS'i açıyorsa satıcı bağlantısı düşer");
  }
}
