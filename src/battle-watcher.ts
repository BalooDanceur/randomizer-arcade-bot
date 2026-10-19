import { normalizePlayerId } from './storage.js';
import { normalizePokemonName } from './parser.js';
import type { GeneratedTeam, TournamentState } from './types.js';

type ExpectedSet = { species: string; moves: Set<string>; illusion: boolean };
type ActivePokemon = { species: string; candidates: number[]; transformed: boolean; dynamax: boolean; zMove: boolean };
type Side = { player: string; expected?: ExpectedSet[]; preview: string[]; size?: number; checked: boolean; uncertainMoves: boolean };
type Battle = { room: string; join: string; round: number; teams: Record<string, GeneratedTeam>; sides: Record<string, Side>; active: Map<string, ActivePokemon>; notices: Set<string>; turn: number; ready: boolean };

export function parseBattleTarget(input: string): { room: string; join: string } {
  let target = input.trim();
  if (target.startsWith('https://')) {
    let url: URL;
    try { url = new URL(target); } catch { throw new Error('Lien de combat invalide.'); }
    if (url.origin !== 'https://play.pokemonshowdown.com' || url.search || url.hash) {
      throw new Error('Utilise un lien https://play.pokemonshowdown.com/battle-… ou un identifiant battle-…');
    }
    target = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  const match = /^(battle-[a-z0-9]+-\d+)(?:-[a-z0-9]+pw)?$/i.exec(target);
  if (!match) throw new Error('Identifiant de combat invalide. Utilisation : $watch LIEN_DU_COMBAT');
  return { room: match[1]!.toLowerCase(), join: target.toLowerCase() };
}

function species(details: string): string {
  return (details.split(',')[0] ?? '').trim();
}
function speciesMatches(expected: string, observed: string): boolean {
  const e = normalizePokemonName(expected), o = normalizePokemonName(observed);
  if (e === o) return true;
  if (observed.endsWith('-*')) {
    const base = normalizePokemonName(observed.slice(0, -2));
    return e === base || e.startsWith(base);
  }
  return false;
}
function moveId(move: string): string {
  const id = normalizePokemonName(move);
  if (id.startsWith('hiddenpower')) return 'hiddenpower';
  if (/^(return|frustration)\d*$/.test(id)) return id.replace(/\d+$/, '');
  return id;
}
function expectedSets(team: GeneratedTeam): ExpectedSet[] {
  return team.sets.map(set => ({
    species: set.pokemonName,
    moves: new Set(set.raw.split(/\r?\n/).filter(line => /^\s*-\s+/.test(line)).map(line => moveId(line.replace(/^\s*-\s+/, '').trim()))),
    illusion: /^Ability\s*:\s*Illusion\s*$/im.test(set.raw),
  }));
}
function slotOf(ident: string): string { return /^(p[1-4][a-z]):/.exec(ident)?.[1] ?? ''; }

// Team Preview hides some formes: use a multiset matching rather than order.
function matchesPreview(expected: ExpectedSet[], preview: string[]): boolean {
  const owners = new Map<number, number>();
  function assign(observed: number, visited: Set<number>): boolean {
    for (let i = 0; i < expected.length; i++) {
      if (visited.has(i) || !speciesMatches(expected[i]!.species, preview[observed]!)) continue;
      visited.add(i);
      const previous = owners.get(i);
      if (previous === undefined || assign(previous, visited)) { owners.set(i, observed); return true; }
    }
    return false;
  }
  return preview.length === expected.length && preview.every((_, i) => assign(i, new Set()));
}

export class BattleWatcher {
  private battles = new Map<string, Battle>();
  constructor(
    private send: (wire: string) => void,
    private notify: (text: string) => void,
  ) {}

  watch(target: string, state: TournamentState): string {
    if (!state.isStarted) throw new Error('Lance un tournoi avec $start avant de surveiller un combat.');
    const {room, join} = parseBattleTarget(target);
    if (this.battles.has(room)) return `Ce combat est déjà surveillé : ${room}`;
    if (this.battles.size >= 10) throw new Error('Dix combats sont déjà surveillés. Utilise $unwatch LIEN_DU_COMBAT.');
    const teams = structuredClone(state.teamsByRound[String(state.activeRound)] ?? {});
    if (!Object.keys(teams).length) throw new Error('Aucune équipe attribuée au round actif. Les joueurs doivent demander $team avant $watch.');
    this.battles.set(room, {room,join,round:state.activeRound,teams,sides:{},active:new Map(),notices:new Set(),turn:0,ready:false});
    // Joining an already-open room does not resend its initial battle log.
    // Re-enter so a newly registered watch always receives the full history.
    console.log(`[Surveillance] Réentrée demandée : ${room} (round ${state.activeRound}).`);
    this.send(`|/leave ${room}`);
    this.send(`|/join ${join}`);
    return `Connexion au combat demandée pour le round ${state.activeRound} : ${room}. Attends la confirmation de surveillance en MP.`;
  }

  unwatch(target: string): string {
    const {room} = parseBattleTarget(target);
    if (!this.battles.delete(room)) return 'Ce combat n’est pas surveillé.';
    this.send(`|/leave ${room}`);
    return `Surveillance arrêtée : ${room}`;
  }

  private notice(b: Battle, key: string, message: string): void {
    if (b.notices.has(key) || b.notices.size >= 30) return;
    b.notices.add(key);
    this.notify(`[Vérification R${b.round} T${b.turn}] ${message} https://play.pokemonshowdown.com/${b.join}`);
  }
  private side(b: Battle, id: string): Side {
    return b.sides[id] ??= {player:id,preview:[],checked:false,uncertainMoves:false};
  }
  private checkPreview(b: Battle): void {
    for (const [id,s] of Object.entries(b.sides)) {
      if (!s.expected || s.checked || !s.preview.length) continue;
      s.checked = true;
      if (!matchesPreview(s.expected,s.preview)) {
        this.notice(b,`preview-${id}`,`Écart à vérifier pour ${s.player} : aperçu ${s.preview.join(', ')} ; équipe attribuée ${s.expected.map(x=>x.species).join(', ')}.`);
      } else {
        this.notice(b,`preview-${id}`,`${s.player} : les ${s.expected.length} Pokémon de l’aperçu correspondent (formes cachées non distinguées).`);
      }
    }
  }

  processPacket(packet: string): void {
    let room = '';
    for (const line of packet.split(/\r?\n/)) {
      if (line.startsWith('>')) {
        room = line.slice(1).trim();
        if (room.startsWith('battle-') && packet.includes('|init|')) {
          console.log(`[Surveillance] Initialisation reçue : ${room} ; suivi ${this.battles.has(room) ? 'trouvé' : 'absent'}.`);
        }
        continue;
      }
      const b = this.battles.get(room);
      if (!b) continue;
      const f = line.split('|');
      const event = f[1], a = f[2] ?? '', value = f[3] ?? '';
      if (event === 'deinit' && !b.ready) continue;
      if (event === 'noinit' || event === 'deinit' || event === 'expire') {
        this.notice(b,'unavailable','Surveillance arrêtée : combat inaccessible, fermé ou expiré. Vérifie les droits de spectateur.');
        this.battles.delete(room);continue;
      }
      if (event === 'init' && a === 'battle') {
        b.ready = true;
        this.notice(b,'ready','Surveillance active. Contrôle limité aux Pokémon et attaques visibles ; aucune sanction automatique.');
      }
      if (event === 'player' && /^p[1-4]$/.test(a) && value) {
        const s = this.side(b,a); s.player = value;
        const team = b.teams[normalizePlayerId(value)];
        s.expected = team ? expectedSets(team) : undefined;
        if (!s.expected) this.notice(b,`missing-${a}`,`${value} : aucune équipe attribuée au round ${b.round}, contrôle indisponible pour ce joueur.`);
        else if (s.expected.some(x=>x.illusion)) this.notice(b,`illusion-${a}`,`${value} : talent Illusion dans l’équipe ; contrôle des attaques suspendu pour ce joueur afin d’éviter les fausses alertes.`);
      }
      if (event === 'teamsize' && /^p[1-4]$/.test(a)) {
        const s=this.side(b,a);s.size=Number(value);
        if (s.expected && s.size !== s.expected.length) this.notice(b,`size-${a}`,`Écart à vérifier pour ${s.player} : ${s.size} Pokémon annoncés au lieu de ${s.expected.length}.`);
      }
      if (event === 'clearpoke') for (const s of Object.values(b.sides)) {s.preview=[];s.checked=false;}
      if (event === 'poke' && /^p[1-4]$/.test(a)) this.side(b,a).preview.push(species(value));
      if (event === 'teampreview' || event === 'start') {
        this.checkPreview(b);
        if (event === 'start') for (const [id,s] of Object.entries(b.sides)) {
          if (!s.preview.length && s.expected) this.notice(b,`nopreview-${id}`,`${s.player} : pas d’aperçu complet ; la composition et les doublons ne peuvent pas être entièrement vérifiés.`);
        }
      }
      if (event === 'turn') b.turn=Number(a)||0;
      const slot=slotOf(a), sideId=slot.slice(0,2);
      if (['switch','drag','replace'].includes(event ?? '') && slot) {
        const s=this.side(b,sideId), observed=species(value);
        const candidates=(s.expected ?? []).flatMap((x,i)=>speciesMatches(x.species,observed)?[i]:[]);
        // A switch can reveal a form changed earlier. If it cannot be matched,
        // defer rather than flag a legal transformation as cheating.
        b.active.set(slot,{species:observed,candidates,transformed:false,dynamax:false,zMove:false});
        if (!s.preview.length && s.expected && !candidates.length) this.notice(b,`species-${sideId}-${observed}`,`Écart possible pour ${s.player} : ${observed} absent du tirage. Une forme ou Illusion peut expliquer cet écart.`);
      }
      const active=b.active.get(slot);
      if (event === 'swap' && active && /^\d+$/.test(value)) {
        const other=`${sideId}${String.fromCharCode(97+Number(value))}`;
        const previous=b.active.get(other);b.active.set(other,active);
        if(previous)b.active.set(slot,previous);else b.active.delete(slot);
      }
      if (event === '-transform' && active) active.transformed=true;
      if ((event === 'detailschange' || event === '-formechange') && active) active.species=species(value);
      if (event === '-zpower' && active) active.zMove=true;
      if (event === '-start' && active && value === 'Dynamax') active.dynamax=true;
      if (event === '-end' && active && value === 'Dynamax') active.dynamax=false;
      if (event === 'move' && active) {
        const s=this.side(b,sideId), move=moveId(value);
        const zMove=active.zMove;active.zMove=false;
        const called = f.slice(4).some(x=>x.startsWith('[from]'));
        if (called && (move === 'mimic' || move === 'sketch')) {
          s.uncertainMoves=true;
          this.notice(b,`copied-${sideId}`,`${s.player} : copie d’attaques possible ; contrôle des attaques suspendu pour éviter les fausses alertes.`);
        }
        if (!s.expected || active.transformed || active.dynamax || zMove || move === 'struggle' || called) continue;
        if (s.uncertainMoves || s.expected.some(x=>x.illusion) || !active.candidates.length) continue;
        const allowed=active.candidates.filter(i=>s.expected![i]!.moves.has(move));
        if (!allowed.length) {
          this.notice(b,`move-${sideId}-${active.species}-${move}`,`Écart à vérifier pour ${s.player} : ${active.species} utilise ${value}, absent de ses sets attribués compatibles (tour ${b.turn}).`);
        } else {
          active.candidates=allowed;
          if (move === 'mimic' || move === 'sketch' || move === 'transform') {
            s.uncertainMoves=true;
            this.notice(b,`copied-${sideId}`,`${s.player} : copie d’attaques possible ; contrôle des attaques suspendu pour éviter les fausses alertes.`);
          }
        }
      }
      if (event === 'win' || event === 'tie') {
        this.checkPreview(b);
        this.notice(b,'end','Combat terminé. Contrôle des informations visibles terminé ; les attaques jamais utilisées ne sont pas vérifiées.');
        this.battles.delete(room);this.send(`|/leave ${room}`);
      }
    }
  }
}
