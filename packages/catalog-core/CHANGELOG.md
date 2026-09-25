# Changelog

## [1.10.1](https://github.com/adea-ai/plugins/compare/catalog-core-v1.10.0...catalog-core-v1.10.1) (2026-09-25)


### Maintenance

* **catalog:** republish on a catalog format change, and scope the test command ([#108](https://github.com/adea-ai/plugins/issues/108)) ([ad2e4c4](https://github.com/adea-ai/plugins/commit/ad2e4c42603f298a6afd2001a081975987488b80))

## [1.10.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.9.0...catalog-core-v1.10.0) (2026-09-25)


### Features

* **catalog:** carry the publisher and source in the product index ([#106](https://github.com/adea-ai/plugins/issues/106)) ([f220d67](https://github.com/adea-ai/plugins/commit/f220d67ef870f199ded8f7be34bb173a60f1a3fb))

## [1.9.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.8.0...catalog-core-v1.9.0) (2026-09-25)


### Features

* **catalog:** make the product index install-complete ([#104](https://github.com/adea-ai/plugins/issues/104)) ([740e718](https://github.com/adea-ai/plugins/commit/740e718414a714fb210fff76d274f7f679578a73))

## [1.8.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.7.0...catalog-core-v1.8.0) (2026-09-25)


### Features

* **catalog:** publish the browsing index URL in the navigation artifact ([#102](https://github.com/adea-ai/plugins/issues/102)) ([0b3726f](https://github.com/adea-ai/plugins/commit/0b3726f8235142b63262c1167e4a8ef1b4e390a1))

## [1.7.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.6.0...catalog-core-v1.7.0) (2026-09-25)


### Features

* **catalog:** carry compiled brand marks in the navigation artifact ([#101](https://github.com/adea-ai/plugins/issues/101)) ([29e7458](https://github.com/adea-ai/plugins/commit/29e7458bef0725e86ceceb5a0d8ae1d52dc8e9ac))

## [1.6.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.5.2...catalog-core-v1.6.0) (2026-09-25)


### Features

* **catalog:** publish absolute, immutable icon asset URLs ([#91](https://github.com/adea-ai/plugins/issues/91)) ([956df84](https://github.com/adea-ai/plugins/commit/956df84d7094b6f271e8b2e88aa5b0711f56ca43))

## [1.5.2](https://github.com/adea-ai/plugins/compare/catalog-core-v1.5.1...catalog-core-v1.5.2) (2026-09-24)


### Bug Fixes

* **catalog:** stage brand marks during the build ([#82](https://github.com/adea-ai/plugins/issues/82)) ([6fca141](https://github.com/adea-ai/plugins/commit/6fca14152501dd747c99550631cb9b05457ec4b6))

## [1.5.1](https://github.com/adea-ai/plugins/compare/catalog-core-v1.5.0...catalog-core-v1.5.1) (2026-09-24)


### Bug Fixes

* **catalog:** file a product under every category its variants belong to ([#80](https://github.com/adea-ai/plugins/issues/80)) ([2dd8f2e](https://github.com/adea-ai/plugins/commit/2dd8f2e00476a497b19e973017a0a0c972faae00))

## [1.5.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.4.1...catalog-core-v1.5.0) (2026-09-24)


### Features

* **catalog:** compile consumer shards and mirrored brand marks ([#77](https://github.com/adea-ai/plugins/issues/77)) ([8a3c2a8](https://github.com/adea-ai/plugins/commit/8a3c2a85ad677e12f7b37186341cc59103229a4e))

## [1.4.1](https://github.com/adea-ai/plugins/compare/catalog-core-v1.4.0...catalog-core-v1.4.1) (2026-09-17)


### Maintenance

* standardize lint and format toolchain ([#66](https://github.com/adea-ai/plugins/issues/66)) ([65d9d59](https://github.com/adea-ai/plugins/commit/65d9d59937ed7d46a71def9d1f5a71f308e0b298))

## [1.4.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.3.1...catalog-core-v1.4.0) (2026-09-12)


### Features

* catalog-taxonomy ([#62](https://github.com/adea-ai/plugins/issues/62)) ([b39ce79](https://github.com/adea-ai/plugins/commit/b39ce79cf4676e8129a4942ee4e5433808afab2d))

## [1.3.1](https://github.com/adea-ai/plugins/compare/catalog-core-v1.3.0...catalog-core-v1.3.1) (2026-09-10)


### Bug Fixes

* harden deterministic catalog normalization ([#50](https://github.com/adea-ai/plugins/issues/50)) ([99f369c](https://github.com/adea-ai/plugins/commit/99f369cd994938e5c763dbbc0e1e0c0100c40b83))

## [1.3.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.2.0...catalog-core-v1.3.0) (2026-09-09)


### Features

* add portable agent plugin planning ([#42](https://github.com/adea-ai/plugins/issues/42)) ([996300e](https://github.com/adea-ai/plugins/commit/996300e57a0b0123400a1c82cb3374e15d383caa))

## [1.2.0](https://github.com/adea-ai/plugins/compare/catalog-core-v1.1.4...catalog-core-v1.2.0) (2026-09-08)


### Features

* add automated plugin marketplace ([eb27c46](https://github.com/adea-ai/plugins/commit/eb27c46b1977992fea577fe0af5b13faa8bf8cbf))
* bootstrap marketplace catalog publication ([2f6b859](https://github.com/adea-ai/plugins/commit/2f6b85965817fe791fbd7ccbecb84b3149b7c773))
* **packages:** publish the marketplace toolkit under [@adea-ai](https://github.com/adea-ai) ([#31](https://github.com/adea-ai/plugins/issues/31)) ([92120b0](https://github.com/adea-ai/plugins/commit/92120b0d06bb47bc81c59b8e8718217d74709b56))
* quarantine upstream fetch failures instead of failing sync ([93e27d5](https://github.com/adea-ai/plugins/commit/93e27d52d3131636501121fe92f73be2877857f4))


### Bug Fixes

* **ci:** compare offline regen against fixture snapshots, not live data ([#3](https://github.com/adea-ai/plugins/issues/3)) ([0e9c769](https://github.com/adea-ai/plugins/commit/0e9c7696a835291e87d343812c3cc1d543991e15))
* drop dead initializer flagged by no-useless-assignment ([#11](https://github.com/adea-ai/plugins/issues/11)) ([9643bb8](https://github.com/adea-ai/plugins/commit/9643bb8953020e3eff2ff72939f9ee1bb52af046))
* **publish:** ship src so the bun exports condition resolves; republish at 1.1.4 ([#35](https://github.com/adea-ai/plugins/issues/35)) ([f754ef1](https://github.com/adea-ai/plugins/commit/f754ef192ce1562db84b192725cbd0b6a0e73d1b))
* **sync:** authenticate GitHub content fetches ([1649439](https://github.com/adea-ai/plugins/commit/1649439623eab2b3438f3492442e7324f3e3c740))
* **sync:** quarantine unsafe plugin snapshots ([d0c6ffd](https://github.com/adea-ai/plugins/commit/d0c6ffd62d06234090e5663fbdd5e434d561231e))
* **sync:** skip invalid normalized plugin records ([941439f](https://github.com/adea-ai/plugins/commit/941439f21706e92b73d2f9c2a6f505a8cbe7358a))
* **sync:** timestamp live snapshots at retrieval ([8363f83](https://github.com/adea-ai/plugins/commit/8363f839a1bd863feafb62da11f6089e1e3be3a5))


### Performance

* **sync:** normalize plugins concurrently ([235d9c1](https://github.com/adea-ai/plugins/commit/235d9c161b1577dedb9a750d940e1047e4677e31))


### Maintenance

* **ci:** upgrade code-foundry runtime to v1.3.1 and migrate to oxlint/oxfmt ([#29](https://github.com/adea-ai/plugins/issues/29)) ([f30d85b](https://github.com/adea-ai/plugins/commit/f30d85b23367d84b86d3744061998adb624fc899))
* update repository references from 0xPlayerOne to adea-ai ([141e75c](https://github.com/adea-ai/plugins/commit/141e75c9fd519a24685037afc31cac26c7717cec))
