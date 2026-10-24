// Uygulama girişi (adı bilinçli: web paketi `entry-<özet>.js` adını bu dosyadan alır, Dockerfile onu arar).
// Sıra: metro-runtime ilk (web Fast Refresh), sonra web adresinin `//` katlaması ve ikon fontu önkaydı, en son yönlendirici —
// içe aktarmalar sırayla değerlendirilir, ikisi de yönlendirici ilk adresi okumadan / ilk çizimden önce biter.
import "@expo/metro-runtime";
import "./src/web-path-fix";
import "./src/web-icon-font";
import "expo-router/entry";
