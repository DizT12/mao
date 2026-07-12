import fs from 'fs'
import path from 'path'

const DB_DIR = './database'
const DB_FILE = path.join(DB_DIR, 'database.json')
const MSG_FILE = path.join(DB_DIR, 'message.json')

if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true })
}

let db = {
    contacts: {},
    lid_mapping: {},
    groups: {},
    group_settings: {},
    global_settings: {
        menu_style: 1,
        bot_mode: 'public'
    }
}

let msgDb = {
    messages: {}
}

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'))
        if (!db.global_settings) {
            db.global_settings = { menu_style: 1, bot_mode: 'public' }
        }
        if (!db.global_settings.bot_mode) {
            db.global_settings.bot_mode = 'public'
        }
    } catch (e) {
        db = {
            contacts: {},
            lid_mapping: {},
            groups: {},
            group_settings: {},
            global_settings: { menu_style: 1, bot_mode: 'public' }
        }
    }
}

if (fs.existsSync(MSG_FILE)) {
    try {
        msgDb = JSON.parse(fs.readFileSync(MSG_FILE, 'utf-8'))
    } catch (e) {
        msgDb = {
            messages: {}
        }
    }
}

let _saveDbTimer = null
const saveDb = () => {
    if (_saveDbTimer) return
    _saveDbTimer = setTimeout(() => {
        _saveDbTimer = null
        fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf-8', () => {})
    }, 1000)
}

let _saveMsgTimer = null
const saveMsgDb = () => {
    if (_saveMsgTimer) return
    _saveMsgTimer = setTimeout(() => {
        _saveMsgTimer = null
        fs.writeFile(MSG_FILE, JSON.stringify(msgDb, null, 2), 'utf-8', () => {})
    }, 1000)
}

export async function saveMessage(m, type) {
    if (!m || !m.key) return
    const key = `${m.key.remoteJid}:${m.key.id}`
    msgDb.messages[key] = {
        key_id: key,
        remote_jid: m.key.remoteJid,
        id: m.key.id,
        from_me: m.key.fromMe ? 1 : 0,
        push_name: m.pushName || 'null',
        message: JSON.stringify(m.message),
        timestamp: m.messageTimestamp,
        type: type
    }
    saveMsgDb()
}

export async function loadMessage(jid, id) {
    const key = `${jid}:${id}`
    const row = msgDb.messages[key]
    if (!row) return undefined
    return JSON.parse(row.message)
}

export async function saveContact(jid, lid, pushName) {
    if (!jid || !jid.endsWith('@s.whatsapp.net')) return
    
    const existing = db.contacts[jid]
    let finalName = pushName
    
    if (pushName === 'Unknown' || !pushName) {
        if (existing && existing.pushname && existing.pushname !== 'null') {
            finalName = existing.pushname
        } else {
            finalName = 'null'
        }
    }

    const finalLid = lid || (existing ? existing.lid : 'null')

    db.contacts[jid] = {
        jid: jid,
        lid: finalLid,
        pushname: finalName
    }

    if (lid && lid.endsWith('@lid')) {
        db.lid_mapping[lid] = jid
    }
    saveDb()
}

export async function getContact(jid) {
    return db.contacts[jid] || undefined
}

export async function getLidMapping(lid) {
    return db.lid_mapping[lid] || null
}

export async function saveMetadata(jid, name, desc, participants = []) {
    if (!jid || (!jid.endsWith('@g.us') && !jid.endsWith('@newsletter'))) return
    
    db.groups[jid] = {
        jid: jid,
        name: name || 'null',
        description: desc || 'null',
        members: JSON.stringify(participants)
    }
    saveDb()
}

export async function syncGroupParticipants(jid, participants = []) {
    if (!jid || !participants.length) return
    for (const p of participants) {
        const userJid = p.phoneNumber || (p.id?.endsWith('@s.whatsapp.net') ? p.id : null)
        const userLid = p.id?.endsWith('@lid') ? p.id : null
        
        if (userJid) {
            await saveContact(userJid, userLid, 'Unknown')
        }
    }
}

export async function getGroupSettings(jid) {
    let row = db.group_settings[jid]
    if (!row) {
        row = { 
            jid: jid,
            welcome: 1, 
            goodbye: 1, 
            welcome_text: 'Hai @pushname, Selamat datang di @gcname!', 
            goodbye_text: 'Selamat tinggal @pushname, semoga tenang disana.' 
        }
        db.group_settings[jid] = row
        saveDb()
    }
    return {
        welcome: row.welcome === 1,
        goodbye: row.goodbye === 1,
        welcomeText: row.welcome_text,
        goodbyeText: row.goodbye_text
    }
}

export async function updateGroupSettings(jid, field, value) {
    let col = ''
    if (field === 'welcome') col = 'welcome'
    else if (field === 'goodbye') col = 'goodbye'
    else if (field === 'welcomeText') col = 'welcome_text'
    else if (field === 'goodbyeText') col = 'goodbye_text'
    
    if (!col) return

    if (!db.group_settings[jid]) {
        db.group_settings[jid] = {
            jid: jid,
            welcome: 1,
            goodbye: 1,
            welcome_text: 'Hai @pushname, Selamat datang di @gcname!',
            goodbye_text: 'Selamat tinggal @pushname, semoga tenang disana.'
        }
    }

    db.group_settings[jid][col] = (value === true || value === 1) ? 1 : (value === false || value === 0) ? 0 : value
    saveDb()
}

export function getMenuStyle() {
    return db.global_settings?.menu_style || 1
}

export function updateMenuStyle(style) {
    if (!db.global_settings) {
        db.global_settings = {}
    }
    db.global_settings.menu_style = style
    saveDb()
}

export function getBotMode() {
    return db.global_settings?.bot_mode || 'public'
}

export function setBotMode(mode) {
    if (!db.global_settings) {
        db.global_settings = {}
    }
    db.global_settings.bot_mode = mode
    saveDb()
}