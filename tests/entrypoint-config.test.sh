#!/bin/sh
set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

assert_password_hash() {
    conf_path="$1"
    expected_hash="$2"
    actual_hash="$(sed -n 's/^ECPassword=//p' "$conf_path")"

    if [ "$actual_hash" != "$expected_hash" ]; then
        echo "Expected ECPassword=$expected_hash, got ECPassword=$actual_hash" >&2
        exit 1
    fi
}

default_dir="$TEST_ROOT/default"
(
    unset AMULE_PASSWORD
    AMULE_CONFIG_DIR="$default_dir" "$REPO_DIR/entrypoint.sh" true
)
assert_password_hash "$default_dir/amule.conf" "5ebe2294ecd0e0f08eab7690d2a6ee69"

custom_dir="$TEST_ROOT/custom"
AMULE_CONFIG_DIR="$custom_dir" AMULE_PASSWORD="custom-secret" "$REPO_DIR/entrypoint.sh" true
assert_password_hash "$custom_dir/amule.conf" "ddc33abcbec51fd4de296be5cf1230fe"

persisted_dir="$TEST_ROOT/persisted"
mkdir -p "$persisted_dir"
cat > "$persisted_dir/amule.conf" <<'EOF'
[eMule]
Nick=Mularr

[ExternalConnect]
AcceptExternalConnections=1
ECAddress=127.0.0.1
ECPort=4712
ECPassword=5ebe2294ecd0e0f08eab7690d2a6ee69
EOF
AMULE_CONFIG_DIR="$persisted_dir" AMULE_PASSWORD="rotated-password" "$REPO_DIR/entrypoint.sh" true
assert_password_hash "$persisted_dir/amule.conf" "a43dd3d72b3ec93171c53da0075fefb8"

echo "entrypoint EC password tests passed"
