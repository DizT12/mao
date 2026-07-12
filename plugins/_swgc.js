import { downloadContentFromMessage } from '@whiskeysockets/baileys'
import { convertToOpus } from '../lib/helper.js'

export default {
    cmd: ['swgc'],
    category: 'tools',
    run: async (m, { sock, isOwner }) => {
        if (!m.isGroup) return m.reply("Khusus di dalam grup!")
        if (!isOwner) return m.reply("Hanya admin grup yang bisa menggunakan perintah ini!")

        let type = m.quoted ? m.quoted.type : m.type
        let mediaMsg = m.quoted ? m.quoted[type] : m.message[type]

        if (/ephemeral|viewOnce/.test(type)) {
            const innerType = Object.keys(mediaMsg.message || mediaMsg)[0]
            mediaMsg = (mediaMsg.message || mediaMsg)[innerType]
            type = innerType
        }

        if (/status/i.test(type) && mediaMsg?.message) {
            const innerType = Object.keys(mediaMsg.message)[0]
            mediaMsg = mediaMsg.message[innerType]
            type = innerType
        }

        if (!mediaMsg) {
            const allKeys = Object.keys(m.message || {})
            const mediaKey = allKeys.find(k => /image|video|audio/i.test(k))
            if (mediaKey) {
                type = mediaKey
                mediaMsg = m.message[mediaKey]
            }
        }

        const mime = (mediaMsg?.mimetype || '')
        const isMedia = /image|video|audio/.test(mime)
        let text = m.text.trim()

        const colorMap = { 'biru': '0xff26c4dc', 'merah': '0xffff0000', 'hijau': '0xff00ff00', 'kuning': '0xffffff00', 'hitam': '0xff000000' }
        let bgColor = colorMap['biru']
        if (text.includes('--color:')) {
            let col = text.split('--color:')[1].trim().split(' ')[0]
            bgColor = colorMap[col] || `0xff${col.replace('#', '')}`
            text = text.replace(`--color:${col}`, '').replace('--color:', '').trim()
        }

        try {
            const groupMeta = await sock.groupMetadata(m.from)
            const participants = groupMeta.participants.map(p => p.id)

            // contextInfo masuk ke dalam message content
            const contextInfo = {
                isGroupStatus: true,
                remoteJid: 'status@broadcast',
                groupStatusJidList: participants,
                statusAttributions: [{ type: 10 }]
            }

            let content = {}

            if (isMedia) {
                const downloadType = type.replace('Message', '').toLowerCase()
                const dlType = downloadType.includes('image') ? 'image'
                             : downloadType.includes('video') ? 'video'
                             : 'audio'

                const stream = await downloadContentFromMessage(mediaMsg, dlType)
                let buffer = Buffer.from([])
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

                if (dlType === 'audio') {
                    content.audio = await convertToOpus(buffer)
                    content.ptt = true
                    content.mimetype = 'audio/ogg; codecs=opus'
                    content.waveform = new Uint8Array(64).fill(10)
                    content.contextInfo = contextInfo
                } else {
                    content[dlType] = buffer
                    content.caption = text || undefined
                    content.contextInfo = contextInfo
                }
            } else {
                if (!text) return m.reply("Teksnya mana?")
                content.text = text
                content.contextInfo = contextInfo
            }

            await sock.sendMessage(m.from, content, {
                backgroundColor: bgColor,
                statusJidList: participants
            })
            return m.reply("Status Grup Berhasil Dikirim!")
        } catch (e) {
            console.error(e)
            m.reply("Terjadi kesalahan: " + e.message)
        }
    }
}