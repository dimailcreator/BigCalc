import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDirectory = path.join(workspace, "android");
const workspaceSdk = path.join(workspace, ".android-sdk");
const androidHome =
  process.env.ANDROID_HOME ?? (existsSync(workspaceSdk) ? workspaceSdk : undefined);
const required = [
  "BIGCALC_RELEASE_KEYSTORE",
  "BIGCALC_RELEASE_STORE_PASSWORD",
  "BIGCALC_RELEASE_KEY_ALIAS",
  "BIGCALC_RELEASE_KEY_PASSWORD"
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0)
  throw new Error(`Release signing variables are missing: ${missing.join(", ")}`);

const keystore = path.resolve(process.env.BIGCALC_RELEASE_KEYSTORE);
if (!existsSync(keystore) || !statSync(keystore).isFile()) {
  throw new Error(`Release keystore was not found: ${keystore}`);
}

const wrapper = process.platform === "win32" ? "gradlew.bat" : "sh";
const buildEnvironment = {
  ...process.env,
  BIGCALC_RELEASE_KEYSTORE: keystore,
  ...(androidHome === undefined ? {} : { ANDROID_HOME: androidHome })
};
await run(
  wrapper,
  process.platform === "win32"
    ? ["assembleRelease", "bundleRelease"]
    : ["./gradlew", "assembleRelease", "bundleRelease"],
  {
    cwd: androidDirectory,
    env: buildEnvironment,
    shell: process.platform === "win32"
  }
);

const apk = path.join(
  androidDirectory,
  "app",
  "build",
  "outputs",
  "apk",
  "release",
  "app-release.apk"
);
const aab = path.join(
  androidDirectory,
  "app",
  "build",
  "outputs",
  "bundle",
  "release",
  "app-release.aab"
);
for (const artifact of [apk, aab]) {
  if (!existsSync(artifact) || statSync(artifact).size === 0) {
    throw new Error(`Release artifact is missing or empty: ${artifact}`);
  }
}

const buildTools = androidHome === undefined ? null : path.join(androidHome, "build-tools");
if (buildTools === null || !existsSync(buildTools)) {
  throw new Error("Android build-tools were not found; cannot verify the release APK signature");
}
const apksignerName = process.platform === "win32" ? "apksigner.bat" : "apksigner";
const apksigner = readdirSync(buildTools)
  .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  .map((version) => path.join(buildTools, version, apksignerName))
  .find(existsSync);
if (apksigner === undefined) throw new Error("apksigner was not found in Android build-tools");
await run(apksigner, ["verify", apk], {
  cwd: workspace,
  env: buildEnvironment,
  shell: process.platform === "win32",
  quiet: true
});
await run("jarsigner", ["-verify", aab], {
  cwd: workspace,
  env: buildEnvironment,
  shell: process.platform === "win32",
  quiet: true
});
process.stdout.write("Release APK and AAB signatures verified.\n");

const releaseVersion = JSON.parse(readFileSync(path.join(workspace, "app-version.json"), "utf8"));
const apkMetadata = JSON.parse(
  readFileSync(
    path.join(
      androidDirectory,
      "app",
      "build",
      "outputs",
      "apk",
      "release",
      "output-metadata.json"
    ),
    "utf8"
  )
);
if (
  apkMetadata.elements?.[0]?.versionCode !== releaseVersion.versionCode ||
  apkMetadata.elements?.[0]?.versionName !== releaseVersion.versionName
) {
  throw new Error("Release APK metadata does not match app-version.json");
}

for (const artifact of [apk, aab]) {
  const hash = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  process.stdout.write(`${path.relative(workspace, artifact)} SHA-256 ${hash}\n`);
}

async function run(command, args, options) {
  const { quiet = false, ...spawnOptions } = options;
  const child = spawn(command, args, {
    ...spawnOptions,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  let captured = "";
  if (quiet) {
    child.stdout.on("data", (chunk) => {
      captured += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      captured += chunk.toString();
    });
  }
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    if (quiet) process.stderr.write(captured);
    throw new Error(`${path.basename(command)} exited with code ${exitCode}`);
  }
}
