import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIncomingCommands as parse, responseDestination as destination } from '../src/ps-messages.js';
import { handleCommand } from '../src/commands.js';
import { JsonStorage } from '../src/storage.js';
import { ActiveListManager } from '../src/list-manager.js';
const bot = 'UrsuCyberus';
// Keep paste creation deterministic and offline.
const pasteFetch = async () => new Response(null, {status:303, headers:{location:'https://pokepast.es/0123456789abcdef'}});
globalThis.fetch = pasteFetch;
test('PMs, ranks and embedded pipes are parsed; self and other rooms are ignored', () => {
  const commands = parse('|pm|%BalooDanceur| UrsuCyberus|$help a|b', bot, 'arcade');
  assert.equal(commands[0]?.player, 'BalooDanceur');
  assert.equal(commands[0]?.text, '$help a|b');
  assert.deepEqual(parse('|pm| UrsuCyberus| BalooDanceur|$team', bot, 'arcade'), []);
  assert.deepEqual(parse('>other\n|c:|123| User|$start', bot, 'arcade'), []);
  assert.deepEqual(parse('|pm| User| OtherBot|$start', bot, 'arcade'), []);
});
test('room history is never executed', () => {
  assert.deepEqual(parse('>arcade\n|init|chat\n|c:|123|%BalooDanceur|$new', bot, 'arcade'), []);
});
test('teams/history/admin details stay private; short round controls are public', () => {
  for (const command of ['$team', '$advance User', '$history User', '$status', '$help']) {
    const incoming = parse(`>arcade\n|c:|123|%BalooDanceur|${command}`, bot, 'arcade')[0]!;
    assert.deepEqual(destination(incoming), {user: 'baloodanceur'});
  }
  const incoming = parse('>arcade\n|c|%BalooDanceur|$start', bot, 'arcade')[0]!;
  assert.deepEqual(destination(incoming), {room: 'arcade'});
});
test('parsed messages exercise real permissions, start, stable teams, next round and MP restriction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'randomizer-test-'));
  try {
    const context = {
      storage: new JsonStorage(join(dir, 'state.json')),
      listManager: new ActiveListManager(join(dir, 'list.json'), 'sets/sample-sets.txt'),
      admins: ['BalooDanceur'], teamSize: 6, sameName: false,
    };
    async function run(packet: string) {
      const c = parse(packet, bot, 'arcade')[0]!;
      return handleCommand(c.text, c.player, context, {isPrivateMessage: c.isPrivateMessage});
    }
    assert.match(await run('>arcade\n|c:|123| User|$start'), /réservée aux admins/);
    assert.equal(context.storage.load().isStarted, false);
    assert.match(await run('>arcade\n|c:|123|%BalooDanceur|$start'), /Round actif : 1/);
    const team = await run('|pm| User| UrsuCyberus|$team');
    assert.match(team, /Voici ta team pour le round 1/);
    assert.equal(await run('|pm| User| UrsuCyberus|$team'), team);
    assert.match(await run('>arcade\n|c:|123|%BalooDanceur|$setlist https://pokepast.es/test'), /en MP/);
    assert.match(await run('|pm|%BalooDanceur| UrsuCyberus|$next'), /Round actif : 2/);
    assert.match(await run('|pm| User| UrsuCyberus|$team'), /round 2/);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('WebSocket login, room join and replies pass through the actual client', {timeout: 10000}, async () => {
  const { WebSocketServer } = await import('ws');
  const { runPokemonShowdownClient } = await import('../src/ps-client.js');
  const server = new WebSocketServer({port:0, host:'127.0.0.1'});
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as {port:number};
  const dir = mkdtempSync(join(tmpdir(), 'randomizer-ws-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes('pokepast.es') ? pasteFetch() : new Response(JSON.stringify({assertion:'test-assertion'}));
  const sent: string[] = [];
  server.on('connection', socket => {
    socket.send('|challstr|4|test');
    socket.on('message', data => {
      const message = data.toString(); sent.push(message);
      if (message.startsWith('|/trn ')) socket.send('|updateuser| UrsuCyberus|1|1|{}');
      if (message === '|/join arcade') {
        socket.send('>arcade\n|init|chat\n|c:|1|%BalooDanceur|$new');
        socket.send('>arcade\n|c:|2|%BalooDanceur|$start');
        socket.send('|pm| User| UrsuCyberus|$team');
      }
      if (message.startsWith('|/pm user, Voici ta team')) socket.close();
    });
  });
  try {
    await runPokemonShowdownClient({serverUrl:`ws://127.0.0.1:${address.port}`, username:bot,
      password:'test-only', room:'arcade', context:{
        storage:new JsonStorage(join(dir, 'state.json')),
        listManager:new ActiveListManager(join(dir, 'list.json'), 'sets/sample-sets.txt'),
        admins:['BalooDanceur'], teamSize:6, sameName:false,
      }});
    assert.ok(sent.includes('arcade|Tournoi lancé. Round actif : 1'));
    assert.ok(sent.some(line => line.startsWith('|/pm user, Voici ta team pour le round 1')));
    assert.ok(!sent.some(line => line.includes('Nouveau tournoi préparé')));
    assert.ok(!sent.some(line => line.startsWith('arcade|Voici ta team')));
  } finally {
    globalThis.fetch = originalFetch;
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, {recursive:true, force:true});
  }
});
