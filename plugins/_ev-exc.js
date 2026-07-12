import { exec } from 'child_process'
import util from 'util'

export default {
    cmd: ['>', '>>', '$'],
    category: 'owner',
    run: async (m, { sock, text, isOwner, jid, config }) => {
        if (!isOwner) return
        
        const jid_ = jid 
        const sock_ = sock

        const parseEval = (input) => {
            const isStatement = /^\s*(const|let|var|if|for|while|switch|try|return)\b/.test(input)
            return isStatement ? input : `return ${input}`
        }

        if (m.body.startsWith('>>')) {
            try {
                let evalTarget = m.body.slice(2).trim()
                if (!evalTarget) return m.reply("Kodenya mana?")
                
                let result = await eval(`(async () => {
                    try {
                        ${parseEval(evalTarget)}
                    } catch (e) {
                        return e
                    }
                })()`)

                if (typeof result !== 'string') result = util.inspect(result, { depth: 5 })
                m.reply(result)
            } catch (e) {
                m.reply(util.format(e))
            }
        } else if (m.body.startsWith('>')) {
            try {
                let evalTarget = m.body.slice(1).trim()
                if (!evalTarget) return m.reply("Kodenya mana?")
                
                let result = eval(`(() => {
                    try {
                        ${parseEval(evalTarget)}
                    } catch (e) {
                        return e
                    }
                })()`)
                
                if (typeof result !== 'string') result = util.inspect(result, { depth: 5 })
                m.reply(result)
            } catch (e) {
                m.reply(util.format(e))
            }
        } else if (m.body.startsWith('$')) {
            let execTarget = m.body.slice(1).trim()
            if (!execTarget) return m.reply("Perintahnya mana?")
            exec(execTarget, (err, stdout) => {
                if (err) return m.reply(util.format(err))
                if (stdout) {
                    const output = stdout.trim()
                    let lang = 'bash'
                    if (output.startsWith('{') || output.startsWith('[')) {
                        lang = 'json'
                    }
                    sock_.sendAIRich(m.from, {
                        text: `*Result of:* \`$ ${execTarget}\``,
                        code: {
                            language: lang,
                            code: output
                        }
                    }, { quoted: m })
                }
            })
        }
    }
}