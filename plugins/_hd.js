import axios from 'axios'
import FormData from 'form-data'
import crypto from 'crypto'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

export default {
    cmd: ['hd', 'unblur', 'upscalehd'],
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

        let mime = mediaMsg?.mimetype || ''

        if (!/image/.test(mime)) {
            return m.reply("Kirim gambar dengan caption atau reply gambar dengan perintah ini.")
        }

        m.reply("⏳ Sedang menghilangkan blur & upscale gambar ke HD...")

        try {
            const stream = await downloadContentFromMessage(mediaMsg, 'image')
            let media = Buffer.from([])
            for await (const chunk of stream) media = Buffer.concat([media, chunk])

            const serial = crypto.randomBytes(16).toString("hex")
            const fname = `Image_${crypto.randomBytes(6).toString("hex")}.jpg`

            const form = new FormData()
            form.append("original_image_file", media, {
                filename: fname,
                contentType: "image/jpeg",
            })
            form.append("scale_factor", 3)
            form.append("upscale_type", "image-upscale")

            const headers = {
                ...form.getHeaders(),
                "product-serial": serial,
            }

            const createJob = await axios.post(
                "https://api.unblurimage.ai/api/imgupscaler/v2/ai-image-unblur/create-job",
                form,
                { headers }
            )

            const jobId = createJob.data?.result?.job_id

            if (!jobId) {
                return m.reply("❌ Gagal membuat job upscale.")
            }

            let outputUrl = null
            const timeout = Date.now() + 180000

            while (Date.now() < timeout) {
                const poll = await axios.get(
                    `https://api.unblurimage.ai/api/imgupscaler/v2/ai-image-unblur/get-job/${jobId}`,
                    { headers }
                )

                if (
                    poll.data.code === 100000 &&
                    poll.data.result?.output_url?.[0]
                ) {
                    outputUrl = poll.data.result.output_url[0]
                    break
                }

                await new Promise((r) => setTimeout(r, 3000))
            }

            if (!outputUrl) {
                return m.reply("❌ Gagal mendapatkan hasil HD.")
            }

            const resultImg = await axios.get(outputUrl, {
                responseType: "arraybuffer",
            })

            await sock.sendMessage(
                m.from,
                {
                    image: Buffer.from(resultImg.data),
                    caption: "✨ Berhasil upscale & unblur gambar ke HD 3x.",
                },
                { quoted: m }
            )
        } catch (err) {
            console.error(err)
            m.reply(
                `❌ Terjadi kesalahan:\n${err?.response?.data?.message || err.message}`
            )
        }
    }
}