import { downloadContentFromMessage, generateWAMessageFromContent, prepareWAMessageMedia } from '@whiskeysockets/baileys'

// Sisipkan metadata (EXIF) ke buffer WEBP mentah, dipakai untuk kasih
// atribut khusus pada sticker (nama pack, publisher, emoji, dsb).
function buildStickerExif(metadata) {
    const json = Buffer.from(JSON.stringify(metadata), 'utf-8')

    const exif = Buffer.concat([
        Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
            0x07, 0x00,
        ]),
        Buffer.alloc(4),
        Buffer.from([0x16, 0x00, 0x00, 0x00]),
        json,
    ])

    exif.writeUInt32LE(json.length, 14)
    return exif
}

function makeChunk(type, data) {
    const typeBuffer = Buffer.from(type)
    const sizeBuffer = Buffer.alloc(4)
    sizeBuffer.writeUInt32LE(data.length, 0)

    const padding = data.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0)

    return Buffer.concat([typeBuffer, sizeBuffer, data, padding])
}

function setWebpExif(webpBuffer, metadata) {
    if (
        webpBuffer.slice(0, 4).toString() !== 'RIFF' ||
        webpBuffer.slice(8, 12).toString() !== 'WEBP'
    ) {
        throw new Error('File bukan WEBP valid.')
    }

    const chunks = []
    let offset = 12

    while (offset + 8 <= webpBuffer.length) {
        const type = webpBuffer.slice(offset, offset + 4).toString()
        const size = webpBuffer.readUInt32LE(offset + 4)
        const chunkStart = offset
        const chunkEnd = offset + 8 + size + (size % 2)

        if (chunkEnd > webpBuffer.length) break

        if (type !== 'EXIF') {
            chunks.push(webpBuffer.slice(chunkStart, chunkEnd))
        }

        offset = chunkEnd
    }

    const exifPayload = buildStickerExif(metadata)
    const exifChunk = makeChunk('EXIF', exifPayload)

    const body = Buffer.concat([...chunks, exifChunk])

    const header = Buffer.alloc(12)
    header.write('RIFF', 0)
    header.writeUInt32LE(body.length + 4, 4)
    header.write('WEBP', 8)

    return Buffer.concat([header, body])
}

async function downloadStickerBuffer(stickerMessage) {
    const stream = await downloadContentFromMessage(stickerMessage, 'sticker')

    const chunks = []
    for await (const chunk of stream) {
        chunks.push(chunk)
    }

    return Buffer.concat(chunks)
}

export default {
    cmd: ['setattr', 'stattr', 'anticolong'],
    category: 'sticker',
    run: async (m, { sock, config }) => {
        try {
            const jid = m.from

            // Di project mao, m.quoted sudah langsung berisi objek pesan yang
            // di-reply (bukan perlu digali lagi lewat contextInfo manual).
            const stickerMessage = m.quoted?.stickerMessage

            if (!stickerMessage) {
                return m.reply('Reply sticker WEBP biasa dulu.')
            }

            if (stickerMessage.mimetype !== 'image/webp') {
                return m.reply('Ini bukan sticker WEBP biasa. Untuk lottie/application/was beda cara.')
            }

            const stickerBuffer = await downloadStickerBuffer(stickerMessage)

            const metadata = {
                'sticker-pack-id': `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                'sticker-pack-name': config.botName || 'MaoMao',
                'sticker-pack-publisher': '',
                'accessibility-text': config.botName || 'MaoMao',
                emojis: ['🦸', '😴', '😌'],
                'is-from-sticker-maker': 0,
                'is-avatar-sticker': 1,
                'avatar-sticker-template-id': 'whatsapp',
                'is-ai-sticker': 1,
                'is-avatar-country-sticker': 1,
                'is-avatar-instant-sticker': 1,
                'sticker-maker-source-type': 4,
                'is-avatar-social-sticker': 1,
                'avatar-sticker-style': 'whatsapp',
                'avatar-sticker-revision-id': '2026',
                'is-from-user-created-pack': 1,
                'origin-pack-id': 'whatsapp',
                'is-text-sticker': 1,
            }

            const finalStickerBuffer = setWebpExif(stickerBuffer, metadata)

            const media = await prepareWAMessageMedia(
                { sticker: finalStickerBuffer },
                { upload: sock.waUploadToServer }
            )

            const msgContent = {
                messageContextInfo: {
                    limitSharingV2: {
                        sharingLimited: true,
                        trigger: 'CHAT_SETTING',
                        limitSharingSettingTimestamp: Date.now().toString(),
                        initiatedByMe: true,
                    },
                },
                stickerMessage: {
                    ...media.stickerMessage,
                    isAnimated: stickerMessage.isAnimated || false,
                    isAvatar: true,
                    isAiSticker: true,
                    isLottie: false,
                },
            }

            const msg = generateWAMessageFromContent(jid, msgContent, {
                quoted: m,
                userJid: sock.user.id,
            })

            await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })

            console.log('✅ Sticker berhasil diberi EXIF/atribut dan dikirim ulang')
        } catch (e) {
            console.error('❌ Error inject sticker metadata:', e)
            m.reply('Gagal inject atribut sticker. Cek console.')
        }
    }
}