# Changelog

## [1.3.4](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.3.3...plugins-marketplace-v1.3.4) (2026-09-10)


### Bug Fixes

* **ci:** avoid auth on unchanged catalog sync ([#52](https://github.com/adea-ai/plugins/issues/52)) ([4338a34](https://github.com/adea-ai/plugins/commit/4338a341ac01cca2393d442b555ed64e5052a656))

## [1.3.3](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.3.2...plugins-marketplace-v1.3.3) (2026-09-10)


### Bug Fixes

* harden deterministic catalog normalization ([#50](https://github.com/adea-ai/plugins/issues/50)) ([99f369c](https://github.com/adea-ai/plugins/commit/99f369cd994938e5c763dbbc0e1e0c0100c40b83))

## [1.3.2](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.3.1...plugins-marketplace-v1.3.2) (2026-09-10)


### Maintenance

* roll up dependencies and Code Foundry v1.28.6 ([#48](https://github.com/adea-ai/plugins/issues/48)) ([370b779](https://github.com/adea-ai/plugins/commit/370b779e0b74d505f831d652f75f106a5c733a46))

## [1.3.1](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.3.0...plugins-marketplace-v1.3.1) (2026-09-10)


### Maintenance

* **code-foundry:** upgrade runtime to v1.28.4 ([2df5c31](https://github.com/adea-ai/plugins/commit/2df5c3140a20b7c56cd4cb4edd2e574dd51be124))

## [1.3.0](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.2.0...plugins-marketplace-v1.3.0) (2026-09-09)


### Features

* add portable agent plugin planning ([#42](https://github.com/adea-ai/plugins/issues/42)) ([996300e](https://github.com/adea-ai/plugins/commit/996300e57a0b0123400a1c82cb3374e15d383caa))

## [1.2.0](https://github.com/adea-ai/plugins/compare/plugins-marketplace-v1.1.3...plugins-marketplace-v1.2.0) (2026-09-08)


### Features

* add automated plugin marketplace ([eb27c46](https://github.com/adea-ai/plugins/commit/eb27c46b1977992fea577fe0af5b13faa8bf8cbf))
* bootstrap marketplace catalog publication ([2f6b859](https://github.com/adea-ai/plugins/commit/2f6b85965817fe791fbd7ccbecb84b3149b7c773))
* **packages:** publish the marketplace toolkit under [@adea-ai](https://github.com/adea-ai) ([#31](https://github.com/adea-ai/plugins/issues/31)) ([92120b0](https://github.com/adea-ai/plugins/commit/92120b0d06bb47bc81c59b8e8718217d74709b56))
* quarantine upstream fetch failures instead of failing sync ([93e27d5](https://github.com/adea-ai/plugins/commit/93e27d52d3131636501121fe92f73be2877857f4))


### Bug Fixes

* **ci:** compare offline regen against fixture snapshots, not live data ([#3](https://github.com/adea-ai/plugins/issues/3)) ([0e9c769](https://github.com/adea-ai/plugins/commit/0e9c7696a835291e87d343812c3cc1d543991e15))
* **ci:** open catalog snapshot PR instead of pushing direct to main ([#18](https://github.com/adea-ai/plugins/issues/18)) ([7e7a258](https://github.com/adea-ai/plugins/commit/7e7a25819b3ce01496aa1eaa054af5caf4245310))
* **ci:** pin generated callers to the adopted v1.4.1 runtime ([#36](https://github.com/adea-ai/plugins/issues/36)) ([93666f3](https://github.com/adea-ai/plugins/commit/93666f38176776df490a2454b35fa56ff692f837))
* **ci:** push catalog snapshot PR with a PAT so checks trigger ([#21](https://github.com/adea-ai/plugins/issues/21)) ([24f48a3](https://github.com/adea-ai/plugins/commit/24f48a3ed7f6ef603f5dbad2b0162d4fd8980eb2))
* **ci:** set up Node registry auth for npm publish ([#34](https://github.com/adea-ai/plugins/issues/34)) ([bac3f2d](https://github.com/adea-ai/plugins/commit/bac3f2d20e406e8db4c1ab873339f720d8c82040))
* **ci:** use published Bun release ([ee4026b](https://github.com/adea-ai/plugins/commit/ee4026b388db6e6b20e11a3eb8f4a1c4671c1a27))
* drop dead initializer flagged by no-useless-assignment ([#11](https://github.com/adea-ai/plugins/issues/11)) ([9643bb8](https://github.com/adea-ai/plugins/commit/9643bb8953020e3eff2ff72939f9ee1bb52af046))
* **publication:** enforce immutable catalog releases ([a2f5325](https://github.com/adea-ai/plugins/commit/a2f5325f81cc9301b5986f241c51d16abebf0294))
* **publish:** resolve workspace: ranges from workspace manifests ([#33](https://github.com/adea-ai/plugins/issues/33)) ([78223d5](https://github.com/adea-ai/plugins/commit/78223d5b4df6d3b83d5f20f9bae24cf87b3d094a))
* **publish:** ship src so the bun exports condition resolves; republish at 1.1.4 ([#35](https://github.com/adea-ai/plugins/issues/35)) ([f754ef1](https://github.com/adea-ai/plugins/commit/f754ef192ce1562db84b192725cbd0b6a0e73d1b))
* **sync:** authenticate GitHub content fetches ([1649439](https://github.com/adea-ai/plugins/commit/1649439623eab2b3438f3492442e7324f3e3c740))
* **sync:** quarantine unsafe plugin snapshots ([d0c6ffd](https://github.com/adea-ai/plugins/commit/d0c6ffd62d06234090e5663fbdd5e434d561231e))
* **sync:** skip invalid normalized plugin records ([941439f](https://github.com/adea-ai/plugins/commit/941439f21706e92b73d2f9c2a6f505a8cbe7358a))
* **sync:** timestamp live snapshots at retrieval ([8363f83](https://github.com/adea-ai/plugins/commit/8363f839a1bd863feafb62da11f6089e1e3be3a5))
* use canonical Apache-2.0 LICENSE text and declare SPDX license ([#16](https://github.com/adea-ai/plugins/issues/16)) ([4b03a39](https://github.com/adea-ai/plugins/commit/4b03a3934eeaf4e4fb4a78a3594d6b780efe3160))
* **workflow:** add bootstrap-only catalog publication ([2fa9677](https://github.com/adea-ai/plugins/commit/2fa9677e1c93ee7e22f1bb390c36248e2d184067))
* **workflow:** fail sync on piped command errors ([47c22e1](https://github.com/adea-ai/plugins/commit/47c22e10bcbe455cff9b2c052199c11509f921ad))
* **workflow:** preserve last-known-good catalog until publish ([aaaa0bd](https://github.com/adea-ai/plugins/commit/aaaa0bd73f15378518b3cf31f5bb34caf0f2f783))
* **workflow:** publish latest asset by filename ([3b3c83a](https://github.com/adea-ai/plugins/commit/3b3c83af8f52f5183b9e06abdee3b2e0b46c4198))
* **workflow:** require stable latest asset ([284a9f9](https://github.com/adea-ai/plugins/commit/284a9f9b100ce75079ee2855b169b6c8160d23b6))


### Performance

* **sync:** normalize plugins concurrently ([235d9c1](https://github.com/adea-ai/plugins/commit/235d9c161b1577dedb9a750d940e1047e4677e31))


### Documentation

* rename Agent HQ product references to Adea ([#26](https://github.com/adea-ai/plugins/issues/26)) ([0303936](https://github.com/adea-ai/plugins/commit/0303936eabdb3c21bf661d0e95c7dddf07db951b))


### Tests

* **publication:** assert complete immutable asset set ([e50c29c](https://github.com/adea-ai/plugins/commit/e50c29c3b36422f84eee97a4f63b589e47038d89))


### Maintenance

* **catalog:** refresh marketplace snapshot ([6a2bea0](https://github.com/adea-ai/plugins/commit/6a2bea066f81aad91cd3a7905d9ce1fc88643d68))
* **catalog:** refresh marketplace snapshot ([2fab101](https://github.com/adea-ai/plugins/commit/2fab101ff776354508b9b0c15310e89eaf029244))
* **catalog:** refresh marketplace snapshot ([5128da3](https://github.com/adea-ai/plugins/commit/5128da378a0c4517f3b4ef953c0e4521f42bfb83))
* **catalog:** refresh marketplace snapshot ([70a862e](https://github.com/adea-ai/plugins/commit/70a862eccea0d6f80f362d8c9ec9a5fbe418a5b1))
* **catalog:** refresh marketplace snapshot ([c9966db](https://github.com/adea-ai/plugins/commit/c9966db05616f367f4a94b9372df3fbbde65389b))
* **catalog:** refresh marketplace snapshot ([ed15796](https://github.com/adea-ai/plugins/commit/ed157962c2646403e22bb75d761b5b8747d2cfd7))
* **catalog:** refresh marketplace snapshot ([1d3f661](https://github.com/adea-ai/plugins/commit/1d3f661c1b1043e09b1976fcb7ad878ca12959eb))
* **catalog:** refresh marketplace snapshot ([2231c18](https://github.com/adea-ai/plugins/commit/2231c1821e2d388126145af3c1e2e41e3c91621a))
* **catalog:** refresh marketplace snapshot ([de95b93](https://github.com/adea-ai/plugins/commit/de95b930828e6a89c82a7e41b2cf809b40e6d191))
* **catalog:** refresh marketplace snapshot catalog:ecfeddfd91109b6fb9ab90d1375b759fa0d9589c1c3a5267a3066259baf4489c ([#23](https://github.com/adea-ai/plugins/issues/23)) ([e957c0c](https://github.com/adea-ai/plugins/commit/e957c0c443514eab1205b4801161c95a9cf1e198))
* **ci:** auto-merge green catalog snapshots ([#24](https://github.com/adea-ai/plugins/issues/24)) ([b6e4a2b](https://github.com/adea-ai/plugins/commit/b6e4a2bed72ea0b0900324a29f9756133d9d9389))
* **ci:** upgrade Code Foundry to v1.9.11 ([#40](https://github.com/adea-ai/plugins/issues/40)) ([1e8a896](https://github.com/adea-ai/plugins/commit/1e8a896a88b6cd423efaba3bea48cbe7cc4cd640))
* **ci:** upgrade code-foundry runtime to v1.0.0 ([#25](https://github.com/adea-ai/plugins/issues/25)) ([b157b00](https://github.com/adea-ai/plugins/commit/b157b008c3d6666b9fab8fd18537b10fbbd9f815))
* **ci:** upgrade code-foundry runtime to v1.0.4 ([#27](https://github.com/adea-ai/plugins/issues/27)) ([7b22490](https://github.com/adea-ai/plugins/commit/7b22490e9192aaa79415d4b4f35cf5f37715b594))
* **ci:** upgrade code-foundry runtime to v1.3.1 and migrate to oxlint/oxfmt ([#29](https://github.com/adea-ai/plugins/issues/29)) ([f30d85b](https://github.com/adea-ai/plugins/commit/f30d85b23367d84b86d3744061998adb624fc899))
* **code-foundry:** upgrade runtime to v1.4.1 ([#30](https://github.com/adea-ai/plugins/issues/30)) ([0150847](https://github.com/adea-ai/plugins/commit/015084738a05939ec66a57d1a5e655bba29e4dd8))
* **code-foundry:** upgrade to v1.5.0 ([#37](https://github.com/adea-ai/plugins/issues/37)) ([247b90c](https://github.com/adea-ai/plugins/commit/247b90cad466062297f92528989bb63c6189cc48))
* **deps:** bump the npm-dependencies group across 1 directory with 7 updates ([#9](https://github.com/adea-ai/plugins/issues/9)) ([ff2341f](https://github.com/adea-ai/plugins/commit/ff2341f60c1feee6be75831a578c85bf9e45e30b))
* **deps:** hold typescript majors until TS7 toolchain migration ([daa6b0c](https://github.com/adea-ai/plugins/commit/daa6b0cfa9c706674b62e78eb2254ee5bfc8efa3))
* enforce owner-exempt review policy via required check ([#13](https://github.com/adea-ai/plugins/issues/13)) ([57ece86](https://github.com/adea-ai/plugins/commit/57ece8637386115f8baa87f0fd0f1f12f5b327c9))
* **main:** release 1.0.0 ([7906946](https://github.com/adea-ai/plugins/commit/790694650ed81f773b5ef0320a4cd2b4c1a4bb5c))
* **main:** release 1.0.1 ([694fdae](https://github.com/adea-ai/plugins/commit/694fdae9e1fdc00d22902b4acde774198994c3f8))
* **main:** release 1.1.1 ([0a5b9dd](https://github.com/adea-ai/plugins/commit/0a5b9dd3a1cd5de776461cf1d909939fb69c6c02))
* **main:** release 1.1.2 ([68e74ea](https://github.com/adea-ai/plugins/commit/68e74eaca5519618fdbef6e9e2d979dbdfc76c32))
* **main:** release 1.1.3 ([c0a790a](https://github.com/adea-ai/plugins/commit/c0a790a7562d0ea489a86124a63032715f014787))
* publish 1.1.0 release notes and version ([#14](https://github.com/adea-ai/plugins/issues/14)) ([7105cd9](https://github.com/adea-ai/plugins/commit/7105cd999ce9a1b0557c14bb2ea6f4d7441edb48))
* record release-please manifest at 1.1.0 ([#15](https://github.com/adea-ai/plugins/issues/15)) ([b92cd3d](https://github.com/adea-ai/plugins/commit/b92cd3d3b2cf20c6d6ba075a9a646d58c01af470))
* standardize direct-workflow merge strategy to squash ([#12](https://github.com/adea-ai/plugins/issues/12)) ([9bb36d4](https://github.com/adea-ai/plugins/commit/9bb36d4c84dfb0bd23d0dff16de2f133cf3b260c))
* update repository references from 0xPlayerOne to adea-ai ([141e75c](https://github.com/adea-ai/plugins/commit/141e75c9fd519a24685037afc31cac26c7717cec))

## [1.1.3](https://github.com/adea-ai/plugins/compare/v1.1.2...v1.1.3) (2026-09-05)


### Bug Fixes

* **ci:** push catalog snapshot PR with a PAT so checks trigger ([#21](https://github.com/adea-ai/plugins/issues/21)) ([24f48a3](https://github.com/adea-ai/plugins/commit/24f48a3ed7f6ef603f5dbad2b0162d4fd8980eb2))

## [1.1.2](https://github.com/adea-ai/plugins/compare/v1.1.1...v1.1.2) (2026-09-05)


### Bug Fixes

* **ci:** open catalog snapshot PR instead of pushing direct to main ([#18](https://github.com/adea-ai/plugins/issues/18)) ([7e7a258](https://github.com/adea-ai/plugins/commit/7e7a25819b3ce01496aa1eaa054af5caf4245310))

## [1.1.1](https://github.com/adea-ai/plugins/compare/v1.1.0...v1.1.1) (2026-09-05)


### Bug Fixes

* use canonical Apache-2.0 LICENSE text and declare SPDX license ([#16](https://github.com/adea-ai/plugins/issues/16)) ([4b03a39](https://github.com/adea-ai/plugins/commit/4b03a3934eeaf4e4fb4a78a3594d6b780efe3160))

## [1.1.0](https://github.com/adea-ai/plugins/compare/v1.0.1...v1.1.0) (2026-09-05)


### Features

* quarantine upstream fetch failures instead of failing sync ([93e27d5](https://github.com/adea-ai/plugins/commit/93e27d52d3131636501121fe92f73be2877857f4))


### Bug Fixes

* drop dead initializer flagged by no-useless-assignment ([#11](https://github.com/adea-ai/plugins/issues/11)) ([9643bb8](https://github.com/adea-ai/plugins/commit/9643bb8953020e3eff2ff72939f9ee1bb52af046))

## [1.0.1](https://github.com/adea-ai/plugins/compare/v1.0.0...v1.0.1) (2026-09-05)


### Bug Fixes

* **ci:** compare offline regen against fixture snapshots, not live data ([#3](https://github.com/adea-ai/plugins/issues/3)) ([0e9c769](https://github.com/adea-ai/plugins/commit/0e9c7696a835291e87d343812c3cc1d543991e15))

## 1.0.0 (2026-09-05)


### Features

* add automated plugin marketplace ([eb27c46](https://github.com/adea-ai/plugins/commit/eb27c46b1977992fea577fe0af5b13faa8bf8cbf))
* bootstrap marketplace catalog publication ([2f6b859](https://github.com/adea-ai/plugins/commit/2f6b85965817fe791fbd7ccbecb84b3149b7c773))


### Bug Fixes

* **ci:** use published Bun release ([ee4026b](https://github.com/adea-ai/plugins/commit/ee4026b388db6e6b20e11a3eb8f4a1c4671c1a27))
* **publication:** enforce immutable catalog releases ([a2f5325](https://github.com/adea-ai/plugins/commit/a2f5325f81cc9301b5986f241c51d16abebf0294))
* **sync:** authenticate GitHub content fetches ([1649439](https://github.com/adea-ai/plugins/commit/1649439623eab2b3438f3492442e7324f3e3c740))
* **sync:** quarantine unsafe plugin snapshots ([d0c6ffd](https://github.com/adea-ai/plugins/commit/d0c6ffd62d06234090e5663fbdd5e434d561231e))
* **sync:** skip invalid normalized plugin records ([941439f](https://github.com/adea-ai/plugins/commit/941439f21706e92b73d2f9c2a6f505a8cbe7358a))
* **sync:** timestamp live snapshots at retrieval ([8363f83](https://github.com/adea-ai/plugins/commit/8363f839a1bd863feafb62da11f6089e1e3be3a5))
* **workflow:** add bootstrap-only catalog publication ([2fa9677](https://github.com/adea-ai/plugins/commit/2fa9677e1c93ee7e22f1bb390c36248e2d184067))
* **workflow:** fail sync on piped command errors ([47c22e1](https://github.com/adea-ai/plugins/commit/47c22e10bcbe455cff9b2c052199c11509f921ad))
* **workflow:** preserve last-known-good catalog until publish ([aaaa0bd](https://github.com/adea-ai/plugins/commit/aaaa0bd73f15378518b3cf31f5bb34caf0f2f783))
* **workflow:** publish latest asset by filename ([3b3c83a](https://github.com/adea-ai/plugins/commit/3b3c83af8f52f5183b9e06abdee3b2e0b46c4198))
* **workflow:** require stable latest asset ([284a9f9](https://github.com/adea-ai/plugins/commit/284a9f9b100ce75079ee2855b169b6c8160d23b6))


### Performance Improvements

* **sync:** normalize plugins concurrently ([235d9c1](https://github.com/adea-ai/plugins/commit/235d9c161b1577dedb9a750d940e1047e4677e31))
