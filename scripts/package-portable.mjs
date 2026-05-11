import { packager } from "@electron/packager";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const stagingDir = path.join(root, ".packager-staging");
const tempDir = path.join(tmpdir(), `hermherm-packager-${process.pid}`);
const outDir = path.join(root, "release", "portable");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const electronVersion = packageJson.devDependencies.electron.replace(
  /^[^\d]*/,
  "",
);

await rm(stagingDir, { recursive: true, force: true });
await rm(tempDir, { recursive: true, force: true });
await rm(outDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await mkdir(tempDir, { recursive: true });

await cp(path.join(root, "dist"), path.join(stagingDir, "dist"), {
  recursive: true,
});
await cp(path.join(root, "electron"), path.join(stagingDir, "electron"), {
  recursive: true,
});
await writeFile(
  path.join(stagingDir, "package.json"),
  JSON.stringify(
    {
      name: "hermherm",
      version: packageJson.version,
      description: packageJson.description,
      author: packageJson.author,
      main: "electron/main.cjs",
    },
    null,
    2,
  ),
);

const appPaths = await packager({
  dir: stagingDir,
  out: outDir,
  tmpdir: tempDir,
  overwrite: true,
  asar: true,
  platform: process.platform === "darwin" ? "darwin" : "win32",
  arch: process.arch === "arm64" ? "arm64" : "x64",
  name: "HermHerm",
  executableName: "HermHerm",
  appBundleId: "com.hermherm.playground",
  appVersion: packageJson.version,
  electronVersion,
  win32metadata: {
    CompanyName: "HermHerm",
    FileDescription: "HermHerm desktop playground",
    ProductName: "HermHerm",
  },
});

await rm(stagingDir, { recursive: true, force: true });
await rm(tempDir, { recursive: true, force: true });

console.log("Portable app created:");
for (const appPath of appPaths) {
  console.log(`- ${appPath}`);
}
