#!/bin/bash
set -e

# This script is intended for development environments (e.g. DevContainer)
# Production installation is handled directly in the Dockerfile.

if [ -f /etc/alpine-release ]; then
    echo "This script is for development (Debian/Ubuntu). For Alpine/Production, use the Dockerfile."
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AMULE_VERSION="3.0.0"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
# sudo apt-get install -y amule-daemon amule-utils
# For now, install from GitHub release to ensure we have the latest version.
sudo bash "${SCRIPT_DIR}/../install-amule-gh-release.sh" "${AMULE_VERSION}"

echo "aMule ${AMULE_VERSION} installation complete."

# -- Configuration Setup --
# Dev uses default home directory for config
CONF_DIR="$HOME/.aMule"
mkdir -p "$CONF_DIR"

if [ ! -f "$CONF_DIR/amule.conf" ]; then
    echo "Generating amule.conf..."
    cat <<EOF > "$CONF_DIR/amule.conf"
[eMule]
Nick=Mularr

[ExternalConnect]
AcceptExternalConnections=1
ECAddress=127.0.0.1
ECPort=4712
ECPassword=5ebe2294ecd0e0f08eab7690d2a6ee69
EOF
fi

echo "Configuration complete. aMule is ready for development."
