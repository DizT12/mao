import axios from 'axios';

const spotifyCreds = '7bbae52593da45c69a27c853cc22edff:88ae1f7587384f3f83f62a279e7f87af';

async function getAccessToken() {
    const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(spotifyCreds).toString('base64'),
            },
        }
    );
    return res.data.access_token;
}

export async function spotifySearch(query, limit = 1) {
    const token = await getAccessToken();
    const res = await axios.get('https://api.spotify.com/v1/search', {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: query, type: 'track', limit, market: 'ID' },
    });

    return (res.data.tracks?.items || []).map(item => ({
        title: item.name,
        artist: item.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
        album: item.album?.name || 'Unknown Album',
        duration: (item.duration_ms / 1000 / 60).toFixed(2) + ' Min',
        popularity: item.popularity,
        cover: item.album?.images?.[0]?.url,
        url: item.external_urls?.spotify
    }));
}

export async function spotifyDownload(url) {
    const cleanUrl = url.replace('/intl-id', '').replace('/intl-id/', '/');
    const res = await axios.post(
        'https://sssspotify.com/api/download/get-url',
        { url: cleanUrl },
        { 
            headers: {
                'content-type': 'application/json',
                'referer': 'https://sssspotify.com/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }
    );

    if (res.data?.code !== 200 || !res.data.originalVideoUrl) throw new Error('Gagal ambil link download.');

    const encodedPart = res.data.originalVideoUrl.replace('/api/download/dl?url=', '');
    const finalUrl = Buffer.from(encodedPart, 'base64').toString('utf-8');

    return {
        title: res.data.title,
        artist: res.data.authorName,
        cover: res.data.coverUrl,
        downloadUrl: finalUrl
    };
}