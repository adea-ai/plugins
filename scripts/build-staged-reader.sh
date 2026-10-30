#!/usr/bin/env bash
# Build both Windows Node-API modules on Linux, with pinned and checked inputs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fetch() {
  local url="$1" file="$2" digest="$3"
  curl --fail --location --silent --show-error --retry 3 "$url" -o "$file"
  printf '%s  %s\n' "$digest" "$file" | sha256sum --check --status
}
fetch https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz "$tmp/zig.tar.xz" 24aeeec8af16c381934a6cd7d95c807a8cb2cf7df9fa40d359aa884195c4716c
fetch https://nodejs.org/dist/v24.22.1/node-v24.22.1-headers.tar.gz "$tmp/headers.tar.gz" 322e0a27db9088093ab8347bdc8c7e0aaa21dc9ed548390bf06b394494c09267
fetch https://nodejs.org/dist/v24.22.1/win-x64/node.lib "$tmp/x64.lib" a0a84aa03917b578d286010b7521837e9ff1136ffb2e4a406c14316c33fd06f7
fetch https://nodejs.org/dist/v24.22.1/win-arm64/node.lib "$tmp/arm64.lib" 2c0c3215d59c09d7c136da4949696dae121a299e9bdfc64cd9130a58610af63d
tar -xJf "$tmp/zig.tar.xz" -C "$tmp"
tar -xzf "$tmp/headers.tar.gz" -C "$tmp"
zig="$tmp/zig-x86_64-linux-0.14.1/zig"
include="$tmp/node-v24.22.1/include/node"
output="$root/packages/plugins/native"
for arch in x64 arm64; do
  target=x86_64-windows-gnu
  if [ "$arch" = arm64 ]; then target=aarch64-windows-gnu; fi
  for flavor in production test; do
    name="staged-reader-win32-$arch.node"
    flags=()
    if [ "$flavor" = test ]; then name="staged-reader-test-win32-$arch.node"; flags=(-DSTAGED_MAX_BYTES=131072); fi
    "$zig" cc -target "$target" -shared -O2 -Wall -Wextra -Werror "${flags[@]}" \
      -I "$include" "$output/staged-reader.c" "$tmp/$arch.lib" -o "$output/$name"
  done
done
(cd "$root" && printf 'source_commit %s\n' "$(git rev-parse HEAD)" && sha256sum packages/plugins/native/staged-reader.c packages/plugins/native/*.node) > "$output/build-provenance.txt"
