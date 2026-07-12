import fs from 'fs'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

const SETTINGS_FILE = './database/antiswgc_settings.json'

const getSettings = () => {
    if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true })
    if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '{}', 'utf-8')
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

const saveSettings = (data) => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')

export default {
    cmd: ['antiswgc'],
    category: 'admin',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply('Fitur ini hanya dapat digunakan di dalam grup.')
        if (!isAdmin) return m.reply('Hanya admin grup yang dapat menggunakan perintah ini.')

        const action = text.toLowerCase().trim()
        const settings = getSettings()

        if (action === 'on') {
            settings[m.from] = 'kick'
            saveSettings(settings)
            return m.reply('✅ Anti Group Status diaktifkan!\nStatus dihapus + pengirim dikick.')
        } else if (action === 'silent') {
            settings[m.from] = 'silent'
            saveSettings(settings)
            return m.reply('✅ Anti Group Status (silent) diaktifkan!\nStatus otomatis dihapus tanpa kick.')
        } else if (action === 'off') {
            delete settings[m.from]
            saveSettings(settings)
            return m.reply('❌ Anti Group Status dinonaktifkan.')
        } else {
            const mode = settings[m.from]
            const status = mode === 'kick' ? 'ON (kick)' : mode === 'silent' ? 'ON (silent)' : 'OFF'
            let help = `⌗ *Anti Group Status*\n\n`
            help += `Status: *[ ${status} ]*\n\n`
            help += `› .antiswgc on — hapus + kick\n`
            help += `› .antiswgc silent — hapus saja\n`
            help += `› .antiswgc off — matikan`
            return m.reply(help)
        }
    },

    onMessage: async (m, { sock }) => {
        const log = (msg) => console.log(`[antiswgc] ${msg}`)

        if (!m || !m.isGroup || m.key.fromMe) return false

        const settings = getSettings()
        const mode = settings[m.from]
        if (!mode) return false // antiswgc emang lagi off di grup ini, normal, gak usah di-log biar gak spam

        log(`Pesan masuk di grup ${m.from} | type: ${m.type} | sender: ${m.sender} | mode: ${mode}`)

        // Cukup cek type di top-level. m.message selalu { groupStatusMessageV2: {...} }
        // di lapisan paling luar walaupun isinya di-nested berkali-kali, jadi getContentType
        // di serialize.js udah otomatis kebaca 'groupStatusMessageV2' tanpa perlu recursive scan.
        if (m.type !== 'groupStatusMessageV2') {
            log(`Bukan groupStatusMessageV2 (type: ${m.type}), skip.`)
            return false
        }

        log(`✅ Terdeteksi Group Status dari ${m.sender}!`)

        if (!m.isBotAdmin) {
            log(`❌ Bot bukan admin di grup ${m.from}, gak bisa hapus/kick. Skip.`)
            return false
        }

        try {
            // Pesan Group Status dikirim langsung ke chat grup (m.from), bukan status@broadcast,
            // jadi m.del() (default-nya pakai m.key) udah otomatis ngarah ke tempat yang benar.
            const delResult = await m.del()
                .then(() => true)
                .catch((e) => {
                    log(`❌ Gagal hapus pesan: ${e.message}`)
                    return false
                })
            log(delResult ? `🗑️ Pesan berhasil dihapus (id: ${m.key.id})` : `⚠️ Pesan GAGAL dihapus (id: ${m.key.id})`)

            if (mode === 'kick') {
                const botJid = jidNormalizedUser(sock.user.id)
                if (m.sender === botJid) {
                    log(`Sender adalah bot sendiri, skip kick.`)
                    return true
                }

                const groupMeta = await sock.groupMetadata(m.from).catch(() => null)
                const target = groupMeta?.participants?.find(p => jidNormalizedUser(p.id) === m.sender)
                if (target?.admin === 'admin' || target?.admin === 'superadmin') {
                    log(`Sender (${m.sender}) adalah admin grup, skip kick.`)
                    return true
                }

                try {
                    await sock.groupParticipantsUpdate(m.from, [m.sender], 'remove')
                    log(`👢 Berhasil kick ${m.sender}`)
                    await sock.sendMessage(m.from, {
                        text: `@${m.sender.split('@')[0]} telah dikick karena mengirim Group Status!`,
                        mentions: [m.sender]
                    })
                } catch (e) {
                    log(`❌ Gagal kick ${m.sender}: ${e.message}`)
                }
            }

            return true
        } catch (e) {
            log(`❌ Error tak terduga: ${e.message}`)
            console.error('[antiswgc] Gagal:', e)
        }
        return true
    }
}