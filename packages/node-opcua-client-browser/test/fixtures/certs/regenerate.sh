#!/usr/bin/env bash
# Regenerate development-only test certificates.
# ⚠️ These are committed to the repo and are for tests ONLY.
# Do NOT use them in production or accept them from any real server.

set -euo pipefail
cd "$(dirname "$0")"

# Bridge TLS cert (for wss://127.0.0.1 → opc.tcp://… tunnel)
openssl req -x509 -newkey rsa:2048 \
  -keyout bridge.key.pem -out bridge.crt.pem \
  -days 3650 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# OPC UA application certificate (Basic256Sha256 test)
# Has the ApplicationURI embedded in the SAN URI entry, which OPC UA
# servers validate at CreateSession time.
openssl req -x509 -newkey rsa:2048 \
  -keyout app.key.pem -out app.cert.pem \
  -days 3650 -nodes \
  -config client.openssl.cnf

echo "Regenerated:"
ls -la bridge.* app.*
