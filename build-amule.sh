#!/bin/bash
set -euo pipefail

# Install build dependencies
apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    bash \
    git \
    autoconf \
    automake \
    libtool \
    gettext \
    autopoint \
    libwxgtk3.2-dev \
    libcrypto++-dev \
    libupnp-dev \
    zlib1g-dev \
    libpng-dev \
    libreadline-dev \
    binutils \
    ca-certificates

# Clone, configure and build
# We compile from source to avoid the SegFault from the official Debian/Alpine packages
# Flags: headless daemon only, no GUI, no NLS, no UPnP, optimized
git clone --depth 1 https://github.com/amule-project/amule.git /tmp/amule
cd /tmp/amule
./autogen.sh
./configure \
    --disable-gui \
    --disable-amule-gui \
    --disable-nls \
    --enable-amule-daemon \
    --enable-amulecmd \
    --enable-webserver \
    --disable-monolithic \
    --disable-cas \
    --disable-alcc \
    --disable-upnp \
    --disable-debug \
    --enable-optimize
make -j$(nproc)
make install

# Clean up build artifacts and build-only deps
cd /
rm -rf /tmp/amule
apt-get purge -y git autoconf automake libtool gettext autopoint
apt-get autoremove -y
rm -rf /var/lib/apt/lists/*
