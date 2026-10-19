import { randomUUID } from 'node:crypto';
import type { CommandContext } from './commands.js';
import { generateTeam } from './randomizer.js';
import { normalizePlayerId } from './storage.js';
import { exportHistoryToMarkdown } from './exporter.js';
import type { AutomaticTournamentState, GeneratedTeam, TournamentState } from './types.js';

type Node = {team?:string;state?:string;room?:string;children?:Node[]};
type Bracket = {type?:string;rootNode?:Node|null};
type View = {format?:string;generator?:string;isStarted?:boolean;bracketData?:Bracket};
type Pair = {players:[string,string];round:number;room?:string;state:string};
type Dependencies = {
  room: string|null;
  context: CommandContext;
  sendWire: (wire:string)=>void;
  notifyError: (message:string)=>void;
  watch: (room:string,state:TournamentState)=>void;
  unwatch?: (room:string)=>void;
  renderTeam: (team:GeneratedTeam)=>Promise<string>;
  sendTeam: (player:string,response:string)=>void;
  exportHistory?: (state:TournamentState)=>string;
};
function pairKey(players:[string,string],round:number):string {
  return `${round}:${players.map(normalizePlayerId).sort().join(':')}`;
}
function inspectBracket(bracket:Bracket):{roster:string;pairs:Pair[]} {
  if(bracket.type!=='tree'||!bracket.rootNode)throw new Error('Tableau à élimination simple complet non disponible.');
  const leaves:string[]=[],pairs:Pair[]=[];
  let count=0;
  function walk(node:Node,depth:number):number {
    if(++count>4096||depth>32||!node||typeof node!=='object')throw new Error('Tableau invalide ou trop grand.');
    if(!node.children){
      if(typeof node.team!=='string'||!normalizePlayerId(node.team)||node.team.length>100)throw new Error('Participant non identifiable dans le tableau.');
      leaves.push(normalizePlayerId(node.team));return 0;
    }
    if(!Array.isArray(node.children)||node.children.length!==2)throw new Error('Tableau non pris en charge.');
    const height=1+Math.max(walk(node.children[0]!,depth+1),walk(node.children[1]!,depth+1));
    if(['available','challenging','inprogress'].includes(node.state??'')) {
      const players=node.children.map(x=>x.team);
      if(players.some(x=>typeof x!=='string'||!normalizePlayerId(x)))throw new Error('Appariement incomplet.');
      pairs.push({players:players as [string,string],round:height,room:node.room,state:node.state!});
    }
    return height;
  }
  walk(bracket.rootNode,0);
  return {roster:leaves.sort().join(','),pairs:pairs.sort((a,b)=>a.round-b.round)};
}

