'use strict';
/**
 * LUMORA Universal Multi-Provider Source
 *
 * Returns multiple public embed sources for a given TMDB movie or TV episode.
 * Designed for streaming (and download where the player supports it) using
 * widely-used multi-embed providers. Only HTTPS embed URLs are returned.
 *
 * Contract:
 *   GET /health
 *   GET /lumora/v1/resolve?type=movie|tv&tmdb=ID[&season=S&episode=E][&imdb=tt…][&title=…][&year=YYYY]
 *     → { sources: [ { label, type, url, quality, audio, lang } ] }
 *
 * Hosts used here must be approved in LUMORA (PROVIDER_ALLOWED_HOSTS, /addhost,
 * or the pending-host approval flow).
 */

const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1';

/** @typedef {{ label: string, type: 'embed'|'mp4'|'hls', url: string, quality?: string, audio?: string, lang?: string }} Source */

/**
 * Provider definitions. Each builds one or more embed URLs for a title.
 * Patterns follow the public multi-embed sites commonly used by community clients.
 */
const PROVIDERS = [
  {
    id: 'vidsrc',
    label: 'VidSrc',
    hosts: ['vidsrc.to', 'vidsrc.xyz', 'vidsrc.me', 'vidsrc.cc', 'vidsrc.pm', 'vidsrc.net'],
    movie: (id) => [
      { host: 'vidsrc.to', path: `/embed/movie/${id}` },
      { host: 'vidsrc.xyz', path: `/embed/movie/${id}` },
      { host: 'vidsrc.me', path: `/embed/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'vidsrc.to', path: `/embed/tv/${id}/${s}/${e}` },
      { host: 'vidsrc.xyz', path: `/embed/tv/${id}/${s}/${e}` },
      { host: 'vidsrc.me', path: `/embed/tv/${id}/${s}/${e}` }
    ]
  },
  {
    id: 'autoembed',
    label: 'AutoEmbed',
    hosts: ['autoembed.co', 'player.autoembed.cc'],
    movie: (id) => [
      { host: 'autoembed.co', path: `/embed/movie/${id}` },
      { host: 'player.autoembed.cc', path: `/embed/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'autoembed.co', path: `/embed/tv/${id}/${s}/${e}` },
      { host: 'player.autoembed.cc', path: `/embed/tv/${id}/${s}/${e}` }
    ]
  },
  {
    id: '2embed',
    label: '2Embed',
    hosts: ['2embed.cc', 'www.2embed.cc'],
    movie: (id) => [
      { host: '2embed.cc', path: `/embed/${id}` },
      { host: 'www.2embed.cc', path: `/embed/${id}` }
    ],
    tv: (id, s, e) => [
      { host: '2embed.cc', path: `/embedtv/${id}&s=${s}&e=${e}` },
      { host: 'www.2embed.cc', path: `/embedtv/${id}&s=${s}&e=${e}` }
    ]
  },
  {
    id: 'multiembed',
    label: 'MultiEmbed',
    hosts: ['multiembed.mov', 'www.multiembed.mov'],
    movie: (id) => [
      { host: 'multiembed.mov', path: `/directstream.php?video_id=${id}&tmdb=1` }
    ],
    tv: (id, s, e) => [
      { host: 'multiembed.mov', path: `/directstream.php?video_id=${id}&tmdb=1&s=${s}&e=${e}` }
    ]
  },
  {
    id: 'embedsu',
    label: 'EmbedSu',
    hosts: ['embed.su'],
    movie: (id) => [
      { host: 'embed.su', path: `/embed/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'embed.su', path: `/embed/tv/${id}/${s}/${e}` }
    ]
  },
  {
    id: 'moviesapi',
    label: 'MoviesAPI',
    hosts: ['moviesapi.club'],
    movie: (id) => [
      { host: 'moviesapi.club', path: `/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'moviesapi.club', path: `/tv/${id}-${s}-${e}` }
    ]
  },
  {
    id: 'vidlink',
    label: 'VidLink',
    hosts: ['vidlink.pro'],
    movie: (id) => [
      { host: 'vidlink.pro', path: `/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'vidlink.pro', path: `/tv/${id}/${s}/${e}` }
    ]
  },
  {
    id: 'smashy',
    label: 'SmashyStream',
    hosts: ['embed.smashystream.com', 'player.smashy.stream'],
    movie: (id) => [
      { host: 'embed.smashystream.com', path: `/playe.php?tmdb=${id}` },
      { host: 'player.smashy.stream', path: `/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'embed.smashystream.com', path: `/playe.php?tmdb=${id}&season=${s}&episode=${e}` },
      { host: 'player.smashy.stream', path: `/tv/${id}?s=${s}&e=${e}` }
    ]
  },
  {
    id: 'vidora',
    label: 'Vidora',
    hosts: ['vidora.su'],
    movie: (id) => [
      { host: 'vidora.su', path: `/embed/movie/${id}` }
    ],
    tv: (id, s, e) => [
      { host: 'vidora.su', path: `/embed/tv/${id}/${s}/${e}` }
    ]
  }
];

function buildSources(type, tmdbId, season, episode) {
  /** @type {Source[]} */
  const out = [];
  const seen = new Set();

  for (const p of PROVIDERS) {
    let entries = [];
    try {
      if (type === 'movie') {
        entries = typeof p.movie === 'function' ? p.movie(tmdbId) : [];
      } else {
        entries = typeof p.tv === 'function' ? p.tv(tmdbId, season, episode) : [];
      }
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry || !entry.host || !entry.path) continue;
      const url = `https://${entry.host}${entry.path.startsWith('/') ? entry.path : '/' + entry.path}`;
      if (seen.has(url)) continue;
      seen.add(url);

      out.push({
        label: `${p.label}`,
        type: 'embed',
        url,
        quality: '1080p',
        audio: 'multi',
        lang: 'en'
      });
    }
  }

  // Prefer a stable ordering: known high-coverage providers first
  const priority = ['VidSrc', 'AutoEmbed', '2Embed', 'MultiEmbed', 'EmbedSu', 'VidLink', 'SmashyStream', 'MoviesAPI', 'Vidora'];
  out.sort((a, b) => {
    const ia = priority.indexOf(a.label);
    const ib = priority.indexOf(b.label);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return out.slice(0, 24);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  let url;
  try {
    url = new URL(req.url || '/', `http://${HOST}`);
  } catch {
    return send(res, 400, { error: 'Bad request' });
  }

  if (url.pathname === '/health' || url.pathname === '/') {
    return send(res, 200, {
      ok: true,
      name: 'universal-multi-provider',
      version: '1.0.0',
      providers: PROVIDERS.map((p) => p.id)
    });
  }

  if (url.pathname !== '/lumora/v1/resolve') {
    return send(res, 404, { error: 'Not found' });
  }

  const type = String(url.searchParams.get('type') || '').toLowerCase();
  const tmdb = String(url.searchParams.get('tmdb') || '').trim();
  const season = Number(url.searchParams.get('season'));
  const episode = Number(url.searchParams.get('episode'));

  if (!['movie', 'tv'].includes(type) || !/^\d{1,9}$/.test(tmdb)) {
    return send(res, 400, { error: 'type (movie|tv) and numeric tmdb are required' });
  }

  if (type === 'tv' && (!(season >= 1) || !(episode >= 1))) {
    return send(res, 400, { error: 'season and episode (>=1) are required for tv' });
  }

  try {
    const sources = buildSources(type, tmdb, season, episode);
    return send(res, 200, { sources });
  } catch (err) {
    return send(res, 500, { error: 'Resolve failed', detail: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`universal-multi-provider listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
