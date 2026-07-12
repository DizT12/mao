import fs from 'fs'
import path from 'path'
import axios from 'axios'
import crypto from 'crypto'

const ALLOWED_GROUPS_FILE = './database/am_allowed_groups.json'
const SESSIONS_FILE = './database/am_sessions.json'
const API_KEY = 'bilzxio'
const BASE_URL = 'http://43.156.138.209'

const getSettings = () => {
    if (!fs.existsSync('./database')) {
        fs.mkdirSync('./database', { recursive: true })
    }
    if (!fs.existsSync(ALLOWED_GROUPS_FILE)) {
        fs.writeFileSync(ALLOWED_GROUPS_FILE, '{}', 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(ALLOWED_GROUPS_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

const saveSettings = (data) => {
    fs.writeFileSync(ALLOWED_GROUPS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

const getSessions = () => {
    if (!fs.existsSync('./database')) {
        fs.mkdirSync('./database', { recursive: true })
    }
    if (!fs.existsSync(SESSIONS_FILE)) {
        fs.writeFileSync(SESSIONS_FILE, '{}', 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))
    } catch {
        return {}
    }
}

const saveSessions = (data) => {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

const callAPI = async (endpoint, params) => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const hashSource = `${endpoint}:${timestamp}:${API_KEY}`
    const signature = crypto.createHash('sha256').update(hashSource).digest('hex')

    const headers = {
        'x-api-key': API_KEY,
        'x-signature': signature,
        'x-timestamp': timestamp,
        'User-Agent': 'MaoMaoBot/1.0'
    }

    return await axios.get(`${BASE_URL}${endpoint}`, { params, headers })
}

export default {
    cmd: ['am'],
    category: 'tools',
    run: async (m, { text, isOwner, isAdmin }) => {
        const args = text.trim().split(/\s+/)
        const subcommand = args[0]?.toLowerCase()
        const restText = args.slice(1).join(' ')

        if (subcommand === 'allow') {
            if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup.")
            if (!isAdmin && !isOwner) return m.reply("Hanya admin grup atau owner bot yang dapat menggunakan perintah ini.")

            const settings = getSettings()
            const isAllowed = settings[m.from] === true

            if (isAllowed) {
                settings[m.from] = false
                saveSettings(settings)
                return m.reply("Fitur Alight Motion berhasil dinonaktifkan untuk grup ini.")
            } else {
                settings[m.from] = true
                saveSettings(settings)
                return m.reply("Fitur Alight Motion berhasil diaktifkan untuk grup ini. Anggota grup sekarang dapat menggunakan perintah ini.")
            }
        }

        if (!isOwner) {
            if (!m.isGroup) return m.reply("Fitur ini hanya dapat digunakan di dalam grup yang telah diizinkan.")
            const settings = getSettings()
            if (!settings[m.from]) return m.reply("Grup ini belum diizinkan menggunakan fitur Alight Motion. Silakan aktifkan menggunakan `.am allow` oleh admin.")
        }

        if (subcommand === 'send') {
            const email = restText.trim()
            if (!email) return m.reply("Format salah. Gunakan: `.am send <email>`")

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(email)) return m.reply("Silakan masukkan alamat email yang valid!")

            m.reply("Sedang memproses pengiriman verifikasi, mohon tunggu...")

            try {
                const response = await callAPI('/api/send', { email })
                const data = response.data

                if (data.status === false) {
                    return m.reply(`Gagal mengirim verifikasi: ${data.error || 'Terjadi kesalahan'}`)
                }

                const sessions = getSessions()
                sessions[m.sender] = email
                saveSessions(sessions)

                let instructions = `📬 *Verifikasi Berhasil Dikirim!*\n`
                instructions += `Silakan ikuti instruksi berikut untuk melanjutkan proses login:\n\n`
                instructions += `1. *Buka Aplikasi Gmail* di ponsel Anda.\n`
                instructions += `2. *Cek Folder Spam* (atau kotak masuk utama jika tidak ada).\n`
                instructions += `3. *Cari Email dari:* noreply [ \`noreply@alight-creative.firebaseapp.com\` ]. Biasanya email ini berada di baris paling atas karena baru saja dikirim.\n`
                instructions += `4. *Buka Email Tersebut*, lalu ketuk dan *TAHAN LAMA* pada tombol atau teks *Login ke Alight Creative*.\n`
                instructions += `5. *Pilih Salin URL* atau *Copy Link Address*.\n`
                instructions += `6. *Kembali ke WhatsApp*.\n`
                instructions += `7. *Kirim Verifikasi* menggunakan perintah:\n`
                instructions += `   \`.am verif <url_yang_disalin>\`\n\n`
                instructions += `*Catatan:* Sesi email Anda (\`${email}\`) telah disimpan secara otomatis. Jika ingin mengganti email, lakukan kembali perintah \`.am send <email_baru>\`.`

                return m.reply(instructions)
            } catch (e) {
                const errMsg = e.response?.data?.error || e.message || "Internal Server Error"
                return m.reply(`Gagal menghubungi API: ${errMsg}`)
            }
        }

        if (subcommand === 'verif') {
            if (!restText.trim()) {
                return m.reply("Format salah.\nGunakan: `.am verif <url_yang_disalin>` atau `.am verif <email> | <url_yang_disalin>`")
            }

            let email = ''
            let link = ''

            if (restText.includes('|')) {
                const parts = restText.split('|')
                email = parts[0].trim()
                link = parts[1].trim()
            } else {
                const sessions = getSessions()
                email = sessions[m.sender] || ''
                link = restText.trim()
            }

            if (!email) {
                return m.reply("Sesi email Anda tidak ditemukan. Silakan gunakan format manual:\n`.am verif <email> | <url>`\natau jalankan `.am send <email>` terlebih dahulu.")
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(email)) {
                return m.reply("Email tidak valid. Pastikan format email sudah benar.")
            }

            if (!link.startsWith('http://') && !link.startsWith('https://')) {
                return m.reply("URL tautan tidak valid. Pastikan Anda menyalin tautan yang dikirimkan ke email Anda.")
            }

            m.reply("Sedang memproses verifikasi login Anda, mohon tunggu sebentar...")

            try {
                const response = await callAPI('/api/verify', { email, link })
                const data = response.data

                if (data.status === false) {
                    return m.reply(`Gagal melakukan verifikasi: ${data.error || 'Terjadi kesalahan'}`)
                }

                let successMsg = `🎉 *Verifikasi Berhasil!*\n\n`
                successMsg += `Proses verifikasi untuk email \`${email}\` telah berhasil diselesaikan.\n\n`
                successMsg += `*Langkah Selanjutnya:*\n`
                successMsg += `1. Silakan buka aplikasi *Alight Motion* Anda.\n`
                successMsg += `2. Pilih opsi *Masuk* atau *Login* menggunakan Email atau Akun Google.\n`
                successMsg += `3. Masukkan email yang baru saja Anda verifikasi (\`${email}\`).\n`
                successMsg += `4. Akun Anda sekarang telah aktif Premium dengan durasi keanggotaan *1 Tahun*.\n\n`
                successMsg += `Selamat berkarya!`

                const sessions = getSessions()
                if (sessions[m.sender]) {
                    delete sessions[m.sender]
                    saveSessions(sessions)
                }

                return m.reply(successMsg)
            } catch (e) {
                const errMsg = e.response?.data?.error || e.message || "Internal Server Error"
                return m.reply(`Gagal menghubungi API saat verifikasi: ${errMsg}`)
            }
        }

        let help = `⌗ *Alight Motion Premium*\n\n`
        help += `Gunakan menu ini untuk mengelola akses masuk Alight Motion Premium.\n\n`
        help += `› \`.am send <email>\`\n`
        help += `  Mengirimkan tautan verifikasi masuk ke email Anda.\n\n`
        help += `› \`.am verif <url_yang_disalin>\`\n`
        help += `  Melakukan verifikasi otomatis dengan tautan yang disalin.\n\n`
        help += `› \`.am verif <email> | <url_yang_disalin>\`\n`
        help += `  Melakukan verifikasi manual jika sesi tidak tersimpan.\n\n`
        help += `› \`.am allow\`\n`
        help += `  Mengaktifkan/menonaktifkan penggunaan fitur ini di dalam grup (Khusus Admin/Owner).\n\n`
        help += `> *Bilsz - Ai*`
        return m.reply(help)
    }
}