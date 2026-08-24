#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

version="$(tr -d '[:space:]' < VERSION)"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid VERSION: $version" >&2
  exit 1
fi

CMA_VERSION="$version" node <<'NODE'
const fs = require("node:fs");

const version = process.env.CMA_VERSION;

for (const file of ["package.json", "package-lock.json"]) {
  const path = file;
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  data.version = version;
  if (file === "package-lock.json") data.packages[""].version = version;
  if (file === "package.json") {
    data.contributes.viewsContainers.activitybar[0].title = `CODEX MULTI ACCOUNT - v${version}`;
  }
  fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

const path = "README.md";
const readme = fs.readFileSync(path, "utf8");
const versionPattern = /Version \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)? targets VS Code/;
if (!versionPattern.test(readme)) throw new Error("README version line not found");
const updated = readme.replace(
  versionPattern,
  `Version ${version} targets VS Code`,
);
fs.writeFileSync(path, updated);
NODE

echo "Propagated VERSION=$version"
