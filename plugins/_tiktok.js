import { ttdown } from '../lib/scraper/tiktok.js'

export default {
    cmd: ['tiktok', 'tt', 'ttdl'],
    category: 'downloader',
    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukan URL TikTok yang valid!')
        if (!/tiktok.com/.test(text)) return m.reply('Link tidak valid!')

        m.reply('⏳ Sedang memproses, mohon tunggu...')

        try {
            const data = await ttdown(text)
            
            if (!data.downloads.length) return m.reply('Gagal mengambil link download.')

            const videoUrl = data.downloads.find(v => v.type === 'mp4' || v.label.includes('MP4'))?.url || data.downloads[0].url
            const audioUrl = data.downloads.find(v => v.type === 'mp3' || v.label.includes('MP3'))?.url

            let caption = `⌗ *TikTok Downloader*\n\n`
            caption += `› *Judul:* ${data.title || '-'}\n`
            caption += `› *Author:* ${data.author.username || '-'}\n\n`
            caption += `> *${config.botName}*`

            await sock.sendVideo(m.from, videoUrl, caption, m)

            if (audioUrl) {
                await sock.sendAudio(m.from, audioUrl, false, m)
            }

        } catch (e) {
            console.error(e)
            m.reply('Terjadi kesalahan saat mengunduh video. Pastikan link benar dan video tidak diprivasi.')
        }
    }
}