# Security and threat boundary

The marketplace is a discovery and metadata service, not an execution service.
The ingestion process never invokes upstream scripts, hooks, MCP servers,
package managers, binaries, or commands.

Controls include:

- strict HTTPS repository URL parsing without credentials, query, or fragment;
- configured GitHub host and protocol allow-list;
- relative path normalization rejecting absolute paths, drive paths, `.` and
  `..` segments, and path escapes;
- duplicate-key JSON rejection so last-key-wins ambiguity cannot hide metadata;
- Git tree symlink detection and no-follow filesystem fixture traversal;
- file count, individual file, and total plugin size limits;
- immutable source commits and SHA-derived release identities;
- deterministic content digests over sorted paths and bytes;
- capability classification for hooks, MCP, connectors, browser controls,
  schedules, executables, and unknown content;
- explicit permission-sensitive changes in every report;
- atomic last-known-good artifact replacement.

## Mirrored brand marks

A product's brand mark is mirrored into the catalog release, because
marketplaces declare no icon field and consumers would otherwise have to fetch
vendor repositories directly. Mirroring is the only path by which upstream bytes
are republished, and it is constrained:

- the mark is a file that already exists in the plugin's own content, resolved
  by a documented rule over the release file index; when the content has no mark
  and the plugin declares a vendor homepage, the site's own icon is used, which
  is the one fetch the compiler makes outside a plugin's pinned content;
- a site icon is only fetched over HTTPS from a public host: loopback, private,
  link-local, internal and single-label hostnames are refused, and a repository
  host is refused because its icon is the forge's, not the product's. Only the
  first 256 KiB of the page is parsed, and the mirror repeats the host check on
  the recorded URL rather than trusting the artifact;
- bytes are sniffed by magic number and must be PNG, JPEG, GIF, WebP or SVG, and
  must be at most 1 MiB;
- SVG is treated as active content: a mark containing `script`,
  `foreignObject`, `iframe`, an event handler, a `javascript:` URL, an external
  `href`/`src`, or an entity declaration is refused, and the product simply
  reports no icon;
- assets are content addressed and published beside the artifacts, never
  committed to the repository; every release declares each asset's digest and
  byte length in `integrity.json`, and both the publish step and the release
  verification refetch and compare them.

Consumers must render a mirrored SVG through an image element and never inline
it into a document, where its contents would share the page's origin.

Mirrored marks remain the trademark of their owners and are republished as
supplied, with the source repository, commit and path recorded for each. They
are not relicensed by this repository's licence, and a plugin whose licence is
undeclared is mirrored like any other; remove an entry from
`config/product-icons.json` to exclude one product, or drop `mirror-icons` from
the release workflow to publish no marks at all.

The classifier is static and conservative. It is not malware detection, sandboxing,
or runtime authorization. Control Plane must re-check policy and credentials when
it turns a catalog release into an execution plan. Credentials are never stored
in marketplace artifacts.
