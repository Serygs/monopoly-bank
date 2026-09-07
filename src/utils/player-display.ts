type NamedPlayer = { id: string; name: string };

export function playerNameWithGameId(player: NamedPlayer, players: NamedPlayer[]): string {
  if (!players.some((candidate) => candidate.id !== player.id && candidate.name === player.name)) return player.name;
  return `${player.name} · #${shortGamePlayerId(player, players)}`;
}

function shortGamePlayerId(player: NamedPlayer, players: NamedPlayer[]): string {
  const id = player.id.replaceAll('-', '').toUpperCase();
  for (let length = Math.min(4, id.length); length < id.length; length += 1) {
    const suffix = id.slice(-length);
    if (players.every((candidate) => candidate.id === player.id || !candidate.id.replaceAll('-', '').toUpperCase().endsWith(suffix))) return suffix;
  }
  return id;
}
