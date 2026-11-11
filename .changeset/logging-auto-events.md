---
'@naulabsco/logging': minor
---

`LoggerOptions` gains `autoEvents`. `request` names the `event` on the automatic HTTP
request-completion line and `message` names it on the automatic microservice completion
line. Each name must be a non-empty string. Handler lines, `msg` and the output without the
option are unchanged.
