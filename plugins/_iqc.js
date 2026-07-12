import axios from 'axios'

const API_URL = 'https://api.azbry.com/api/maker/iqc'

export default {
    cmd: ['iqc'],
    category: 'maker',
    run: async (m, { sock, text, config }) => {
        if (!text) return m.reply('Masukan teks yang mau ditampilkan!\n\nContoh: `.iqc Halo semua`')

        if (text.length > 200) return m.reply('Teks terlalu panjang! Maksimal 200 karakter.')

        m.reply('⏳ Sedang membuat gambar...')

        try {
            const apiUrl = `${API_URL}?text=${encodeURIComponent(text)}`

            // Validasi dulu apakah API benar-benar mengembalikan gambar,
            // supaya kalau API down/error kita bisa kasih pesan yang jelas
            // daripada mengirim file rusak ke user.
            const check = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000 })
            const contentType = check.headers['content-type'] || ''

            if (!contentType.startsWith('image/')) {
                console.error('[iqc] Unexpected content-type:', contentType)
                return m.reply('Gagal membuat gambar. API tidak mengembalikan gambar yang valid.')
            }

            const caption = `> *${config.botName}*`
            await sock.sendImage(m.from, Buffer.from(check.data), caption, m)

        } catch (e) {
            console.error('[iqc]', e.message)
            m.reply('Terjadi kesalahan saat mengambil gambar dari API. Coba lagi nanti.')
        }
    }
}