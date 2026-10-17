#!/bin/bash
# Builds Postgres, contrib and pgvector into $PREFIX, movable as one directory, then describes it in
# manifest.json. Each platform's script runs it, in two steps so Docker keeps the compile cached.
# usage: build.sh compile|describe
set -euo pipefail

: "${PREFIX:?}" "${POSTGRES_TAG:?}" "${POSTGRES_COMMIT:?}" "${PGVECTOR_TAG:?}" "${PGVECTOR_COMMIT:?}"

# $ORIGIN on Linux and @loader_path on macOS (see `man dyld`) both mean the directory of the binary
# being loaded. $ORIGIN must reach the linker unexpanded: make turns $$ into $ and the shell drops the
# backslash. Apple's strip has no --strip-unneeded; -x is its nearest.
# $ORIGIN: https://man7.org/linux/man-pages/man8/ld.so.8.html
# $$: https://www.gnu.org/software/make/manual/html_node/Reference.html
# shellcheck disable=SC2016
case $(uname) in
Linux) ORIGIN='\$$ORIGIN' STRIP=--strip-unneeded ;;
Darwin) ORIGIN=@loader_path STRIP=-x ;;
esac
JOBS=$(getconf _NPROCESSORS_ONLN)

compile() {
	cd "$(mktemp -d)"
	clone postgres/postgres "$POSTGRES_TAG" "$POSTGRES_COMMIT" postgres
	clone pgvector/pgvector "$PGVECTOR_TAG" "$PGVECTOR_COMMIT" pgvector

	build_postgres
	build_pgvector

	licenses
	slim
}

describe() {
	: "${VERSION:?}" "${PLATFORM:?}" "${REQUIRES:?}" "${SOURCE:?}"
	manifest >"$PREFIX/manifest.json"
}

clone() {
	git -c advice.detachedHead=false clone -q --depth 1 --branch "$2" "https://github.com/$1" "$4"
	local head
	head=$(git -C "$4" rev-parse HEAD)
	[[ $head == "$3" ]] || { echo "$1 $2 is at $head, expected $3" >&2; exit 1; }
}

# The run path lets the binaries find lib/ wherever the directory is moved.
# Options: https://www.postgresql.org/docs/18/install-make.html#CONFIGURE-OPTIONS
build_postgres() {
	(
		cd postgres
		./configure --prefix="$PREFIX" --disable-rpath --without-icu --without-readline --without-zlib \
			LDFLAGS="-Wl,-rpath,$ORIGIN/../lib" >/dev/null
		make -s -j"$JOBS" >/dev/null
		make -s install >/dev/null
		make -s -C contrib -j"$JOBS" install >/dev/null
	)
}

# Without OPTFLAGS, pgvector builds for this CPU only (-march=native).
# See https://github.com/pgvector/pgvector#installation-notes---linux-and-mac
build_pgvector() {
	make -s -C pgvector PG_CONFIG="$PREFIX/bin/pg_config" OPTFLAGS="" -j"$JOBS" install >/dev/null
}

licenses() {
	mkdir -p "$PREFIX/LICENSES"
	cp postgres/COPYRIGHT "$PREFIX/LICENSES/postgresql.txt"
	cp pgvector/LICENSE "$PREFIX/LICENSES/pgvector.txt"
}

manifest() {
	local postgres
	postgres=$("$PREFIX/bin/postgres" --version | awk '{ print $NF }')
	cat <<-EOF
		{
		  "version": "$VERSION",
		  "platform": "$PLATFORM",
		  "requires": "$REQUIRES",
		  "source": "$SOURCE",
		  "postgres": { "version": "$postgres", "tag": "$POSTGRES_TAG", "commit": "$POSTGRES_COMMIT" },
		  "pgvector": { "tag": "$PGVECTOR_TAG", "commit": "$PGVECTOR_COMMIT" },
		  "extensions": {
		$(extensions)
		  }
		}
	EOF
}

extensions() {
	local control
	for control in "$PREFIX"/share/extension/*.control; do
		printf '    "%s": "%s"\n' "$(basename "$control" .control)" \
			"$(sed -n "s/^default_version *= *'\(.*\)'/\1/p" "$control")"
	done | sed '$!s/$/,/'
}

# See https://sourceware.org/binutils/docs/binutils/strip.html
slim() {
	rm -rf "$PREFIX/include" "$PREFIX/lib/pgxs" "$PREFIX/lib/pkgconfig" "$PREFIX"/lib/*.a
	find "$PREFIX/bin" "$PREFIX/lib" -type f \( -perm -u+x -o -name '*.so*' -o -name '*.dylib' \) \
		-exec strip "$STRIP" {} + 2>/dev/null || true
}

case ${1:-} in
compile | describe) "$1" ;;
*) echo "usage: build.sh compile|describe" >&2; exit 1 ;;
esac
