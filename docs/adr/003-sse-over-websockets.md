# ADR-003: Use Server-Sent Events (SSE) Instead of WebSockets for Streaming

## Status
Accepted

## Context
The query pipeline takes 2–5 seconds to complete (dominated by LLM inference). A blocking request-response pattern makes the UI feel frozen. Streaming the response progressively — tokens of the explanation appearing as they're generated — gives a much better perceived performance.

Two real-time transport options were evaluated:
1. **WebSockets** — full-duplex, persistent connection
2. **Server-Sent Events (SSE)** — unidirectional server-to-client stream over HTTP

## Decision
Use **Server-Sent Events (SSE)** via FastAPI's `StreamingResponse` and a custom `useQueryStream` React hook on the frontend.

## Consequences

**Why SSE over WebSockets:**
- The communication pattern here is strictly unidirectional: the client sends one query (HTTP POST), then receives a stream of events from the server. Full-duplex is not needed.
- SSE works over plain HTTP/1.1 — no protocol upgrade, no connection state to manage on the server, no reconnect logic to implement (browsers handle SSE reconnection automatically)
- SSE is trivially proxiable — works out of the box with nginx, Caddy, and most cloud load balancers without WebSocket-specific configuration
- FastAPI's `StreamingResponse` + Python `async generators` make SSE implementation ~20 lines
- Browser support is universal; no polyfill needed

**Stream event types emitted:**
```
event: sql        → the generated SQL query
event: row        → one result row (sent as they're fetched)
event: token      → one explanation token (LLM streaming)
event: meta       → result count, query duration, column types
event: error      → structured error if pipeline fails
event: done       → signals stream completion
```

The frontend `useQueryStream` hook subscribes to these event types and updates separate React state slices for the SQL panel, result table, and explanation panel independently — each section renders as its data arrives.

**Trade-offs:**
- SSE connections are HTTP/1.1 limited to 6 concurrent connections per domain in some browsers — not a concern for a single-user dashboard, but worth noting for multi-user deployments
- No client-to-server messaging after the initial POST — if interruption/cancellation is needed, it requires a separate DELETE request (implemented via an AbortController in `useQueryStream`)
- SSE requires `Content-Type: text/event-stream` — some overzealous proxies buffer this; documented in `docs/deployment.md`