export class TournamentAuto {
  private view:View={};
  private watched=new Set<string>();
  private errors=new Set<string>();
  private rosterTimer?: ReturnType<typeof setTimeout>;
  private watchedPlayers=new Map<string,[string,string]>();
  private jobs:Array<()=>Promise<void>>=[];
  private workers=0;
  private awaitingSnapshot=false;
  private idleWaiters:Array<()=>void>=[];
  constructor(private deps:Dependencies) {
    const state=deps.context.storage.load();
    if(state.automation?.enabled){
      state.automation.enabled=false;
      if(state.automation.phase==='running')state.automation.phase='paused';
      deps.context.storage.save(state);
      console.log('[Auto] Session conservée mais mise en pause au redémarrage. Utilise $auto resume après réception du tableau courant.');
    }
  }
  private error(message:string):void {
    if(this.errors.has(message))return;
    this.errors.add(message);
    console.error(`[Auto] ${message}`);
    this.deps.notifyError(`[Auto] ${message}`);
  }
  private current():AutomaticTournamentState|undefined{return this.deps.context.storage.load().automation;}
  private namedTournament():boolean{return this.view.format==='RandArcade';}
  private supported():boolean{return this.view.generator==='Single Elimination';}
  private pause(message:string):void {
    const state=this.deps.context.storage.load();
    if(state.automation){state.automation.enabled=false;state.automation.phase='paused';this.deps.context.storage.save(state);}
    this.error(message);
  }
  private preparePermanentSession():void {
    const {storage}=this.deps.context;
    const state=storage.load(),preference=state.permanentAuto;
    if(!preference?.enabled||preference.room!==this.deps.room)return;
    if(state.isStarted||state.automation?.phase==='paused')throw new Error('Une session non clôturée existe. Reprends-la ou termine-la avant le prochain tournoi.');
    if(state.automation?.enabled&&state.automation.phase==='armed')return;
    if(state.activeRound>0||Object.keys(state.teamsByRound).length){
      const file=this.deps.exportHistory?this.deps.exportHistory(state):exportHistoryToMarkdown(state).filePath;
      const archive=storage.archiveAndNewTournament();
      console.log(`[Auto permanent] Session précédente archivée : ${archive} ; export ${file}`);
    }
    const fresh=storage.load();
    fresh.automation={id:randomUUID(),enabled:true,phase:'armed',room:preference.room,generator:this.view.generator,playerRounds:{},readyPlayers:{},delivered:{},matches:{}};
    storage.save(fresh);this.errors.clear();this.watched.clear();this.watchedPlayers.clear();
    console.log(`[Auto permanent] En attente du prochain tournoi Single Elimination nommé RandArcade dans ${preference.room}.`);
  }
  private ensurePermanentReady():void {
    const state=this.deps.context.storage.load();
    if(!state.permanentAuto?.enabled||state.permanentAuto.room!==this.deps.room)return;
    if(!this.supported()||!this.namedTournament()){
      if(state.automation?.phase==='armed'){
        state.automation.enabled=false;this.deps.context.storage.save(state);
      }
      return;
    }
    if(this.view.isStarted)return;
    if(state.automation?.enabled&&['running','armed'].includes(state.automation.phase))return;
    this.preparePermanentSession();
  }

