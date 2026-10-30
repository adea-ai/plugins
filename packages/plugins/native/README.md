# Staged reader prototype (draft)

The Windows candidate opens the final path component with `CreateFileW` and
`FILE_FLAG_OPEN_REPARSE_POINT`, refuses reparse points, directories and non-disk
handles, then reads from that same handle on a Node-API async worker. The parent
directory remains trusted, and regular-file contents may change through another
handle. It does not confine directory traversal or provide a snapshot. The native
reader caps input at 512 MiB and returns no bytes on failure. Missing paths retain
`ENOENT`. The POSIX reader is unchanged and has no equivalent size cap yet.

This is not a release-ready native distribution. The Windows loader fails closed
if its architecture-specific binary is absent or cannot load. No binary is
committed and no install hook downloads or compiles code. A release must provide
`staged-reader-win32-x64.node` and `staged-reader-win32-arm64.node` in this
folder for both source and compiled layouts. The build must pin the Node-API
headers and toolchain, record source revision, dependencies and artifact hashes,
and verify that the published package contains the exact qualified artifacts.
Qualify Node 24 and Bun 1.4 on each architecture, including Windows races,
reparse tags, failed reads, large files, Unicode paths and loader failures.
The Node import library and Bun's Windows addon loader compatibility need
explicit verification; a successful cross-compile alone establishes neither.

For a local Linux test of the shared async worker and allocation/error paths,
with Node 24 headers installed, compile with a reduced limit:

```sh
cc -std=c11 -D_GNU_SOURCE -DSTAGED_MAX_BYTES=131072 -shared -fPIC \
  -Wall -Wextra -Werror -I "$NODE_HEADERS" staged-reader.c -o /tmp/staged-reader.node
node ../test-support/native-reader-check.mjs /tmp/staged-reader.node
bun ../test-support/native-reader-check.mjs /tmp/staged-reader.node
```

The POSIX build is a test harness, not the production POSIX path. It cannot
qualify the Windows handle implementation.
