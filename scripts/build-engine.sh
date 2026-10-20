#!/bin/sh
# Packs the analysis engine into one self-contained executable (Node single executable app)
# that the Mac app launches as a sidecar.
set -e
cd "$(dirname "$0")/.."
OUT=build/engine
TRIPLE=$(rustc -vV | sed -n 's/host: //p')
mkdir -p "$OUT" src-tauri/binaries

npx esbuild server/index.ts --bundle --platform=node --format=cjs --target=node22 --outfile="$OUT/engine.cjs" --log-level=warning

cat > "$OUT/sea-config.json" <<JSON
{ "main": "$OUT/engine.cjs", "output": "$OUT/engine.blob", "disableExperimentalSEAWarning": true }
JSON
node --experimental-sea-config "$OUT/sea-config.json"

BIN="src-tauri/binaries/assay-engine-$TRIPLE"
cp "$(command -v node)" "$BIN"
chmod u+w "$BIN"
codesign --remove-signature "$BIN"
npx --yes postject "$BIN" NODE_SEA_BLOB "$OUT/engine.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA
codesign --sign - "$BIN"
echo "Engine built at $BIN"
