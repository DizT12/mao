import axios from 'axios'

const API_URL = 'https://api.azbry.com/api/maker/brat'

export default {
    cmd: ['brat'],
    category: 'maker',
    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukan teks yang mau ditampilkan!\n\nContoh: `.brat mao ganteng`')

        if (text.length > 200) return m.reply('Teks terlalu panjang! Maksimal 200 karakter.')

        await sock.sendMessage(m.from, { react: { text: '⏳', key: m.key } })

        try {
            const apiUrl = `${API_URL}?text=${encodeURIComponent(text)}`

            // Satu request langsung ambil buffer gambar, timeout dipangkas
            // biar gak nunggu lama kalau API lambat/down. Content-type dicek
            // dari response yang sama, tanpa request kedua terpisah (biar cepat).
            const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 15000 })
            const contentType = res.headers['content-type'] || ''

            if (!contentType.startsWith('image/')) {
                console.error('[brat] Unexpected content-type:', contentType)
                await sock.sendMessage(m.from, { react: { text: '❌', key: m.key } })
                return m.reply('Gagal membuat stiker. API tidak mengembalikan gambar yang valid.')
            }

            await sock.sendSticker(m.from, Buffer.from(res.data), m, {
                packname: config.botName || 'maomao',
                author: 'brat'
            })

            await sock.sendMessage(m.from, { react: { text: '✅', key: m.key } })

        } catch (e) {
            console.error('[brat]', e.message)
            await sock.sendMessage(m.from, { react: { text: '❌', key: m.key } })
            m.reply('Terjadi kesalahan saat membuat stiker. Coba lagi nanti.')
        }
    }
}