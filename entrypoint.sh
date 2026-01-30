#!/bin/sh
set -e

# Define generic password hash for 'secret' if not provided?
# For simplicity we hardcode the hash for 'secret' to match defaults.
# MD5("secret") = 5ebe2294ecd0e0f08eab7690d2a6ee69

CONF_DIR="/home/node/.aMule"
# If running as root, we might want to run amule as 'node' user?
# But checking process: Dockerfile doesn't switch user.
# Let's try to run everything as node user if we can, or just handle root.
# If HOME is /root, use /root/.aMule

if [ "$(id -u)" = "0" ]; then
    # We are root. Amuled warns about root.
    # Better to run as node user if possible, but we need to ensure permissions.
    # We'll just run it. Amuled usually works as root with a warning.
    CONF_DIR="/root/.aMule"
else
    CONF_DIR="$HOME/.aMule"
fi

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

echo "Starting amule daemon..."
amuled -f

echo "Starting Mularr backend..."
exec "$@"