  command(action:string):string {
    const {storage}=this.deps.context;
    const state=storage.load(),auto=state.automation;
    switch(action.toLowerCase()) {
      case 'status':
        return `Mode permanent : ${state.permanentAuto?.enabled ? 'actif dans '+state.permanentAuto.room+' (nom exact : RandArcade)' : 'inactif'}. ` + (auto ? `Mode automatique : ${auto.enabled?'actif':'inactif'} ; état ${auto.phase} ; salon ${auto.room}. Joueurs avec tirage : ${Object.keys(auto.playerRounds).length}. ${auto.exportPath?'Export : '+auto.exportPath:''}` : 'Mode automatique désactivé. Utilise $auto on avant le début du tournoi Showdown.');
      case 'permanent on': {
        if(!this.deps.room)throw new Error('Configure PS_ROOM avant le mode permanent.');
        if(auto?.enabled&&auto.phase==='running'&&auto.room===this.deps.room){
          state.permanentAuto={enabled:true,room:this.deps.room};storage.save(state);
          return 'Mode permanent activé. Le tournoi actuel continue ; les prochains tournois Single Elimination nommés exactement RandArcade de ce salon seront suivis automatiquement avec la liste active.';
        }
        if(this.view.isStarted||state.isStarted||auto?.phase==='paused')throw new Error('Une session ou un tournoi est en cours. Termine ou reprends cette session avant d’activer le mode permanent.');
        const previous=state.permanentAuto;
        state.permanentAuto={enabled:true,room:this.deps.room};storage.save(state);
        try{this.preparePermanentSession();}catch(error){const latest=storage.load();latest.permanentAuto=previous;storage.save(latest);throw error;}
        this.awaitingSnapshot=true;this.deps.sendWire(`${this.deps.room}|/tour getupdate`);
        return `Mode permanent activé dans ${this.deps.room}. Seuls les tournois Single Elimination nommés exactement RandArcade avant leur départ seront suivis avec la liste active. Attendre les équipes en MP avant de combattre.`;
      }
      case 'permanent off': {
        const wasPermanent=state.permanentAuto?.enabled;
        if(state.permanentAuto)state.permanentAuto.enabled=false;
        // An already armed future session must not start after permanent off.
        if(wasPermanent&&auto?.phase==='armed')auto.enabled=false;
        storage.save(state);
        return 'Mode permanent désactivé pour les prochains tournois. Un tournoi automatique déjà en cours continue ; utilise $auto off pour le suspendre aussi.';
      }
      case 'on': {
        if(!this.deps.room)throw new Error('Configure PS_ROOM avant le mode automatique.');
        if(auto?.enabled)return 'Mode automatique déjà activé.';
        if(this.view.isStarted)throw new Error('Le tournoi Showdown a déjà commencé. Active $auto on avant son départ.');
        if(state.isStarted||state.activeRound>0||Object.keys(state.teamsByRound).length)throw new Error('Un ancien état existe. Sauvegarde avec $export, puis utilise $new avant $auto on. Pour reprendre une session automatique en pause, utilise $auto resume.');
        state.automation={id:randomUUID(),enabled:true,phase:'armed',room:this.deps.room,generator:this.view.generator,playerRounds:{},readyPlayers:{},delivered:{},matches:{}};
        storage.save(state);this.errors.clear();this.watched.clear();this.watchedPlayers.clear();
        this.awaitingSnapshot=true;
        this.deps.sendWire(`${this.deps.room}|/tour getupdate`);
        return `Mode automatique armé dans ${this.deps.room} pour le prochain tournoi Single Elimination. Les équipes seront envoyées aux joueurs dès que leur match sera prêt. Attendre leur réception avant de combattre.`;
      }
      case 'off':
        if(state.permanentAuto)state.permanentAuto.enabled=false;
        if(!auto){storage.save(state);return 'Mode automatique et mode permanent désactivés.';}
        auto.enabled=false;if(auto.phase==='running')auto.phase='paused';storage.save(state);
        return 'Mode automatique désactivé. Équipes conservées ; les combats déjà surveillés restent suivis. Utilise $auto resume pour reprendre.';
      case 'resume': {
        if(!auto||auto.phase==='ended'||auto.room!==this.deps.room)throw new Error('Aucune session automatique reprenable dans ce salon.');
        if(auto.enabled)return 'Mode automatique déjà activé.';
        if(auto.phase==='armed'&&!this.view.isStarted){auto.enabled=true;storage.save(state);return 'Mode automatique réarmé.';}
        if(!state.isStarted||!this.view.isStarted||!this.supported()||!this.view.bracketData)throw new Error('Reprise refusée : le tableau du tournoi actif n’est pas disponible ou compatible.');
        const data=inspectBracket(this.view.bracketData);
        if(!auto.roster||data.roster!==auto.roster)throw new Error('Reprise refusée : les participants diffèrent de la session sauvegardée.');
        auto.enabled=true;auto.phase='running';storage.save(state);this.errors.clear();this.watched.clear();this.watchedPlayers.clear();this.reconcile();
        return 'Session automatique reprise avec les équipes sauvegardées.';
      }
      default:return 'Utilisation : $auto on|off|resume|status ou $auto permanent on|off';
    }
  }
  private start():void {
    const state=this.deps.context.storage.load(),auto=state.automation;
    if(!auto?.enabled||auto.phase!=='armed')return;
    if(state.permanentAuto?.enabled&&!this.namedTournament()){
      auto.enabled=false;this.deps.context.storage.save(state);return;
    }
    if(!this.supported()){
      if(state.permanentAuto?.enabled&&state.permanentAuto.room===this.deps.room){
        auto.enabled=false;this.deps.context.storage.save(state);console.log('[Auto permanent] Tournoi non compatible ignoré.');
      }else this.pause('Tournoi non pris en charge : seule Single Elimination est supportée dans cette version.');
      return;
    }
    try {
      this.deps.context.storage.startTournament();
      const started=this.deps.context.storage.load();
      started.automation!.phase='running';started.automation!.generator=this.view.generator;
      this.deps.context.storage.save(started);
      console.log('[Auto] Tournoi démarré. Attente du tableau et préparation des équipes.');
    }catch(error){this.pause(`Démarrage automatique refusé : ${String(error)}`);}
  }
  private reconcile():void {
    const {storage,listManager}=this.deps.context;
    let state=storage.load(),auto=state.automation;
    if(!auto?.enabled||auto.phase!=='running'||!this.view.bracketData?.rootNode)return;
    if(!this.supported()){this.pause('Générateur modifié : automatisation mise en pause.');return;}
    const data=inspectBracket(this.view.bracketData);
    if(auto.roster&&auto.roster!==data.roster){
      // Showdown sends its updated bracket BEFORE its logged replace event.
      // Wait briefly for that event without generating any new reference team.
      if(!this.rosterTimer){
        const session=auto.id;
        this.rosterTimer=setTimeout(()=>{
          this.rosterTimer=undefined;
          const current=this.current();
          if(current?.id!==session||!current.enabled||current.phase!=='running')return;
          try{
            if(this.view.bracketData&&inspectBracket(this.view.bracketData).roster!==current.roster){
              this.pause('Participants modifiés sans remplacement identifiable : automatisation mise en pause pour préserver les tirages.');
            }
          }catch(error){this.pause(`Tableau modifié non vérifiable : ${String(error)}`);}
        },1500);
        this.rosterTimer.unref();
      }
      return;
    }
    auto.roster=data.roster;
    auto.readyPlayers={};
    const deliveries:Array<{player:string;round:number}>=[];
    for(const pair of data.pairs){
      const key=pairKey(pair.players,pair.round);
      // Never invent a reference team after a battle has already begun.
      const live=pair.state==='inprogress';
      auto.matches[key]={players:pair.players,round:pair.round};
      for(const player of pair.players){
        const id=normalizePlayerId(player),roundKey=String(pair.round);
        if((auto.playerRounds[id]??0)>pair.round)continue;
        auto.playerRounds[id]=pair.round;
        state.activeRound=Math.max(state.activeRound,pair.round);
        state.teamsByRound[roundKey]??={};
        if(!state.teamsByRound[roundKey]![id]&&!live){
          state.teamsByRound[roundKey]![id]=generateTeam(listManager.getSets(),{teamSize:this.deps.context.teamSize,sameName:this.deps.context.sameName,player,round:pair.round});
        }
        auto.readyPlayers[id]=Boolean(state.teamsByRound[roundKey]![id]);
        if(state.teamsByRound[roundKey]![id]&&!auto.delivered[`${pair.round}:${id}`])deliveries.push({player,round:pair.round});
      }
    }
    storage.save(state);
    for(const d of deliveries)this.enqueueDelivery(d.player,d.round,auto.id);
    for(const pair of data.pairs)if(pair.state==='inprogress'&&pair.room)this.watchPair(pair.players,pair.room,pair.round);
  }
  private deliveryQueued=new Set<string>();
  private enqueueDelivery(player:string,round:number,session:string):void {
    const id=normalizePlayerId(player),key=`${session}:${round}:${id}`;
    if(this.deliveryQueued.has(key))return;
    this.deliveryQueued.add(key);
    this.jobs.push(async()=>{
      try {
        const state=this.deps.context.storage.load(),auto=state.automation;
        if(auto?.id!==session||!auto.enabled||auto.phase!=='running'||!auto.readyPlayers[id]||auto.playerRounds[id]!==round)return;
        const team=state.teamsByRound[String(round)]?.[id];if(!team)return;
        const response=await this.deps.renderTeam(team);
        const latest=this.deps.context.storage.load(),a=latest.automation;
        if(a?.id!==session||!a.enabled||a.phase!=='running'||!a.readyPlayers[id]||a.playerRounds[id]!==round||latest.teamsByRound[String(round)]?.[id]?.createdAt!==team.createdAt)return;
        this.deps.sendTeam(player,`Voici ta team pour le round ${round} du tournoi :\n${response}`);
        a.delivered[`${round}:${id}`]=true;this.deps.context.storage.save(latest);
      }catch(error){this.error(`Échec de préparation ou d’envoi pour ${player} : ${String(error)}. Le joueur peut utiliser $team.`);}
      finally{this.deliveryQueued.delete(key);}
    });
    this.pump();
  }
  private pump():void {
    while(this.workers<2&&this.jobs.length){
      const job=this.jobs.shift()!;this.workers++;
      void job().finally(()=>{this.workers--;this.pump();if(!this.workers&&!this.jobs.length){for(const resolve of this.idleWaiters.splice(0))resolve();}});
    }
  }
  async idle():Promise<void>{if(!this.workers&&!this.jobs.length)return;await new Promise<void>(r=>this.idleWaiters.push(r));}
  private watchPair(players:[string,string],target:string,round?:number):void {
    const state=this.deps.context.storage.load(),auto=state.automation;
    if(!auto?.enabled||auto.phase!=='running'||this.watched.has(target))return;
    const match=Object.values(auto.matches).find(m=>pairKey(m.players,m.round)===pairKey(players,round??m.round));
    if(!match){this.error(`Combat ${target} : appariement sans référence, vérification manuelle nécessaire avec $watch.`);return;}
    const teams:Record<string,GeneratedTeam>={};
    for(const name of players){const id=normalizePlayerId(name),team=state.teamsByRound[String(match.round)]?.[id];if(team)teams[id]=team;else this.error(`${name} : aucune équipe attribuée avant le début du combat ${target}.`);}
    if(!Object.keys(teams).length)return;
    try{
      this.deps.watch(target,{isStarted:true,activeRound:match.round,teamsByRound:{[match.round]:teams}});
      this.watched.add(target);
      this.watchedPlayers.set(target,players);
    }catch(error){this.error(`Impossible de surveiller ${target} : ${String(error)}`);}
  }
  private replacePlayer(oldName:string,newName:string):void {
    const {storage}=this.deps.context,state=storage.load(),auto=state.automation;
    if(!auto?.enabled||auto.phase!=='running')return;
    const oldId=normalizePlayerId(oldName),newId=normalizePlayerId(newName);
    if(!oldId||!newId||newName.length>100)throw new Error('Remplacement invalide.');
    if(oldId===newId)return;
    const roster=(auto.roster??'').split(',').filter(Boolean);
    // Duplicate protocol events must neither resend the team nor create a draw.
    if(!roster.includes(oldId)&&roster.includes(newId))return;
    if(!roster.includes(oldId)||roster.includes(newId))throw new Error('Remplacement incohérent avec les participants sauvegardés.');
    const nextRoster=roster.map(id=>id===oldId?newId:id).sort().join(',');
    const nextView=structuredClone(this.view);
    const rename=(node:Node|undefined|null):void=>{
      if(!node)return;
      if(typeof node.team==='string'&&normalizePlayerId(node.team)===oldId)node.team=newName;
      node.children?.forEach(rename);
    };
    rename(nextView.bracketData?.rootNode);
    if(nextView.bracketData?.rootNode&&inspectBracket(nextView.bracketData).roster!==nextRoster){
      throw new Error('Un autre changement de participants empêche le transfert automatique.');
    }
    const round=auto.playerRounds[oldId];
    const ready=Boolean(auto.readyPlayers[oldId]);
    if(round){
      const teams=state.teamsByRound[String(round)]??={};
      const oldTeam=teams[oldId];
      if(teams[newId]&&(!oldTeam||teams[newId]!.rawTeam!==oldTeam.rawTeam))throw new Error('Le remplaçant possède un autre tirage à ce round ; transfert refusé pour conserver l’historique.');
      if(oldTeam)teams[newId]={...structuredClone(oldTeam),player:newName};
      auto.playerRounds[newId]=round;
      auto.readyPlayers[newId]=ready&&Boolean(oldTeam);
      delete auto.delivered[`${round}:${newId}`];
    }
    delete auto.playerRounds[oldId];delete auto.readyPlayers[oldId];
    // Keep old teams and match records as history, adding the new slot identity.
    for(const match of Object.values(auto.matches)){
      if(!match.players.some(name=>normalizePlayerId(name)===oldId))continue;
      const players=match.players.map(name=>normalizePlayerId(name)===oldId?newName:name) as [string,string];
      auto.matches[pairKey(players,match.round)]={players,round:match.round};
    }
    auto.roster=nextRoster;
    (auto.replacements??=[]).push({from:oldName,to:newName,round,at:new Date().toISOString()});
    storage.save(state);this.view=nextView;
    if(this.rosterTimer){clearTimeout(this.rosterTimer);this.rosterTimer=undefined;}
    // Showdown invalidates a tournament battle involving the replaced player.
    for(const [target,players] of this.watchedPlayers){
      if(players.some(name=>normalizePlayerId(name)===oldId)){
        this.deps.unwatch?.(target);this.watched.delete(target);this.watchedPlayers.delete(target);
      }
    }
    console.log(`[Auto] Remplacement ${oldName} → ${newName} ; tirage conservé${round?` au round ${round}`:''}.`);
    if(round&&auto.readyPlayers[newId])this.enqueueDelivery(newName,round,auto.id);
    this.reconcile();
  }

