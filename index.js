import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    jidDecode
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import fs from 'fs'
import readline from 'readline'
import chalk from 'chalk'
import { loadPlugins, getPlugin, reloadPlugin, plugins } from './lib/plugins.js'
import { serialize } from './lib/serialize.js'
import wrapSocket, { groupCache } from './lib/helper.js'
import config from './config.js'
import { saveMessage, loadMessage, saveMetadata, syncGroupParticipants, getGroupSettings, getContact, getLidMapping } from './lib/database.js'

const originLog = console.log
console.log = (...args) => {
    const msg = args[0]
    if (typeof msg === 'string' && msg.includes('Closing session: SessionEntry')) return
    if (typeof msg === 'string' && msg.includes('remoteIdentityKey')) return
    if (msg && typeof msg === 'object' && msg.remoteIdentityKey) return
    if (msg && typeof msg === 'object' && msg._chains) return
    originLog(...args)
}

let gconlyCache = null

const decodeJid = (jid) => {
    if (!jid) return jid
    if (typeof jid !== 'string') return jid.id || jid.jid || jid
    if (/:\d+@/gi.test(jid)) {
        let decode = jidDecode(jid) || {}
        return decode.user && decode.server && decode.user + '@' + decode.server || jid
    } else return jid
}

const startBot = async () => {
    await loadPlugins()
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const { version } = await fetchLatestBaileysVersion()
    
    const silentLogger = pino({ level: 'silent' })

    const sock = makeWASocket({
        version,
        logger: silentLogger,
        printQRInTerminal: !config.usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, silentLogger)
        },
        browser:['Ubuntu', 'Chrome', '20.0.04'],
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            return await loadMessage(key.remoteJid, key.id) || undefined
        }
    })

    await wrapSocket(sock)

    // Simpan referensi sock aktif secara global supaya proses lain (mis. auto
    // maintenance scheduler) bisa kirim pesan tanpa perlu passing sock manual.
    global.sockInstance = sock

    if (config.usePairingCode && !sock.authState.creds.registered) {
        console.log(chalk.yellow('Menunggu inisialisasi...'))
        await new Promise(resolve => setTimeout(resolve, 2000))
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const phoneNumber = await new Promise(resolve => rl.question(chalk.bgMagenta.white.bold(' Masukan Nomer Bot: '), resolve))
        rl.close()
        setTimeout(async () => {
            const code = await sock.requestPairingCode(phoneNumber.trim())
            console.log(chalk.black(chalk.bgCyanBright(` Pairing Code: ${code} `)))
        }, 3000)
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'open') {
            console.log(chalk.greenBright.bold('MaoMao - Ai Connected !'))
            const groups = await sock.groupFetchAllParticipating()
            for (const id in groups) {
                const meta = groups[id]
                if (meta.ephemeralDuration) groupCache.set(id, meta.ephemeralDuration)
                await saveMetadata(id, meta.subject, meta.desc?.toString(), meta.participants)
                await syncGroupParticipants(id, meta.participants)
            }
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason !== DisconnectReason.loggedOut) startBot()
        }
    })

    sock.ev.on('creds.update', saveCreds)

    // Anti Chat Audio
    sock.ev.on('call', async (calls) => {
        console.log('[CALL EVENT]', JSON.stringify(calls).slice(0, 500))
        for (const call of calls) {
            try {
                if (!call.isGroup) continue
                if (call.status !== 'offer') continue

                // Cek apakah ini chat audio (bukan video call biasa)
                const isChatAudio = call.isGroup && !call.isVideo

                if (!isChatAudio) continue

                const fs = await import('fs')
                const SETTINGS_FILE = './database/antichataudiosettings.json'
                if (!fs.default.existsSync(SETTINGS_FILE)) continue
                const settings = JSON.parse(fs.default.readFileSync(SETTINGS_FILE, 'utf-8'))
                if (settings[call.chatId] !== true) continue

                const groupMeta = await sock.groupMetadata(call.chatId)
                const target = groupMeta.participants.find(p => p.id === call.from)
                if (target?.admin === 'admin' || target?.admin === 'superadmin') continue

                await sock.groupParticipantsUpdate(call.chatId, [call.from], 'remove')
                await sock.sendMessage(call.chatId, {
                    text: `@${call.from.split('@')[0]} telah dikick karena memulai Chat Audio!`,
                    mentions: [call.from]
                })
            } catch (e) {
                console.error('[antichataudiosettings] Error:', e.message)
            }
        }
    })

    sock.ev.on('group-participants.update', async (anu) => {
        const { id, participants, action } = anu

        // onParticipantsUpdate untuk plugin
        for (const [, plugin] of plugins) {
            if (typeof plugin.onParticipantsUpdate === 'function') {
                try { await plugin.onParticipantsUpdate(anu, { sock }) } catch (e) {}
            }
        }

        try {
            const metadata = await sock.groupMetadata(id)
            await saveMetadata(id, metadata.subject, metadata.desc?.toString(), metadata.participants)
            await syncGroupParticipants(id, metadata.participants)
        } catch (e) { }

        const settings = await getGroupSettings(id)
        if (action === 'add' && !settings.welcome) return
        if (action === 'remove' && !settings.goodbye) return
        if (action !== 'add' && action !== 'remove') return

        const botJid = jidNormalizedUser(sock.user.id)
        const now = new Date()
        const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(now)
        const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)

        for (let item of participants) {
            try {
                let jid = decodeJid(item)
                if (jid === botJid) continue

                if (jid.endsWith('@lid')) {
                    let found = null
                    try {
                        const metadata = await sock.groupMetadata(id)
                        if (metadata) {
                            found = metadata.participants.find(p => p.id === jid)
                        }
                    } catch (e) { }

                    if (found && found.phoneNumber) {
                        jid = found.phoneNumber
                    } else {
                        const mapped = await getLidMapping(jid)
                        if (mapped) jid = mapped
                    }
                }
                jid = jidNormalizedUser(jid)

                let dbContact = await getContact(jid)
                let pushName = (dbContact && dbContact.pushname && dbContact.pushname !== 'null') ? dbContact.pushname : jid.split('@')[0]

                let ppUser
                try {
                    const fetchPP = (async () => {
                        try {
                            return await sock.profilePictureUrl(jid, 'image')
                        } catch {
                            return await sock.profilePictureUrl(jid, 'preview')
                        }
                    })()
                    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                    ppUser = await Promise.race([fetchPP, timeout])
                } catch (e) {
                    ppUser = config.thumbnail1
                }
                if (!ppUser) ppUser = config.thumbnail1

                let text = action === 'add' ? settings.welcomeText : settings.goodbyeText
                if (text) {
                    text = String(text).replace(/@pushname/g, `@${jid.split('@')[0]}`)
                    text = text.replace(/@nama/g, String(pushName))

                    let groupSubject = 'Grup'
                    try {
                        const metadata = await sock.groupMetadata(id)
                        if (metadata) {
                            groupSubject = metadata.subject
                        }
                    } catch (e) { }

                    text = text.replace(/@gcname/g, String(groupSubject))
                    text = text.replace(/@date/g, String(date))
                    text = text.replace(/@jam/g, String(time))

                    await sock.sendImage(id, ppUser, text, '', { mentions: [jid] })
                }
            } catch (e) { }
        }
    })

    // Auto delete group status dari status@broadcast
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
            try {
                const remoteJid = msg.key?.remoteJid
                if (remoteJid !== 'status@broadcast') continue
                const msgContent = msg.message
                if (!msgContent) continue
                const innerType = Object.keys(msgContent).find(k => !['messageContextInfo', 'senderKeyDistributionMessage'].includes(k))
                if (!innerType) continue
                const contextInfo = msgContent[innerType]?.contextInfo
                if (contextInfo?.isGroupStatus !== true) continue
                await sock.sendMessage('status@broadcast', { delete: { remoteJid: 'status@broadcast', fromMe: false, id: msg.key.id, participant: msg.key.participant } }).catch(() => {})
            } catch (e) {}
        }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        const m = await serialize(sock, messages[0])
        if (!m || !m.message) return

        if (m.type === 'protocolMessage' || m.type === 'senderKeyDistributionMessage') return

        const SETTINGS_FILE = './database/gconly_settings.json'
        if (!m.isGroup && !m.isOwner) {
            try {
                if (!gconlyCache) {
                    if (fs.existsSync(SETTINGS_FILE)) {
                        gconlyCache = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
                        fs.watch(SETTINGS_FILE, () => { gconlyCache = null })
                    }
                }
                const settings = gconlyCache
                if (settings?.active === true) {
                    if (!settings.warned.includes(m.sender)) {
                        settings.warned.push(m.sender)
                        fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8', () => {})
                        await m.reply("Maaf, saat ini bot sedang dalam mode *Group Only* (Hanya merespon di dalam grup).\n\nSilakan bergabung ke grup resmi kami di: nefu.life/nefusoft")
                    }
                    return
                }
            } catch (e) {}
        }

        const time = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        
        console.log(`[ ${m.isGroup ? chalk.yellowBright.bold('GC') : chalk.greenBright.bold('PC')} ][ ${chalk.whiteBright(time + ' WIB')} ]`)
        if (m.isGroup) {
            console.log(`${chalk.magentaBright('›')} ${chalk.whiteBright.bold(m.groupName || 'Loading...')}`)
            console.log(`${chalk.magentaBright('›')} ${chalk.yellowBright(m.from)}`)
        }
        console.log(`${chalk.magentaBright('›')} ${chalk.cyanBright(m.sender)} ${chalk.whiteBright('~')} ${chalk.blueBright(m.senderLid || 'no-lid')}`)
        console.log(`${chalk.magentaBright('›')} ${chalk.greenBright.bold(m.pushName || 'User')}`)
        console.log(`${chalk.magentaBright('›')} ${chalk.yellowBright(m.type)}`)
        console.log(`${chalk.magentaBright('›')} ${chalk.whiteBright('message:')} ${chalk.cyanBright(m.body || 'Media Content')}`)
        console.log(chalk.cyanBright('· · ─ ·𖥸· ─ · ·'))

        saveMessage(m, type)

        for (const [file, plugin] of plugins) {
            if (plugin && typeof plugin.onMessage === 'function') {
                try {
                    const isHandled = await plugin.onMessage(m, { sock, config })
                    if (isHandled) return
                } catch (e) {
                    console.error(e)
                }
            }
        }

        if (m.isOwner && (m.body.startsWith('>>') || m.body.startsWith('>') || m.body.startsWith('$'))) {
            const ownerPlugin = getPlugin('>')
            if (ownerPlugin) return await ownerPlugin.run(m, { 
                sock, 
                config, 
                text: m.text, 
                isOwner: m.isOwner,
                jid: m.from
            })
        }

        const prefixes = ['.', '/', '#', '!']
        const prefix = prefixes.find(p => m.body.startsWith(p))
        if (!prefix) return

        const cmd = m.body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase()
        const plugin = getPlugin(cmd)
        if (plugin) {
            try {
                const textWithoutCmd = m.body.slice(prefix.length + cmd.length).trim()
                await plugin.run(m, { 
                    sock, 
                    config, 
                    text: textWithoutCmd,
                    jid: m.from,
                    isOwner: m.isOwner,
                    isAdmin: m.isAdmin,
                    isBotAdmin: m.isBotAdmin
                })
            } catch (e) {
                console.error(chalk.red(e))
            }
        }
    })
}

