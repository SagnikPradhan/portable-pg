#!/bin/bash
# Turns the built tarballs into a release: stamps the version, records each tarball's checksum for
# the Node package, packs it, and writes a manifest per platform and SHA256SUMS beside them.
# usage: scripts/release.sh <version> <directory holding the tarballs>
set -euo pipefail

VERSION=${1:?usage: scripts/release.sh <version> <directory>}
ASSETS=$(realpath "${2:?usage: scripts/release.sh <version> <directory>}")

cd "$(dirname "$0")/.."

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
	local arch
	for arch in x64 arm64; do
		tarball "$arch" >/dev/null
	done
}

checksums() {
	local arch
	printf '{\n'
	for arch in x64 arm64; do
		printf '\t"linux-%s": "%s"' "$arch" "$(sha256sum <"$(tarball "$arch")" | cut -d' ' -f1)"
		[[ $arch == x64 ]] && printf ','
		printf '\n'
	done
	printf '}\n'
}

manifests() {
	local arch
	for arch in x64 arm64; do
		tar -xzOf "$(tarball "$arch")" "portable-pg-$VERSION-linux-$arch/manifest.json" \
			>"$ASSETS/portable-pg-$VERSION-linux-$arch.manifest.json"
	done
}

tarball() {
	local file="$ASSETS/portable-pg-$VERSION-linux-$1.tar.gz"
	[[ -f $file ]] || { echo "missing $file" >&2; exit 1; }
	echo "$file"
}

main
