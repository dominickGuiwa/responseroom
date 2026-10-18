import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
// Runs the storage helpers and action() from public/app.js against mock storage, without a browser.
const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('// Drafts are keyed'),source.indexOf('let session=null'));
const actionFn=source.slice(source.indexOf('// Returns true only'),source.indexOf('function ended('));
const mockStorage=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),map:m}};
function load({local={},tab={}}={}){
 const context=vm.createContext({localStorage:mockStorage(local),sessionStorage:mockStorage(tab),crypto:{randomUUID:(()=>{let n=0;return()=>'key-'+ ++n})()},paintMessages:()=>{},calls:[],pending:[]});
 vm.runInContext(helpers+actionFn+`;var session=null;function api(path,body,key){calls.push({path,body,key});return new Promise((resolve,reject)=>pending.push({resolve,reject}))}`,context);
 return context;
};
const v=(c,expr)=>vm.runInContext(expr,c);
const A={id:'aaaa',token:'ta'},B={id:'bbbb',token:'tb'};

test('drafts are isolated per session and survive switching back',()=>{const c=load();vm.runInContext(`setAuth(${JSON.stringify(A)});store.set(draftKey('draft'),'to Fire: north');store.set(draftKey('record-drafts'),{entrance:'North'});setAuth(${JSON.stringify(B)})`,c);assert.equal(v(c,"draft"),'');assert.equal(v(c,"JSON.stringify(recordDrafts)"),"{}");vm.runInContext(`setAuth(${JSON.stringify(A)})`,c);assert.equal(v(c,"draft"),'to Fire: north');assert.equal(v(c,"recordDrafts").entrance,'North')});

test('active session is per tab; a new tab is seeded from the last started session',()=>{const c1=load();vm.runInContext(`setAuth(${JSON.stringify(A)})`,c1);const shared=Object.fromEntries(c1.localStorage.map);const c2=load({local:shared,tab:{'rr-session':JSON.stringify(B)}});assert.equal(v(c2,"auth").id,'bbbb');const c3=load({local:shared});assert.equal(v(c3,"auth").id,'aaaa')});

test('late response for a session the tab has left is dropped',async()=>{const c=load();vm.runInContext(`setAuth(${JSON.stringify(A)});session={id:'aaaa',status:'active'}`,c);const result=vm.runInContext(`action('send',{to:'Fire',text:'x'})`,c);assert.equal(c.calls[0].key,'ta');vm.runInContext(`setAuth(${JSON.stringify(B)});session={id:'bbbb',status:'active'}`,c);c.pending[0].resolve({id:'aaaa',status:'ended'});assert.equal(await result,false);assert.equal(c.session.id,'bbbb');assert.equal(c.session.status,'active')});

test('retry ID is reused after a network failure, replaced after success, and kept per tab',async()=>{const c=load();vm.runInContext(`setAuth(${JSON.stringify(A)})`,c);let p=vm.runInContext(`action('send',{to:'Fire',text:'Copy'})`,c);c.pending[0].reject(new Error('offline'));await assert.rejects(p);p=vm.runInContext(`action('send',{to:'Fire',text:'Copy'})`,c);assert.equal(c.calls[1].body.key,c.calls[0].body.key);c.pending[1].resolve({id:'aaaa'});assert.equal(await p,true);p=vm.runInContext(`action('send',{to:'Fire',text:'Copy'})`,c);assert.notEqual(c.calls[2].body.key,c.calls[0].body.key);c.pending[2].resolve({id:'aaaa'});await p;assert.equal([...c.localStorage.map.keys()].some(k=>k.startsWith('rr-request-')),false)});

test('legacy global drafts migrate to the stored session once',()=>{const c=load({local:{'rr-session':JSON.stringify(A),'rr-draft':'old text','rr-record-drafts':JSON.stringify({notes:'n'}),'rr-to':'EMS'}});assert.equal(v(c,"draft"),'old text');assert.equal(v(c,"recordDrafts").notes,'n');assert.equal(v(c,"recipient"),'EMS');assert.equal(c.localStorage.getItem('rr-draft'),null)});
