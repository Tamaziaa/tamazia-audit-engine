'use strict';
// eval/calibration-known-bad/fixtures/p2-health-deep-nested-function.js
//
// Seeded known-bad input for tools/health-gate/check.js. This single function is deliberately shaped
// to trip every one of the gate's five caps at once (Constitution Rule 4: a gate must demonstrably
// fail on a seeded bad fixture on every run):
//   - > 60 lines            (80 lines in the body below)
//   - nesting depth > 4      (five nested "if" levels)
//   - > 12 decision points   (if/for/while/case/&&/||/ternary, more than a dozen)
//   - > 5 parameters         (seven formal parameters)
// It is intentionally never called or exported for real use: it exists only to be caught.

function processEverythingAtOnce(alpha, bravo, charlie, delta, echo, foxtrot, golf) {
  let total = 0;
  const bucket = [];

  if (alpha) {
    if (bravo) {
      if (charlie) {
        if (delta) {
          if (echo) {
            total += 1;
          }
        }
      }
    }
  }

  for (let i = 0; i < alpha; i++) {
    if (i % 2 === 0 && bravo) {
      total += i;
    } else if (i % 3 === 0 || charlie) {
      total -= i;
    }
  }

  let j = 0;
  while (j < bravo) {
    if (j % 2 === 0 && delta) {
      bucket.push(j);
    }
    j++;
  }

  switch (foxtrot) {
    case 1:
      total += 1;
      break;
    case 2:
      total += 2;
      break;
    case 3:
      total += 3;
      break;
    case 4:
      total += 4;
      break;
    default:
      total += 0;
  }

  const label = alpha ? 'has-alpha' : 'no-alpha';
  const size = bravo ? (charlie ? 'big' : 'medium') : 'small';
  const flag = (delta && echo) || (foxtrot && golf) ? 'flagged' : 'clear';

  if (golf && (alpha || bravo) && charlie) {
    total += golf;
  }

  bucket.push(label, size, flag);

  for (const item of bucket) {
    if (item === 'flagged' && delta) {
      total += 10;
    } else if (item === 'clear' && echo) {
      total -= 10;
    }
  }

  if (total > 0 && bravo > 0 && charlie > 0 && delta > 0 && echo > 0) {
    return { total, bucket, ok: true };
  }

  return { total, bucket, ok: false };
}

module.exports = { processEverythingAtOnce };
