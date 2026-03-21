import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import { invalidateAll } from '../cache.js';

export const addRouter = Router();

function toArray(data: any): any[] {
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return []; } }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

const ARR_TIMEOUT = 60000; // 60 seconds — lookups can be slow

// ── Sonarr Config ──

addRouter.get('/sonarr/profiles', async (_req, res) => {
  try {
    const { data } = await axios.get(`${config.sonarr.url}/api/v3/qualityprofile`, {
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      timeout: ARR_TIMEOUT,
    });
    const profiles = toArray(data).map((p: any) => ({ id: p.id, name: p.name }));
    res.json({ success: true, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

addRouter.get('/sonarr/rootfolders', async (_req, res) => {
  try {
    const { data } = await axios.get(`${config.sonarr.url}/api/v3/rootfolder`, {
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      timeout: ARR_TIMEOUT,
    });
    const folders = toArray(data).map((f: any) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace }));
    res.json({ success: true, data: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Sonarr Add Series ──

addRouter.post('/sonarr/add', async (req, res) => {
  try {
    const { title, tvdbId, tmdbId, qualityProfileId, rootFolderPath, monitor, searchForMissing } = req.body;

    if (!title || !qualityProfileId || !rootFolderPath) {
      res.status(400).json({ success: false, error: 'title, qualityProfileId, and rootFolderPath are required' });
      return;
    }

    // Lookup the series in Sonarr to get full metadata
    // Try tmdb ID first, then tvdb ID, then title
    let lookupTerm = title;
    if (tmdbId) lookupTerm = `tmdb:${tmdbId}`;
    else if (tvdbId) lookupTerm = `tvdb:${tvdbId}`;

    console.log(`[Sonarr] Looking up series: "${lookupTerm}"`);
    const { data: lookupData } = await axios.get(`${config.sonarr.url}/api/v3/series/lookup`, {
      params: { term: lookupTerm },
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      timeout: ARR_TIMEOUT,
    });

    const candidates = toArray(lookupData);
    console.log(`[Sonarr] Lookup returned ${candidates.length} candidates`);

    let seriesData = candidates[0];

    // If we have tmdbId, try to find a better match
    if (tmdbId && candidates.length > 1) {
      const tmdbMatch = candidates.find((c: any) => c.tmdbId === tmdbId);
      if (tmdbMatch) seriesData = tmdbMatch;
    }

    if (!seriesData) {
      // Fallback: try title search if ID search failed
      if (lookupTerm !== title) {
        console.log(`[Sonarr] ID lookup failed, trying title: "${title}"`);
        const { data: titleLookup } = await axios.get(`${config.sonarr.url}/api/v3/series/lookup`, {
          params: { term: title },
          headers: { 'X-Api-Key': config.sonarr.apiKey },
          timeout: ARR_TIMEOUT,
        });
        const titleCandidates = toArray(titleLookup);
        seriesData = titleCandidates[0];
      }

      if (!seriesData) {
        res.status(404).json({ success: false, error: `Series "${title}" not found in Sonarr lookup` });
        return;
      }
    }

    console.log(`[Sonarr] Adding: "${seriesData.title}" (tvdbId: ${seriesData.tvdbId})`);

    const addBody = {
      title: seriesData.title,
      tvdbId: seriesData.tvdbId,
      qualityProfileId,
      rootFolderPath,
      titleSlug: seriesData.titleSlug,
      images: seriesData.images,
      seasons: seriesData.seasons,
      monitored: true,
      seriesType: seriesData.seriesType || 'standard',
      seasonFolder: true,
      addOptions: {
        monitor: monitor || 'all',
        searchForMissingEpisodes: searchForMissing !== false,
        searchForCutoffUnmetEpisodes: false,
      },
    };

    const { data: result } = await axios.post(`${config.sonarr.url}/api/v3/series`, JSON.stringify(addBody), {
      headers: { 'X-Api-Key': config.sonarr.apiKey, 'Content-Type': 'application/json' },
      timeout: ARR_TIMEOUT,
    });

    invalidateAll();
    console.log(`[Sonarr] Added series: "${seriesData.title}" (id: ${result.id})`);
    res.json({ success: true, data: { id: result.id, title: result.title } });
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.[0]?.errorMessage || error.message;
    console.error(`[Sonarr] Add failed:`, msg);
    res.status(error.response?.status || 500).json({ success: false, error: msg });
  }
});

// ── Radarr Config ──

addRouter.get('/radarr/profiles', async (_req, res) => {
  try {
    const { data } = await axios.get(`${config.radarr.url}/api/v3/qualityprofile`, {
      headers: { 'X-Api-Key': config.radarr.apiKey },
      timeout: ARR_TIMEOUT,
    });
    const profiles = toArray(data).map((p: any) => ({ id: p.id, name: p.name }));
    res.json({ success: true, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

addRouter.get('/radarr/rootfolders', async (_req, res) => {
  try {
    const { data } = await axios.get(`${config.radarr.url}/api/v3/rootfolder`, {
      headers: { 'X-Api-Key': config.radarr.apiKey },
      timeout: ARR_TIMEOUT,
    });
    const folders = toArray(data).map((f: any) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace }));
    res.json({ success: true, data: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Radarr Add Movie ──

addRouter.post('/radarr/add', async (req, res) => {
  try {
    const { title, tmdbId, qualityProfileId, rootFolderPath } = req.body;

    if (!title || !tmdbId || !qualityProfileId || !rootFolderPath) {
      res.status(400).json({ success: false, error: 'title, tmdbId, qualityProfileId, and rootFolderPath are required' });
      return;
    }

    console.log(`[Radarr] Looking up movie: tmdb:${tmdbId}`);
    const { data: lookupData } = await axios.get(`${config.radarr.url}/api/v3/movie/lookup`, {
      params: { term: `tmdb:${tmdbId}` },
      headers: { 'X-Api-Key': config.radarr.apiKey },
      timeout: ARR_TIMEOUT,
    });

    const candidates = toArray(lookupData);
    console.log(`[Radarr] Lookup returned ${candidates.length} candidates`);

    let movieData = candidates.find((c: any) => c.tmdbId === tmdbId) || candidates[0];

    if (!movieData) {
      // Fallback: try title search
      console.log(`[Radarr] ID lookup failed, trying title: "${title}"`);
      const { data: titleLookup } = await axios.get(`${config.radarr.url}/api/v3/movie/lookup`, {
        params: { term: title },
        headers: { 'X-Api-Key': config.radarr.apiKey },
        timeout: ARR_TIMEOUT,
      });
      const titleCandidates = toArray(titleLookup);
      movieData = titleCandidates.find((c: any) => c.tmdbId === tmdbId) || titleCandidates[0];

      if (!movieData) {
        res.status(404).json({ success: false, error: `Movie "${title}" not found in Radarr lookup` });
        return;
      }
    }

    console.log(`[Radarr] Adding: "${movieData.title}" (tmdbId: ${movieData.tmdbId})`);

    const addBody = {
      title: movieData.title,
      tmdbId: movieData.tmdbId,
      qualityProfileId,
      rootFolderPath,
      titleSlug: movieData.titleSlug,
      images: movieData.images,
      monitored: true,
      minimumAvailability: 'released',
      addOptions: {
        searchForMovie: true,
        monitor: 'movieOnly',
      },
    };

    const { data: result } = await axios.post(`${config.radarr.url}/api/v3/movie`, JSON.stringify(addBody), {
      headers: { 'X-Api-Key': config.radarr.apiKey, 'Content-Type': 'application/json' },
      timeout: ARR_TIMEOUT,
    });

    invalidateAll();
    console.log(`[Radarr] Added movie: "${movieData.title}" (id: ${result.id})`);
    res.json({ success: true, data: { id: result.id, title: result.title } });
  } catch (error: any) {
    const msg = error.response?.data?.message || error.response?.data?.[0]?.errorMessage || error.message;
    console.error(`[Radarr] Add failed:`, msg);
    res.status(error.response?.status || 500).json({ success: false, error: msg });
  }
});
