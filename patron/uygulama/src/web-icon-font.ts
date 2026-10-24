// Yan etkili modül: `entry.ts`te yönlendiriciden ÖNCE içe aktarılır ki ikon fontu ilk çizimden önce CSSOM ile kayıtlı olsun
// (web CSP'si metin düğümlü `@font-face`i engeller). Uygulamadaki TEK ikon seti Ionicons; yeni set eklenirse buraya da eklenir.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform } from "react-native";
import { preregisterIconFonts, type FontDocumentLike } from "./lib/web-icon-font";

preregisterIconFonts(
  Platform.OS,
  typeof document === "undefined" ? undefined : (document as unknown as FontDocumentLike),
  [Ionicons.font],
);
