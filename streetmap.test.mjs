import {test} from 'node:test';import assert from 'node:assert/strict';import {Engine} from './engine.mjs';import {createServer} from './server.mjs';import {SITUATIONS} from './situations.mjs';import {buildMap,sanitizeSpec,mapState,renderMap} from './public/streetmap.js';
// The map is a pure function of the situation, the event log and the clock, so it is tested without a browser.
const crash=SITUATIONS.find(s=>s.version==='demo-county-road-crash-1'),center=SITUATIONS.find(s=>s.version==='demo-community-center-1');
const msg=(time,from,to,text)=>({kind:'message',time,data:{from,to,text}});
const first=s=>msg(0,'Caller','Dispatcher',s.initialMessage);
const by=(spec,id)=>spec.points.find(p=>p.id===id);

test('every built-in situation builds a map whose corrected point matches its keywords; the trainee spec hides which point matters',()=>{for(const s of SITUATIONS){const spec=buildMap(s);assert.ok(spec.corrected,s.version);assert.ok(by(spec,spec.corrected)&&by(spec,spec.original),s.version);assert.ok(spec.points.length>=3,s.version+' shows more than the two points that matter');const san=JSON.stringify(sanitizeSpec(spec));for(const leak of ['corrected','original','keywords','"place"'])assert.equal(san.includes(leak),false,s.version+' leaks '+leak);assert.ok(spec.decor.length>10)}});

test('units wait at their stations, travel after dispatch and arrive where they were told',()=>{const spec=buildMap(center);const ev=[first(center),msg(10000,'Dispatcher','Fire','Smoke at Harbor House, east entrance')];
 assert.equal(mapState(spec,ev,5000).units.Fire.status,'station');
 const mid=mapState(spec,ev,10000+spec.stations.Fire.seconds*500).units.Fire;assert.equal(mid.status,'enroute');assert.ok(mid.remaining.length>1);assert.equal(mid.targetId,'east');assert.ok(mid.eta>0);
 const done=mapState(spec,ev,10000+spec.stations.Fire.seconds*1000+20000).units.Fire;assert.equal(done.status,'onscene');assert.equal(done.targetId,'east');assert.deepEqual([done.x,done.y],[by(spec,'east').x,by(spec,'east').y]);
 assert.equal(mapState(spec,ev,200000).units.EMS.status,'station')});

test('a later message re-routes a unit from wherever it is, and the caller marker follows the correction',()=>{const spec=buildMap(center);const arrive=10000+spec.stations.Fire.seconds*1000;const ev=[first(center),msg(10000,'Dispatcher','Fire','east entrance'),msg(35000,'Caller','Dispatcher',center.correctionMessage),msg(arrive+20000,'Dispatcher','Fire','Change that: north entrance')];
 const before=mapState(spec,ev,arrive+19000);assert.equal(before.units.Fire.status,'onscene');assert.equal(before.units.Fire.targetId,'east');assert.equal(before.caller.pointId,'north');assert.equal(mapState(spec,ev,34000).caller.pointId,'east');
 const moving=mapState(spec,ev,arrive+22000).units.Fire;assert.equal(moving.status,'enroute');assert.equal(moving.targetId,'north');
 const after=mapState(spec,ev,arrive+60000);assert.equal(after.units.Fire.status,'onscene');assert.equal(after.units.Fire.targetId,'north');
 const kinds=after.notices.map(n=>n.kind);assert.deepEqual(kinds,['centers','caller','dispatch','caller','arrival','reroute','arrival']);assert.match(after.notices[2].text,/Engine 4 leaving Fire Station 4 for the east entrance · ETA \d\d:\d\d/);assert.match(after.notices.at(-2).text,/now heading to the north entrance/);assert.ok(after.notices.every(n=>!/wrong|actual|correct/i.test(n.text)))});

