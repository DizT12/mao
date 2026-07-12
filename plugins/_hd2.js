import FormData from 'form-data'
import { fileTypeFromBuffer } from 'file-type'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

function generateRandomIP() {
    const ranges = [
        [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
        [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
        [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
    ]
    const range = ranges[Math.floor(Math.random() * ranges.length)]
    return [
        range[0],
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256),
        Math.floor(Math.random() * 256)
    ].join('.')
}

export default {
    cmd: ['hd2', 'upscale2', 'ihancer'],
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

        let mimeType = mediaMsg?.mimetype || ''

        if (!/image/.test(mimeType)) {
            return m.reply("Kirim gambar dengan caption atau reply gambar dengan perintah ini.")
        }

        m.reply("⏳ Sedang memproses gambar ke HD menggunakan server alternatif (ihancer)...")

        try {
            const stream = await downloadContentFromMessage(mediaMsg, 'image')
            let mediaBuffer = Buffer.from([])
            for await (const chunk of stream) mediaBuffer = Buffer.concat([mediaBuffer, chunk])

            const detected = await fileTypeFromBuffer(mediaBuffer)
            const ext = detected ? detected.ext : 'jpg'
            const mime = detected ? detected.mime : 'image/jpeg'

            const spoofedIp = generateRandomIP()
            const form = new FormData()
            form.append('method', '1')
            form.append('is_pro_version', 'true')
            form.append('is_enhancing_more', 'true')
            form.append('max_image_size', 'high')
            form.append('file', mediaBuffer, {
                filename: `upscale_${Date.now()}.${ext}`,
                contentType: mime
            })

            const headers = {
                ...form.getHeaders(),
                'accept-encoding': 'gzip',
                'host': 'ihancer.com',
                'user-agent': 'Dart/3.5 (dart:io)',
                'X-Forwarded-For': spoofedIp,
                'X-Real-IP': spoofedIp,
                'Client-IP': spoofedIp,
                'True-Client-IP': spoofedIp,
                'X-Originating-IP': spoofedIp,
                'X-Cluster-Client-IP': spoofedIp,
                'Forwarded': `for=${spoofedIp}`
            }

            const response = await fetch('https://ihancer.com/api/enhance', {
                method: 'POST',
                headers,
                body: form.getBuffer()
            })

            if (!response.ok) {
                return m.reply(`❌ Gagal memproses gambar. Server error: ${response.status}`)
            }

            const arrayBuffer = await response.arrayBuffer()
            const resultBuffer = Buffer.from(arrayBuffer)

            await sock.sendMessage(
                m.from,
                {
                    image: resultBuffer,
                    caption: "✨ Berhasil upscale & unblur gambar ke HD 3x (ihancer).",
                },
                { quoted: m }
            )
        } catch (err) {
            m.reply(`❌ Terjadi kesalahan:\n${err.message}`)
        }
    }
}