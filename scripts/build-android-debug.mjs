import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDirectory = path.join(workspace, "android");
const workspaceSdk = path.join(workspace, ".android-sdk");
const androidHome =
  process.env.ANDROID_HOME ?? (existsSync(workspaceSdk) ? workspaceSdk : undefined);
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const child = spawn(wrapper, ["assembleDebug"], {
  cwd: androidDirectory,
  env: {
    ...process.env,
    ...(androidHome === undefined ? {} : { ANDROID_HOME: androidHome })
  },
  stdio: "inherit",
  shell: process.platform === "win32"
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

if (exitCode !== 0) process.exitCode = exitCode;
