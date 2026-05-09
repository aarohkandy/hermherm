import { execFileSync } from "node:child_process";

function runCommand(command, args) {
  if (process.platform === "win32") {
    return execFileSync(
      "cmd.exe",
      ["/d", "/s", "/c", [command, ...args].join(" ")],
      {
        encoding: "utf8",
      },
    ).trim();
  }

  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

const checks = [
  ["Git", "git", ["--version"]],
  ["Node", "node", ["--version"]],
  ["npm", "npm.cmd", ["--version"]],
];

let failed = false;

for (const [label, command, args] of checks) {
  try {
    const output = runCommand(command, args);
    console.log(`${label}: ${output}`);
  } catch {
    failed = true;
    console.error(`${label}: missing`);
  }
}

console.log("");
console.log("For this Electron playground, Git + Node + npm are enough.");
console.log(
  "For the later Tauri app, install Rust and Visual Studio C++ Build Tools.",
);

if (failed) {
  process.exit(1);
}
