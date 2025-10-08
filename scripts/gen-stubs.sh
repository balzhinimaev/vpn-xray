#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROTO_DIR="$ROOT/proto"
OUT_DIR="$ROOT/src/generated"
mkdir -p "$OUT_DIR"


./node_modules/.bin/grpc_tools_node_protoc \
--js_out=import_style=commonjs,binary:"$OUT_DIR" \
--grpc_out=grpc_js:"$OUT_DIR" \
--proto_path="$PROTO_DIR" \
$(find "$PROTO_DIR" -name '*.proto' -print)


./node_modules/.bin/grpc_tools_node_protoc_ts \
--ts_out=grpc_js:"$OUT_DIR" \
--proto_path="$PROTO_DIR" \
$(find "$PROTO_DIR" -name '*.proto' -print)


echo "[proto] Generated JS/TS stubs into $OUT_DIR"