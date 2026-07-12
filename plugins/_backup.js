import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import FormData from 'form-data'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')

// ====== KONFIGURASI TELEGRAM (WAJIB DIISI) ======
// Ambil token dari @BotFather, dan chat ID dari bot semacam @userinfobot atau
// @getidsbot (chat ID akun kamu sendiri, BUKAN username).
const TELEGRAM_BOT_TOKEN = '8447277110:AAGa8RNFAP-DAsGCIlIVep45j8DzGuH3kaQ'
const TELEGRAM_CHAT_ID = '8089494997'
// ==================================================

// Telegram Bot API limit kirim dokumen normal adalah 50MB. Di atas ini
// kita tolak lebih awal daripada upload gagal diam-diam.
const MAX_SAFE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

const SEND_TIMEOUT_MS = 3 * 60 * 1000 // 3 menit

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

const withTimeout = (promise, ms, label) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} lebih dari ${ms / 1000} detik`)), ms))
    ])
}

// Kirim file ke Telegram lewat Bot API (sendDocument)
async function sendToTelegram(filePath, fileName, caption) {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.startsWith('GANTI_')) {
        throw new Error('Tokeb belum diisi di plugins/_backup.js')
    }
    if (!TELEGRAM_CHAT_ID || TELEGRAM_CHAT_ID.startsWith('GANTI_')) {
        throw new Error('TELEGRAM_CHAT_ID belum diisi di plugins/_backup.js')
    }

    const form = new FormData()
    form.append('chat_id', TELEGRAM_CHAT_ID)
    form.append('caption', caption)
    form.append('document', fs.createReadStream(filePath), fileName)

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`

    const res = await withTimeout(
        axios.post(url, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        }),
        SEND_TIMEOUT_MS,
        'Kirim dokumen ke Telegram'
    )

    if (!res.data?.ok) {
        throw new Error(`Telegram API menolak: ${res.data?.description || 'unknown error'}`)
    }
    return res.data
}

export default {
    cmd: ['backup'],
    category: 'owner',
    run: async (m, { isOwner }) => {
        if (!isOwner) return m.reply('Fitur ini khusus untuk owner.')

        m.reply('⏳ Sedang membuat backup, mohon tunggu... (akan dikirim ke Telegram)')
        console.log('[Backup] Mulai proses backup...')

        // Folder yang di-skip: cuma dependency yang bisa di-install ulang
        // (node_modules) dan yang murni cache/temp/build. 'session' dan
        // 'database' SENGAJA IKUT di-backup karena kalau VPS bermasalah,
        // kamu perlu restore login WA & data bot tanpa scan ulang.
        const ignoredDirs = [
            'node_modules', '.git', '.replit', '.cache',
            'tmp', 'temp', 'cache', '.next', 'dist', 'build', 'coverage'
        ]
        const ignoredFiles = ['package-lock.json']

        let zip
        let zipName
        try {
            zip = new AdmZip()

            let fileCount = 0
            let skippedCount = 0

            const addFilesToZip = (dir, currentPath = '') => {
                const list = fs.readdirSync(dir)
                list.forEach((file) => {
                    const fullPath = path.join(dir, file)
                    const zipPath = currentPath ? path.join(currentPath, file) : file

                    let stat
                    try {
                        stat = fs.statSync(fullPath)
                    } catch (e) {
                        skippedCount++
                        console.log(`[Backup] Lewati (gagal stat): ${zipPath} - ${e.message}`)
                        return
                    }

                    if (stat.isDirectory()) {
                        if (!ignoredDirs.includes(file)) {
                            addFilesToZip(fullPath, zipPath)
                        }
                        return
                    }

                    if (!stat.isFile()) {
                        skippedCount++
                        return
                    }

                    const ext = path.extname(file).toLowerCase()
                    if (!ignoredFiles.includes(file) && ext !== '.zip' && ext !== '.gz') {
                        try {
                            zip.addLocalFile(fullPath, currentPath)
                            fileCount++
                        } catch (e) {
                            skippedCount++
                            console.log(`[Backup] Lewati (gagal ditambah ke zip): ${zipPath} - ${e.message}`)
                        }
                    }
                })
            }

            addFilesToZip('.')
            console.log(`[Backup] Selesai scan file: ${fileCount} ditambahkan, ${skippedCount} dilewati.`)

            const dateStr = new Date().toISOString().slice(0, 10)
            zipName = `backup_maomao_${dateStr}.zip`

            console.log(`[Backup] Menulis file zip: ${zipName}...`)
            zip.writeZip(zipName)

            const stat = fs.statSync(zipName)
            console.log(`[Backup] Zip selesai dibuat. Ukuran: ${formatBytes(stat.size)}`)

            if (stat.size > MAX_SAFE_SIZE_BYTES) {
                fs.unlinkSync(zipName)
                console.log('[Backup] Zip terlalu besar, dibatalkan dan file dihapus.')
                return m.reply(
                    `❌ Backup gagal dikirim: ukuran zip (${formatBytes(stat.size)}) melebihi batas ${formatBytes(MAX_SAFE_SIZE_BYTES)} (limit dokumen Telegram Bot API).\n\n` +
                    `Kemungkinan folder session/database sudah besar. Cek log server untuk detail.`
                )
            }

            console.log('[Backup] Mengirim dokumen ke Telegram...')
            const caption = `🗂️ Backup MaoMao\nTanggal: ${dateStr}\nUkuran: ${formatBytes(stat.size)}\n\n⚠️ File ini berisi session login WA (creds.json). Simpan dengan aman, jangan diteruskan ke orang lain.`
            await sendToTelegram(zipName, zipName, caption)

            console.log('[Backup] ✅ Berhasil terkirim ke Telegram.')
            fs.unlinkSync(zipName)

            m.reply(`✅ Backup berhasil dikirim ke Telegram!\nUkuran: ${formatBytes(stat.size)}`)

        } catch (e) {
            console.error('[Backup] ❌ Gagal:', e.message)
            if (zipName && fs.existsSync(zipName)) {
                try { fs.unlinkSync(zipName) } catch {}
            }
            m.reply(`Gagal membuat/mengirim backup: ${e.message}`)
        }
    }
}