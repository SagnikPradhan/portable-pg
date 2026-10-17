#!/bin/bash
# Builds the Linux binaries in Docker, on AlmaLinux 9 for its old glibc, into $OUT.
# usage: scripts/postgres/linux.sh [extra docker buildx flags...], run by scripts/postgres.sh
set -euo pipefail

: "${PLATFORM:?}" "${OUT:?}" "${VERSION:?}" "${SOURCE:?}"
ARCH=${PLATFORM#linux-}

# --output type=local: https://docs.docker.com/build/exporters/local-tar/
docker buildx build scripts/postgres \
	--platform "linux/${ARCH/x64/amd64}" \
	--build-arg VERSION="$VERSION" \
	--build-arg PLATFORM="$PLATFORM" \
	--build-arg SOURCE="$SOURCE" \
	--build-arg POSTGRES_TAG="$POSTGRES_TAG" \
	--build-arg POSTGRES_COMMIT="$POSTGRES_COMMIT" \
	--build-arg PGVECTOR_TAG="$PGVECTOR_TAG" \
	--build-arg PGVECTOR_COMMIT="$PGVECTOR_COMMIT" \
	--output "type=local,dest=$OUT" \
	"$@"
