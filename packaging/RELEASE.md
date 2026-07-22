# Releasing fr5a

Distribution channels: **GitHub Releases** (AppImage + .deb), **AUR** (`fr5a-bin`).
npm is intentionally not used — see the note at the bottom.

## 1. Build the Linux artifacts

```sh
bun run dist:linux
```

Produces in `dist/`:

- `fr5a-<version>.AppImage` — portable, runs on any distro
- `fr5a-notes_<version>_amd64.deb` — Debian/Ubuntu

> On Arch, the `.deb` step needs `libxcrypt-compat` installed (provides `libcrypt.so.1` for fpm).

## 2. Publish a GitHub Release

Tag must be `v<version>` (e.g. `v0.0.1`) so the AUR `source=` URL resolves.

```sh
git tag v0.0.1
git push origin v0.0.1

gh release create v0.0.1 \
  dist/fr5a-0.0.1.AppImage \
  dist/fr5a-notes_0.0.1_amd64.deb \
  --title "fr5a 0.0.1" --generate-notes
```

## 3. Publish / update the AUR package (`fr5a-bin`)

The PKGBUILD in `packaging/aur/` installs the published AppImage.

```sh
cd packaging/aur

# 1. bump pkgver to match the release, then pull the real checksum:
updpkgsums                     # rewrites sha256sums from the release URL
makepkg -si                    # local test install
namcap PKGBUILD                # lint (optional)
makepkg --printsrcinfo > .SRCINFO

# 2. push to the AUR (first time: clone ssh://aur@aur.archlinux.org/fr5a-bin.git)
git add PKGBUILD .SRCINFO
git commit -m "upgpkg: 0.0.1-1"
git push
```

On every new version: bump `pkgver`, `updpkgsums`, regenerate `.SRCINFO`, commit, push.

## Notes

- **Add a LICENSE file.** The PKGBUILD declares `MIT` but the repo has none. Pick a
  license, add `LICENSE`, and set `"license": "MIT"` in `package.json`.
- **Windows/macOS** builds cannot be produced from Linux (native `better-sqlite3`).
  Use the GitHub Actions workflow (`.github/workflows/build.yml`) — native runners.
- **Why not npm `-g`:** this is a ~150 MB Electron GUI app with a native module that
  would need recompiling on each user's machine, and npm gives no desktop integration.
  AppImage / .deb / AUR are the right channels.
