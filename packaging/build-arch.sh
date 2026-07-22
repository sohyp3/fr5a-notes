#!/usr/bin/env bash
# Build a local Arch package (.pkg.tar.zst) from the built AppImage, for
# installing/testing on this machine. Reuses packaging/aur/PKGBUILD (the one
# published to the AUR) but points its source at the local dist AppImage instead
# of the GitHub release, so no download/release is needed.
#
# Usage:  bun run dist:arch     (builds the AppImage first, then this)
# Output: build/aur/<pkgname>-<ver>-x86_64.pkg.tar.zst
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ver="$(node -p "require('$root/package.json').version")"
appimage="$root/dist/fr5a-${ver}.AppImage"
out="$root/build/aur"

if [[ ! -f "$appimage" ]]; then
	echo "error: $appimage not found. Run 'bun run dist:linux' first." >&2
	exit 1
fi

rm -rf "$out"
mkdir -p "$out"

# Reuse the maintained PKGBUILD, but swap the remote source for the local file.
sed -E \
	-e 's|^source=\(.*\)|source=("fr5a-'"${ver}"'.AppImage")|' \
	-e "s|^sha256sums=\(.*|sha256sums=('SKIP')|" \
	"$root/packaging/aur/PKGBUILD" > "$out/PKGBUILD"

ln -sf "$appimage" "$out/fr5a-${ver}.AppImage"

( cd "$out" && makepkg -f --noconfirm )

echo
echo "Built: $(ls "$out"/*.pkg.tar.zst)"
echo "Install with:  sudo pacman -U $(ls "$out"/*.pkg.tar.zst)"
