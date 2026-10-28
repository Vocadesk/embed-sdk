#!/usr/bin/env bash
# Publish dist/vocadesk.min.js (+ .map) to the gh-pages branch under embed/<dir>/.
# GitHub Pages serves that branch at cdn.vocadesk.com. Used by cloudbuild.yaml (staging) and
# cloudbuild-release.yaml (versioned releases).
#   usage: publish-gh-pages.sh <embed subdir, e.g. v0.staging or v1.2.3> <commit message> [index-html-file]
# Needs GH_TOKEN (fine-grained token, Contents: read/write on Vocadesk/embed-sdk).
set -euo pipefail
SUBDIR="$1"; MESSAGE="$2"; INDEX="${3:-}"
REPO_URL="${REPO_URL:-https://github.com/Vocadesk/embed-sdk.git}"  # override only for local tests
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
DIR="$(mktemp -d)"
if git -c http.extraheader="$AUTH" clone -q --depth 1 --branch gh-pages "$REPO_URL" "$DIR" 2>/dev/null; then
  echo "updating existing gh-pages"
else
  echo "creating gh-pages"
  git -C "$DIR" init -q -b gh-pages
  git -C "$DIR" remote add origin "$REPO_URL"
fi
# Custom domain pin (Pages custom domain is cdn.vocadesk.com).
echo "cdn.vocadesk.com" > "$DIR/CNAME"
TARGET="$DIR/embed/$SUBDIR"
mkdir -p "$TARGET"
cp dist/vocadesk.min.js     "$TARGET/vocadesk.min.js"
cp dist/vocadesk.min.js.map "$TARGET/vocadesk.min.js.map"
[ -n "$INDEX" ] && cp "$INDEX" "$DIR/index.html"
cd "$DIR"
git config user.name  "Cloud Build"
git config user.email "cloudbuild@users.noreply.github.com"
git add -A
git commit -q -m "$MESSAGE" || { echo "nothing to commit"; exit 0; }
git -c http.extraheader="$AUTH" push -q origin gh-pages
echo "published embed/$SUBDIR"
