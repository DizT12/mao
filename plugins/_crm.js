import util from 'util'

function hasNativeFlow(msg) {
    if (!msg || typeof msg !== 'object') return false
    if (msg.interactiveMessage?.nativeFlowMessage) return true
    if (msg.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage) return true
    for (const k in msg) {
        if (typeof msg[k] === 'object' && hasNativeFlow(msg[k])) return true
    }
    return false
}

function buildRelayOption(msg) {
    if (!hasNativeFlow(msg)) return {}
    return {
        additionalNodes: [
            {
                tag: 'biz',
                attrs: {},
                content: [
                    {
                        tag: 'interactive',
                        attrs: { type: 'native_flow', v: '1' },
                        content: [
                            { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }
                        ]
                    }
                ]
            }
        ]
    }
}

function cleanMessage(msg) {
    if (!msg || typeof msg !== 'object') return msg
    if (Buffer.isBuffer(msg)) return '<Buffer ' + msg.length + ' bytes>'
    if (msg.constructor?.name === 'Long') return msg.toNumber()
    if (msg instanceof Uint8Array) return Buffer.from(msg).toString('base64')

    const result = {}
    for (const [k, v] of Object.entries(msg)) {
        if (v === null || v === undefined) continue
        if (Array.isArray(v)) {
            if (v.length === 0) continue
            result[k] = v.map(cleanMessage)
        } else if (typeof v === 'object') {
            const cleaned = cleanMessage(v)
            if (cleaned && Object.keys(cleaned).length > 0) result[k] = cleaned
        } else {
            result[k] = v
        }
    }
    return result
}

export default {
    cmd: ['icrm'],
    category: 'owner',
    run: async (m, { sock, isOwner }) => {
        if (!isOwner) return m.reply("Hanya owner yang bisa menggunakan perintah ini!")
        if (!m.quoted) return m.reply("Reply pesan target dulu!")

        const raw = m.quoted
        const msgContent = raw.message || raw
        if (!msgContent || Object.keys(msgContent).length === 0) {
            return m.reply("Tidak ada raw message (button tidak bisa di clone)")
        }

        const cleanedMsg = cleanMessage(JSON.parse(JSON.stringify(msgContent)))
        const relayOption = buildRelayOption(msgContent)
        const hasFlow = hasNativeFlow(msgContent)

        const code = `// iCRM - MaoMao Bot
// Sender: ${raw.sender || 'unknown'}
// Type: ${raw.type || 'unknown'}
// Has NativeFlow: ${hasFlow}

const content = ${JSON.stringify(cleanedMsg, null, 2)}

const relayOption = ${JSON.stringify(relayOption, null, 2)}

await sock.relayMessage(m.from, content, { messageId: sock.generateMessageTag(), ...relayOption })
`

        await sock.sendMessage(m.from, {
            document: Buffer.from(code),
            mimetype: 'application/javascript',
            fileName: 'crm-' + Date.now().toString(36) + '.js',
            caption: '📦 *iCRM Result*\n\nSender: ' + (raw.sender || 'unknown') + '\nType: ' + (raw.type || 'unknown') + '\nNativeFlow: ' + (hasFlow ? '✅' : '❌')
        }, { quoted: m })
    }
}