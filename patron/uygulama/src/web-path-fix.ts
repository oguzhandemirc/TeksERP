// Yan etkili modül: `entry.ts`te expo-router'dan ÖNCE içe aktarılır ki yönlendirici ilk adresi katlanmış okusun.
import { Platform } from "react-native";
import { fixWebLocation } from "./lib/web-path";

fixWebLocation(Platform.OS, typeof window === "undefined" ? undefined : window);
