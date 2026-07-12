export default {
    cmd: ['owner', 'creator'],
    category: 'info',
    run: async (m, { sock, config }) => {
        const contactsList = []

        for (const num of config.ownerNumber) {
            const cleanNumber = num.replace(/[^0-9]/g, '')
            const vcard = 'BEGIN:VCARD\n'
                        + 'VERSION:3.0\n'
                        + 'FN:Owner ' + config.botName + '\n'
                        + 'ORG:Owner;\n'
                        + 'TEL;type=CELL;type=VOICE;waid=' + cleanNumber + ':+' + cleanNumber + '\n'
                        + 'END:VCARD'
            contactsList.push({ vcard })
        }

        await sock.sendMessage(m.from, {
            contacts: {
                displayName: 'Owner ' + config.botName,
                contacts: contactsList
            }
        }, { quoted: m })
    }
}