#!/bin/sh
set -e

CONF_DIR="${AMULE_CONFIG_DIR:-$HOME/.aMule}"
INCOMING_DIR="${AMULE_INCOMING_DIR:-$CONF_DIR/Incoming}"
TEMP_DIR="${AMULE_TEMP_DIR:-$CONF_DIR/Temp}"
EC_PASSWORD="${AMULE_PASSWORD:-secret}"
EC_PASSWORD_HASH="$(printf '%s' "$EC_PASSWORD" | node -e "const crypto = require('crypto'); const chunks = []; process.stdin.on('data', (chunk) => chunks.push(chunk)); process.stdin.on('end', () => process.stdout.write(crypto.createHash('md5').update(Buffer.concat(chunks)).digest('hex')));")"

sync_ec_password() {
    conf_path="$1"
    temp_path="${conf_path}.tmp"

    cp -p "$conf_path" "$temp_path"
    awk -v password_hash="$EC_PASSWORD_HASH" '
        BEGIN {
            in_external_connect = 0
            password_written = 0
        }
        /^\[/ {
            if (in_external_connect && !password_written) {
                print "ECPassword=" password_hash
                password_written = 1
            }
            in_external_connect = ($0 == "[ExternalConnect]")
        }
        in_external_connect && /^ECPassword=/ {
            if (!password_written) {
                print "ECPassword=" password_hash
                password_written = 1
            }
            next
        }
        {
            print
        }
        END {
            if (in_external_connect && !password_written) {
                print "ECPassword=" password_hash
            } else if (!password_written) {
                print ""
                print "[ExternalConnect]"
                print "ECPassword=" password_hash
            }
        }
    ' "$conf_path" > "$temp_path"

    mv "$temp_path" "$conf_path"
}

mkdir -p "$CONF_DIR"
mkdir -p "$INCOMING_DIR"
mkdir -p "$TEMP_DIR"

if [ ! -f "$CONF_DIR/amule.conf" ]; then
    echo "Generating amule.conf..."
    cat <<EOF > "$CONF_DIR/amule.conf"
[eMule]
Nick=Mularr
IncomingDir=$INCOMING_DIR
TempDir=$TEMP_DIR

[ExternalConnect]
AcceptExternalConnections=1
ECAddress=127.0.0.1
ECPort=4712
ECPassword=$EC_PASSWORD_HASH
EOF
else
    sync_ec_password "$CONF_DIR/amule.conf"

    # Update directories if env vars are provided and file exists
    if [ -n "$AMULE_INCOMING_DIR" ]; then
        sed -i "s|^IncomingDir=.*|IncomingDir=$AMULE_INCOMING_DIR|" "$CONF_DIR/amule.conf"
    fi
    if [ -n "$AMULE_TEMP_DIR" ]; then
        sed -i "s|^TempDir=.*|TempDir=$AMULE_TEMP_DIR|" "$CONF_DIR/amule.conf"
    fi
fi

echo "Starting Mularr backend..."
exec "$@"
