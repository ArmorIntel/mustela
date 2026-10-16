// The guide owns one timer. Environmental suspension preserves its remaining time.
export function createGuide({ render, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  const route = [{ at: 300, stage: 1, cursor: true }, { at: 1000, stage: 2, cursor: true },
    { at: 1850, stage: 3 }, { at: 3300, stage: 4 }, { at: 5600, stage: 5 }];
  let stage = 1, cursor = false, manual = false, paused = false, started = false;
  let visible = false, hidden = false, reduced = false, disposed = false;
  let index = 0, elapsed = 0, since = 0, timer = null;
  function stop() {
    if (timer !== null) { elapsed += now() - since; cancel(timer); timer = null; }
  }
  function update() {
    const suspended = !visible || hidden || reduced || paused;
    render({ stage, cursor: cursor && !suspended && !manual, manual, paused, suspended });
    if (disposed || manual || suspended || index === route.length || timer !== null) return;
    started = true; since = now();
    timer = schedule(() => {
      elapsed = route[index].at; timer = null;
      const next = route[index++]; stage = next.stage; cursor = !!next.cursor;
      update();
    }, Math.max(0, route[index].at - elapsed));
  }
  return {
    conditions(values) {
      stop();
      visible = values.visible ?? visible; hidden = values.hidden ?? hidden; reduced = values.reduced ?? reduced;
      update();
    },
    takeControl(value = stage) { stop(); manual = true; stage = value; cursor = false; update(); },
    pause() { stop(); paused = !paused; update(); },
    replay() {
      stop(); stage = 1; cursor = false; manual = false; paused = false; started = true;
      index = 0; elapsed = 0; update();
    },
    dispose() { stop(); disposed = true; },
    get started() { return started; }
  };
}

export function exampleInvestigation(kind, analystNote = '') {
  const domain = kind === 'DOMAIN';
  const sources = [
    { name: 'VirusTotal', kind: 'Signal', score: domain ? 64 : 92, evidence: domain ? 'Fictional detections: 7 malicious, 2 suspicious.' : 'Fictional detections: 18 malicious, 3 suspicious.' },
    ...(!domain ? [
      { name: 'AbuseIPDB', kind: 'Signal', score: 96, evidence: 'Fictional abuse confidence: 96/100. Repeated example reports.' },
      { name: 'Shodan', kind: 'Context', evidence: 'Fictional exposed services: 443 and 8443. Not a maliciousness score.' }
    ] : []),
    { name: 'MISP', kind: 'Internal signal', evidence: 'Fictional matching attribute in an internal event. Configured instance only; no public pivot.' }
  ];
  return {
    fictional: true, ioc: { kind, value: domain ? 'update.example.org' : '203.0.113.42' },
    verdict: domain ? 'suspicious' : 'malicious', score: domain ? 64 : 92, sources,
    recommendations: ['Correlate endpoint and DNS evidence before containment.'],
    aiBrief: 'Fictional AI brief: validate the related process before escalating. No model was called.',
    analystNote,
    disclaimer: 'Offline fictional demonstration. All scores, sources, recommendations and AI output are fictional; not a live threat assessment.'
  };
}
