// Uygulama girişi (adı bilinçli: web paketi `entry-<özet>.js` adını bu dosyadan alır, Dockerfile onu arar).
// Sıra: metro-runtime ilk (web Fast Refresh), sonra web adresinin `//` katlaması, en son yönlendirici —
// içe aktarmalar sırayla değerlendirilir, katlama yönlendirici ilk adresi okumadan biter.
import "@expo/metro-runtime";
import "./src/web-path-fix";
import "expo-router/entry";
