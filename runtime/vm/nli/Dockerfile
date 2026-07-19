# runtime/vm/nli/Dockerfile - NLI sidecar (stand-in implementation, see README.md).
# Zero npm dependencies for the stand-in: it uses only node:core http, matching the engine-wide
# zero-runtime-dependency default. Swapping in onnxruntime-node for a real model is a follow-up.

FROM node:24-alpine

RUN addgroup -S tamazia && adduser -S tamazia -G tamazia
WORKDIR /app

COPY runtime/vm/nli/server.js ./server.js
COPY runtime/vm/nli/package.json ./package.json

USER tamazia
EXPOSE 3600

CMD ["node", "server.js"]
