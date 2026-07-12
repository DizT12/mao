import fs from 'fs'

const SETTINGS_FILE = './database/antichataudiosettings.json'

const getSettings = () => {
    if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true })
    if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, '{}', 'utf-8')
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) } catch { return {} }
}

const saveSettings = (data) => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')

export default {
    cmd: ['anticall', 'antichatauaudio'],
    category: 'admin',
    run: async (m, { isAdmin }) => {
        if (!m.isGroup) return m.reply("Khusus di dalam grup!")
        if (!isAdmin) return m.reply("Hanya admin grup yang bisa menggunakan perintah ini!")

        const settings = getSettings()
        const action = m.text.toLowerCase().trim()

        if (action === 'on') {
            settings[m.from] = true
            saveSettings(settings)
            return m.reply("✅ Anti Chat Audio diaktifkan!\nSiapapun yang mulai Chat Audio akan langsung dikick.")
        } else if (action === 'off') {
            settings[m.from] = false
            saveSettings(settings)
            return m.reply("❌ Anti Chat Audio dinonaktifkan.")
        } else {
            const status = settings[m.from] === true ? "ON" : "OFF"
            return m.reply(`Status Anti Chat Audio: *[ ${status} ]*\n\nGunakan *.antichatau on* untuk menyalakan\nGunakan *.antichatau off* untuk mematikan`)
        }
    },

    onMessage: async (m, { sock }) => {
        if (!m || !m.isGroup || m.key.fromMe) return false

        const settings = getSettings()
        if (settings[m.from] !== true) return false

        // Deteksi callLogMesssage (typo dari WA) dengan callType: 2 = chat audio
        const callLog = m.message?.callLogMesssage || m.quoted?.callLogMesssage
        if (!callLog) return false
        if (callLog.callType !== 2 || callLog.isVideo) return false
        if (!m.isBotAdmin) return false

        // Sender adalah yang mulai chat audio
        const targetSender = m.quoted?.sender || m.sender
        if (!targetSender) return false

        try {
            const groupMeta = await sock.groupMetadata(m.from)
            const target = groupMeta.participants.find(p => p.id === targetSender)
            if (target?.admin === 'admin' || target?.admin === 'superadmin') return false

            await sock.groupParticipantsUpdate(m.from, [targetSender], 'remove')
            await sock.sendMessage(m.from, {
                text: `@${targetSender.split('@')[0]} telah dikick karena memulai Chat Audio!`,
                mentions: [targetSender]
            })
            return true
        } catch (e) {
            console.error('[antichatau] Gagal kick:', e.message)
        }
        return false
    }
}