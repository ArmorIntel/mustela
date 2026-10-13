import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuide, exampleInvestigation } from '../docs/assets/landing/demo-state.js';

function fixture() {
  let time = 0, serial = 0;
  const jobs = new Map(), events = [];
  const guide = createGuide({
    now: () => time,
    schedule: (fn, ms) => { jobs.set(++serial, { fn, at: time + ms }); return serial; },
    cancel: id => jobs.delete(id),
    render: state => events.push({ ...state })
  });
  const advance = ms => {
    const end = time + ms;
    while (jobs.size) {
      const [id, job] = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (job.at > end) break;
      time = job.at; jobs.delete(id); job.fn();
    }
    time = end;
  };
  return { guide, jobs, events, advance };
}

test('guide reveals cursor, loading, verdict, evidence and actions in order', () => {
  const { guide, events, advance, jobs } = fixture();
  guide.conditions({ visible: true });
  advance(300); assert.equal(events.at(-1).cursor, true);
  advance(700); assert.equal(events.at(-1).stage, 2);
  advance(4600); assert.deepEqual([...new Set(events.map(s => s.stage))], [1, 2, 3, 4, 5]);
  assert.equal(jobs.size, 0);
});

test('combined lifecycle suspensions retain remaining time and never restart or overwrite manual state', () => {
  const { guide, events, advance, jobs } = fixture();
  guide.conditions({ visible: true }); advance(1200);
  guide.conditions({ hidden: true }); guide.conditions({ visible: false, reduced: true });
  advance(10000); assert.equal(events.at(-1).stage, 2); assert.equal(jobs.size, 0);
  guide.conditions({ hidden: false, visible: true }); advance(10000);
  assert.equal(events.at(-1).stage, 2);
  guide.conditions({ reduced: false }); advance(649); assert.equal(events.at(-1).stage, 2);
  advance(1); assert.equal(events.at(-1).stage, 3);
  guide.takeControl(1); guide.conditions({ reduced: true }); guide.conditions({ reduced: false });
  advance(10000); assert.equal(events.at(-1).stage, 1); assert.equal(jobs.size, 0);
});

test('explicit pause survives lifecycle changes; replay is the only reset', () => {
  const { guide, advance, events, jobs } = fixture();
  guide.conditions({ visible: true }); advance(2000); guide.pause();
  guide.conditions({ visible: false, hidden: true, reduced: true });
  guide.conditions({ visible: true, hidden: false, reduced: false }); advance(10000);
  assert.equal(events.at(-1).stage, 3); assert.equal(jobs.size, 0);
  guide.pause(); advance(1300); assert.equal(events.at(-1).stage, 4);
  guide.replay(); assert.equal(events.at(-1).stage, 1);
  guide.takeControl(5); advance(10000); assert.equal(events.at(-1).stage, 5);
  guide.dispose(); assert.equal(jobs.size, 0);
});

test('fictional export follows provider eligibility and retains notes literally', () => {
  const note = '<img src=x onerror=alert(1)>' + 'long note '.repeat(2000);
  const ip = exampleInvestigation('IP', note), domain = exampleInvestigation('DOMAIN', note);
  assert.deepEqual(ip.sources.map(s => s.name), ['VirusTotal', 'AbuseIPDB', 'Shodan', 'MISP']);
  assert.deepEqual(domain.sources.map(s => s.name), ['VirusTotal', 'MISP']);
  assert.equal(ip.sources.find(s => s.name === 'Shodan').kind, 'Context');
  assert.equal(JSON.parse(JSON.stringify(domain)).analystNote, note);
  assert.equal(domain.fictional, true); assert.match(domain.disclaimer, /scores.*sources.*recommendations.*AI/i);
});
