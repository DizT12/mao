import { getContentType, jidNormalizedUser } from '@whiskeysockets/baileys'
import { saveContact, saveMetadata, syncGroupParticipants, getLidMapping } from './database.js'
import config from '../config.js'
import util from 'util'

export async function serialize(sock, m) {
    if (!m) return m
    
    if (m.key) {
        m.id = m.key.id
        m.from = m.key.remoteJid
        m.jid = m.from
        m.isGroup = m.from.endsWith('@g.us')
        m.isNewsletter = m.from.endsWith('@newsletter')
        
        let jid, lid
        if (m.isGroup) {
            lid = m.key.participant
            jid = m.key.participantAlt
        } else {
            lid = m.key.remoteJid
            jid = m.key.remoteJidAlt
        }

        if (lid && !jid && lid.endsWith('@s.whatsapp.net')) jid = lid
        if (lid && lid.endsWith('@lid') && !jid) {
            const mapped = await getLidMapping(lid)
            if (mapped) jid = mapped
        }

        m.sender = jid ? jidNormalizedUser(jid) : jidNormalizedUser(lid)
        m.senderLid = lid && lid.endsWith('@lid') ? lid : null
    }

    if (m.message) {
        m.type = getContentType(m.message)
        if (m.type === 'ephemeralMessage' || m.type === 'viewOnceMessageV2') {
            m.message = m.message[m.type].message
            m.type = getContentType(m.message)
        }

        let body = ''
        if (m.type === 'conversation') {
            body = m.message.conversation
        } else if (m.type === 'extendedTextMessage') {
            body = m.message.extendedTextMessage.text
        } else if (m.type === 'imageMessage') {
            body = m.message.imageMessage.caption
        } else if (m.type === 'videoMessage') {
            body = m.message.videoMessage.caption
        } else if (m.type === 'buttonsResponseMessage') {
            body = m.message.buttonsResponseMessage.selectedButtonId
        } else if (m.type === 'listResponseMessage') {
            body = m.message.listResponseMessage.singleSelectReply?.selectedRowId
        } else if (m.type === 'templateButtonReplyMessage') {
            body = m.message.templateButtonReplyMessage.selectedId
        } else if (m.type === 'interactiveResponseMessage') {
            try {
                const params = JSON.parse(m.message.interactiveResponseMessage.nativeFlowResponseMessage?.paramsJson || '{}')
                body = params.id || ''
            } catch {
                body = ''
            }
        }
        m.body = body || ''
        
        m.arg = m.body.trim().split(/ +/) || []
        m.text = m.arg.slice(1).join(" ")
        m.expiration = m.message[m.type]?.contextInfo?.expiration || 0
        
        m.quoted = m.message[m.type]?.contextInfo?.quotedMessage || null
        if (m.quoted) {
            m.quoted.type = getContentType(m.quoted)
            m.quoted.id = m.message[m.type].contextInfo.stanzaId
            
            let qRaw = m.message[m.type].contextInfo.participant
            let qAlt = m.message[m.type].contextInfo.participantAlt
            let qJid = qAlt || (qRaw?.endsWith('@s.whatsapp.net') ? qRaw : null)
            let qLid = qRaw?.endsWith('@lid') ? qRaw : null

            if (qLid && !qJid) {
                const qMapped = await getLidMapping(qLid)
                if (qMapped) qJid = qMapped
            }
            
            m.quoted.sender = qJid ? jidNormalizedUser(qJid) : jidNormalizedUser(qRaw)
            m.quoted.lid = qLid
        }
    }

    m.isAdmin = false
    m.isBotAdmin = false

    if (m.isGroup) {
        const metadata = await sock.groupMetadata(m.from).catch(() => null)
        if (metadata) {
            m.groupName = metadata.subject
            const participants = metadata.participants || []
            const botJid = jidNormalizedUser(sock.user.id)
            
            m.isAdmin = participants.find(p => jidNormalizedUser(p.id) === m.sender || jidNormalizedUser(p.phoneNumber) === m.sender)?.admin !== null
            m.isBotAdmin = participants.find(p => jidNormalizedUser(p.id) === botJid || jidNormalizedUser(p.phoneNumber) === botJid)?.admin !== null
            
            setImmediate(async () => {
                await saveMetadata(m.from, metadata.subject, metadata.desc?.toString(), metadata.participants)
                await syncGroupParticipants(m.from, metadata.participants)
            })
        }
    }

    setImmediate(async () => {
        if (m.sender && m.sender.endsWith('@s.whatsapp.net') && !m.key.fromMe) {
            await saveContact(m.sender, m.senderLid, m.pushName)
        }
    })

    const ownerNumbers = config.ownerNumber.map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
    m.isOwner = ownerNumbers.includes(m.sender)

    m.reply = async (text, options = {}) => {
        let content = typeof text === 'object' ? util.inspect(text) : (text || "Selesai.")
        let mentions = [...String(content).matchAll(/@(\d+)/g)].map(v => v[1] + '@s.whatsapp.net')
        
        let thumbBuffer = Buffer.alloc(0)
        try {
            const res = await fetch(config.thumbnail2)
            thumbBuffer = Buffer.from(await res.arrayBuffer())
        } catch {}

        const messageId = sock.generateMessageID()
        const textWithLink = `https://komarin.dev\n${String(content)}`
        
        const messageContent = {
            extendedTextMessage: {
                text: textWithLink,
                matchedText: "https://komarin.dev",
                description: "WhatsApp Bot",
                title: "MaoMao Chan",
                previewType: 0,
                jpegThumbnail: thumbBuffer,
                contextInfo: {
                    mentionedJid: options.mentions || mentions,
                    expiration: m.expiration,
                    stanzaId: m.key.id,
                    participant: m.sender,
                    quotedMessage: m.message
                }
            }
        }

        await sock.relayMessage(m.from, messageContent, { messageId })
        return { key: { remoteJid: m.from, fromMe: true, id: messageId }, message: messageContent }
    }

    m.del = async (key = m.key) => {
        return await sock.sendMessage(key.remoteJid, { delete: key })
    }

    return m
}