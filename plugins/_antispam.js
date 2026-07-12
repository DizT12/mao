import fs from 'fs'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

const SETTINGS_FILE = './database/antispam_settings.json'

// ── konfigurasi deteksi spam ──
const SPAM_WINDOW_MS = 8000      // jendela waktu untuk hitung pesan beruntun
const SPAM_THRESHOLD = 4         // jumlah pesan identik/cepat dalam jendela waktu agar dianggap spam
const WARN_RESET_MS = 10 * 60 * 1000 // reset jumlah warning jika user "baik" selama 10 menit
const MAX_WARN = 2               // batas warning sebelum kick

const getSettings = () => {
    if (!fs.existsSync('./database')) {
        fs.mkdirSync('./database', { recursive: true })
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, '{}', 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

const saveSettings = (data) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// state runtime (tidak perlu persist ke disk, cukup selama proses bot hidup)
// trackMap: groupId -> senderId -> { lastBody, lastType, count, firstTs, lastTs }
const trackMap = new Map()
// warnMap: groupId -> senderId -> { count, lastWarnTs }
const warnMap = new Map()

function getTrack(groupId, sender) {
    if (!trackMap.has(groupId)) trackMap.set(groupId, new Map())
    const g = trackMap.get(groupId)
    if (!g.has(sender)) g.set(sender, { lastBody: '', lastType: '', count: 0, firstTs: 0, lastTs: 0 })
    return g.get(sender)
}

function getWarn(groupId, sender) {
    if (!warnMap.has(groupId)) warnMap.set(groupId, new Map())
    const g = warnMap.get(groupId)
    if (!g.has(sender)) g.set(sender, { count: 0, lastWarnTs: 0 })
    return g.get(sender)
}

function fingerprintSticker(m) {
    const sticker = m.message?.stickerMessage
    if (!sticker) return null
    // fileSha256 unik per file sticker, dipakai untuk deteksi sticker yang sama dikirim berulang
    return sticker.fileSha256 ? Buffer.from(sticker.fileSha256).toString('base64') : (sticker.url || 'sticker')
}

export default {
    cmd: ['antispam'],
    category: 'admin',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const action = text.toLowerCase().trim()
        const settings = getSettings()

        if (action === 'on') {
            settings[m.from] = true
            saveSettings(settings)
            return m.reply('Antispam berhasil diaktifkan di grup ini!\n\nBot akan menghapus pesan/sticker spam dan memberi peringatan (maks. 2x) sebelum mengeluarkan member yang melanggar.')
        } else if (action === 'off') {
            settings[m.from] = false
            saveSettings(settings)
            return m.reply('Antispam dinonaktifkan di grup ini.')
        } else if (action === 'reset') {
            warnMap.delete(m.from)
            trackMap.delete(m.from)
            return m.reply('Data peringatan antispam di grup ini telah direset.')
        } else {
            const status = settings[m.from] === true ? 'ON' : 'OFF'
            let help = `⌗ *Antispam System*\n\n`
            help += `Status saat ini: *[ ${status} ]*\n\n`
            help += `› .antispam on - Aktifkan\n`
            help += `› .antispam off - Matikan\n`
            help += `› .antispam reset - Reset peringatan\n\n`
            help += `Mendeteksi spam pada chat teks dan sticker. Pelanggar akan diberi peringatan hingga 2x, lalu dikeluarkan dari grup pada pelanggaran ke-3.`
            return m.reply(help)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const settings = getSettings()
        if (settings[m.from] !== true) return false

        // jangan proses command (biar tidak bentrok dengan fitur command lain)
        const prefixes = ['.', '/', '#', '!']
        if (m.body && prefixes.some(p => m.body.startsWith(p))) return false

        // owner & admin grup dikecualikan dari antispam
        if (m.isOwner || m.isAdmin) return false

        // hanya pantau chat teks & sticker
        const isText = (m.type === 'conversation' || m.type === 'extendedTextMessage') && m.body && m.body.trim().length > 0
        const isSticker = m.type === 'stickerMessage'
        if (!isText && !isSticker) return false

        const now = Date.now()
        const sender = m.sender
        const groupId = m.from

        const fingerprint = isSticker ? fingerprintSticker(m) : m.body.trim().toLowerCase()
        if (!fingerprint) return false

        const track = getTrack(groupId, sender)

        const sameContent = track.lastBody === fingerprint && track.lastType === m.type
        const withinWindow = (now - track.lastTs) <= SPAM_WINDOW_MS

        if (sameContent && withinWindow) {
            track.count += 1
        } else {
            track.count = 1
            track.firstTs = now
        }
        track.lastBody = fingerprint
        track.lastType = m.type
        track.lastTs = now

        if (track.count < SPAM_THRESHOLD) return false

        // ── terdeteksi spam ──
        track.count = 0 // reset hitungan beruntun supaya tidak langsung trigger lagi tiap pesan

        try {
            await sock.sendMessage(groupId, {
                delete: {
                    remoteJid: groupId,
                    fromMe: false,
                    id: m.key.id,
                    participant: sender
                }
            })
        } catch (e) {
            console.error('Gagal menghapus pesan spam:', e.message)
        }

        const warn = getWarn(groupId, sender)
        if (now - warn.lastWarnTs > WARN_RESET_MS) {
            warn.count = 0
        }
        warn.count += 1
        warn.lastWarnTs = now

        const tag = `@${sender.split('@')[0]}`
        const jenis = isSticker ? 'sticker' : 'chat'

        if (warn.count <= MAX_WARN) {
            await sock.sendMessage(groupId, {
                text: `⚠️ ${tag} terdeteksi mengirim spam (${jenis})!\nPeringatan *${warn.count}/${MAX_WARN}*.\n\nJika melebihi batas peringatan, kamu akan dikeluarkan dari grup secara otomatis.`,
                mentions: [sender]
            })
        } else {
            // melebihi batas warning -> kick
            warnMap.get(groupId).delete(sender)
            trackMap.get(groupId)?.delete(sender)

            if (!m.isBotAdmin) {
                await sock.sendMessage(groupId, {
                    text: `⚠️ ${tag} sudah melebihi batas peringatan spam, tetapi bot bukan admin sehingga tidak bisa mengeluarkan member secara otomatis.`,
                    mentions: [sender]
                })
                return true
            }

            try {
                const botJid = jidNormalizedUser(sock.user.id)
                if (sender !== botJid) {
                    await sock.groupParticipantsUpdate(groupId, [sender], 'remove')
                    await sock.sendMessage(groupId, {
                        text: `🚫 ${tag} telah dikeluarkan dari grup karena terus melakukan spam setelah ${MAX_WARN}x peringatan.`,
                        mentions: [sender]
                    })
                }
            } catch (e) {
                console.error('Gagal mengeluarkan member spam:', e.message)
                await sock.sendMessage(groupId, {
                    text: `⚠️ ${tag} sudah melebihi batas peringatan, namun bot gagal mengeluarkannya dari grup.`,
                    mentions: [sender]
                })
            }
        }

        return true
    }
}