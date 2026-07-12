import fs from 'fs'
import path from 'path'

const SESSION_DIR = path.resolve('session')
const SETTINGS_FILE = './database/session_cleaner_settings.json'
const HISTORY_FILE = './database/session_cleaner_history.json'

const DEFAULT_INTERVAL_HOURS = 4
const DEFAULT_MAX_AGE_DAYS = 7
const MAX_HISTORY_ENTRIES = 50 // biar file histori gak numpuk tanpa batas

// File inti auth Baileys yang TIDAK BOLEH pernah dihapus, atau bot logout.
const PROTECTED_SESSION_FILES = new Set(['creds.json'])

// ===== Settings (interval & max age) =====

const ensureDatabaseDir = () => {
    if (!fs.existsSync('./database')) fs.mkdirSync('./database', { recursive: true })
}

const getSettings = () => {
    ensureDatabaseDir()
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
            intervalHours: DEFAULT_INTERVAL_HOURS,
            maxAgeDays: DEFAULT_MAX_AGE_DAYS
        }, null, 2), 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    } catch {
        return { intervalHours: DEFAULT_INTERVAL_HOURS, maxAgeDays: DEFAULT_MAX_AGE_DAYS }
    }
}

const saveSettings = (data) => {
    ensureDatabaseDir()
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export function getInterval() {
    return getSettings().intervalHours ?? DEFAULT_INTERVAL_HOURS
}

export function setInterval_(hours) {
    const settings = getSettings()
    settings.intervalHours = hours
    saveSettings(settings)
    return hours
}

export function getMaxAgeDays() {
    return getSettings().maxAgeDays ?? DEFAULT_MAX_AGE_DAYS
}

export function setMaxAgeDays(days) {
    const settings = getSettings()
    settings.maxAgeDays = days
    saveSettings(settings)
    return days
}

// ===== Histori =====

const getHistory = () => {
    ensureDatabaseDir()
    if (!fs.existsSync(HISTORY_FILE)) {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8')
    }
    try {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
    } catch {
        return []
    }
}

const addHistoryEntry = (entry) => {
    ensureDatabaseDir()
    const history = getHistory()
    history.unshift(entry) // entri terbaru di paling atas
    const trimmed = history.slice(0, MAX_HISTORY_ENTRIES)
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8')
}

/**
 * Ambil histori clear session, terbaru duluan.
 * @param {number} limit - jumlah entri maksimal yang diambil (default 10)
 */
export function getSessionCleanHistory(limit = 10) {
    return getHistory().slice(0, limit)
}

// ===== Fungsi inti clear session =====

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

/**
 * Hapus file session (pre-key, sender-key, session-*, dsb) yang sudah lebih
 * tua dari `maxAgeDays` hari. File inti (creds.json) TIDAK PERNAH disentuh,
 * jadi bot tidak akan pernah logout akibat proses ini. Hasilnya otomatis
 * dicatat ke histori.
 *
 * @param {number} maxAgeDays - usia maksimum file sebelum dihapus
 * @param {string} trigger - 'manual' atau 'auto', dicatat di histori
 */
export async function clearOldSessions(maxAgeDays, trigger = 'manual') {
    const days = maxAgeDays ?? getMaxAgeDays()
    const result = { scanned: 0, deleted: 0, freedBytes: 0, errors: [] }

    if (!fs.existsSync(SESSION_DIR)) {
        result.errors.push(`Folder session tidak ditemukan: ${SESSION_DIR}`)
        addHistoryEntry({
            timestamp: new Date().toISOString(),
            trigger,
            maxAgeDays: days,
            ...result
        })
        return result
    }

    const maxAgeMs = days * 24 * 60 * 60 * 1000
    const now = Date.now()

    let files = []
    try {
        files = fs.readdirSync(SESSION_DIR)
    } catch (e) {
        result.errors.push(`Gagal membaca folder session: ${e.message}`)
        addHistoryEntry({
            timestamp: new Date().toISOString(),
            trigger,
            maxAgeDays: days,
            ...result
        })
        return result
    }

    for (const file of files) {
        // creds.json (dan file protected lain di masa depan) selalu dilewati,
        // apapun umurnya. Ini satu-satunya jaminan supaya bot tidak logout.
        if (PROTECTED_SESSION_FILES.has(file)) continue

        const fullPath = path.join(SESSION_DIR, file)
        try {
            const stat = fs.statSync(fullPath)
            if (!stat.isFile()) continue

            result.scanned++
            const age = now - stat.mtimeMs
            if (age > maxAgeMs) {
                result.freedBytes += stat.size
                fs.unlinkSync(fullPath)
                result.deleted++
            }
        } catch (e) {
            result.errors.push(`${file}: ${e.message}`)
        }
    }

    addHistoryEntry({
        timestamp: new Date().toISOString(),
        trigger,
        maxAgeDays: days,
        scanned: result.scanned,
        deleted: result.deleted,
        freedBytes: result.freedBytes,
        errorCount: result.errors.length
    })

    return result
}

/**
 * Format hasil clearOldSessions jadi teks WhatsApp.
 */
export function formatClearResult(result, days) {
    let text = `*🔑 CLEAR SESSION SELESAI*\n\n`
    text += `File dicek: ${result.scanned}\n`
    text += `File dihapus: ${result.deleted}\n`
    text += `Ruang dibebaskan: ${formatBytes(result.freedBytes)}\n`
    text += `Usia minimal: >${days} hari\n`
    text += `\n_creds.json (kredensial login utama) tidak pernah dihapus._`
    if (result.errors.length) {
        text += `\n\n⚠️ ${result.errors.length} file gagal diproses.`
    }
    return text
}

/**
 * Format histori jadi teks WhatsApp yang enak dibaca.
 */
export function formatHistory(entries) {
    if (entries.length === 0) {
        return '*📜 HISTORI CLEAR SESSION*\n\nBelum ada riwayat.'
    }

    let text = `*📜 HISTORI CLEAR SESSION*\n_${entries.length} riwayat terakhir_\n\n`

    for (const entry of entries) {
        const date = new Date(entry.timestamp)
        const dateStr = date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
        const triggerIcon = entry.trigger === 'auto' ? '⏰' : '👤'

        text += `${triggerIcon} *${dateStr}*\n`
        text += `   Dicek: ${entry.scanned} | Dihapus: ${entry.deleted} | Dibebaskan: ${formatBytes(entry.freedBytes)}\n`
        if (entry.errorCount > 0) {
            text += `   ⚠️ ${entry.errorCount} error\n`
        }
        text += `\n`
    }

    return text.trim()
}

