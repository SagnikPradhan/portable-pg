#!/bin/bash
# Turns the built tarballs into a release: stamps the version, records each tarball's checksum for
# the Node package, packs it, and writes a manifest per platform and SHA256SUMS beside them.
# usage: scripts/release.sh <version> <directory holding the tarballs>
set -euo pipefail

VERSION=${1:?usage: scripts/release.sh <version> <directory>}
ASSETS=$(realpath "${2:?usage: scripts/release.sh <version> <directory>}")

cd "$(dirname "$0")/.."
PLATFORMS=(linux-x64 linux-arm64 darwin-arm64)

main() {
	tarballs
	npm pkg set version="$VERSION" >/dev/null
	checksums >checksums.json
	manifests

	pnpm -s build
	pnpm -s pack --pack-destination "$ASSETS" >/dev/null

	(cd "$ASSETS" && sha256sum -- * >SHA256SUMS)
	ls "$ASSETS"
}

tarballs() {
	local platform
	for platform in "${PLATFORMS[@]}"; do
		tarball "$platform" >/dev/null
	done
}

checksums() {
	local platform
	printf '{\n'
	for platform in "${PLATFORMS[@]}"; do
		printf '\t"%s": "%s"\n' "$platform" "$(sha256sum <"$(tarball "$platform")" | cut -d' ' -f1)"
	done | sed '$!s/$/,/'
	printf '}\n'
}

manifests() {
	local platform
	for platform in "${PLATFORMS[@]}"; do
		tar -xzOf "$(tarball "$platform")" "portable-pg-$VERSION-$platform/manifest.json" \
			>"$ASSETS/portable-pg-$VERSION-$platform.manifest.json"
	done
}

tarball() {
	local file="$ASSETS/portable-pg-$VERSION-$1.tar.gz"
	[[ -f $file ]] || { echo "missing $file" >&2; exit 1; }
	echo "$file"
}

main
