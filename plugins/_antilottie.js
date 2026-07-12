import fs from 'fs'
import path from 'path'

const SETTINGS_FILE = './database/antilottie_settings.json'

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

export default {
    cmd: ['antilottie'],
    category: 'admin',
    run: async (m, { text, isAdmin }) => {
        if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup.")
        if (!isAdmin) return m.reply("Hanya admin grup yang dapat menggunakan perintah ini.")

        const action = text.toLowerCase().trim()
        const settings = getSettings()

        if (action === 'on') {
            settings[m.from] = true
            saveSettings(settings)
            return m.reply("Anti-Lottie Sticker berhasil diaktifkan di grup ini!")
        } else if (action === 'off') {
            settings[m.from] = false
            saveSettings(settings)
            return m.reply("Anti-Lottie Sticker dinonaktifkan di grup ini.")
        } else {
            const status = settings[m.from] === true ? "ON" : "OFF"
            return m.reply(`Status Anti-Lottie di grup ini: *[ ${status} ]*\n\nGunakan \`!antilottie on\` untuk menyalakan atau \`!antilottie off\` untuk mematikan.`)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const settings = getSettings()
        if (settings[m.from] !== true) return false

        if (m.type === 'lottieStickerMessage' || m.message?.lottieStickerMessage) {
            if (!m.isBotAdmin) return false

            try {
                await sock.sendMessage(m.from, {
                    delete: {
                        remoteJid: m.from,
                        fromMe: m.key.fromMe,
                        id: m.key.id,
                        participant: m.sender
                    }
                })
                return true
            } catch (e) {
                console.error("Gagal menghapus Lottie sticker:", e.message)
            }
        }
        return false
    }
}