startBot()

// ===== Auto Session Cleaner Scheduler (versi baru dengan histori) =====
// Terpisah dari Auto Maintenance di atas. Fokus khusus membersihkan file
// session lama secara berkala, dengan setiap hasil run tercatat ke histori
// (lihat lewat .sessionhistory). creds.json tidak pernah disentuh.
//
// Command manual: .clearsession / .sessionhistory / .sessionconfig
import { clearOldSessions, formatClearResult, getInterval as getSessionCleanerInterval, getMaxAgeDays } from './lib/session-cleaner.js'

const SESSION_CLEANER_NOTIFY_OWNER = true

async function runAutoSessionClean() {
    try {
        console.log(chalk.cyan('⟳ [SessionCleaner] Menjalankan pembersihan session otomatis...'))
        const days = getMaxAgeDays()
        const result = await clearOldSessions(undefined, 'auto')
        console.log(chalk.green('✓ [SessionCleaner] Selesai.'))

        if (SESSION_CLEANER_NOTIFY_OWNER && global.sockInstance && config.ownerNumber?.[0]) {
            const ownerJid = config.ownerNumber[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net'
            const report = formatClearResult(result, days) + '\n\n_🤖 Auto session cleaner terjadwal_'
            await global.sockInstance.sendMessage(ownerJid, { text: report }).catch(() => {})
        }
    } catch (e) {
        console.error(chalk.red('✖ [SessionCleaner] Gagal:'), e.message)
    }
}

function scheduleNextSessionClean() {
    const hours = getSessionCleanerInterval()
    const ms = hours * 60 * 60 * 1000

    setTimeout(async () => {
        await runAutoSessionClean()
        scheduleNextSessionClean()
    }, ms)

    console.log(chalk.gray(`[SessionCleaner] Dijadwalkan jalan lagi dalam ${hours} jam.`))
}

scheduleNextSessionClean()
// ===== End Auto Session Cleaner Scheduler =====

const pluginDebounce = new Map()

const watchPlugins = (dir) => {
    fs.watch(dir, { recursive: true }, async (eventType, filename) => {
        if (filename && filename.endsWith('.js')) {
            if (pluginDebounce.has(filename)) clearTimeout(pluginDebounce.get(filename))
            const timer = setTimeout(async () => {
                await reloadPlugin(filename)
                pluginDebounce.delete(filename)
            }, 100)
            pluginDebounce.set(filename, timer)
        }
    })
}
watchPlugins('./plugins')
