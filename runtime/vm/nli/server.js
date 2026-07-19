'use strict';
// runtime/vm/nli/server.js - NLI sidecar contract, stand-in implementation. See README.md: every
// response is marked modelStaged:true so no caller can mistake this for a real ONNX DeBERTa
// verdict.

const http = require('node:http');

const PORT = Number(process.env.PORT || 3600);

function json(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length });
  res.end(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Stand-in entailment: a crude lexical-overlap heuristic, deliberately unfit for production
 * adjudication. It exists to prove the HTTP contract end to end, never to produce a real breach
 * verdict - every response carries modelStaged:true and a confidence score that a real caller
 * must treat as "abstain" grade, per the engine's own graded-confidence doctrine.
 */
function standInEntail(premise, hypothesis) {
  if (!premise || !hypothesis) {
    return { label: 'neutral', score: 0, modelStaged: true, reason: 'missing_input' };
  }
  const pTokens = new Set(premise.toLowerCase().split(/\W+/).filter(Boolean));
  const hTokens = hypothesis.toLowerCase().split(/\W+/).filter(Boolean);
  const overlap = hTokens.filter((t) => pTokens.has(t)).length;
  const ratio = hTokens.length ? overlap / hTokens.length : 0;
  const label = ratio > 0.6 ? 'entailment' : ratio < 0.15 ? 'contradiction' : 'neutral';
  return { label, score: Number(ratio.toFixed(3)), modelStaged: true };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      json(res, 200, { ok: true, modelStaged: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/entail') {
      const { premise, hypothesis } = await readBody(req);
      json(res, 200, standInEntail(premise, hypothesis));
      return;
    }
    json(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error('nli_service_error', err);
    json(res, 500, { error: err.message || 'internal_error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`nli stand-in service listening on :${PORT} (modelStaged: every response)`);
  });
}

module.exports = { server, standInEntail };
