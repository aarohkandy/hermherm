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
console.log("For HermHerm app development, Git + Node + npm are enough.");
console.log(
  "For local runtime mode on Windows, WSL Ubuntu must have Hermes installed.",
);
console.log(
  "Run npm.cmd run hermes:wsl to prepare the isolated hermherm profile.",
);

if (failed) {
  process.exit(1);
}
