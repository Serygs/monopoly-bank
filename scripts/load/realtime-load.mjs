import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';

const scenarioPath = process.env.LOAD_TEST_SCENARIO;
const durationMinutes = Number(process.env.LOAD_TEST_DURATION_MINUTES ?? '30');
const gameCount = Number(process.env.LOAD_TEST_GAME_COUNT ?? '30');
if (scenarioPath === undefined) throw new Error('LOAD_TEST_SCENARIO must point to a private, uncommitted scenario JSON file.');
if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 60) throw new Error('LOAD_TEST_DURATION_MINUTES must be an integer from 30 to 60.');
if (gameCount !== 30 && gameCount !== 60) throw new Error('LOAD_TEST_GAME_COUNT must be 30 (peak) or 60 (2x peak).');

const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
if (!Array.isArray(scenario.games) || scenario.games.length !== gameCount) throw new Error(`Scenario must contain exactly ${gameCount} games.`);
const sockets = [];
const failures = [];
const startedAt = Date.now();
const finishAt = startedAt + durationMinutes * 60_000;

for (const game of scenario.games) {
  if (!Array.isArray(game.participants) || game.participants.length !== 6) throw new Error(`Game ${game.gameId} must provide six authenticated participants.`);
  for (const participant of game.participants) {
    const socketUrl = new URL(`/api/games/${encodeURIComponent(game.gameId)}/live`, scenario.baseUrl);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(socketUrl, { headers: { Cookie: participant.cookie } });
    socket.on('error', () => failures.push(`socket error: ${game.gameId}`));
    sockets.push(socket);
  }
}

await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out opening a load-test socket.')), 15_000);
  socket.once('open', () => { clearTimeout(timer); resolve(); });
  socket.once('error', () => { clearTimeout(timer); reject(new Error('Failed to open a load-test socket.')); });
}))); 

while (Date.now() < finishAt && failures.length === 0) {
  await Promise.all(scenario.games.map(async (game) => {
    const payer = game.participants[0];
    const commandId = crypto.randomUUID();
    const response = await fetch(new URL(`/api/games/${encodeURIComponent(game.gameId)}/transactions`, scenario.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: payer.cookie, 'x-command-id': commandId },
      body: JSON.stringify({ type: 'PLAYER_TO_BANK', playerId: payer.playerId, amount: 1 }),
    });
    if (!response.ok) failures.push(`mutation ${response.status}: ${game.gameId}`);
  }));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

for (const game of scenario.games) {
  const auditor = game.participants[0];
  const response = await fetch(new URL(`/api/games/${encodeURIComponent(game.gameId)}`, scenario.baseUrl), { headers: { cookie: auditor.cookie } });
  const payload = await response.json();
  if (!response.ok || payload.data.players.some((player) => player.balance < 0)) failures.push(`negative balance or failed audit: ${game.gameId}`);
}
for (const socket of sockets) socket.close();
if (failures.length > 0) throw new Error(`Load test failed: ${failures.join(', ')}`);
console.log(`Passed ${scenario.games.length} games × 6 sockets for ${durationMinutes} minutes with no observed negative balance invariant violation.`);
