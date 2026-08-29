# @lynxship/submit

Submission contracts and provider boundaries for Google Play and App Store
Connect. Inputs are validated for the target platform and providers accept an
injected transport so unit tests do not contact a store.

Live publishing still requires the developer's own Google/Apple credentials,
application identifiers and store review state. This package does not bypass
store policy or create provider accounts.

`SubmissionService` deliberately has no implicit fake provider. In local demos
and tests, pass `new MockSubmissionProvider()` explicitly; production and
self-hosted control planes must inject a real provider or fail with a clear
configuration error.

## Usage and safety

Create a submission job with a previously hashed artifact, select the matching
platform provider, and inject the provider transport in tests or self-hosted
deployments. Credentials stay in the server or CI secret store. Submission
requests are not automatically retried after an unknown provider response
unless the provider's idempotency contract is available.
