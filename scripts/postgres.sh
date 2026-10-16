#!/bin/bash
# Builds the binaries into vendor/postgres/linux-<arch> and packs them as a release tarball.
# usage: scripts/postgres.sh [x64|arm64] [extra docker buildx flags...]
# VERSION overrides the version from package.json, as a release does from its tag.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/postgres/versions.env
source scripts/postgres/versions.env

ARCH=${1:-$(node -p process.arch)}
VERSION=${VERSION:-$(node -p "require('./package.json').version")}
SOURCE=$(git rev-parse --verify -q HEAD || echo unknown)

NAME=portable-pg-$VERSION-linux-$ARCH
OUT=vendor/postgres/linux-$ARCH

[[ $ARCH == x64 || $ARCH == arm64 ]] || { echo "unsupported architecture: $ARCH" >&2; exit 1; }

rm -rf "$OUT"
# --output type=local: https://docs.docker.com/build/exporters/local-tar/
docker buildx build scripts/postgres \
	--platform "linux/${ARCH/x64/amd64}" \
	--build-arg VERSION="$VERSION" \
	--build-arg ARCH="$ARCH" \
	--build-arg SOURCE="$SOURCE" \
	--build-arg POSTGRES_TAG="$POSTGRES_TAG" \
	--build-arg POSTGRES_COMMIT="$POSTGRES_COMMIT" \
	--build-arg PGVECTOR_TAG="$PGVECTOR_TAG" \
	--build-arg PGVECTOR_COMMIT="$PGVECTOR_COMMIT" \
	--output "type=local,dest=$OUT" \
	"${@:2}"
chmod 755 "$OUT"

# --transform: https://www.gnu.org/software/tar/manual/html_node/transform.html
tar -C vendor/postgres -czf "vendor/postgres/$NAME.tar.gz" --transform "s|^linux-$ARCH|$NAME|" "linux-$ARCH"
echo "vendor/postgres/$NAME.tar.gz"
