// Built-in fictional situations so trainees get a new call on every run with no instructor setup.
// These are shipped DEMO ONLY content: fictional places, no real procedures. Each session pins a full copy of the
// situation it ran, so later edits never change a replay. Instructor-approved scenarios join the same rotation.
// Every situation has the same shape the authoring form produces (and passes the same validation, see tests):
// a first caller report with one wrong detail, a later correction, one more caller update, readback-only replies
// for Fire/EMS/Caller (they only ever repeat what the trainee sent) and a time limit.
// Outcome data (used only after a call ends): `keywords` lists ways a trainee might write the corrected and the
// original detail (first entry is the one shown), `places` says where a unit ends up in each case, `detail` names
// the thing that was corrected, `units` names the responding units, and `notes` adds one line of story per result.
const procedures = 'None supplied. Built-in fictional demo situation; not a validated operational procedure. DEMO ONLY.';
const briefing = 'A caller is on the line. Keep your own incident record and message the caller, Fire or EMS when you decide to.';
const crew = (engine, medic) => ({
 units: { Fire: engine, EMS: medic },
 replies: { Fire: `${engine} copies: “{message}”`, EMS: `${medic} copies: “{message}”` },
});

export const SITUATIONS = Object.freeze([
 {
  version: 'demo-community-center-1',
  map: { streets: { north: 'Pier Street', main: 'Bay Road', south: 'Anchor Street', west: 'Dock Avenue', center: 'Harbor Avenue', east: 'Lantern Avenue' }, buildingLabel: 'Harbor House', fire: { label: 'Fire Station 4', km: 1.3 }, ems: { label: 'Medic 2 base (ambulance)', km: 1.9 }, hospital: { label: 'Harbor General Hospital', km: 2.6 }, place: ['harbor house', 'bay road', '220 bay'], original: 'east', corrected: 'north' }, title: 'Smoke at a community center',
  objective: 'Record and relay a corrected entrance.',
  truth: { location: 'Harbor House Community Center, 220 Bay Road', entrance: 'North entrance' },
  initialMessage: 'There’s smoke coming out of Harbor House, the community center on Bay Road! I’m standing at the east entrance.',
  correctionMessage: 'Sorry, I got that wrong. I’m at the north entrance. The smoke is on the north side.', correctionAt: 35000,
  extraCallerLines: [{ at: 80000, text: 'People are coming out of the doors near me now.' }],
  ...crew('Engine 4', 'Medic 2'), endAt: 180000,
  keywords: { corrected: ['north'], original: ['east'] }, detail: 'entrance',
  places: { corrected: 'the north entrance', original: 'the east entrance' },
  notes: { success: 'Crews met the caller at the north doors as people were coming out.', failure: 'Crews set up at the east side, away from the smoke and the people leaving.' },
 },
 {
  version: 'demo-gym-collapse-1',
  map: { streets: { north: 'Weir Street', main: 'Mill Street', south: 'Foundry Street', west: 'River Avenue', center: 'Bend Avenue', east: 'Dam Avenue' }, buildingLabel: 'Riverbend Fitness', points: [{ id: 'lower', label: 'the 1st floor entrance', short: '1st floor entrance', side: 'south' }, { id: 'upper', label: 'the 2nd floor stairs', short: '2nd floor stairs', side: 'north' }, { id: 'pool', label: 'the pool door', short: 'Pool door', side: 'west', keywords: ['pool'] }, { id: 'loading', label: 'the loading door', short: 'Loading door', side: 'east', keywords: ['loading'] }], fire: { label: 'Fire Station 12', km: 1.1 }, ems: { label: 'Medic 6 base (ambulance)', km: 2.2 }, hospital: { label: 'Riverbend Medical Center', km: 1.8 }, place: ['riverbend', 'mill street', '48 mill'], original: 'lower', corrected: 'upper' }, title: 'Person collapsed at a gym',
  objective: 'Record and relay a corrected floor.',
  truth: { location: 'Riverbend Fitness, 48 Mill Street', entrance: 'Second floor' },
  initialMessage: 'A man just collapsed at Riverbend Fitness on Mill Street. We’re on the first floor by the treadmills!',
  correctionMessage: 'Wait, I said that wrong. We’re on the second floor, in the weights room upstairs.', correctionAt: 30000,
  extraCallerLines: [{ at: 75000, text: 'Someone here is helping him. He is breathing but not answering.' }],
  ...crew('Engine 12', 'Medic 6'), endAt: 180000,
  keywords: { corrected: ['second', '2nd', 'upstairs'], original: ['first', '1st'] }, detail: 'floor',
  places: { corrected: 'the second floor', original: 'the first floor' },
  notes: { success: 'Crews went straight upstairs to the weights room.', failure: 'Crews searched the first floor before anyone pointed them upstairs.' },
 },
 {
  version: 'demo-county-road-crash-1',
  map: { kind: 'road', streets: { north: 'Orchard Lane', main: 'County Road 9', south: 'Quarry Road', west: 'Mile 13 Road', center: 'Creek Crossing', east: 'Mile 15 Road' }, marker: 'Mile marker 14', points: [{ id: 'westbound', label: 'the westbound lanes', short: 'Westbound lanes', x: 610, y: 391, lx: -22, ly: -12, anchor: 'end' }, { id: 'eastbound', label: 'the eastbound lanes', short: 'Eastbound lanes', x: 610, y: 409, lx: 22, ly: 28, anchor: 'start' }, { id: 'median', label: 'the median', short: 'Median', x: 470, y: 400, side: 'south', keywords: ['median'] }], approachLabel: 'the shoulder at mile marker 14', fire: { label: 'Fire Station 9', km: 4.2, seconds: 70 }, ems: { label: 'Medic 4 base (ambulance)', km: 5.1, seconds: 84 }, hospital: { label: 'Valley Regional Hospital', km: 9.0 }, place: ['county road 9', 'cr 9', 'cr9', 'mile marker 14', 'mm 14', 'mm14'], original: 'eastbound', corrected: 'westbound', zoom: 2.6 }, title: 'Two-car crash on a county road',
  objective: 'Record and relay a corrected direction of travel.',
  truth: { location: 'County Road 9 near mile marker 14', entrance: 'Westbound lanes' },
  initialMessage: 'There’s been a crash on County Road 9 near mile marker 14. It’s in the eastbound lanes.',
  correctionMessage: 'Correction, it’s the westbound side. I crossed over to look and I was wrong.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'One of the cars is leaking something onto the road.' }],
  ...crew('Engine 9', 'Medic 4'), endAt: 180000,
  keywords: { corrected: ['westbound', 'west bound', 'west side', 'wb'], original: ['eastbound', 'east bound', 'east side', 'eb'] }, detail: 'side of the road',
  places: { corrected: 'the westbound lanes', original: 'the eastbound lanes' },
  notes: { success: 'Crews reached both cars on the westbound side.', failure: 'Crews lost time turning around to reach the westbound side.' },
 },
 {
  version: 'demo-gas-smell-1',
  map: { streets: { north: 'Birch Street', main: 'Maple Street', south: 'Cedar Street', west: 'Park Avenue', center: 'Court Avenue', east: 'Grove Avenue' }, buildingLabel: 'Maple Court Apts', points: [{ id: '3a', label: 'unit 3A', short: '3A', side: 'south', slot: 0, keywords: ['3a', '3 a'] }, { id: '3b', label: 'unit 3B', short: '3B', side: 'south', slot: 1 }, { id: 'stairs', label: 'the stairwell', short: 'Stairs', side: 'south', slot: 2, keywords: ['stairs', 'stairwell'] }, { id: '3c', label: 'unit 3C', short: '3C', side: 'south', slot: 3, keywords: ['3c', '3 c'] }, { id: '3d', label: 'unit 3D', short: '3D', side: 'south', slot: 4 }], fire: { label: 'Fire Station 2', km: 0.9 }, ems: { label: 'Medic 7 base (ambulance)', km: 2.4 }, hospital: { label: 'Maple Grove Hospital', km: 3.1 }, place: ['maple court', 'maple street', '412 maple'], original: '3d', corrected: '3b' }, title: 'Gas smell in an apartment building',
  objective: 'Record and relay a corrected unit number.',
  truth: { location: 'Maple Court Apartments, 412 Maple Street', entrance: 'Unit 3B' },
  initialMessage: 'I smell gas really strongly at Maple Court Apartments, 412 Maple Street. It’s coming from unit 3D.',
  correctionMessage: 'Sorry, I misread the door. It’s unit 3B, right next to the stairs.', correctionAt: 30000,
  extraCallerLines: [{ at: 85000, text: 'My neighbors are starting to leave the building.' }],
  ...crew('Engine 2', 'Medic 7'), endAt: 180000,
  keywords: { corrected: ['3b', '3 b'], original: ['3d', '3 d'] }, detail: 'unit number',
  places: { corrected: 'unit 3B', original: 'unit 3D' },
  notes: { success: 'Crews went to unit 3B by the stairs and found the source.', failure: 'Crews knocked on the wrong door while the smell got stronger.' },
 },
 {
  version: 'demo-restaurant-kitchen-1',
  map: { streets: { north: 'Alley Row', main: 'Pine Avenue', south: 'Spruce Street', west: 'Second Avenue', center: 'Market Avenue', east: 'Garden Avenue' }, buildingLabel: 'Lotus Garden', points: [{ id: 'front', label: 'the front door', short: 'Front door', side: 'south' }, { id: 'back', label: 'the back alley door', short: 'Back alley door', side: 'north' }, { id: 'patio', label: 'the patio gate', short: 'Patio gate', side: 'east', keywords: ['patio'] }, { id: 'delivery', label: 'the delivery bay', short: 'Delivery bay', side: 'west', keywords: ['delivery'] }], fire: { label: 'Fire Station 11', km: 1.6 }, ems: { label: 'Medic 1 base (ambulance)', km: 1.4 }, hospital: { label: 'Pine Avenue Hospital', km: 2.0 }, place: ['lotus garden', 'pine avenue', '15 pine'], original: 'front', corrected: 'back' }, title: 'Kitchen fire at a restaurant',
  objective: 'Record and relay a corrected access point.',
  truth: { location: 'Lotus Garden Restaurant, 15 Pine Avenue', entrance: 'Back alley door' },
  initialMessage: 'Fire in the kitchen at Lotus Garden on Pine Avenue! Come to the front door.',
  correctionMessage: 'The front door is locked. Use the back alley door, that’s where we are.', correctionAt: 35000,
  extraCallerLines: [{ at: 80000, text: 'Everyone is outside but the smoke is getting thicker.' }],
  ...crew('Engine 11', 'Medic 1'), endAt: 180000,
  keywords: { corrected: ['back', 'alley', 'rear'], original: ['front'] }, detail: 'door',
  places: { corrected: 'the back alley door', original: 'the locked front door' },
  notes: { success: 'Crews came in through the alley and reached the kitchen.', failure: 'Crews found the front door locked and had to go around.' },
 },
 {
  version: 'demo-work-site-fall-1',
  map: { streets: { north: 'Depot Street', main: 'Industrial Way', south: 'Rail Street', west: 'Steel Avenue', center: 'Crane Avenue', east: 'Yard Avenue' }, buildingLabel: 'Northgate site', points: [{ id: 'gate-a', label: 'Gate A', short: 'Gate A', side: 'west' }, { id: 'gate-b', label: 'Gate B', short: 'Gate B', side: 'south', keywords: ['gate b'] }, { id: 'gate-c', label: 'Gate C', short: 'Gate C', side: 'east' }, { id: 'gate-d', label: 'Gate D', short: 'Gate D', side: 'north', keywords: ['gate d'] }], fire: { label: 'Fire Station 6', km: 2.0 }, ems: { label: 'Medic 3 base (ambulance)', km: 2.8 }, hospital: { label: 'Northgate Hospital', km: 3.4 }, place: ['northgate', 'industrial way', '900 industrial'], original: 'gate-a', corrected: 'gate-c' }, title: 'Fall at a construction site',
  objective: 'Record and relay a corrected gate.',
  truth: { location: 'Northgate construction site, 900 Industrial Way', entrance: 'Gate C' },
  initialMessage: 'A worker fell off a ladder at the Northgate site on Industrial Way. Have them come in at Gate A.',
  correctionMessage: 'Change that, Gate A is blocked by a truck. Use Gate C.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'He’s awake but he can’t stand up.' }],
  ...crew('Engine 6', 'Medic 3'), endAt: 180000,
  keywords: { corrected: ['gate c'], original: ['gate a'] }, detail: 'gate',
  places: { corrected: 'Gate C', original: 'Gate A, which is blocked' },
  notes: { success: 'Crews drove in through Gate C and reached the worker.', failure: 'Crews were stopped at the blocked gate.' },
 },
 {
  version: 'demo-elevator-1',
  map: { streets: { north: 'Summit Street', main: 'Grand Street', south: 'Plaza Street', west: 'Tower Avenue', center: 'Union Avenue', east: 'Bank Avenue' }, buildingLabel: 'Summit Office Tower', points: [{ id: 'e1', label: 'elevator 1', short: 'Elev. 1', side: 'south', slot: 0, keywords: ['elevator 1', 'elevator one', 'car 1'] }, { id: 'e2', label: 'elevator 2', short: 'Elev. 2', side: 'south', slot: 1 }, { id: 'e3', label: 'elevator 3', short: 'Elev. 3', side: 'south', slot: 2, keywords: ['elevator 3', 'elevator three', 'car 3'] }, { id: 'e4', label: 'elevator 4', short: 'Elev. 4', side: 'south', slot: 3 }, { id: 'freight', label: 'the freight elevator', short: 'Freight', side: 'north', keywords: ['freight'] }], fire: { label: 'Fire Station 8', km: 0.8 }, ems: { label: 'Medic 5 base (ambulance)', km: 1.5 }, hospital: { label: 'Grand Street Medical', km: 1.2 }, place: ['summit', 'grand street', '300 grand'], original: 'e2', corrected: 'e4' }, title: 'People stuck in an elevator',
  objective: 'Record and relay a corrected elevator number.',
  truth: { location: 'Summit Office Tower, 300 Grand Street', entrance: 'Elevator 4' },
  initialMessage: 'We’re stuck in elevator 2 at Summit Tower on Grand Street, somewhere around the 12th floor.',
  correctionMessage: 'Sorry, the sign in here says elevator 4, not 2.', correctionAt: 35000,
  extraCallerLines: [{ at: 85000, text: 'One person in here is feeling faint.' }],
  ...crew('Engine 8', 'Medic 5'), endAt: 180000,
  keywords: { corrected: ['elevator 4', 'elevator four', 'car 4'], original: ['elevator 2', 'elevator two', 'car 2'] }, detail: 'elevator number',
  places: { corrected: 'elevator 4', original: 'elevator 2' },
  notes: { success: 'Crews opened elevator 4 and helped everyone out.', failure: 'Crews worked on the wrong elevator first.' },
 },
 {
  version: 'demo-trailhead-brush-fire-1',
  map: { streets: { north: 'Canyon Road', main: 'Ridge Road', south: 'Valley Road', west: 'Pass Road', center: 'Oak Hollow Road', east: 'Creek Road' }, buildingLabel: 'Oak Hollow trailhead', points: [{ id: 'north-lot', label: 'the north parking lot', short: 'North lot', side: 'north' }, { id: 'south-lot', label: 'the south parking lot', short: 'South lot', side: 'south' }, { id: 'kiosk', label: 'the ranger kiosk', short: 'Ranger kiosk', side: 'west', keywords: ['kiosk', 'ranger'] }, { id: 'trail', label: 'the trail start', short: 'Trail start', side: 'east', keywords: ['trail start', 'trailhead sign'] }], fire: { label: 'Fire Station 15', km: 3.6, seconds: 68 }, ems: { label: 'Medic 8 base (ambulance)', km: 4.4, seconds: 80 }, hospital: { label: 'Ridge Valley Hospital', km: 7.5 }, place: ['oak hollow', 'ridge road', 'trailhead'], original: 'north-lot', corrected: 'south-lot' }, title: 'Brush fire near a trailhead',
  objective: 'Record and relay a corrected parking lot.',
  truth: { location: 'Oak Hollow trailhead, Ridge Road', entrance: 'South parking lot' },
  initialMessage: 'There’s a small brush fire by the Oak Hollow trailhead off Ridge Road. I’m in the north parking lot.',
  correctionMessage: 'I got turned around. It’s the south parking lot, by the restrooms.', correctionAt: 40000,
  extraCallerLines: [{ at: 90000, text: 'The wind is pushing it toward the trees.' }],
  ...crew('Engine 15', 'Medic 8'), endAt: 180000,
  keywords: { corrected: ['south'], original: ['north'] }, detail: 'parking lot',
  places: { corrected: 'the south parking lot', original: 'the north parking lot' },
  notes: { success: 'Crews reached the fire from the south lot before it spread far.', failure: 'Crews drove to the north lot while the fire moved toward the trees.' },
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
