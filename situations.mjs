// Built-in fictional situations so trainees get a new call on every run with no instructor setup.
// These are shipped DEMO ONLY content: fictional places, no real procedures. Each session pins a full copy of the
// situation it ran, so later edits never change a replay. Instructor-approved scenarios join the same rotation.
// Every situation has the same shape the authoring form produces (and passes the same validation, see tests):
// a first caller report with one wrong detail, a later correction, one more caller update, readback-only replies
// for Fire/EMS/Caller (they only ever repeat what the trainee sent) and a time limit.
// `keywords` drive the instructor's automatic observations (keyword match on the event log), never the trainee view.
const procedures = 'None supplied. Built-in fictional demo situation; not a validated operational procedure. DEMO ONLY.';
const briefing = 'A caller is on the line. Keep your own incident record and message the caller, Fire or EMS when you decide to.';
const replies = (engine, medic) => ({ Fire: `${engine} copies: “{message}”`, EMS: `${medic} copies: “{message}”`, Caller: 'Okay. You said: “{message}”' });

export const SITUATIONS = Object.freeze([
 {
  version: 'demo-community-center-1', title: 'Smoke at a community center',
  objective: 'Record and relay a corrected entrance.',
  truth: { location: 'Harbor House Community Center, 220 Bay Road', entrance: 'North entrance' },
  initialMessage: 'There’s smoke coming out of Harbor House, the community center on Bay Road! I’m standing at the east entrance.',
  correctionMessage: 'Sorry, I got that wrong. I’m at the north entrance. The smoke is on the north side.', correctionAt: 35000,
  extraCallerLines: [{ at: 80000, text: 'People are coming out of the doors near me now.' }],
  replies: replies('Engine 4', 'Medic 2'), endAt: 180000, keywords: { corrected: 'north', original: 'east' },
 },
 {
  version: 'demo-gym-collapse-1', title: 'Person collapsed at a gym',
  objective: 'Record and relay a corrected floor.',
  truth: { location: 'Riverbend Fitness, 48 Mill Street', entrance: 'Second floor' },
  initialMessage: 'A man just collapsed at Riverbend Fitness on Mill Street. We’re on the first floor by the treadmills!',
  correctionMessage: 'Wait, I said that wrong. We’re on the second floor, in the weights room upstairs.', correctionAt: 30000,
  extraCallerLines: [{ at: 75000, text: 'Someone here is helping him. He is breathing but not answering.' }],
  replies: replies('Engine 12', 'Medic 6'), endAt: 180000, keywords: { corrected: 'second', original: 'first' },
 },
 {
  version: 'demo-county-road-crash-1', title: 'Two-car crash on a county road',
  objective: 'Record and relay a corrected direction of travel.',
  truth: { location: 'County Road 9 near mile marker 14', entrance: 'Westbound lanes' },
  initialMessage: 'There’s been a crash on County Road 9 near mile marker 14. It’s in the eastbound lanes.',
  correctionMessage: 'Correction, it’s the westbound side. I crossed over to look and I was wrong.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'One of the cars is leaking something onto the road.' }],
  replies: replies('Engine 9', 'Medic 4'), endAt: 180000, keywords: { corrected: 'westbound', original: 'eastbound' },
 },
 {
  version: 'demo-gas-smell-1', title: 'Gas smell in an apartment building',
  objective: 'Record and relay a corrected unit number.',
  truth: { location: 'Maple Court Apartments, 412 Maple Street', entrance: 'Unit 3B' },
  initialMessage: 'I smell gas really strongly at Maple Court Apartments, 412 Maple Street. It’s coming from unit 3D.',
  correctionMessage: 'Sorry, I misread the door. It’s unit 3B, right next to the stairs.', correctionAt: 30000,
  extraCallerLines: [{ at: 85000, text: 'My neighbors are starting to leave the building.' }],
  replies: replies('Engine 2', 'Medic 7'), endAt: 180000, keywords: { corrected: '3b', original: '3d' },
 },
 {
  version: 'demo-restaurant-kitchen-1', title: 'Kitchen fire at a restaurant',
  objective: 'Record and relay a corrected access point.',
  truth: { location: 'Lotus Garden Restaurant, 15 Pine Avenue', entrance: 'Back alley door' },
  initialMessage: 'Fire in the kitchen at Lotus Garden on Pine Avenue! Come to the front door.',
  correctionMessage: 'The front door is locked. Use the back alley door, that’s where we are.', correctionAt: 35000,
  extraCallerLines: [{ at: 80000, text: 'Everyone is outside but the smoke is getting thicker.' }],
  replies: replies('Engine 11', 'Medic 1'), endAt: 180000, keywords: { corrected: 'back', original: 'front' },
 },
 {
  version: 'demo-work-site-fall-1', title: 'Fall at a construction site',
  objective: 'Record and relay a corrected gate.',
  truth: { location: 'Northgate construction site, 900 Industrial Way', entrance: 'Gate C' },
  initialMessage: 'A worker fell off a ladder at the Northgate site on Industrial Way. Have them come in at Gate A.',
  correctionMessage: 'Change that, Gate A is blocked by a truck. Use Gate C.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'He’s awake but he can’t stand up.' }],
  replies: replies('Engine 6', 'Medic 3'), endAt: 180000, keywords: { corrected: 'gate c', original: 'gate a' },
 },
 {
  version: 'demo-elevator-1', title: 'People stuck in an elevator',
  objective: 'Record and relay a corrected elevator number.',
  truth: { location: 'Summit Office Tower, 300 Grand Street', entrance: 'Elevator 4' },
  initialMessage: 'We’re stuck in elevator 2 at Summit Tower on Grand Street, somewhere around the 12th floor.',
  correctionMessage: 'Sorry, the sign in here says elevator 4, not 2.', correctionAt: 35000,
  extraCallerLines: [{ at: 85000, text: 'One person in here is feeling faint.' }],
  replies: replies('Engine 8', 'Medic 5'), endAt: 180000, keywords: { corrected: 'elevator 4', original: 'elevator 2' },
 },
 {
  version: 'demo-trailhead-brush-fire-1', title: 'Brush fire near a trailhead',
  objective: 'Record and relay a corrected parking lot.',
  truth: { location: 'Oak Hollow trailhead, Ridge Road', entrance: 'South parking lot' },
  initialMessage: 'There’s a small brush fire by the Oak Hollow trailhead off Ridge Road. I’m in the north parking lot.',
  correctionMessage: 'I got turned around. It’s the south parking lot, by the restrooms.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'The wind is pushing it toward the trees.' }],
  replies: replies('Engine 15', 'Medic 8'), endAt: 180000, keywords: { corrected: 'south', original: 'north' },
 },
].map(s => Object.freeze({ ...s, briefing, procedures, builtIn: true })));

// Picks a situation for a new run, avoiding the ones this trainee saw most recently when possible.
export function pickSituation(pool, avoid = [], random = Math.random) {
 if (!pool.length) throw Error('No situations available');
 const recent = new Set(Array.isArray(avoid) ? avoid.slice(-20).map(String) : []);
 const fresh = pool.filter(s => !recent.has(s.version));
 const choices = fresh.length ? fresh : pool.filter(s => s.version !== String(avoid.at?.(-1)));
 const list = choices.length ? choices : pool;
 return list[Math.floor(random() * list.length) % list.length];
}
