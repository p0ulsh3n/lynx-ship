# @lynxship/storage

Private artifact storage adapters. `FileStorage` and `ObjectStorage` support
content-addressed local artifacts; `S3ObjectStorage` targets S3-compatible
providers such as Cloudflare R2 and exposes verified object metadata and
download operations.

Credentials are server-side only. Configure bucket, endpoint and access keys
through the control plane or secret manager; never ship them to Lynx, Expo or a
mobile client.
