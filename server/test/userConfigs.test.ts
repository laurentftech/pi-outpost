/**
 * The user's uv.toml, pip.ini and .npmrc, carried into the sandbox without their credentials: a
 * company's mirror declared there is seen by confined commands (issues #552, #554).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { carriedSummary, carryUserConfigs, userConfigsToCarry, windowsToolchains, withoutCredentials } from "../src/terminalSandbox.ts";

describe("the user's package manager configuration", () => {
  const made: string[] = [];
  after(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  // openlore: scenario=TheUsersMirrorIsSeen spec=sandbox-runner-bash
  test("TheUsersMirrorIsSeen: credentials are taken out, the mirror's address kept", () => {
    const uv = withoutCredentials(`[[index]]\nurl = "https://alice:s3cret@nexus.corp.example:8446/repository/pypi/simple"\ndefault = true\n`, "uv.toml");
    assert.equal(uv.text, `[[index]]\nurl = "https://nexus.corp.example:8446/repository/pypi/simple"\ndefault = true\n`);
    assert.equal(uv.leftOut, true);
    const pip = withoutCredentials("[global]\r\nindex-url = https://nexus.corp.example/simple\r\ntrusted-host = nexus.corp.example\r\n", "pip.ini");
    assert.equal(pip.leftOut, false, "nothing to take out");
    assert.match(pip.text, /index-url = https:\/\/nexus\.corp\.example\/simple/);
    const npm = withoutCredentials(
      ["registry=https://npm.corp.example/", "//npm.corp.example/:_authToken=npm_abc", "_auth=dXNlcjpwYXNz", "//npm.corp.example/:username=alice", "//npm.corp.example/:_password=cGFzcw==", "strict-ssl=true", "email=alice@corp.example"].join("\n"),
      ".npmrc",
    );
    assert.equal(npm.text, ["registry=https://npm.corp.example/", "strict-ssl=true", "email=alice@corp.example"].join("\n"));
    assert.equal(npm.leftOut, true);
  });

  test("Maven's servers and passwords, Gradle's secret properties, Cargo's token and Go's GOAUTH are taken out", () => {
    const maven = withoutCredentials(
      [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<settings>`,
        `  <mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://nexus.corp.example/repository/maven-public/</url></mirror></mirrors>`,
        `  <servers><server><id>corp</id><username>alice</username><password>{s3cret}</password></server></servers>`,
        `  <proxies><proxy><host>proxy.corp.example</host><port>8080</port><username>alice</username><password>p</password></proxy></proxies>`,
        `</settings>`,
      ].join("\n"),
      "settings.xml",
    );
    assert.equal(maven.leftOut, true);
    assert.match(maven.text, /<url>https:\/\/nexus\.corp\.example\/repository\/maven-public\/<\/url>/);
    assert.match(maven.text, /<host>proxy\.corp\.example<\/host><port>8080<\/port>/, "the proxy stays, without its account");
    assert.doesNotMatch(maven.text, /alice|s3cret|<servers|<password/);

    const gradle = withoutCredentials(
      ["systemProp.https.proxyHost=proxy.corp.example", "systemProp.https.proxyPassword=p", "artifactoryToken=t0k", "mavenRepoPassword: pw", "corpRepoUrl=https://nexus.corp.example/maven", "org.gradle.jvmargs=-Xmx2g"].join("\n"),
      "gradle.properties",
    );
    assert.equal(gradle.text, ["systemProp.https.proxyHost=proxy.corp.example", "corpRepoUrl=https://nexus.corp.example/maven", "org.gradle.jvmargs=-Xmx2g"].join("\n"));

    const cargo = withoutCredentials(`[source.crates-io]\nreplace-with = "corp"\n[source.corp]\nregistry = "sparse+https://cargo.corp.example/index/"\n[registries.corp]\nindex = "sparse+https://cargo.corp.example/index/"\ntoken = "cio_secret"\n`, "config.toml");
    assert.doesNotMatch(cargo.text, /cio_secret/);
    assert.match(cargo.text, /replace-with = "corp"/);

    const go = withoutCredentials("GOPROXY=https://bob:pw@goproxy.corp.example,direct\nGOPRIVATE=*.corp.example\nGOAUTH=git dir\n", "go env");
    assert.equal(go.text, "GOPROXY=https://goproxy.corp.example,direct\nGOPRIVATE=*.corp.example\n");

    const nuget = withoutCredentials(
      `<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><add key="corp" value="https://nuget.corp.example/v3/index.json" /></packageSources><packageSourceCredentials><corp><add key="Username" value="alice" /><add key="ClearTextPassword" value="s3cret" /></corp></packageSourceCredentials></configuration>`,
      "NuGet.Config",
    );
    assert.equal(nuget.leftOut, true);
    assert.match(nuget.text, /<add key="corp" value="https:\/\/nuget\.corp\.example\/v3\/index\.json" \/>/, "on one line, the source stays");
    assert.doesNotMatch(nuget.text, /alice|s3cret|packageSourceCredentials/);
  });

  test("each is looked for where the user's tool keeps it, and copied where the confined one reads it", async () => {
    const toolchains = windowsToolchains({ cacheDir: "C:\\cache", serverEnv: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, home: "C:\\Users\\me" });
    assert.deepEqual(toolchains.carried, [
      { name: "uv.toml", from: "C:\\Users\\me\\AppData\\Roaming\\uv\\uv.toml", to: "C:\\cache\\appdata\\Roaming\\uv\\uv.toml" },
      { name: "pip.ini", from: "C:\\Users\\me\\AppData\\Roaming\\pip\\pip.ini", to: "C:\\cache\\user-config\\pip.ini" },
      { name: ".npmrc", from: "C:\\Users\\me\\.npmrc", to: "C:\\cache\\user-config\\npmrc" },
      { name: "settings.xml", from: "C:\\Users\\me\\.m2\\settings.xml", to: "C:\\cache\\user-config\\settings.xml" },
      { name: "gradle.properties", from: "C:\\Users\\me\\.gradle\\gradle.properties", to: "C:\\cache\\gradle\\gradle.properties" },
      { name: "config.toml", from: "C:\\Users\\me\\.cargo\\config.toml", to: "C:\\cache\\cargo\\config.toml" },
      { name: "go env", from: "C:\\Users\\me\\AppData\\Roaming\\go\\env", to: "C:\\cache\\appdata\\Roaming\\go\\env" },
      { name: "NuGet.Config", from: "C:\\Users\\me\\AppData\\Roaming\\NuGet\\NuGet.Config", to: "C:\\cache\\appdata\\Roaming\\NuGet\\NuGet.Config" },
    ]);
    assert.equal(toolchains.env.npm_config_userconfig, undefined, "no ~/.npmrc on this disk: npm is not pointed at a copy that will never exist");
    assert.equal(toolchains.env.PIP_CONFIG_FILE, undefined, "same for pip");
    assert.equal(toolchains.env.MAVEN_ARGS, undefined, "no ~/.m2/settings.xml: MAVEN_ARGS would break every mvn on a file that is never copied");
    assert.equal(toolchains.env.APPDATA, "C:\\cache\\appdata\\Roaming", "uv and Go find theirs under the sandbox's APPDATA");
    // With the user's files present, each tool is told where its copy is.
    const base = await mkdtemp(path.join(tmpdir(), "toolchains-"));
    made.push(base);
    const home = path.join(base, "home");
    await mkdir(path.join(home, ".m2"), { recursive: true });
    await writeFile(path.join(home, ".m2", "settings.xml"), "<settings/>\n");
    await writeFile(path.join(home, ".npmrc"), "registry=https://npm.corp.example/\n");
    const withFiles = windowsToolchains({ cacheDir: "C:\\cache", serverEnv: { APPDATA: path.join(home, "AppData", "Roaming") }, home });
    assert.equal(withFiles.env.npm_config_userconfig, "C:\\cache\\user-config\\npmrc");
    assert.equal(withFiles.env.MAVEN_ARGS, `-s "C:\\cache\\user-config\\settings.xml"`, "Maven 3.9 reads its settings file from MAVEN_ARGS");
    // The user's own homes, when they moved them.
    const moved = userConfigsToCarry({ serverEnv: { CARGO_HOME: "D:\\rust\\cargo", GRADLE_USER_HOME: "D:\\gradle" }, home: "C:\\Users\\me", cacheDir: "C:\\cache", sandboxAppData: "C:\\a", gradleHome: "C:\\cache\\gradle", cargoHome: "C:\\cache\\cargo" });
    assert.ok(moved.some((config) => config.from === "D:\\rust\\cargo\\config.toml"));
    assert.ok(moved.some((config) => config.from === "D:\\gradle\\gradle.properties"));
  });

  test("copied at each launch as the original is now; a copy of one removed is removed; a file a command wrote is left alone", { skip: process.platform === "win32" ? false : "the sandbox cache and APPDATA are Windows paths (MXC on Windows only)" }, async () => {
    const base = await mkdtemp(path.join(tmpdir(), "user-configs-"));
    made.push(base);
    const home = path.join(base, "home");
    const roaming = path.join(home, "AppData", "Roaming");
    const cache = path.join(base, "cache");
    await mkdir(path.join(roaming, "uv"), { recursive: true });
    await mkdir(path.join(roaming, "pip"), { recursive: true });
    await writeFile(path.join(roaming, "uv", "uv.toml"), `index-url = "https://bob:pw@mirror.corp.example/simple"\n`);
    await writeFile(path.join(home, ".npmrc"), "registry=https://npm.corp.example/\n//npm.corp.example/:_authToken=npm_secret\n");
    const carried = userConfigsToCarry({ serverEnv: { APPDATA: roaming }, home, cacheDir: cache, sandboxAppData: path.join(cache, "appdata", "Roaming") });
    const at = (name: string) => carried.find((config) => config.name === name)!.to;

    await carryUserConfigs(carried);
    const uv = await readFile(at("uv.toml"), "utf8");
    assert.match(uv, /^# pi-outpost: carried from .*uv\.toml, credentials left out; edit that one\.\n/);
    assert.match(uv, /index-url = "https:\/\/mirror\.corp\.example\/simple"/);
    assert.doesNotMatch(uv, /bob|pw@/);
    const npm = await readFile(at(".npmrc"), "utf8");
    assert.match(npm, /registry=https:\/\/npm\.corp\.example\//);
    assert.doesNotMatch(npm, /npm_secret/);
    assert.equal(existsSync(at("pip.ini")), false, "no pip.ini, no copy");

    // Edited: the next launch carries the new content.
    await writeFile(path.join(roaming, "uv", "uv.toml"), `index-url = "https://other.corp.example/simple"\n`);
    await carryUserConfigs(carried);
    assert.match(await readFile(at("uv.toml"), "utf8"), /other\.corp\.example/);
    // Removed: its copy goes too.
    await rm(path.join(roaming, "uv", "uv.toml"));
    await carryUserConfigs(carried);
    assert.equal(existsSync(at("uv.toml")), false);
    // A pip.ini a command wrote itself (no mark) is neither replaced nor removed.
    await mkdir(path.dirname(at("pip.ini")), { recursive: true });
    await writeFile(at("pip.ini"), "[global]\ntimeout = 60\n");
    await writeFile(path.join(roaming, "pip", "pip.ini"), "[global]\nindex-url = https://mirror.corp.example/simple\n");
    await carryUserConfigs(carried);
    assert.equal(await readFile(at("pip.ini"), "utf8"), "[global]\ntimeout = 60\n");

    assert.equal(carriedSummary(carried), "your pip.ini, .npmrc (credentials left out) carried in");
  });
});
