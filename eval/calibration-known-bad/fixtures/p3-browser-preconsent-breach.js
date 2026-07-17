'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for evidence/browser/observe.js.
//
// THE DISEASE (caution.md C-039): the PECR reg.6 breach is BEHAVIOUR, not HTML - a non-essential
// cookie written, or a tracker request fired, on first load with NOTHING clicked. The engine was
// structurally blind to it for versions. This fixture is the earn-your-zero proof for the DETECTOR:
// a scripted browser that sets a Google Analytics `_ga` cookie AND fires a GA tracker request BEFORE
// any consent interaction, while ALSO holding a legitimate session cookie. observe() must flag the
// two pre-consent breaches (with their artifacts) and must NOT flag the essential session cookie. A
// detector that reports zero on this planted breach has not earned its zero (Constitution Rule 4);
// a detector that flags the session cookie is a false positive (Rule 10).
//
// DIALECT: calibrate() returns findings on a correct catch, [] (misses to stderr) on any regression.
// Standalone: `node eval/calibration-known-bad/fixtures/p3-browser-preconsent-breach.js` exits 1 on a miss.

const path = require('path');
const { observe } = require(path.resolve(__dirname, '..', '..', '..', 'evidence', 'browser', 'observe.js'));

// A scripted browser: pre-consent it holds one tracker cookie (_ga), one session cookie (PHPSESSID),
// and fires one GA tracker request. It touches nothing on its own.
function breachLaunch() {
  const handlers = [];
  const page = {
    on(ev, h) { if (ev === 'request') handlers.push(h); },
    async goto() {
      for (const h of handlers) h({ host: 'www.google-analytics.com', url: 'https://www.google-analytics.com/g/collect', resourceType: 'xhr', ts: Date.now() });
    },
    async settle() {},
    async cookies() {
      return [
        { name: '_ga', domain: '.example.com', value: 'GA1.2.1.1', expires: Math.floor(Date.now() / 1000) + 86400 },
        { name: 'PHPSESSID', domain: 'example.com', value: 'sess', expires: -1 },
      ];
    },
    async findConsentControl() { return null; },
    async clickConsent() {},
  };
  return async function launch() {
    return { async newPage() { return page; }, async close() {} };
  };
}

function counter() { let t = 0; return () => (t += 1); }

async function runTrials() {
  const misses = [];
  const r = await observe('https://example.com', { launchBrowser: breachLaunch(), now: counter(), deadlineMs: 4000 });
  if (!r.lane || r.lane.ran !== true) {
    misses.push('pre-consent: expected lane.ran=true, got ' + JSON.stringify(r.lane));
    return misses;
  }
  const kinds = r.observed.map((o) => o.kind);
  if (!kinds.includes('cookie_pre_consent')) misses.push('pre-consent: the _ga cookie set before consent was NOT flagged (cookie_pre_consent missing) - the PECR detector did not earn its zero (C-039)');
  if (!kinds.includes('tracker_request_pre_consent')) misses.push('pre-consent: the Google Analytics request fired before consent was NOT flagged (tracker_request_pre_consent missing)');
  if (r.observed.some((o) => o.name === 'PHPSESSID')) misses.push('pre-consent: the essential session cookie PHPSESSID was wrongly flagged as a breach (false positive, Rule 10)');
  const cookie = r.observed.find((o) => o.kind === 'cookie_pre_consent');
  if (cookie && !(cookie.artifact && cookie.artifact.type === 'cookie_jar_entry')) misses.push('pre-consent: the cookie breach carries no deterministic artifact (Rule 3)');
  return misses;
}

async function calibrate() {
  const misses = await runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p3-browser-preconsent-breach',
    message: 'trap caught: a pre-consent _ga cookie and GA tracker request are flagged with artifacts; the session cookie is not (C-039 / Rule 3 / Rule 10)',
  }];
}

module.exports = { breachLaunch, runTrials, calibrate };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p3-browser-preconsent-breach: trap MISSED - the pre-consent detector did not fire on planted disease');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p3-browser-preconsent-breach', findings }));
    process.exit(0);
  });
}
