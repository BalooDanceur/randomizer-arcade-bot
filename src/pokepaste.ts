export async function createTeamPaste(rawTeam: string, round: number): Promise<string> {
  const response = await fetch('https://pokepast.es/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      paste: rawTeam,
      title: `Randomizer Arcade — Round ${round}`,
      author: 'Randomizer Arcade Bot',
      notes: '',
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const location = response.headers.get('location');
  if (![302, 303].includes(response.status) || !location) {
    throw new Error('Poképaste ne répond pas comme prévu.');
  }
  const url = new URL(location, 'https://pokepast.es');
  if (url.origin !== 'https://pokepast.es' || !/^\/[a-f0-9]{16}\/?$/i.test(url.pathname) || url.search || url.hash) {
    throw new Error('Lien Poképaste invalide.');
  }
  return url.href;
}
