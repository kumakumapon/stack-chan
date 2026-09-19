# HTTP connection policy

HttpServerService and MCPServerService use the SDK's listen() implementation,
which supports one request/response per connection. Both services enforce
`Connection: close`; HttpServerService overrides even a handler's explicit
keep-alive header, including custom, missing-route and error responses.

Issue #19 is addressed with this connection policy. Keep-alive is intentionally
disabled. We do not vendor or relicense the LGPL-3.0 SDK implementation into this
Apache-2.0 repository. Removing the close policy requires a separately verified
SDK fix for per-request response promises and offsets, plus repeated-request
regression tests for both services.

Run the XS regression from `firmware/`:

```sh
npm run test:moddable -- ./host/modules/connectivity/http-server/__tests__/http-server-service/manifest.test.json
```

The test uses the SDK fetch client against the live server. That client evicts
its origin cache on the asynchronous socket-close notification, so the test
yields between completed responses before making the next request. Body
completion alone is not the SDK client's connection-close notification.
