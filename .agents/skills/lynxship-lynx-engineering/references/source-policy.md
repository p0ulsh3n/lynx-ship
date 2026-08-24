# Current-source policy for Lynx work

This repository targets a fast-moving framework. A contributor must verify
the current release before changing framework-facing code. The date in a PR
or handoff is the date the source was checked, not the date a copied snippet
was originally published.

## Source priority

Use sources in this order:

1. The official Lynx documentation for the project's release channel:
   - [Lynx documentation](https://lynxjs.org/)
   - [Quick Start](https://lynxjs.org/guide/start/quick-start)
   - [Rspeedy](https://lynxjs.org/rspeedy/)
   - [Rspeedy CLI](https://lynxjs.org/4.0/rspeedy/cli.html)
   - [Rspeedy configuration API](https://lynxjs.org/api/rspeedy/rspeedy.config.html)
   - [Integrate with existing apps](https://lynxjs.org/guide/start/integrate-with-existing-apps.html)
   - [iOS integration](https://lynxjs.org/guide/start/integrate-with-existing-apps?platform=ios)
   - [Autolink](https://lynxjs.org/guide/autolink)
   - [Lynx specification index](https://lynxjs.org/guide/spec.html)
2. The official source and release tags:
   - [Lynx source](https://github.com/lynx-family/lynx)
   - [Lynx Stack](https://github.com/lynx-family/lynx-stack)
   - [Official integration demos](https://github.com/lynx-family/integrating-lynx-demo-projects)
   - [Lynx examples](https://github.com/lynx-family/lynx-examples)
3. The installed package's `package.json`, `.d.ts` files, lockfile and actual
   implementation. These are authoritative for what this checkout can run.
4. Platform vendor documentation. Use community material only to locate a
   primary source, never as the final authority for an API contract.

## Research procedure

When an API, option, annotation, pod, Gradle plugin, or native callback is
uncertain:

1. Identify the exact package/framework version from the lockfile and
   `node_modules` (or the native dependency manifest).
2. Search the official documentation and source repository for the symbol,
   then open the surrounding implementation/example, not just a search-result
   summary.
3. Compare the docs with installed type declarations and the official demo
   for the same release. If they disagree, stop and report the discrepancy;
   do not invent a compatibility shim silently.
4. Prefer official raw Markdown, GitHub source, package metadata, Maven
   metadata, CocoaPods specs, or documented APIs over HTML scraping. Respect
   robots.txt, authentication, rate limits and terms; never scrape private or
   access-controlled data.
5. Record the URL, version/tag, and check date in the change or handoff when
   the behavior is release-sensitive.

## Freshness rules

- Never copy a `next`/development API into a stable release without checking
  that the installed package exports it.
- Never use a floating dependency (`latest`, `+`, `.*`) in build-critical
  configuration.
- Re-check compatibility tables after upgrading Node, Gradle, AGP, Xcode,
  CocoaPods, Lynx, Rspeedy, or a cloud provider SDK.
- If current sources are unavailable, make the work explicitly blocked or
  limited to a static, non-claiming change. Do not substitute an old memory
  for evidence.
