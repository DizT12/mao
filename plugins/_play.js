import { ButtonV2 } from '../lib/helper.js'

export default {
    cmd: ['play'],
    category: 'downloader',
    run: async (m, { sock, text }) => {
        await sock.sendMessage(m.from, { react: { text: '✨', key: m.key } })

        if (!text) return m.reply('Contoh : !play2 Swim chase atlantic')

        try {
            const api = `https://api.azbry.com/api/download/ytplay2?q=${encodeURIComponent(text)}`
            const res = await fetch(api)
            const json = await res.json()

            if (!json.status) throw new Error('API error')

            const data = json.result
            if (!data?.download) throw new Error('No download link returned')

            let thumbBuffer = Buffer.alloc(0)
            try {
                const rawThumb = await ButtonV2.fetchBuffer(data.thumbnail, {}, { silent: true })
                thumbBuffer = await ButtonV2.resize(rawThumb, 300, 300)
            } catch {}

            const fakeQuoted = {
                key: { remoteJid: m.from, fromMe: true, id: sock.generateMessageID() },
                message: {
                    locationMessage: {
                        degreesLatitude: 0,
                        degreesLongitude: 0,
                        name: data.title,
                        address: `${data.channel} • ${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}`,
                        jpegThumbnail: thumbBuffer
                    }
                }
            }

            await sock.sendAudio(m.from, data.download, false, fakeQuoted, {
                fileName: `${data.title}.mp3`
            })

        } catch (e) {
            console.error(e)
            m.reply('⚠️ Gagal mengambil audio.')
        }
    }
}