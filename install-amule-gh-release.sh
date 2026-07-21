#!/bin/bash
# Installs aMule from the official GitHub release AppImage.
# Works in both Docker (no FUSE) and devcontainer environments.
# Usage: install-amule-gh-release.sh [version]  (default: 3.0.0)
set -e

AMULE_VERSION="${1:-3.0.0}"

# Select the release asset for the build platform. Under a buildx
# cross-build (docker/setup-qemu-action), uname -m reports the *target*
# architecture, so this also works when cross-building linux/arm64 from
# an amd64 runner.
case "$(uname -m)" in
    x86_64)  AMULE_ARCH="x64" ;;
    aarch64) AMULE_ARCH="arm64" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

APPIMAGE_URL="https://github.com/amule-org/amule/releases/download/${AMULE_VERSION}/aMule-${AMULE_VERSION}-Linux-${AMULE_ARCH}.AppImage"
APPIMAGE_PATH="/tmp/aMule-${AMULE_VERSION}-Linux-${AMULE_ARCH}.AppImage"
INSTALL_DIR="/opt/amule"

echo "Installing aMule ${AMULE_VERSION} (${AMULE_ARCH})..."

# Install some libraries needed by amuled and amulecmd and this script. 
# wget is needed to download the AppImage, and will be removed at the end.
# libreadline8 needed by amulecmd.
# ca-certificates needed by amuled for HTTPS download like serverlist updates.
apt-get install -y --no-install-recommends libreadline8 ca-certificates wget

# Download AppImage
wget -q --show-progress -O "${APPIMAGE_PATH}" "${APPIMAGE_URL}"
chmod +x "${APPIMAGE_PATH}"

# AppImages set magic bytes "AI\x02" at ELF header offset 8. Native kernels
# ignore them, but they break binfmt_misc matching under QEMU (buildx
# cross-builds fail with "cannot execute binary file: Exec format error").
# Zero them before executing — the runtime doesn't need them, and this is a
# no-op for correctness on native builds too.
dd if=/dev/zero of="${APPIMAGE_PATH}" bs=1 seek=8 count=3 conv=notrunc status=none

# Extract without FUSE
cd /tmp && "${APPIMAGE_PATH}" --appimage-extract > /dev/null
rm -rf "${INSTALL_DIR}"
mv /tmp/squashfs-root "${INSTALL_DIR}"
rm "${APPIMAGE_PATH}"

# Symlink binaries. Fail hard if a binary is missing — a silent skip would
# produce an image without amuled (e.g. if an arch variant of the AppImage
# ever ships a different internal layout).
for bin in amuled amulecmd; do
    if [ -f "${INSTALL_DIR}/usr/bin/${bin}" ]; then
        ln -sf "${INSTALL_DIR}/usr/bin/${bin}" "/usr/local/bin/${bin}"
    else
        echo "ERROR: ${bin} not found at ${INSTALL_DIR}/usr/bin/${bin}" >&2
        exit 1
    fi
done

# Remove unnecessary files from the extracted AppImage to reduce image size
rm -rf \
    "${INSTALL_DIR}/usr/share/doc" \
    "${INSTALL_DIR}/usr/share/man" \
    "${INSTALL_DIR}/usr/share/locale" \
    "${INSTALL_DIR}/usr/share/icons" \
    "${INSTALL_DIR}/usr/share/applications" \
    "${INSTALL_DIR}/usr/share/pixmaps" \
    "${INSTALL_DIR}"/*.desktop \
    "${INSTALL_DIR}"/.DirIcon

# Remove GUI-only binaries (only amuled and amulecmd are needed in headless mode)
rm -f \
    "${INSTALL_DIR}/usr/bin/amule" \
    "${INSTALL_DIR}/usr/bin/amulegui" \
    "${INSTALL_DIR}/usr/bin/amuleweb" \
    "${INSTALL_DIR}/usr/bin/wxcas" \
    "${INSTALL_DIR}/usr/bin/alc" \
    "${INSTALL_DIR}/usr/bin/alcc" \
    "${INSTALL_DIR}/usr/bin/cas"

# Remove GUI-only libraries not needed by amuled/amulecmd
rm -f \
    "${INSTALL_DIR}/usr/lib/libgtk-3.so"* \
    "${INSTALL_DIR}/usr/lib/libgdk-3.so"* \
    "${INSTALL_DIR}/usr/lib/librsvg-2.so"* \
    "${INSTALL_DIR}/usr/lib/libicudata.so"* \
    "${INSTALL_DIR}/usr/lib/libicuuc.so"* \
    "${INSTALL_DIR}/usr/lib/libepoxy.so"* \
    "${INSTALL_DIR}/usr/lib/libcairo.so"* \
    "${INSTALL_DIR}/usr/lib/libcairo-gobject.so"* \
    "${INSTALL_DIR}/usr/lib/libpango"* \
    "${INSTALL_DIR}/usr/lib/libatk"* \
    "${INSTALL_DIR}/usr/lib/libatspi.so"* \
    "${INSTALL_DIR}/usr/lib/libgdk_pixbuf"* \
    "${INSTALL_DIR}/usr/lib/libX"* \
    "${INSTALL_DIR}/usr/lib/libwayland"* \
    "${INSTALL_DIR}/usr/lib/libxkbcommon.so"* \
    "${INSTALL_DIR}/usr/lib/libxcb"* \
    "${INSTALL_DIR}/usr/lib/libayatana"* \
    "${INSTALL_DIR}/usr/lib/libdbusmenu"* \
    "${INSTALL_DIR}/usr/lib/libcolord.so"* \
    "${INSTALL_DIR}/usr/lib/libcups.so"* \
    "${INSTALL_DIR}/usr/lib/libgd.so"* \
    "${INSTALL_DIR}/usr/lib/libwebp.so"* \
    "${INSTALL_DIR}/usr/lib/libtiff.so"* \
    "${INSTALL_DIR}/usr/lib/libjpeg.so"* \
    "${INSTALL_DIR}/usr/lib/libpng16.so"* \
    "${INSTALL_DIR}/usr/lib/libgraphite2.so"*
rm -rf "${INSTALL_DIR}/usr/lib/girepository-1.0"

# Remove wget; it was only needed for the download
apt-get purge -y --auto-remove wget

echo "aMule ${AMULE_VERSION} installed."
