import axios from 'axios';
import FormData from 'form-data';
import * as cheerio from 'cheerio';

class TwitterDL {
    constructor() {
        this.client = axios.create({
            baseURL: 'https://ssstwitter.com',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Origin': 'https://ssstwitter.com',
                'Referer': 'https://ssstwitter.com/en-11'
            }
        });
    }

    async getToken() {
        const r = await this.client.get('/en-11');
        const $ = cheerio.load(r.data);
        const f = $('form[data-hx-post]');
        const v = f.attr('include-vals');
        const m = v.match(/tt:'([^']+)',ts:(\d+),source:'([^']+)'/);
        return { tt: m[1], ts: parseInt(m[2]), source: m[3] };
    }

    async download(url) {
        const t = await this.getToken();
        const fd = new FormData();
        fd.append('id', url);
        fd.append('locale', 'en');
        fd.append('tt', t.tt);
        fd.append('ts', t.ts.toString());
        fd.append('source', t.source);
        const h = {
            'HX-Request': 'true',
            'HX-Current-URL': 'https://ssstwitter.com/en-11',
            'HX-Target': 'target',
            ...fd.getHeaders()
        };
        const r = await this.client.post('/', fd, { headers: h });
        return this.parseLinks(r.data);
    }

    parseLinks(html) {
        const $ = cheerio.load(html);
        const links = [];
        $('.download-btn').each((i, b) => {
            const u = $(b).attr('href') || $(b).attr('data-directurl');
            const txt = $(b).text().trim();
            const q = txt.match(/(\d+x\d+)/)?.[1] || this.getQ(txt);
            if (u && u.startsWith('http')) {
                links.push({ quality: q, url: u });
            }
        });
        const title = $('.result-title').text().trim();
        const thumb = $('.result-thumbnail img').attr('src');
        return { 
            title: title || 'X Downloader', 
            thumbnail: thumb || '', 
            downloads: links 
        };
    }

    getQ(txt) {
        if (txt.includes('HD')) return 'HD';
        const resolutions = ['640x640', '540x540', '320x320'];
        for (const res of resolutions) {
            if (txt.includes(res)) return res;
        }
        return txt.match(/\d+x\d+/)?.[0] || 'Unknown';
    }
}

export default TwitterDL;