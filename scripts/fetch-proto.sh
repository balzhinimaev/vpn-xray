#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="$ROOT/proto"
mkdir -p "$DST/app/proxyman/command" \
"$DST/app/stats/command" \
"$DST/common/serial" \
"$DST/common/protocol" \
"$DST/proxy/vless"


base="https://raw.githubusercontent.com/XTLS/Xray-core/main"


curl -fsSL "$base/app/proxyman/command/command.proto" -o "$DST/app/proxyman/command/command.proto"
curl -fsSL "$base/app/stats/command/command.proto" -o "$DST/app/stats/command/command.proto"
curl -fsSL "$base/common/serial/typed_message.proto" -o "$DST/common/serial/typed_message.proto"
curl -fsSL "$base/common/protocol/user.proto" -o "$DST/common/protocol/user.proto"
# VLESS account
curl -fsSL "$base/proxy/vless/account.proto" -o "$DST/proxy/vless/account.proto"
# На всякий случай — некоторые версии импортируют encryption.proto
if curl -fsSLI "$base/proxy/vless/encryption.proto" >/dev/null 2>&1; then
curl -fsSL "$base/proxy/vless/encryption.proto" -o "$DST/proxy/vless/encryption.proto"
fi


echo "[proto] Fetched to $DST"