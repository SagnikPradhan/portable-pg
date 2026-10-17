#!/bin/bash
# Builds the macOS binaries natively into $OUT, then points them at each other through @rpath.
# usage: scripts/postgres/darwin.sh, run by scripts/postgres.sh on a Mac. It takes no flags.
set -euo pipefail

: "${PLATFORM:?}" "${OUT:?}"

# The oldest macOS the binaries run on, which clang reads from the environment. See ENVIRONMENT in
# https://clang.llvm.org/docs/CommandGuide/clang.html
export MACOSX_DEPLOYMENT_TARGET=26.0
export FLOOR_NAME=macos FLOOR_VERSION=$MACOSX_DEPLOYMENT_TARGET

# Postgres installs extensions straight into lib/ only when the prefix names postgres, as the Linux
# build's /opt/postgres does. See pkglibdir in src/Makefile.global.in.
BUILD=$(mktemp -d)
export PREFIX=$BUILD/postgres
trap 'rm -rf "$BUILD"' EXIT

main() {
	[[ $# -eq 0 ]] || {
		echo "the macOS build takes no flags, got: $*" >&2
		exit 1
	}
	[[ $PLATFORM == "darwin-$(uname -m)" ]] || {
		echo "a Mac builds only its own architecture, not $PLATFORM" >&2
		exit 1
	}

	scripts/postgres/build.sh compile
	relocate
	scripts/postgres/build.sh describe
	mv "$PREFIX" "$OUT"
}

# Postgres records each of its own libraries by absolute path, in the library and in everything that
# loads it. @rpath/<name> makes the loader search the run path every binary carries instead.
# Editing a binary breaks its signature, and Apple silicon runs no unsigned code, so each is signed
# again, ad hoc.
relocate() {
	local file
	machos | while IFS= read -r file; do
		rename_self "$file"
		rename_dependencies "$file"
		codesign --force --sign - "$file" 2>/dev/null
	done
}

machos() {
	find "$PREFIX/bin" "$PREFIX/lib" -type f -exec file {} + | sed -n 's/: *Mach-O .*//p'
}

# otool -D prints a library's own install name on its second line, and nothing for programs.
rename_self() {
	local id
	id=$(otool -D "$1" | sed -n 2p)
	if [[ $id == "$PREFIX"/* ]]; then
		install_name_tool -id "@rpath/${id##*/}" "$1" 2>/dev/null
	fi
}

# otool -L prints every library a file loads, one per line after the first, as
# `<path> (compatibility version ...)`.
rename_dependencies() {
	local library
	otool -L "$1" | sed -n '2,$ s/^[[:space:]]*\(.*\) (compatibility.*/\1/p' | while IFS= read -r library; do
		if [[ $library == "$PREFIX"/* ]]; then
			install_name_tool -change "$library" "@rpath/${library##*/}" "$1" 2>/dev/null
		fi
	done
}

main "$@"