  private finish():void {
    const {storage}=this.deps.context,state=storage.load(),auto=state.automation;
    if(!auto?.enabled||auto.phase!=='running')return;
    auto.enabled=false;auto.phase='ended';state.isStarted=false;storage.save(state);
    const file=this.deps.exportHistory?this.deps.exportHistory(state):exportHistoryToMarkdown(state).filePath;
    const latest=storage.load();if(latest.automation?.id===auto.id){latest.automation.exportPath=file;storage.save(latest);}
    console.log(`[Auto] Tournoi terminé ; historique conservé et exporté : ${file}`);
  }
  processPacket(packet:string):void {
    let room='';
    const initial=packet.split(/\r?\n/).includes('|init|chat');
    for(const line of packet.split(/\r?\n/)){
      if(line.startsWith('>')){room=line.slice(1).trim();continue;}
      if(room!==this.deps.room||!line.startsWith('|tournament|'))continue;
      const fields=line.split('|'),event=fields[2]??'',parts=fields.slice(3);
      try {
        // Old room logs include create/start/end. Only the live update snapshot
        // is usable when joining or reconnecting; never replay old events.
        if(initial&&!['update','updateEnd','error'].includes(event))continue;
        if(event==='create'){
          const auto=this.current();
          if(auto?.enabled&&auto.phase==='running'){this.pause('Nouveau tournoi détecté avant clôture de la session sauvegardée.');continue;}
          this.view={format:parts[0],generator:parts[1],isStarted:false};this.awaitingSnapshot=false;
          const state=this.deps.context.storage.load();
          if(state.permanentAuto?.enabled&&state.permanentAuto.room===this.deps.room){
            if(this.supported())this.ensurePermanentReady();
            else if(state.automation?.phase==='armed'){state.automation.enabled=false;this.deps.context.storage.save(state);console.log('[Auto permanent] Tournoi non compatible ignoré.');}
          }
        }
        if(event==='update'){
          const update=JSON.parse(parts.join('|')) as View;
          if(!update||typeof update!=='object')throw new Error('Mise à jour de tournoi invalide.');
          this.view={...this.view,...update};
          if(typeof update.format==='string')this.ensurePermanentReady();
          if(initial&&update.isStarted&&(!this.deps.context.storage.load().permanentAuto?.enabled||this.namedTournament())&&this.current()?.enabled&&this.current()?.phase==='armed')this.pause('Le tournoi a démarré avant la réception des équipes. Activation tardive refusée.');
        }
        if(event==='start'){this.awaitingSnapshot=false;this.view.isStarted=true;this.start();this.reconcile();}
        if(event==='end'||event==='forceend'){this.finish();this.view={};continue;}
        if(event==='updateEnd')this.ensurePermanentReady();
        const auto=this.current();
        if(!auto?.enabled)continue;
        if(event==='updateEnd'){
          if(this.awaitingSnapshot&&auto.phase==='armed'&&this.view.isStarted){this.pause('Activation refusée : le tournoi Showdown a déjà commencé.');this.awaitingSnapshot=false;continue;}
          this.awaitingSnapshot=false;this.reconcile();
        }
        if(event==='battlestart')this.watchPair([parts[0]??'',parts[1]??''],parts[2]??'');
        if(event==='replace'&&auto.phase==='running')this.replacePlayer(parts[0]??'',parts[1]??'');
        if(event==='error')this.awaitingSnapshot=false;
        if(event==='error'&&auto.phase==='running')this.pause(`Erreur tournoi Showdown : ${parts.join(' ')}`);
      }catch(error){if(this.current()?.enabled)this.pause(`Traitement du tournoi interrompu : ${String(error)}`);else if(this.deps.context.storage.load().permanentAuto?.enabled)this.error(`Préparation permanente interrompue : ${String(error)}`);else console.error('[Auto]',error);}
    }
  }
}
