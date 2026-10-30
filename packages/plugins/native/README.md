# Windows staged reader

The Windows reader opens the final path component with `CreateFileW` and
`FILE_FLAG_OPEN_REPARSE_POINT`, refuses reparse points, directories and non-disk
handles, then reads from that same handle on a Node-API async worker. The parent
directory remains trusted, and regular-file contents may change through another
handle. This is not filesystem confinement or a snapshot. The Windows reader
caps input at 512 MiB and returns no bytes on failure; the POSIX reader retains
its existing behavior. Missing paths retain `ENOENT`.

`scripts/build-staged-reader.sh` builds x64 and arm64 modules on Linux from
Zig 0.14.1 and Node 24.22.1 headers and import libraries, checking each pinned
SHA-256 before use. It records the source commit and output hashes in
`build-provenance.txt`. There is no runtime download or installation hook.
The release workflow builds the modules before packing them; the package
includes only the production modules and provenance, while the repository root
build copies available production modules beside the compiled reader. Missing,
invalid, or unsupported binaries fail closed.

The Windows qualification workflow builds the same sources and exercises both
architectures with Node and Bun, including size limits and concurrent pathname
replacement. It also checks the source and compiled reader layouts. A successful
cross-compile alone does not establish Windows compatibility; in particular,
Bun's Windows loader must be tested with the Node import library.
