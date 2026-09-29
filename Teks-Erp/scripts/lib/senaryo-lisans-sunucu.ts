// SENARYO L — fabrika backend'inin giriş noktası: gerçek `src/server.ts`, önce test enjeksiyonları.
// Koşucu bunu `node --import tsx --import ./senaryo-saat.ts` ile doğurur (127.0.0.1, `_test` DB).
// Sıra yük taşır: ayar modülü sunucudan ÖNCE değerlendirilmeli (çapa + parmak izi sorgusu).
import "./senaryo-lisans-ayar";
import "../../src/server";
