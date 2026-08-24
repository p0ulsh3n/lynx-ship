# Provider strategy

The build API depends on a provider-neutral `ProviderCatalog`. A provider declares its platform, mode and capabilities; it does not change the public build job contract.

The local build provider and the direct Google Play/App Store Connect
submission providers are executable in this release. Managed vendor selection,
benchmark data, capacity, pricing, stock and terms must be revalidated from
current provider sources before procurement. No provider price or
unlimited-compute promise is hard-coded in the application.

Production promotion remains gated on: worker isolation acceptance tests,
capability revalidation, lease recovery, cost ledger, credential scope, live
store sandbox validation and a written provider/ToS review.
