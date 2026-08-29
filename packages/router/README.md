# @lynxship/router

Small, host-independent route and deep-link contract. It matches path parameters and query values and exposes an in-memory history; native navigation stacks, app lifecycle, and platform URL registration remain responsibilities of the host integration.

## Usage and boundaries

```ts
import { createRouter } from "@lynxship/router";

const router = createRouter([{ name: "chat", pattern: "/chat/:id" }]);
router.push("/chat/42");
```

Patterns are validated before registration and route values are decoded only
after a successful match. The router does not register Android App Links,
Apple Universal Links, notification handlers or platform navigation stacks; an
adapter should translate those platform events into `push` calls.
