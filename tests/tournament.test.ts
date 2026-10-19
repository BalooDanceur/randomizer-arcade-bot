import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JsonStorage} from '../src/storage.js';
import {ActiveListManager} from '../src/list-manager.js';
import {handleCommand} from '../src/commands.js';
import {TournamentAuto} from '../src/tournament-auto.js';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'arcade-'));
 return {dir,context:{storage:new JsonStorage(join(dir,'state.json')),listManager:new ActiveListManager(join(dir,'list.json'),'sets/sample-sets.txt'),admins:['Admin'],teamSize:6,sameName:false}};
}
test('resend is private, preserves the draw, and never exposes the team to the admin',async()=>{
 const {dir,context}=fixture();const sent:Array<[string,string]>=[];
 try{
 context.storage.startTournament();
 const team={player:'Player',round:1,sets:[],rawTeam:'Pikachu\n- Thunderbolt',createdAt:'saved',pasteUrl:'https://pokepast.es/0123456789abcdef'};
 context.storage.getOrCreateTeam('Player',()=>team);
 const ctx={...context,sendPrivateTeam:(p:string,r:string)=>sent.push([p,r])};
 assert.match(await handleCommand('$resend Player','Guest',ctx),/réservée aux admins/);
 assert.match(await handleCommand('$resend Player','Admin',ctx,{isPrivateMessage:false}),/en MP/);
 assert.equal(sent.length,0);
 const answer=await handleCommand('$resend Player','Admin',ctx);
 assert.match(answer,/mis en file/);assert.ok(!answer.includes('Pikachu'));
 assert.equal(sent[0]?.[0],'player');assert.match(sent[0]![1],/Pikachu/);
 assert.deepEqual(context.storage.load().teamsByRound['1']?.player,team);
 assert.match(await handleCommand('$resend Missing','Admin',ctx),/Aucune équipe/);
 assert.equal(sent.length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('permanent mode ignores other names, distributes stable teams, then archives before the next RandArcade',async()=>{
 const {dir,context}=fixture();const sent:string[]=[],errors:string[]=[];
 const auto=new TournamentAuto({room:'arcade',context,sendWire:()=>{},notifyError:m=>errors.push(m),watch:()=>{},renderTeam:async t=>t.rawTeam,sendTeam:(p)=>sent.push(p),exportHistory:()=>join(dir,'export.md')});
 const packet=(s:string)=>auto.processPacket('>arcade\n'+s);
 try{
 auto.command('permanent on');
 packet('|tournament|create|Other|Single Elimination|0\n|tournament|start|2');
 assert.equal(context.storage.load().isStarted,false);
 packet('|tournament|end|{}');
 packet('|tournament|create|RandArcade|Single Elimination|0\n|tournament|start|2');
 const bracket={type:'tree',rootNode:{state:'available',children:[{team:'Alice'},{team:'Bob'}]}};
 const update='|tournament|update|'+JSON.stringify({bracketData:bracket})+'\n|tournament|updateEnd';
 packet(update);await auto.idle();assert.equal(sent.length,2);
 const teams=structuredClone(context.storage.load().teamsByRound);
 packet(update);await auto.idle();assert.deepEqual(context.storage.load().teamsByRound,teams);assert.equal(sent.length,2);
 packet('|tournament|end|{}');assert.equal(context.storage.load().automation?.phase,'ended');
 packet('|tournament|create|RandArcade|Single Elimination|0');
 assert.deepEqual(context.storage.load().teamsByRound,{});assert.ok(existsSync(join(dir,'archives')));
 assert.equal(context.storage.load().automation?.phase,'armed');assert.deepEqual(errors,[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
