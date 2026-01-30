#!/bin/bash
set -e

# Detect OS
if [ -f /etc/alpine-release ]; then
    OS="alpine"
elif [ -f /etc/debian_version ]; then
    OS="debian"
else
    echo "Unsupported OS"
    exit 1
fi

echo "Installing aMule on $OS..."

if [ "$OS" = "alpine" ]; then
    # Alpine installation (used in Stage 3 of Dockerfile)
    apk add --no-cache amule --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing
    apk add --no-cache bash # Ensure bash is available for scripts
elif [ "$OS" = "debian" ]; then
    # Debian installation (used in DevContainer/Ubuntu-based)
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update
    sudo apt-get install -y amule-daemon amule-utils
fi

echo "aMule installation complete."

# -- Configuration Setup --
CONF_DIR="$HOME/.aMule"
mkdir -p "$CONF_DIR"

if [ ! -f "$CONF_DIR/amule.conf" ]; then
    echo "Generating initial amule.conf..."
    # Run amuled briefly to generate default config if it doesn't exist
    timeout 2s amuled || true
fi

echo "Configuring amule.conf for external connections..."
# Enable External Connections (EC)
sed -i 's/^AcceptExternalConnections=0/AcceptExternalConnections=1/' "$CONF_DIR/amule.conf"
# Set EC Address (local only for security by default within container)
sed -i 's/^ECAddress=.*/ECAddress=127.0.0.1/' "$CONF_DIR/amule.conf"
# Set Password to 'secret' (MD5: 5ebe2294ecd0e0f08eab7690d2a6ee69)
sed -i 's/^ECPassword=.*/ECPassword=5ebe2294ecd0e0f08eab7690d2a6ee69/' "$CONF_DIR/amule.conf"
# Set Nickname
sed -i 's/^Nick=.*/Nick=Mularr/' "$CONF_DIR/amule.conf"

echo "Configuration complete. aMule is ready to be started."
