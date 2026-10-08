#!/usr/bin/env node
// TeksErpLanTls — JVM denetim koşucusu (Android cihazı/emülatörü gerekmez; yeni bağımlılık yok).
// Saf kural + güven yöneticisi + ad doğrulayıcı + şifresiz istek kesicisini gerçek TLS el sıkışmasıyla ölçer.
// Kotlin derleyicisi, OkHttp ve okio Gradle önbelleğinden alınır (bir kez `expo run:android` / gradle
// derlemesi koşmuş makinede vardır); geçici anahtarlar `keytool` ile koşum başına üretilir, diske kalmaz.
//   node modules/teks-erp-lan-tls/jvm-check.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'android/src/main/java/com/tekserp/lantls');
const TEST = path.join(HERE, 'android/src/test/java/com/tekserp/lantls/LanTlsJvmCheck.kt');
const PURE = ['LanTlsPolicy.kt', 'PinningTrustManager.kt', 'PinningHostnameVerifier.kt', 'CleartextGuardInterceptor.kt', 'LanTlsProbe.kt'];
const CACHE = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1');

function dur(msg) {
  console.error(`✗ ${msg}`);
  process.exit(2);
}

function javaBin() {
  const adaylar = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin'),
    '/opt/homebrew/opt/openjdk@17/bin',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin',
  ].filter(Boolean);
  for (const d of adaylar) if (fs.existsSync(path.join(d, 'java'))) return d;
  return dur('JDK bulunamadı (JAVA_HOME ya da openjdk@17 ya da Android Studio jbr)');
}

function jar(group, artifact, versions) {
  const dir = path.join(CACHE, group, artifact);
  if (!fs.existsSync(dir)) return dur(`Gradle önbelleğinde yok: ${group}:${artifact}`);
  const mevcut = fs.readdirSync(dir);
  const v = versions.find((x) => mevcut.includes(x));
  if (!v) return dur(`Gradle önbelleğinde ${group}:${artifact} ${versions.join('|')} yok (var: ${mevcut.join(', ')})`);
  for (const h of fs.readdirSync(path.join(dir, v))) {
    for (const ad of [`${artifact}-${v}.jar`, `${artifact}-jvm-${v}.jar`]) {
      const f = path.join(dir, v, h, ad);
      if (fs.existsSync(f)) return f;
    }
  }
  return dur(`${group}:${artifact}:${v} jar dosyası yok`);
}

const bin = javaBin();
const java = path.join(bin, 'java');
const keytool = path.join(bin, 'keytool');
const KV = ['2.1.20', '2.0.21'];
const stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', KV);
const derleyici = [
  jar('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', KV),
  stdlib,
  jar('org.jetbrains.kotlin', 'kotlin-script-runtime', KV),
  jar('org.jetbrains.kotlin', 'kotlin-reflect', KV),
  jar('org.jetbrains.kotlin', 'kotlin-daemon-embeddable', KV),
  jar('org.jetbrains.intellij.deps', 'trove4j', ['1.0.20200330', '1.0.20181211']),
  jar('org.jetbrains', 'annotations', ['13.0', '23.0.0']),
  jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', ['1.8.0', '1.8.1', '1.7.3', '1.9.0']),
];
const calisma = [stdlib, jar('com.squareup.okhttp3', 'okhttp', ['4.9.2', '4.12.0']), jar('com.squareup.okio', 'okio', ['2.9.0'])];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantls-jvm-'));
try {
  const parola = `p${process.pid}${Date.now()}`;
  const ks = (ad, san) => {
    const f = path.join(tmp, `${ad}.p12`);
    execFileSync(keytool, ['-genkeypair', '-alias', ad, '-keyalg', 'EC', '-groupname', 'secp256r1', '-sigalg', 'SHA256withECDSA',
      '-dname', `CN=${ad}`, '-ext', `SAN=${san}`, '-validity', '2', '-storetype', 'PKCS12',
      '-keystore', f, '-storepass', parola, '-keypass', parola], { stdio: 'ignore' });
    return f;
  };
  const a = ks('sunucu-a', 'dns:sunucu-a');
  const b = ks('sunucu-b', 'ip:127.0.0.1');
  const out = path.join(tmp, 'out');
  execFileSync(java, ['-cp', derleyici.join(path.delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-nowarn', '-jvm-target', '17', '-cp', calisma.join(path.delimiter), '-d', out,
    ...PURE.map((f) => path.join(SRC, f)), TEST], { stdio: 'inherit' });
  execFileSync(java, ['-cp', [out, ...calisma].join(path.delimiter), 'com.tekserp.lantls.LanTlsJvmCheckKt', a, b, parola],
    { stdio: 'inherit' });
} catch (e) {
  process.exitCode = typeof e.status === 'number' ? e.status : 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
