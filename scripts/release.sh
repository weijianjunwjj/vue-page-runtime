#!/bin/bash
set -euo pipefail

read -r -p "Version: " ver

if ! npm whoami >/dev/null 2>&1; then
  echo "npm auth is invalid. Run 'npm login' first."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit your feature changes before release."
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v$ver" >/dev/null; then
  echo "Tag v$ver already exists locally. Remove it or use a new version."
  exit 1
fi

current_ver=$(node -p "require('./package.json').version")

if [ "$current_ver" != "$ver" ]; then
  npm version "$ver" --no-git-tag-version
fi

publish_tag="latest"
if [[ "$ver" == *-* ]]; then
  prerelease="${ver#*-}"
  publish_tag="${prerelease%%.*}"
fi

npm run build

git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore: release v$ver"
fi
npm publish --registry https://registry.npmjs.org --tag "$publish_tag"
git tag "v$ver"
git push
git push --tags

echo "Released v$ver with npm tag $publish_tag"
