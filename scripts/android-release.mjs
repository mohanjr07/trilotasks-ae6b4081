#!/usr/bin/env node
// Bumps the Android app version everywhere it lives, so phones get the "Update available" prompt.
//   node scripts/android-release.mjs "What changed"        → +1 build, patch version (1.1.0 → 1.1.1)
//   node scripts/android-release.mjs "What changed" --force → users must update before continuing
// Then build the signed APK in Android Studio and copy it to public/download/TaskFlow.apk, and push.
import fs from "fs";
const root = new URL("..", import.meta.url).pathname;
const gradle = root + "mobile/android/app/build.gradle";
const cap = root + "mobile/capacitor.config.json";
const ver = root + "public/app-version.json";

const g = fs.readFileSync(gradle, "utf8");
const code = Number(/versionCode (\d+)/.exec(g)[1]) + 1;
const name = /versionName "([^"]+)"/.exec(g)[1].split(".").map(Number);
name[2] = (name[2] ?? 0) + 1;
const versionName = name.join(".");
fs.writeFileSync(gradle, g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]+"/, `versionName "${versionName}"`));

const c = JSON.parse(fs.readFileSync(cap, "utf8"));
c.appendUserAgent = `TaskFlowApp/${code}`;
fs.writeFileSync(cap, JSON.stringify(c, null, 2) + "\n");

const notes = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "Improvements and fixes.";
fs.writeFileSync(ver, JSON.stringify({ versionCode: code, versionName, apk: "/download/TaskFlow.apk", notes, force: process.argv.includes("--force") }, null, 2) + "\n");
console.log(`Android app → version ${versionName} (build ${code}).`);
console.log("Next: cd mobile && npx cap sync android → Android Studio: Build ▸ Generate Signed APK (release)");
console.log("      copy the APK to public/download/TaskFlow.apk → git add -A && git commit && git push");
