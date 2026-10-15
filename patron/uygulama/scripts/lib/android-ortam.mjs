// JDK + Android SDK bulucu (tablet build-apk ile aynı aday sırası). macOS'ta `java` saplaması her zaman vardır ama JDK
// yoksa çalışmaz; kökler DOSYA SİSTEMİNDEN doğrulanır. Gradle 8.x JDK 17+ ister; Android Studio JBR son çaredir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function jdkBul(env = process.env) {
  const java = (k) => k && fs.existsSync(path.join(k, "bin", "java"));
  if (java(env.JAVA_HOME)) return env.JAVA_HOME;
  const adaylar = [
    "/opt/homebrew/opt/openjdk@17",
    "/opt/homebrew/opt/openjdk@21",
    "/usr/local/opt/openjdk@17",
    "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home",
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  ];
  const bulunan = adaylar.find(java);
  if (bulunan) return bulunan;
  if (process.platform === "darwin") {
    const r = spawnSync("/usr/libexec/java_home", ["-v", "17+"], { encoding: "utf8" });
    const y = (r.stdout ?? "").trim();
    if (r.status === 0 && java(y)) return y;
  }
  return null;
}

export function sdkBul(env = process.env) {
  const adaylar = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, path.join(os.homedir(), "Library/Android/sdk"), path.join(os.homedir(), "Android/Sdk")].filter(Boolean);
  return adaylar.find((k) => fs.existsSync(path.join(k, "platform-tools"))) ?? null;
}

/** En yeni build-tools içindeki araç (aapt2 · apksigner); yoksa null. */
export function buildTool(sdk, ad) {
  const kok = path.join(sdk, "build-tools");
  const surumler = fs.existsSync(kok) ? fs.readdirSync(kok).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  for (const s of surumler) if (fs.existsSync(path.join(kok, s, ad))) return path.join(kok, s, ad);
  return null;
}

export function dur(...satirlar) {
  process.stderr.write(`\n✖ ${satirlar.join("\n  ")}\n`);
  process.exit(1);
}
