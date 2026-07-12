import TwitterDL from '../lib/scraper/twitter.js'

export default {
    cmd: ['twitter', 'twt', 'x', 'xdl'],
    category: 'downloader',
    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukkan URL Twitter/X yang valid!')
        if (!/twitter.com|x.com/.test(text)) return m.reply('Link tidak valid!')

        m.reply('⌛ Sedang mengambil data...')

        try {
            const twt = new TwitterDL()
            const res = await twt.download(text)

            if (!res.downloads.length) return m.reply('Gagal mendapatkan link download.')

            let caption = `⌗ *Twitter Downloader*\n\n`
            caption += `› *Judul:* ${res.title}\n\n`
            caption += `> *${config.botName}*`

            const video = res.downloads.find(v => v.quality === 'HD') || res.downloads[0]

            await sock.sendMessage(m.from, {
                video: { url: video.url },
                caption: caption
            }, { quoted: m })

        } catch (e) {
            console.error(e)
            m.reply('Terjadi kesalahan saat mengunduh video Twitter.')
        }
    }
}