# Changelog

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
