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

APPIMAGE_URL="https://github.com/amule-project/amule/releases/download/${AMULE_VERSION}/aMule-${AMULE_VERSION}-Linux-${AMULE_ARCH}.AppImage"
APPIMAGE_PATH="/tmp/aMule-${AMULE_VERSION}-Linux-${AMULE_ARCH}.AppImage"
INSTALL_DIR="/opt/amule"

echo "Installing aMule ${AMULE_VERSION} (${AMULE_ARCH})..."

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

echo "aMule ${AMULE_VERSION} installed."
