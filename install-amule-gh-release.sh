#!/bin/bash
# Installs aMule from the official GitHub release AppImage.
# Works in both Docker (no FUSE) and devcontainer environments.
# Usage: install-amule-gh-release.sh [version]  (default: 3.0.0)
set -e

AMULE_VERSION="${1:-3.0.0}"
APPIMAGE_URL="https://github.com/amule-project/amule/releases/download/${AMULE_VERSION}/aMule-${AMULE_VERSION}-Linux-x64.AppImage"
APPIMAGE_PATH="/tmp/aMule-${AMULE_VERSION}-Linux-x64.AppImage"
INSTALL_DIR="/opt/amule"

echo "Installing aMule ${AMULE_VERSION}..."

# Ensure wget is available
apt-get install -y --no-install-recommends wget

# Download AppImage
wget -q --show-progress -O "${APPIMAGE_PATH}" "${APPIMAGE_URL}"
chmod +x "${APPIMAGE_PATH}"

# Extract without FUSE
cd /tmp && "${APPIMAGE_PATH}" --appimage-extract > /dev/null
rm -rf "${INSTALL_DIR}"
mv /tmp/squashfs-root "${INSTALL_DIR}"
rm "${APPIMAGE_PATH}"

# Symlink binaries
for bin in amuled amulecmd; do
    if [ -f "${INSTALL_DIR}/usr/bin/${bin}" ]; then
        ln -sf "${INSTALL_DIR}/usr/bin/${bin}" "/usr/local/bin/${bin}"
    fi
done

echo "aMule ${AMULE_VERSION} installed."
