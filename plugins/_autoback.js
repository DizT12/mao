import fs from 'fs'
import { jidNormalizedUser } from '@whiskeysockets/baileys'

const SETTINGS_FILE = './database/autoback_settings.json'
const GC_LINK_REGEX = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i
const COOLDOWN_MS = 15000 // biar ga spam kalo user kirim link grup berkali-kali dalam waktu deket

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 menit nunggu di-acc admin
const POLL_INTERVAL_MS = 15 * 1000 // cek status join tiap 15 detik
const INVITE_CARD_VALID_MS = 3 * 24 * 60 * 60 * 1000 // masa berlaku kartu invite yg dikirim (3 hari)

const DEFAULT_DESCRIPTION = "Gabung juga ke grup kita ya, dijamin rame!"

const cooldown = new Map()
const inProgress = new Set() // biar 1 kode invite ga diproses dobel bersamaan
const selfSentIds = new Set() // id pesan yg DIKIRIM SENDIRI oleh plugin ini, biar ga ke-detect ulang (loop) di mode self-bot

function markSelfSent(id) {
    if (!id) return
    selfSentIds.add(id)
    setTimeout(() => selfSentIds.delete(id), 5 * 60 * 1000)
}

const getSettings = () => {
    if (!fs.existsSync('./database')) {
        fs.mkdirSync('./database', { recursive: true })
    }
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ active: false, link: '', description: DEFAULT_DESCRIPTION }, null, 2), 'utf-8')
    }
    try {
        const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
        if (!data.description) data.description = DEFAULT_DESCRIPTION
        return data
    } catch {
        return { active: false, link: '', description: DEFAULT_DESCRIPTION }
    }
}

const saveSettings = (data) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

// Hapus pesan link yang dikirim user (butuh bot jadi admin kalau di grup)
async function deleteInviteMessage(sock, m) {
    try {
        await sock.sendMessage(m.from, {
            delete: {
                remoteJid: m.from,
                fromMe: m.key.fromMe,
                id: m.key.id,
                participant: m.sender
            }
        })
    } catch (e) {
        console.error("Autoback: gagal hapus pesan link:", e.message || e)
    }
}

// Best-effort batalin/keluar dari request join yang nge-gantung.
// Catatan: WhatsApp/Baileys ga selalu nyediain API buat "cancel join request"
// yang masih pending approval admin, jadi ini cuma jaga-jaga kalau ternyata
// bot sempat kecatet sebagai partial member / bisa di-leave.
async function cancelPendingJoin(sock, groupId) {
    if (!groupId) return
    try {
        await sock.groupLeave(groupId)
    } catch (e) {
        // wajar gagal kalau request masih pending & belum pernah beneran masuk
    }
}

// Kirim kartu "Undangan obrolan grup" native ala WhatsApp (kayak di screenshot):
// judul = nama grup, badge "Undangan obrolan grup" otomatis dari WhatsApp,
// body = deskripsi yang di-set, dan tombol hijau "Gabung ke Grup".
// Fallback ke pesan teks biasa kalau kartunya gagal dibuat (mis. link invalid).
async function sendGroupInviteCard(sock, targetJid, link, description) {
    const match = (link || '').match(GC_LINK_REGEX)
    if (!match) throw new Error('Link tidak valid')
    const code = match[1]

    let subject = 'Grup'
    let groupId = null
    try {
        const info = await sock.groupGetInviteInfo(code)
        groupId = info?.id || null
        subject = info?.subject || subject
    } catch (e) {
        console.error('Autoback: gagal ambil info grup dari link:', e.message || e)
    }

    if (!groupId) {
        // Ga bisa bikin kartu invite tanpa JID grup yang valid, fallback teks biasa
        const sent = await sock.sendMessage(targetJid, {
            text: `${description}\n\n${link}`
        })
        markSelfSent(sent?.key?.id)
        return
    }

    let jpegThumbnail
    try {
        const ppUrl = await sock.profilePictureUrl(groupId, 'image')
        const res = await fetch(ppUrl)
        jpegThumbnail = Buffer.from(await res.arrayBuffer())
    } catch (e) {
        // ga ada foto profil grup / gagal ambil, kirim tanpa thumbnail aja
    }

    const sent = await sock.sendMessage(targetJid, {
        groupInvite: {
            jid: groupId,
            subject,
            text: description,
            inviteCode: code,
            inviteExpiration: Date.now() + INVITE_CARD_VALID_MS,
            ...(jpegThumbnail ? { jpegThumbnail } : {})
        }
    })
    markSelfSent(sent?.key?.id)
}

