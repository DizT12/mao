import fs from 'fs'

const SETTINGS_FILE = './database/gconly_settings.json'

const getSettings = () => {
    if (!fs.existsSync('./database')) {
        fs.mkdirSync('./database', { recursive: true })
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, '{"active":false,"warned":[]}', 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    } catch {
        return { active: false, warned: [] }
    }
}

const saveSettings = (data) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export default {
    cmd: ['gconly'],
    category: 'owner',
    run: async (m, { text, isOwner }) => {
        if (!isOwner) return

        const action = text.toLowerCase().trim()
        const settings = getSettings()

        if (action === 'on') {
            settings.active = true
            settings.warned = []
            saveSettings(settings)
            return m.reply("Mode Group Only (GC Only) berhasil diaktifkan. Pesan pribadi dari pengguna umum tidak akan direspon.")
        } else if (action === 'off') {
            settings.active = false
            settings.warned = []
            saveSettings(settings)
            return m.reply("Mode Group Only (GC Only) berhasil dinonaktifkan.")
        } else {
            const status = settings.active ? "AKTIF" : "NONAKTIF"
            return m.reply(`Status GC Only saat ini: *[ ${status} ]*\n\nGunakan \`!gconly on\` untuk mengaktifkan atau \`!gconly off\` untuk menonaktifkan.`)
        }
    }
}