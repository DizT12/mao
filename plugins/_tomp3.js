import axios from 'axios'
import FormData from 'form-data'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

async function tomp3(url) {
    const h = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer null',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://www.freeconvert.com/mp3-converter/download'
    }

    const fname = url.split('/').pop()
    const datajob = {
        tasks: {
            import: {
                operation: "import/url",
                url: url,
                filename: fname
            },
            convert: {
                operation: "convert",
                input: "import",
                input_format: "mp4",
                output_format: "mp3",
                options: {
                    audio_codec: "libmp3lame",
                    audio_rate_control_mp3: "auto",
                    audio_sample_rate_mp3_dts_ac3: "auto",
                    audio_channel_mp3: "no-change",
                    audio_filter_volume: 100,
                    audio_filter_fade_in: false,
                    audio_filter_fade_out: false,
                    audio_filter_reverse: false
                }
            },
            "export-url": {
                operation: "export/url",
                input: "convert"
            }
        }
    }

    const procres = await axios.post('https://api.freeconvert.com/v1/process/jobs', datajob, { headers: h })
    const idjob = procres.data.id

    async function checkjobs() {
        const statsres = await axios.get(`https://api.freeconvert.com/v1/process/jobs/${idjob}`, { headers: h })

        if (statsres.data.status === 'completed') {
            const taskex = statsres.data.tasks.find(task => task.name === 'export-url')
            if (taskex?.result?.url) return taskex.result.url
            throw new Error('URL MP3 tidak ditemukan')
        }

        if (statsres.data.status === 'failed') throw new Error('Konversi gagal')

        await new Promise(resolve => setTimeout(resolve, 2000))
        return checkjobs()
    }

    return await checkjobs()
}

async function Uguu(buffer, filename) {
    const form = new FormData()
    form.append('files[]', buffer, { filename })

    const { data } = await axios.post('https://uguu.se/upload.php', form, {
        headers: form.getHeaders()
    })

    if (data.files?.[0]) {
        return {
            name: data.files[0].name,
            url: data.files[0].url,
            size: data.files[0].size
        }
    }
    throw new Error('Upload gagal')
}

export default {
    cmd: ['tomp3'],
    category: 'tools',
    run: async (m, { sock }) => {
        let q = m.quoted ? m.quoted : m
        let type = q.type
        let mediaMsg = q === m.quoted ? q[type] : m.message[type]

        if (/ephemeral|viewOnce/.test(type)) {
            const innerType = Object.keys(mediaMsg.message || mediaMsg)[0]
            mediaMsg = (mediaMsg.message || mediaMsg)[innerType]
            type = innerType
        }

        const mimeType = mediaMsg?.mimetype || ''

        if (!mimeType.startsWith('video/')) return m.reply('Mana Videonya Bambang_-')

        m.reply('⏳ Wait...')

        try {
            const stream = await downloadContentFromMessage(mediaMsg, 'video')
            let buffer = Buffer.from([])
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

            const uploaded = await Uguu(buffer, 'video.mp4')
            const mp3Url = await tomp3(uploaded.url)

            await sock.sendMessage(m.from, {
                document: { url: mp3Url },
                mimetype: 'audio/mpeg',
                fileName: 'audio.mp3'
            }, { quoted: m })
        } catch (e) {
            console.error(e)
            m.reply(`❌ Terjadi kesalahan:\n${e.message}`)
        }
    }
}