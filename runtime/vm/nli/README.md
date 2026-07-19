# runtime/vm/nli - ONNX DeBERTa entailment sidecar (placeholder)

Per the Kimi blueprint (sections C and D): local NLI replaces API-based adjudication for
entailment checks (does the page's text actually entail the compliance claim it is being credited
or debited for). This directory is a placeholder service, staged, not model-bearing.

## Why this is a placeholder, not a real model

Vendoring real ONNX DeBERTa weights (several hundred MB) into a public git repository is wrong on
two counts: repo bloat, and model licensing needs a human check before it ships in a public
codebase. The founder decision to pick and licence-clear a specific fine-tuned NLI checkpoint is
out of scope for this infrastructure workstream - `server.js` here implements the real HTTP
contract (`POST /entail {premise, hypothesis} -> {label, score}`) against a trivial rule-based
stand-in so the contract, the docker service, and the worker's `NLI_SERVICE_URL` wiring can all be
tested end to end today. Swapping the stand-in for `onnxruntime-node` plus a real checkpoint is a
follow-up task that does not change this contract.

## Contract

```
POST /entail
{ "premise": "...", "hypothesis": "..." }
->
{ "label": "entailment" | "contradiction" | "neutral", "score": 0.0-1.0, "modelStaged": true }
```

`modelStaged: true` marks every response from the stand-in so no caller can mistake a placeholder
verdict for a real model score - this is the abstention-first doctrine applied to the runtime
layer, not just to the engine's own confidence grading.