async function notifyOwner(sock, config, settings, extraNote) {
    const owners = (config.ownerNumber || []).map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
    const description = extraNote ? `${extraNote}\n\n${settings.description}` : settings.description

    for (const jid of owners) {
        const target = jidNormalizedUser(jid)
        try {
            await sendGroupInviteCard(sock, target, settings.link, description)
        } catch (e) {
            console.error("Autoback: gagal kirim kartu invite ke owner, fallback teks:", e.message || e)
            try {
                const sent = await sock.sendMessage(target, { text: `${description}\n\n${settings.link}` })
                markSelfSent(sent?.key?.id)
            } catch (e2) {
                console.error("Autoback: gagal notif owner:", e2.message || e2)
            }
        }
    }
}

async function handleAutoJoin(sock, config, settings, m, invite) {
    const { code } = invite
    console.log(`[AUTOBACK] Mulai proses invite code=${code} dari sender=${m.sender} di chat=${m.from}`)

    if (inProgress.has(code)) {
        console.log(`[AUTOBACK] Skip, code=${code} lagi diproses (inProgress).`)
        return
    }
    inProgress.add(code)

    try {
        let targetGroupId = invite.groupId || null
        if (targetGroupId) {
            console.log(`[AUTOBACK] groupId udah diketahui dari pesan: ${targetGroupId}`)
        } else {
            try {
                const info = await sock.groupGetInviteInfo(code)
                targetGroupId = info?.id || null
                console.log(`[AUTOBACK] groupGetInviteInfo sukses -> groupId=${targetGroupId}, subject=${info?.subject}`)
            } catch (e) {
                console.log(`[AUTOBACK] groupGetInviteInfo GAGAL: ${e.message || e}`)
            }
        }

        try {
            if (invite.viaV4) {
                const joinedId = await sock.groupAcceptInviteV4(m.key, invite.viaV4)
                if (joinedId) targetGroupId = joinedId
                console.log(`[AUTOBACK] groupAcceptInviteV4 sukses -> ${joinedId}`)
            } else {
                const joinedId = await sock.groupAcceptInvite(code)
                if (joinedId) targetGroupId = joinedId
                console.log(`[AUTOBACK] groupAcceptInvite sukses -> ${joinedId}`)
            }
        } catch (e) {
            console.log(`[AUTOBACK] groupAcceptInvite(V4) GAGAL: ${e.message || e}`)
            // groupAcceptInvite(V4) bisa throw kalau grup pakai mode "perlu persetujuan admin"
            // atau invite invalid. Kita tetap lanjut poll selama kita punya targetGroupId.
        }

        if (!targetGroupId) {
            console.log(`[AUTOBACK] Ga dapet targetGroupId sama sekali, hapus pesan + notif owner (link invalid).`)
            await deleteInviteMessage(sock, m)
            await notifyOwner(sock, config, settings, `⚠️ Gagal proses link grup dari ${m.sender} (link/invite tidak valid).`)
            return
        }

        const botJid = jidNormalizedUser(sock.user.id)
        const deadline = Date.now() + APPROVAL_TIMEOUT_MS
        let joined = false
        let pollCount = 0

        while (Date.now() < deadline) {
            pollCount++
            try {
                const metadata = await sock.groupMetadata(targetGroupId)
                const isMember = metadata?.participants?.some(p =>
                    jidNormalizedUser(p.id) === botJid || jidNormalizedUser(p.phoneNumber) === botJid
                )
                console.log(`[AUTOBACK] Poll #${pollCount} groupId=${targetGroupId} isMember=${isMember}`)
                if (isMember) {
                    joined = true
                    break
                }
            } catch (e) {
                console.log(`[AUTOBACK] Poll #${pollCount} groupMetadata GAGAL: ${e.message || e}`)
            }
            await sleep(POLL_INTERVAL_MS)
        }

        if (joined) {
            console.log(`[AUTOBACK] ✅ Berhasil join grup ${targetGroupId} dari link yang dikirim ${m.sender}`)
            return
        }

        // 5 menit lewat & belum di-acc admin -> hapus link + batalin request + notif owner
        console.log(`[AUTOBACK] ❌ Timeout 5 menit, belum jadi member grup ${targetGroupId}. Hapus pesan + notif owner.`)
        await deleteInviteMessage(sock, m)
        await cancelPendingJoin(sock, targetGroupId)
        await notifyOwner(sock, config, settings, `⚠️ Request join grup dari link yang dikirim ${m.sender} tidak di-acc admin dalam 5 menit. Pesan link sudah dihapus & request dibatalkan.`)
    } catch (e) {
        console.error(`[AUTOBACK] Error tidak terduga di handleAutoJoin:`, e)
    } finally {
        inProgress.delete(code)
    }
}

