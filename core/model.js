// The Nyx recovery chain as modelled here. Public facts are cited; everything
// else is a labelled ASSUMPTION the user can change in the app.

export const ELEMENTS = {
  trigger:  { name: 'Deploy trigger & sequencer', note: 'Avionics that detect the transonic window and fire the drogue mortars (Mission Possible lost contact at 26 km, before this event).' },
  mortar:   { name: 'Drogue mortar', note: 'Pyrotechnic mortar that ejects one drogue pack.' },
  drogue:   { name: 'Drogue canopy', note: 'Supplied by Airborne Systems (flight heritage per TEC).' },
  cutter:   { name: 'Reefing-line cutter', note: 'Pyro cutter that disreefs a canopy on time; two per canopy.' },
  handover: { name: 'Drogue-to-main handover', note: 'Drogue release and main extraction, the focus of the May 2026 drop test.' },
  main:     { name: 'Main canopy', note: 'Four mains; splashdown speed is acceptable with three.' },
  float:    { name: 'Splashdown & flotation', note: 'Water impact, uprighting and beacon (20 subscale tank drops, Jan 2026).' },
};

// ASSUMPTION: architecture. Each element sits in exactly one stage.
export function stagesFor(arch) {
  return [
    arch.dualTrigger
      ? { id: 'trigger', label: 'Deploy trigger', elements: ['trigger'], kind: 'dual', beta: arch.ccf ?? 0.1 }
      : { id: 'trigger', label: 'Deploy trigger', elements: ['trigger'], kind: 'kofn', n: 1, k: 1 },
    { id: 'drogues', label: 'Drogues', elements: ['mortar', 'drogue'], kind: 'kofn', n: 2, k: 1 },
    { id: 'cutters', label: 'Disreef cutters', elements: ['cutter'], kind: 'kofn', n: 2, k: 1 },
    { id: 'handover', label: 'Handover', elements: ['handover'], kind: 'kofn', n: 1, k: 1 },
    { id: 'mains', label: 'Main canopies', elements: ['main'], kind: 'kofn', n: 4, k: arch.mainsNeeded ?? 3 },
    { id: 'float', label: 'Splashdown', elements: ['float'], kind: 'kofn', n: 1, k: 1 },
  ];
}

// ASSUMPTION: priors. Jeffreys Beta(0.5, 0.5) for TEC-built items; heritage
// canopies get a discounted prior worth 10 successful uses (Airborne Systems flight heritage).
export const PRIOR = {
  trigger: { a: 0.5, b: 0.5 }, mortar: { a: 0.5, b: 0.5 }, drogue: { a: 10.5, b: 0.5 },
  cutter: { a: 0.5, b: 0.5 }, handover: { a: 0.5, b: 0.5 }, main: { a: 10.5, b: 0.5 }, float: { a: 0.5, b: 0.5 },
};

// Public evidence. Attribution to elements is ours (TEC has not published the root cause).
export const EVIDENCE = [
  { id: 'mp', date: '2025-06-24', title: 'Mission Possible flight', source: 'https://www.exploration.space/blog/mission-possible-re-entry-milestone-achieved-for-europes-reusable-spaceflight',
    summary: 'Controlled re-entry; contact lost at 26 km before the transonic phase; parachutes did not deploy (TEC, Jun and Nov 2025). Counted as one trigger failure at quarter weight because TEC says the lessons were implemented on Nyx (ASSUMPTION, adjustable).',
    weight: 0.25, trials: { trigger: [0, 1] } },
  { id: 'splash', date: '2026-01-28', title: '20 splashdown tank drops (1:4 scale)', source: 'https://europeanspaceflight.com/the-exploration-company-completes-nyx-splashdown-tests',
    summary: '20 drops of a 135 kg 1:4 mock-up at CNR-INM Rome. Scale model: half weight.', weight: 0.5, trials: { float: [20, 0] } },
  { id: 'drop', date: '2026-05-19', title: 'Mojave drop test (DTV)', source: 'https://www.exploration.space/blog/nyx-recovery-drop-test',
    summary: 'Drop from 2.8 km: drogues, handover and all four mains nominal, event timings achieved.',
    weight: 1, trials: { trigger: [1, 0], mortar: [2, 0], drogue: [2, 0], cutter: [4, 0], handover: [1, 0], main: [4, 0] } },
];

// ASSUMPTION: test menu and unit costs (EUR k). Trials are per test.
export const TESTS = [
  { id: 'drop', name: 'System drop test (DTV, helicopter)', cost: 450, max: 30, step: 1, trials: { trigger: 1, mortar: 2, drogue: 2, cutter: 4, handover: 1, main: 4 } },
  { id: 'ptv', name: 'Handover test (aircraft drop, parachute test vehicle)', cost: 180, max: 120, step: 4, trials: { handover: 1, main: 4 } },
  { id: 'mortar', name: 'Mortar firing (ground)', cost: 25, max: 80, step: 8, trials: { mortar: 1 } },
  { id: 'cutter', name: 'Cutter firing pair', cost: 10, max: 80, step: 8, trials: { cutter: 2 } },
  { id: 'splash', name: 'Full-scale water impact', cost: 120, max: 60, step: 3, trials: { float: 1 } },
  { id: 'hil', name: 'Trigger end-to-end (HIL, flight-like sensors)', cost: 15, max: 1500, step: 1, trials: { trigger: 1 } },
];
