#!/bin/sh
set -e

# Define generic password hash for 'secret' if not provided?
# For simplicity we hardcode the hash for 'secret' to match defaults.
# MD5("secret") = 5ebe2294ecd0e0f08eab7690d2a6ee69

CONF_DIR="${AMULE_CONFIG_DIR:-$HOME/.aMule}"

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
amuled -c "$CONF_DIR" -f

echo "Starting Mularr backend..."
exec "$@"
