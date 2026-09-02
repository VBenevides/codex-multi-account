#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

version="$(<VERSION)"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid VERSION: $version" >&2
  exit 1
fi

npm run build
package_json_backup="$(mktemp)"
cp package.json "$package_json_backup"
trap 'cp "$package_json_backup" package.json; rm -f "$package_json_backup"' EXIT
node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("package.json")); p.contributes.viewsContainers.activitybar[0].title=`CODEX MULTI ACCOUNT - v${process.argv[1]}`; fs.writeFileSync("package.json", JSON.stringify(p, null, 2)+"\n");' "$version"
./node_modules/.bin/vsce package "$version" --no-git-tag-version --no-update-package-json \
  --no-dependencies --allow-missing-repository

vsix="$(node -p "const p=require('./package.json'); p.name")-$version.vsix"
vscode_cli="${VSCODE_CLI:-$(command -v code || true)}"

if [[ -z "$vscode_cli" ]]; then
  echo "VS Code CLI not found; set VSCODE_CLI to its path." >&2
  exit 1
fi

"$vscode_cli" --uninstall-extension vbenevides.cma-codex-multi-account >/dev/null 2>&1 || true
"$vscode_cli" --install-extension "$repo_dir/$vsix" --force
