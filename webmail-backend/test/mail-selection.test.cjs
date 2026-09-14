const test = require('node:test');
const assert = require('node:assert/strict');
const { MailSelectionStore } = require('../src/mail-selection');
const group = (folder, count=1) => ({ folder, uidValidity: '9', uids: Array.from({length:count},(_,i)=>i+1), junk:folder==='Junk', trash:folder==='Trash' });
test('selection snapshots preserve folder identity, batch cursors, and duplicate response replay', async () => {
 const store = new MailSelectionStore(); const snapshot=store.create('owner',[group('INBOX',101),group('Other')]);
 let release; const wait=new Promise(r=>release=r); const writes=[];
 const run=async g=>{writes.push(g);await wait;};
 const first=store.apply('owner',snapshot.token,0,'read',run);
 const duplicate=store.apply('owner',snapshot.token,0,'read',run);
 await assert.rejects(store.apply('stranger',snapshot.token,0,'read',run),/expired/);
 release(); assert.equal((await first).completed,100); assert.equal((await duplicate).completed,100); assert.equal(writes.length,1);
 assert.equal((await store.apply('owner',snapshot.token,0,'read',run)).completed,100); assert.equal(writes.length,1);
 assert.equal((await store.apply('owner',snapshot.token,100,'read',run)).completed,101);
 assert.equal((await store.apply('owner',snapshot.token,101,'read',run)).state,'complete');
 assert.equal(writes[2].folder,'Other'); assert.deepEqual(writes[2].uids,[1]);
});
test('cancellation preserves acknowledged progress and uncertainty is never automatically replayed', async()=>{
 const store=new MailSelectionStore(); const snap=store.create('owner',[group('Junk',201)]); let writes=0;
 const result=await store.apply('owner',snap.token,0,'spam',async()=>{writes++;store.cancel('owner',snap.token);});
 assert.equal(result.completed,100); assert.equal(result.state,'cancelled');
 await store.apply('owner',snap.token,100,'spam',async()=>{writes++;}); assert.equal(writes,1);
 const other=store.create('owner',[group('Trash')]);
 const uncertain=await store.apply('owner',other.token,0,'delete',async()=>{writes++;throw new Error('lost acknowledgement');});
 assert.equal(uncertain.state,'uncertain'); assert.equal(uncertain.includesTrash,true);
 await store.apply('owner',other.token,0,'delete',async()=>{writes++;}); assert.equal(writes,2);
});
test('selection expiry, operation binding and size limits fail closed',async()=>{
 let now=0; const store=new MailSelectionStore(()=>now); const snap=store.create('owner',[group('Junk',101)]);
 assert.equal(snap.allJunk,true); await store.apply('owner',snap.token,0,'read',async()=>{});
 await assert.rejects(store.apply('owner',snap.token,100,'delete',async()=>{}),/different action/);
 now=600001; await assert.rejects(store.apply('owner',snap.token,100,'read',async()=>{}),/expired/);
 assert.throws(()=>store.create('owner',[group('INBOX',10001)]),/10,000/);
});


test('bulk actions reject changed mailbox identity and false acknowledgements; custom Trash deletes permanently', async()=>{
 process.env.OMS_DB_PASSWORD ||= 'selection-test';
 const {ImapService}=require('../src/imap.js');
 const calls=[];const client={mailboxOpen:async()=>({uidValidity:9}),mailboxClose:async()=>{},list:async()=>[{path:'Deleted Items',specialUse:'\\Trash'}],messageDelete:async()=>{calls.push('delete');return true;},messageFlagsAdd:async()=>false};
 const service={client};
 await assert.rejects(ImapService.prototype.messageAction.call(service,'INBOX',[1],'read',undefined,'8'),/identity changed/);
 await assert.rejects(ImapService.prototype.messageAction.call(service,'INBOX',[1],'read',undefined,'9'),/did not acknowledge/);
 await ImapService.prototype.messageAction.call(service,'Deleted Items',[1],'delete',undefined,'9');assert.deepEqual(calls,['delete']);
});
