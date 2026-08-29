# @lynxship/observability

Opt-in event buffering for Lynx apps. Events are bounded, sensitive attribute names are redacted before reaching a sink, and the sink is supplied by the host or backend integration. This package does not silently collect telemetry or log secrets.

## Usage and boundaries

Create a client with an explicit sink and call `capture` for events that the
application has chosen to report. Configure finite buffer limits and flush at
application-owned lifecycle points. Cycles, excessive nesting and sensitive
attribute names are handled defensively, but redaction is not a privacy
classification system: do not send passwords, access tokens, private message
content or provider credentials in event attributes.
