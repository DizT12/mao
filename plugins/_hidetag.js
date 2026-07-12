import { generateWAMessageFromContent, jidNormalizedUser } from '@whiskeysockets/baileys'

export default {
    cmd: ['hidetag', 'ht'],
    category: 'group',
    run: async (m, { sock, isOwner, text, isAdmin, config }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isOwner) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const metadata = await sock.groupMetadata(m.from).catch(() => null)
        if (!metadata) return m.reply('Gagal mengambil data grup.')

        const help = () => {
            let help = `⌗ *Hidetag System*\n\n`
            help += `Mention seluruh member grup tanpa terlihat tag mereka.\n\n`
            help += `› .hidetag <teks>\n`
            help += `› .ht <teks>\n`
            help += `› .hidetag (reply pesan apapun)\n\n`
            help += `> *${config.botName}*`
            return help
        }

        let messageContent

        if (m.quoted) {
            let type = m.quoted.type
            let content = m.quoted[type]

            if (content && /ephemeral|viewOnce/.test(type)) {
                const inner = content.message || content
                type = Object.keys(inner)[0]
                content = inner[type]
            }

            if (type === 'conversation') {
                messageContent = {
                    extendedTextMessage: {
                        text: `${text || content || ''}\n@all`,
                        contextInfo: {
                            mentionedJid: [],
                            nonJidMentions: 1
                        }
                    }
                }
            } else if (content && typeof content === 'object') {
                messageContent = {
                    [type]: {
                        ...content,
                        ...(text && 'caption' in content ? { caption: text } : {}),
                        ...(text && type === 'extendedTextMessage' ? { text: `${text}\n@all` } : {}),
                        contextInfo: {
                            ...(content.contextInfo || {}),
                            mentionedJid: [],
                            nonJidMentions: 1
                        }
                    }
                }
            }
        }

        if (!messageContent) {
            if (!text) return m.reply(help())
            messageContent = {
                extendedTextMessage: {
                    text: `${text}\n@all`,
                    contextInfo: {
                        mentionedJid: [],
                        nonJidMentions: 1
                    }
                }
            }
        }

        try {
            const msg = generateWAMessageFromContent(m.from, messageContent, { userJid: sock.user.id })
            await sock.relayMessage(m.from, msg.message, { messageId: msg.key.id })
        } catch (e) {
            console.error(e)
            m.reply('Gagal mengirim hidetag.')
        }
    }
}