test('a unit told nothing specific goes to the main approach; a correction before arrival only changes the last leg',()=>{const spec=buildMap(center);let ev=[first(center),msg(5000,'Dispatcher','EMS','Harbor House on Bay Road, smoke reported')];let st=mapState(spec,ev,300000);assert.equal(st.units.EMS.targetId,'approach');assert.match(st.notices.find(n=>n.kind==='dispatch').text,/for the main approach/);
 ev=[first(center),msg(5000,'Dispatcher','Fire','east entrance'),msg(20000,'Dispatcher','Fire','make that north entrance')];st=mapState(spec,ev,300000);assert.equal(st.units.Fire.targetId,'north');assert.equal(st.notices.filter(n=>n.kind==='arrival').length,1);assert.match(st.notices.find(n=>n.kind==='reroute').text,/north entrance · ETA/)});

test('the map focuses only when a saved location names the street or building',()=>{const spec=buildMap(center);const rec=(time,value)=>({kind:'record',time,data:{field:'location',value}});
 assert.equal(mapState(spec,[first(center),rec(8000,'somewhere on Elm')],20000).focused,false);
 const st=mapState(spec,[first(center),rec(8000,'Harbor House, 220 Bay Rd')],20000);assert.equal(st.focused,true);assert.equal(st.focusAt,8000);assert.ok(st.notices.some(n=>n.kind==='focus'));
 assert.equal(mapState(spec,[first(center),rec(8000,'Harbor House')],7000).focused,false);assert.equal(mapState(spec,[first(center),{kind:'record',time:8000,data:{field:'notes',value:'Harbor House'}}],20000).focused,false)});

test('road situations use lanes; shorthand like WB counts; authored scenarios get a default map from their hidden entrance',()=>{const spec=buildMap(crash);assert.equal(spec.kind,'road');assert.equal(spec.building,null);const st=mapState(spec,[first(crash),msg(5000,'Dispatcher','EMS','crash at MM 14, WB side')],300000);assert.equal(st.units.EMS.targetId,'westbound');
 const authored=buildMap({title:'Mine',truth:{location:'12 Oak Street',entrance:'North entrance'},replies:{Fire:'Engine 1 copies: “{message}”'}});assert.equal(authored.corrected,'north');assert.deepEqual(authored.points.map(p=>p.id),['north','east','south','west']);assert.ok(authored.place.includes('oak'));
 assert.equal(buildMap({title:'Odd',truth:{location:'Pier 9',entrance:'Rear hatch'}}).corrected,null)});

test('instructor rendering marks the actual location; the live rendering never does; difficulty travel times apply',()=>{const spec=buildMap(center);const st=mapState(spec,[first(center)],1000);const live=renderMap(spec,st,{live:true}),inst=renderMap(spec,st,{instructor:true});assert.equal(live.includes('Actual:'),false);assert.ok(inst.includes('Actual: North entrance'));assert.ok(live.includes('data-live'));assert.ok(live.includes('Nearest centers'));
 const fast=buildMap({...center,difficulty:{level:'hard',label:'Hard',travel:{Fire:40,EMS:48}}});assert.equal(fast.stations.Fire.seconds,40);assert.equal(fast.stations.EMS.seconds,48)});

test('trainee payload carries the sanitized map and live state; difficulty is pinned per run',async()=>{const engine=new Engine(':memory:');const server=createServer(engine,'admin');await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const call=async(path,body,key)=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 try{const s=(await call('sessions',{name:'Dana'})).data;assert.ok(['easy','standard','hard'].includes(s.difficulty.level));assert.ok(s.map.spec.points.length>=3);assert.equal('corrected' in s.map.spec,false);assert.equal(JSON.stringify(s.map.spec).includes('keywords'),false);assert.equal(s.map.state.units.Fire.status,'station');assert.equal(s.map.state.notices[0].kind,'centers');
  const pinned=engine.get(s.id).scenario;assert.equal(pinned.difficulty.level,s.difficulty.level);assert.ok(pinned.correctionAt>=25000&&pinned.correctionAt<=110000);assert.ok(pinned.extraCallerLines.every(l=>l.at>pinned.correctionAt));
  const list=(await call('sessions',null,'admin')).data;assert.equal(list[0].difficulty,s.difficulty.level)}finally{await new Promise(r=>server.close(r));engine.db.close()}});
