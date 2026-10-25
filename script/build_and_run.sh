#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname -s)" = Darwin ] || { echo 'The Mac app requires macOS with Xcode command line tools.' >&2; exit 1; }
arch="$(uname -m)"
mode=debug
launch=true
verify=false
logs=false
debugger=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --arch) arch="$2"; shift ;;
    --release) mode=release ;;
    --build-only) launch=false ;;
    --verify) verify=true ;;
    --logs) logs=true ;;
    --debug) debugger=true ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
case "$arch" in arm64) architecture=x1 ;; x86_64) architecture=x6 ;; *) echo 'Use arm64 or x86_64.' >&2; exit 1 ;; esac
export RELEASE_DISTRIBUTION=MC RELEASE_ARCHITECTURE="$architecture"
if [ "${RELEASE_PREPARED:-false}" != true ]; then node scripts/prepare-release.mjs; fi
node --input-type=module <<'JS'
import fs from 'node:fs';
import { validateReleaseId } from './scripts/release-id.mjs';
const r=JSON.parse(fs.readFileSync('public/release.json'));
if (!validateReleaseId(r.id,r.version) || r.distribution !== 'MC' || r.architecture !== process.env.RELEASE_ARCHITECTURE) throw new Error('Mac release identity does not match this build.');
JS
if [ "$launch" = true ]; then pkill -x EstateInventory 2>/dev/null || true; fi
swift build --package-path native/macos -c "$mode" --arch "$arch"
bin="$(swift build --package-path native/macos -c "$mode" --arch "$arch" --show-bin-path)"
app="dist/macos/$arch/Estate Inventory.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin/EstateInventory" "$app/Contents/MacOS/EstateInventory"
cp public/release.json "$app/Contents/Resources/release.json"
export MAC_BUNDLE_PATH="$app"
python3 <<'PY'
import json, os, plistlib
from pathlib import Path
from urllib.parse import urlsplit
r=json.loads(Path('public/release.json').read_text())
site=os.environ.get('MAC_APP_URL','https://eiapp3.redbaronworks.com/')
url=urlsplit(site)
local=url.scheme=='http' and url.hostname in ('localhost','127.0.0.1','::1') and r['id'].startswith('ZY')
if (url.scheme!='https' and not local) or not url.hostname or url.username or url.password or url.query or url.fragment:
    raise SystemExit('MAC_APP_URL must use HTTPS. Only development builds may use loopback HTTP.')
bundle='io.github.redbaron13.estate-inventory'  + ('.development' if r['id'].startswith('ZY') else '')
info={'CFBundleExecutable':'EstateInventory','CFBundleIdentifier':bundle,'CFBundleName':'Estate Inventory','CFBundleDisplayName':'Estate Inventory','CFBundlePackageType':'APPL','CFBundleShortVersionString':r['version'],'CFBundleVersion':os.environ.get('GITHUB_RUN_NUMBER','1'),'EstateReleaseID':r['id'],'LSMinimumSystemVersion':'13.0','NSPrincipalClass':'NSApplication','NSHighResolutionCapable':True,'NSCameraUsageDescription':'Photograph estate items and scan their labels.','EstateAppURL':site,'WKAppBoundDomains':[url.hostname], 'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True} if local else {}}
Path(os.environ['MAC_BUNDLE_PATH'],'Contents','Info.plist').write_bytes(plistlib.dumps(info))
PY
# Local and CI previews receive an ad hoc signature. The release workflow
# replaces it with a Developer ID signature before notarization.
codesign --force --sign - --entitlements native/macos/Entitlements.plist "$app"
plutil -lint "$app/Contents/Info.plist"
codesign --verify --deep --strict "$app"
if [ "$launch" = true ]; then
  if [ "$verify" = true ]; then
    output="${MAC_VERIFY_DIR:-$PWD/test-results/macos}"
    mkdir -p "$output"
    rm -f "$output/verification.json" "$output/macos.png"
    /usr/bin/open -n "$app" --args --verify-output "$output"
    for ((i=0;i<75;i++)); do [ -f "$output/verification.json" ] && break; sleep 1; done
    node --input-type=module -e 'import fs from "node:fs";const r=JSON.parse(fs.readFileSync(process.argv[1]));console.log(r.message);if(!r.ok)process.exit(1)' "$output/verification.json"
  else
    /usr/bin/open -n "$app"
  fi
  if [ "$debugger" = true ]; then lldb -n EstateInventory; fi
  if [ "$logs" = true ]; then log stream --predicate 'process == "EstateInventory"' --style compact; fi
fi