export default {
    cmd: ['autoback'],
    category: 'owner',
    run: async (m, { sock, text, isOwner }) => {
        if (!isOwner) return

        const args = (text || '').trim().split(/ +/)
        const action = (args[0] || '').toLowerCase()
        const settings = getSettings()

        if (action === 'on') {
            if (!settings.link) return m.reply("Belum ada link yang di-set. Gunakan dulu: `.autoback set <link_grup>`")
            settings.active = true
            saveSettings(settings)
            return m.reply(
                "Autoback berhasil diaktifkan!\n\n" +
                "Setiap ada yang kirim link grup, bot akan otomatis coba join ke grup itu.\n" +
                "Kalau grup butuh persetujuan admin & 5 menit ga di-acc, pesan link akan dihapus, " +
                "request dibatalkan, dan owner akan dikirimi kartu undangan grup cadangan."
            )
        }

        if (action === 'off') {
            settings.active = false
            saveSettings(settings)
            return m.reply("Autoback dinonaktifkan.")
        }

        if (action === 'set') {
            const link = args.slice(1).join(' ').trim()
            if (!link || !GC_LINK_REGEX.test(link)) return m.reply("Format salah. Gunakan: `.autoback set <link_grup>`\nContoh: `.autoback set https://chat.whatsapp.com/xxxxxxxxxxxxxxxxxxxx`")
            settings.link = link
            saveSettings(settings)
            return m.reply(`Link cadangan autoback berhasil diatur ke:\n${link}`)
        }

        if (action === 'desc') {
            const desc = (text || '').slice(action.length).trim()
            if (!desc) return m.reply("Format salah. Gunakan: `.autoback desc <teks deskripsi>`\nContoh: `.autoback desc pencet meki\\nijin need mem\\nmasuk aja woyy`")
            settings.description = desc
            saveSettings(settings)
            return m.reply(`Deskripsi kartu undangan berhasil diatur ke:\n\n${desc}`)
        }

        if (action === 'test') {
            if (!settings.link) return m.reply("Belum ada link yang di-set. Gunakan dulu: `.autoback set <link_grup>`")
            try {
                await sendGroupInviteCard(sock, m.from, settings.link, settings.description)
            } catch (e) {
                return m.reply(`Gagal kirim contoh kartu: ${e.message || e}`)
            }
            return
        }

        const status = settings.active ? "AKTIF" : "NONAKTIF"
        return m.reply(
            `*Status Autoback:* [ ${status} ]\n` +
            `*Link cadangan:* ${settings.link || '(belum diatur)'}\n` +
            `*Deskripsi:* ${settings.description}\n\n` +
            "Gunakan:\n" +
            "`.autoback set <link_grup>` - atur link cadangan\n" +
            "`.autoback desc <teks>` - atur deskripsi kartu undangan\n" +
            "`.autoback test` - kirim contoh kartu undangan ke chat ini\n" +
            "`.autoback on` - aktifkan\n" +
            "`.autoback off` - nonaktifkan"
        )
    },

    onMessage: async (m, { sock, config }) => {
        if (!m) return false
        // Cuma skip pesan yg BENERAN dikirim sendiri sama plugin ini (notif/kartu undangan),
        // biar ga infinite loop. Ini bukan blokir semua fromMe, karena di mode self-bot,
        // pesan link yang diketik manual oleh owner juga fromMe=true dan tetap harus diproses.
        if (selfSentIds.has(m.id)) return false

        const settings = getSettings()
        if (!settings.active || !settings.link) {
            return false
        }

        // Kasus 1: WhatsApp otomatis ubah pesan yang isinya CUMA link invite jadi tipe
        // native "groupInviteMessage" (bukan teks biasa), jadi m.body-nya kosong.
        // Deteksi ini langsung dari struktur pesannya.
        const nativeInvite = m.message?.groupInviteMessage
        if (nativeInvite && nativeInvite.inviteCode) {
            const last = cooldown.get(m.sender) || 0
            const now = Date.now()
            if (now - last < COOLDOWN_MS) return false
            cooldown.set(m.sender, now)

            handleAutoJoin(sock, config, settings, m, {
                code: nativeInvite.inviteCode,
                groupId: nativeInvite.groupJid || null,
                subject: nativeInvite.groupName || null,
                viaV4: nativeInvite
            }).catch(e => {
                console.error("Autoback: error tidak terduga:", e.message || e)
            })
            return true
        }

        // Kasus 2: link invite dikirim sebagai bagian dari pesan teks biasa
        if (!m.body) return false
        const match = m.body.match(GC_LINK_REGEX)
        if (!match) return false

        console.log(`[AUTOBACK] Link terdeteksi di m.body dari ${m.sender}: ${match[0]}`)

        const last = cooldown.get(m.sender) || 0
        const now = Date.now()
        if (now - last < COOLDOWN_MS) {
            console.log(`[AUTOBACK] Skip, masih cooldown buat sender ${m.sender}`)
            return false
        }
        cooldown.set(m.sender, now)

        handleAutoJoin(sock, config, settings, m, { code: match[1] }).catch(e => {
            console.error("Autoback: error tidak terduga:", e.message || e)
        })

        return true
    }
}
