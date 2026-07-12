import util from 'util'

export default {
    cmd: ['q', 'quoted'],
    category: 'tools',
    run: async (m) => {
        let target = m.quoted ? m.quoted : m
        let content = util.inspect(target, { depth: 5, showHidden: false })
        m.reply(content)
    }
}