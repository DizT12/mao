import fs from 'fs'
import { PassThrough } from 'stream'
import ffmpeg from 'fluent-ffmpeg'
import crypto from 'crypto'
import { Readable } from 'stream'
import WebP from 'node-webpmux'
import { 
    proto, 
    generateWAMessageFromContent, 
    prepareWAMessageMedia, 
    generateWAMessage,
    generateMessageID
} from '@whiskeysockets/baileys'

export const groupCache = new Map()

export const convertToOpus = (input) => {
    return new Promise((resolve, reject) => {
        const output = new PassThrough()
        const buffers = []
        
        const source = Buffer.isBuffer(input) ? Readable.from(input) : input

        ffmpeg(source)
            .audioCodec('libopus')
            .audioChannels(1)
            .audioFrequency(16000)
            .toFormat('opus')
            .addOutputOptions(['-avoid_negative_ts make_zero', '-map_metadata -1'])
            .on('error', (err) => reject(err))
            .pipe(output)

        output.on('data', (chunk) => buffers.push(chunk))
        output.on('end', () => resolve(Buffer.concat(buffers)))
    })
}

function extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
    if (!extract) {
        return {
            text,
            ie: [],
        };
    }
    let ie = [],
    result = '',
    last = 0,
    citation_index = 1,
    hyperlink_index = 0,
    latex_index = 0,
    stack = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] == '[' && text[i - 1] != '\\') {
            stack.push(i);
        } else if (text[i] == ']' && (text[i + 1] == '(' || text[i + 1] == '<')) {
            let start = stack.pop();
            if (start == null) continue;
            let open = text[i + 1],
            close = open == '(' ? ')' : '>',
            type = open == '(' ? 'link' : 'latex',
            end = i + 2,
            depth = 1;
            while (end < text.length && depth) {
                if (text[end] == open && text[end - 1] != '\\') depth++;
                else if (text[end] == close && text[end - 1] != '\\') depth--;
                end++;
            }
            if (depth) continue;
            let raw = text.slice(start + 1, i).trim(),
            url = text.slice(i + 2, end - 1).trim(),
            key,
            tag,
            data;
            if (type == 'latex') {
                if (!latex) continue;
                let [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|');
                key = `\u004E\u0049\u0058\u0045\u004C_LATEX_${latex_index++}`;
                tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;
                data = {
                    type: 'latex',
                    ie: {
                        key,
                        text: txt,
                        url,
                        width,
                        height,
                        font_height,
                        padding,
                    },
                };
            } else if (raw) {
                if (!hyperlink) continue;
                key = `\u004E\u0049\u0058\u0045\u004C_HYPERLINK_${hyperlink_index++}`;
                tag = `{{${key}}}${url}{{/${key}}}`;
                data = {
                    type: 'hyperlink',
                    ie: {
                        key,
                        text: raw,
                        url,
                    },
                };
            } else {
                if (!citation) continue;
                key = `\u004E\u0049\u0058\u0045\u004C_CITATION_${citation_index - 1}`;
                tag = `{{${key}}}${url}{{/${key}}}`;
                data = {
                    type: 'citation',
                    ie: {
                        reference_id: citation_index++,
                        key,
                        text: '',
                        url,
                    },
                };
            }
            result += text.slice(last, start) + tag;
            last = end;
            ie.push(data);
            i = end - 1;
        }
    }
    result += text.slice(last);
    return {
        text: result,
        ie,
    };
}

/**
 * Kelas Dasar Pembangun Pesan Interaktif.
 */
class BaseBuilder {
    constructor() {
        this._title = '';
        this._subtitle = '';
        this._body = '';
        this._footer = '';
        this._contextInfo = {};
        this._extraPayload = {};
    }

    setTitle(title) {
        if (typeof title !== 'string') {
            throw new TypeError('Title must be a string');
        }
        this._title = title;
        return this;
    }

    setSubtitle(subtitle) {
        if (typeof subtitle !== 'string') {
            throw new TypeError('Subtitle must be a string');
        }
        this._subtitle = subtitle;
        return this;
    }

    setBody(body) {
        if (typeof body !== 'string') {
            throw new TypeError('Body must be a string');
        }
        this._body = body;
        return this;
    }

    setFooter(footer) {
        if (typeof footer !== 'string') {
            throw new TypeError('Footer must be a string');
        }
        this._footer = footer;
        return this;
    }

    setContextInfo(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('ContextInfo must be a plain object');
        }
        this._contextInfo = obj;
        return this;
    }

    addPayload(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Payload must be a plain object');
        }
        Object.assign(this._extraPayload, obj);
        return this;
    }

    static async resize(buffer, x, y, fit = 'cover') {
        try {
            const sharp = (await import('sharp')).default;
            return await sharp(buffer)
                .resize(x, y, {
                    fit,
                    position: 'center',
                    background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .png()
                .toBuffer();
        } catch (e) {
            return buffer;
        }
    }

    static async fetchBuffer(url, options = {}, config = {}) {
        try {
            let response = await fetch(url, options);
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            if (config.silent) return Buffer.alloc(0);
            throw error;
        }
    }
}

/**
 * Pembangun Pesan Tombol Interaktif Native Flow.
 */
class Button extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }
        this.#client = client;
        this._buttons = [];
        this._data = undefined;
        this._currentSelectionIndex = -1;
        this._currentSectionIndex = -1;
        this._params = {};
    }

    setVideo(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { video: path, ...options }) : (this._data = { video: { url: path }, ...options });
        return this;
    }

    setImage(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { image: path, ...options }) : (this._data = { image: { url: path }, ...options });
        return this;
    }

    setDocument(path, options = {}) {
        if (!path) throw new Error('Url or buffer needed');
        Buffer.isBuffer(path) ? (this._data = { document: path, ...options }) : (this._data = { document: { url: path }, ...options });
        return this;
    }

    setMedia(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }
        this._data = obj;
        return this;
    }

    clearButtons() {
        this._buttons = [];
        return this;
    }

    setParams(obj) {
        this._params = obj;
        return this;
    }

    addButton(name, params) {
        this._buttons.push({
            name,
            buttonParamsJson: typeof params === 'string' ? params : JSON.stringify(params),
        });
        return this;
    }

    makeRow(header = '', title = '', description = '', id = '') {
        if (this._currentSelectionIndex === -1 || this._currentSectionIndex === -1) {
            throw new Error('You need to create a selection and a section first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections[this._currentSectionIndex].rows.push({ header, title, description, id });
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    makeSection(title = '', highlight_label = '') {
        if (this._currentSelectionIndex === -1) {
            throw new Error('You need to create a selection first');
        }
        const buttonParams = JSON.parse(this._buttons[this._currentSelectionIndex].buttonParamsJson);
        buttonParams.sections.push({ title, highlight_label, rows: [] });
        this._currentSectionIndex = buttonParams.sections.length - 1;
        this._buttons[this._currentSelectionIndex].buttonParamsJson = JSON.stringify(buttonParams);
        return this;
    }

    addSelection(title, options = {}) {
        this._buttons.push({ ...options, name: 'single_select', buttonParamsJson: JSON.stringify({ title, sections: [] }) });
        this._currentSelectionIndex = this._buttons.length - 1;
        this._currentSectionIndex = -1;
        return this;
    }

    addReply(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addCall(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addReminder(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_reminder',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addCancelReminder(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'cta_cancel_reminder',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addAddress(display_text = '', id = '', options = {}) {
        this._buttons.push({
            name: 'address_message',
            buttonParamsJson: JSON.stringify({
                display_text,
                id,
                ...options,
            }),
        });
        return this;
    }

    addLocation(options = {}) {
        this._buttons.push({
            name: 'send_location',
            buttonParamsJson: JSON.stringify(options),
        });
        return this;
    }

    addUrl(display_text = '', url = '', webview_interaction = false, options = {}) {
        this._buttons.push({
            ...options,
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text,
                url,
                webview_interaction,
                ...options,
            }),
        });
        return this;
    }

    addCopy(display_text = '', copy_code = '', options = {}) {
        this._buttons.push({
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text,
                copy_code,
                ...options,
            }),
        });
        return this;
    }

    async toCard() {
        return {
            body: {
                text: this._body,
            },
            footer: {
                text: this._footer,
            },
            header: {
                title: this._title,
                subtitle: this._subtitle,
                hasMediaAttachment: !!this._data,
                ...(this._data
                ? await prepareWAMessageMedia(this._data, { upload: this.#client.waUploadToServer }).catch((e) => {
                    if (String(e).includes('Invalid media type')) return this._data;
                    throw e;
                })
                : {}),
            },
            nativeFlowMessage: {
                messageParamsJson: JSON.stringify(this._params),
                buttons: this._buttons,
            },
        };
    }

    async build(jid, { ...options } = {}) {
        const message = await this.toCard();
        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    ...message,
                    contextInfo: this._contextInfo,
                },
            },
            { ...options }
        );
    }

    async send(jid, { ...options } = {}) {
        const msg = await this.build(jid, options);
        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

/**
 * Pembangun Pesan Tombol Interaktif Kompatibilitas Tinggi (ButtonV2).
 */
class ButtonV2 extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }
        this.#client = client;
        this._image = undefined;
        this._data = undefined;
        this._buttons = [];
    }

    addButton(displayText = '', buttonId = crypto.randomUUID()) {
        this._buttons.push({
            buttonId,
            buttonText: { displayText },
            type: 1,
        });
        return this;
    }

    addRawButton(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Buttons must be a plain object');
        }
        this._buttons.push(obj);
        return this;
    }

    setThumbnail(path) {
        if (!path) throw new Error('Url or buffer needed');
        this._image = path;
        return this;
    }

    setMedia(obj) {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new TypeError('Media must be a plain object');
        }
        this._data = obj;
        return this;
    }

    async build(jid, { ...options } = {}) {
        let _thumbnail = this._image ? await BaseBuilder.resize(Buffer.isBuffer(this._image) ? this._image : await BaseBuilder.fetchBuffer(this._image, {}, { silent: true }), 300, 300) : null;
        const msg = generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                buttonsMessage: {
                    contentText: this._body,
                    footerText: this._footer,
                    ...(this._data
                    ? this._data
                    : {
                        headerType: 6,
                        locationMessage: {
                            degreesLatitude: 0,
                            degreesLongitude: 0,
                            name: this._title,
                            address: this._subtitle,
                            jpegThumbnail: _thumbnail,
                        },
                    }),
                    viewOnce: true,
                    contextInfo: this._contextInfo,
                    buttons: [...this._buttons],
                },
            },
            { ...options }
        );
        return msg;
    }

    async send(jid, { ...options } = {}) {
        if (this._buttons.length < 1) throw new Error('ButtonV2 requires at least one button');
        const msg = await this.build(jid, options);
        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

/**
 * Pembangun Pesan Slide Kartu Interaktif (Carousel).
 */
class Carousel extends BaseBuilder {
    #client;

    constructor(client) {
        super();
        if (!client) {
            throw new Error('Socket is required');
        }
        this.#client = client;
        this._cards = [];
    }

    addCard(card) {
        const cards = Array.isArray(card) ? card : [card];
        const baseIndex = this._cards.length;
        for (const [index, c] of cards.entries()) {
            if (!c?.header?.hasMediaAttachment) {
                throw new Error(`Card [${baseIndex + index}] must include an image or video in header`);
            }
        }
        this._cards.push(...cards);
        return this;
    }

    build(jid, { ...options } = {}) {
        return generateWAMessageFromContent(
            jid,
            {
                ...this._extraPayload,
                interactiveMessage: {
                    header: {
                        hasMediaAttachment: false,
                    },
                    body: { text: this._body },
                    footer: { text: this._footer },
                    contextInfo: this._contextInfo,
                    carouselMessage: {
                        cards: this._cards,
                    },
                },
            },
            { ...options }
        );
    }

    async send(jid, { ...options } = {}) {
        const msg = this.build(jid, options);
        await this.#client.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [
                {
                    tag: 'biz',
                    attrs: {},
                    content: [
                        {
                            tag: 'interactive',
                            attrs: { type: 'native_flow', v: '1' },
                            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
                        },
                    ],
                },
            ],
            ...options,
        });
        return msg;
    }
}

/**
 * Pembangun Pesan Terformat AI Rich Response (Teks, Tabel, Code block, Reels, Grid Image, dsb).
 */
class AIRich extends BaseBuilder {
    #client;

    constructor(client) {
        if (!client) {
            throw new Error('Socket is required');
        }
        super();
        this.#client = client;
        this._contextInfo = {};
        this._submessages = [];
        this._sections = [];
        this._richResponseSources = [];
    }

    static newLayout(name, data) {
        return {
            view_model: {
                [Array.isArray(data) ? 'primitives' : 'primitive']: data,
                __typename: `GenAI${name}LayoutViewModel`,
            },
        };
    }

    addSubmessage(submessage) {
        const items = Array.isArray(submessage) ? submessage : [submessage];
        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Submessage must be a plain object or array of plain objects');
            }
            this._submessages.push(item);
        }
        return this;
    }

    addSection(section) {
        const items = Array.isArray(section) ? section : [section];
        for (const item of items) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                throw new TypeError('Section must be a plain object or array of plain objects');
            }
            this._sections.push(item);
        }
        return this;
    }

    addText(text, { hyperlink = true, citation = true, latex = true } = {}) {
        if (typeof text != 'string') {
            throw new TypeError('Text must be a string');
        }
        const extractedIE = extractIE(text, {
            hyperlink,
            citation,
            latex,
        });
        const inline_entities = extractedIE.ie.map(({ type, ie }) => {
            if (type == 'hyperlink') {
                return {
                    key: ie.key,
                    metadata: {
                        display_name: ie.text,
                        is_trusted: true,
                        url: ie.url,
                        __typename: 'GenAIInlineLinkItem',
                    },
                };
            }
            if (type == 'citation') {
                return {
                    key: ie.key,
                    metadata: {
                        reference_id: ie.reference_id,
                        reference_url: ie.url,
                        reference_title: ie.url,
                        reference_display_name: ie.url,
                        sources: [],
                        __typename: 'GenAISearchCitationItem',
                    },
                };
            }
            if (type == 'latex') {
                return {
                    key: ie.key,
                    metadata: {
                        latex_expression: ie.text,
                        latex_image: {
                            url: ie.url,
                            width: Number(ie.width) || 100,
                            height: Number(ie.height) || 100,
                        },
                        font_height: Number(ie.font_height) || 83.333333333333,
                        padding: Number(ie.padding) || 15,
                        __typename: 'GenAILatexItem',
                    },
                };
            }
            return {
                key: ie.key,
                metadata: {
                    latex_expression: ie.text,
                    latex_image: {
                        url: ie.url,
                        width: Number(ie.width) || 100,
                        height: Number(ie.height) || 100,
                    },
                    font_height: Number(ie.font_height) || 83.333333333333,
                    padding: Number(ie.padding) || 15,
                    __typename: 'GenAILatexItem',
                },
            };
        });
        this._submessages.push({
            messageType: 2,
            messageText: extractedIE.text,
        });
        this._sections.push(
            AIRich.newLayout('Single', {
                text: extractedIE.text,
                ...(inline_entities.length && {
                    inline_entities,
                }),
                __typename: 'GenAIMarkdownTextUXPrimitive',
            })
        );
        return this;
    }

    addCode(language, code) {
        if (typeof language !== 'string' || typeof code !== 'string') {
            throw new TypeError('Language and code must be a string');
        }
        const meta = AIRich.tokenizer(code, language);
        this._submessages.push({
            messageType: 5,
            codeMetadata: {
                codeLanguage: language,
                codeBlocks: meta.codeBlock,
            },
        });
        this._sections.push(
            AIRich.newLayout('Single', {
                language,
                code_blocks: meta.unified_codeBlock,
                __typename: 'GenAICodeUXPrimitive',
            })
        );
        return this;
    }

    addTable(table) {
        if (!Array.isArray(table)) {
            throw new TypeError('Table must be an array');
        }
        const meta = AIRich.toTableMetadata(table);
        this._submessages.push({
            messageType: 4,
            tableMetadata: {
                title: meta.title,
                rows: meta.rows,
            },
        });
        this._sections.push(
            AIRich.newLayout('Single', {
                rows: meta.unified_rows,
                __typename: 'GenATableUXPrimitive',
            })
        );
        return this;
    }

    addSource(sources = []) {
        if (!(Array.isArray(sources) && (sources.every((item) => typeof item === 'string') || sources.every((item) => Array.isArray(item) && item.every((v) => typeof v === 'string'))))) {
            throw new TypeError('Sources must be a string array or an array of string arrays');
        }
        if (sources.every((item) => typeof item === 'string')) {
            sources = [sources];
        }
        const source = sources.map(([profile_url, url, text]) => ({
            source_type: 'THIRD_PARTY',
            source_display_name: text ?? '',
            source_subtitle: 'AI',
            source_url: url ?? '',
            favicon: {
                url: profile_url ?? '',
                mime_type: 'image/jpeg',
                width: 16,
                height: 16,
            },
        }));
        this._sections.push(
            AIRich.newLayout('Single', {
                sources: source,
                __typename: 'GenAISearchResultPrimitive',
            })
        );
        return this;
    }

    addReels(reelsItems = []) {
        if (!((reelsItems && typeof reelsItems === 'object' && !Array.isArray(reelsItems)) || (Array.isArray(reelsItems) && reelsItems.every((item) => item && typeof item === 'object' && !Array.isArray(item))))) {
            throw new TypeError('Reels items must be an object or an array of objects');
        }
        if (!Array.isArray(reelsItems)) {
            reelsItems = [reelsItems];
        }
        this._submessages.push({
            messageType: 9,
            contentItemsMetadata: {
                contentType: 1,
                itemsMetadata: reelsItems.map((item) => ({
                    reelItem: {
                        title: item.username ?? '',
                        profileIconUrl: item.profileIconUrl ?? item.profile_url ?? '',
                        thumbnailUrl: item.thumbnailUrl ?? item.thumbnail ?? '',
                        videoUrl: item.videoUrl ?? item.url ?? '',
                    },
                })),
            },
        });
        reelsItems.forEach((item, idx) => {
            this._richResponseSources.push({
                provider: '\u004E\u0049\u0058\u0045\u004C',
                thumbnailCDNURL: item.thumbnailUrl ?? item.thumbnail ?? '',
                sourceProviderURL: item.videoUrl ?? item.url ?? '',
                sourceQuery: '',
                faviconCDNURL: item.profileIconUrl ?? item.profile_url ?? '',
                citationNumber: idx + 1,
                sourceTitle: item.username ?? '',
            });
        });
        this._sections.push(
            AIRich.newLayout(
                'HScroll',
                reelsItems.map((item) => ({
                    reels_url: item.videoUrl ?? item.url ?? '',
                    thumbnail_url: item.thumbnailUrl ?? item.thumbnail ?? '',
                    creator: item.username ?? item.title ?? '',
                    avatar_url: item.profileIconUrl ?? item.profile_url ?? '',
                    reels_title: item.reels_title ?? item.title ?? '',
                    likes_count: item.likes_count ?? item.like ?? 0,
                    shares_count: item.shares_count ?? item.share ?? 0,
                    view_count: item.view_count ?? item.view ?? 0,
                    reel_source: item.reel_source ?? item.source ?? 'IG',
                    is_verified: !!(item.is_verified || item.verified),
                    __typename: 'GenAIReelPrimitive',
                }))
            )
        );
        return this;
    }

    addImage(imageUrl) {
        if (!(typeof imageUrl === 'string' || (Array.isArray(imageUrl) && imageUrl.every((v) => typeof v === 'string')))) {
            throw new TypeError('imageUrl must be a string or array of strings');
        }
        const imageUrls = Array.isArray(imageUrl)
        ? imageUrl.map((url) => ({
            imagePreviewUrl: url,
            imageHighResUrl: url,
            sourceUrl: String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 102, 105, 111, 114, 97, 46, 110, 105, 120, 101, 108, 46, 109, 121, 46, 105, 100, 47),
        }))
        : [
            {
                imagePreviewUrl: imageUrl,
                imageHighResUrl: imageUrl,
                sourceUrl: String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 102, 105, 111, 114, 97, 46, 110, 105, 120, 101, 108, 46, 109, 121, 46, 105, 100, 47),
            },
        ];
        this._submessages.push({
            messageType: 1,
            gridImageMetadata: {
                gridImageUrl: {
                    imagePreviewUrl: Array.isArray(imageUrl) ? imageUrl[0] : imageUrl,
                },
                imageUrls,
            },
        });
        imageUrls.forEach(({ imagePreviewUrl }) => {
            this._sections.push(
                AIRich.newLayout('Single', {
                    media: {
                        url: imagePreviewUrl,
                        mime_type: 'image/png',
                    },
                    imagine_type: 'IMAGE',
                    status: {
                        status: 'READY',
                    },
                    __typename: 'GenAIImaginePrimitive',
                })
            );
        });
        return this;
    }

    addVideo(videoUrl) {
        if (!(typeof videoUrl === 'string' || (Array.isArray(videoUrl) && videoUrl.every((v) => typeof v === 'string')))) {
            throw new TypeError('videoUrl must be a string or array of strings');
        }
        const videoUrls = (Array.isArray(videoUrl) ? videoUrl : [videoUrl]).map((item) => {
            const [url, duration = 0] = item.split('|');
            return {
                videoPreviewUrl: url,
                videoHighResUrl: url,
                duration: Number(duration) || 0,
                sourceUrl: String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47, 102, 105, 111, 114, 97, 46, 110, 105, 120, 101, 108, 46, 109, 121, 46, 105, 100, 47),
            };
        });
        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_VIDEO - \u004E\u0049\u0058\u0045\u004C ]',
        });
        videoUrls.forEach(({ videoPreviewUrl, duration = 0 }) => {
            this._sections.push(
                AIRich.newLayout('Single', {
                    media: {
                        url: videoPreviewUrl,
                        mime_type: 'video/mp4',
                        duration,
                    },
                    imagine_type: 'ANIMATE',
                    status: {
                        status: 'READY',
                    },
                    __typename: 'GenAIImaginePrimitive',
                })
            );
        });
        return this;
    }

    addProduct(data = {}) {
        if (!((data && typeof data === 'object' && !Array.isArray(data)) || (Array.isArray(data) && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))))) {
            throw new TypeError('Product items must be an object or an array of objects');
        }
        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_PRODUCT - NIXEL ]',
        });
        const items = Array.isArray(data) ? data : [data];
        const product = items.map((item) => ({
            title: item.title,
            brand: item.brand,
            price: item.price,
            sale_price: item.sale_price,
            product_url: item.product_url ?? item.url,
            image: {
                url: item.image_url ?? item.image,
            },
            additional_images: [
                {
                    url: item.icon_url ?? item.icon,
                },
            ],
            __typename: 'GenAIProductItemCardPrimitive',
        }));
        this._sections.push(AIRich.newLayout(Array.isArray(data) ? 'HScroll' : 'Single', Array.isArray(data) ? product : product[0]));
        return this;
    }

    addPost(data = {}) {
        if (!((data && typeof data === 'object' && !Array.isArray(data)) || (Array.isArray(data) && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))))) {
            throw new TypeError('Post items must be an object or an array of objects');
        }
        const posts = Array.isArray(data) ? data : [data];
        this._submessages.push({
            messageType: 2,
            messageText: '[ CANNOT_LOAD_POST - NIXEL ]',
        });
        const primitives = posts.map((p) => ({
            title: p.title ?? '',
            subtitle: p.subtitle ?? '',
            username: p.username ?? '',
            profile_picture_url: p.profile_picture_url ?? p.profile_url ?? '',
            is_verified: !!(p.is_verified || p.verified),
            thumbnail_url: p.thumbnail_url ?? p.thumbnail ?? '',
            post_caption: p.post_caption ?? p.caption ?? '',
            likes_count: p.likes_count ?? p.like ?? 0,
            comments_count: p.comments_count ?? p.comment ?? 0,
            shares_count: p.shares_count ?? p.share ?? 0,
            post_url: p.post_url ?? p.url ?? '',
            post_deeplink: p.post_deeplink ?? p.deeplink ?? '',
            source_app: p.source_app || p.source || 'INSTAGRAM',
            footer_label: p.footer_label ?? p.footer ?? '',
            footer_icon: p.footer_icon ?? p.icon ?? '',
            is_carousel: posts.length > 1,
            orientation: p.orientation ?? 'LANDSCAPE',
            post_type: p.post_type ?? 'VIDEO',
            __typename: 'GenAIPostPrimitive',
        }));
        this._sections.push(AIRich.newLayout('HScroll', primitives));
        return this;
    }

    addTip(text) {
        this._submessages.push({
            messageType: 2,
            messageText: text,
        });
        this._sections.push(
            AIRich.newLayout('Single', {
                text,
                __typename: 'GenAIMetadataTextPrimitive',
            })
        );
        return this;
    }

    addSuggest(suggestion) {
        if (!(typeof suggestion === 'string' || (Array.isArray(suggestion) && suggestion.every((v) => typeof v === 'string')))) {
            throw new TypeError('Suggestion must be a string or array of strings');
        }
        const suggest = Array.isArray(suggestion)
        ? suggestion.map((text) => ({
            prompt_text: text,
            prompt_type: 'SUGGESTED_PROMPT',
            __typename: 'GenAIFollowUpSuggestionPillPrimitive',
        }))
        : [
            {
                prompt_text: suggestion,
                prompt_type: 'SUGGESTED_PROMPT',
                __typename: 'GenAIFollowUpSuggestionPillPrimitive',
            },
        ];
        this._sections.push(AIRich.newLayout('ActionRow', suggest));
        return this;
    }

    build({ forwarded = true, includesUnifiedResponse = true, includesSubmessages = true, quoted, quotedParticipant, ...options } = {}) {
        const forward = forwarded
        ? {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '0@bot' },
            forwardOrigin: 4,
        }
        : {};
        const qObj = quoted
        ? {
            stanzaId: quoted?.key?.id || quoted?.id,
            participant: quotedParticipant || quoted?.key?.participant || quoted?.key?.remoteJid,
            quotedType: 0,
            quotedMessage: typeof quoted === 'object' && quoted !== null ? (quoted.message ?? quoted) : undefined,
        }
        : {};
        const sections = this._footer
        ? [
            ...this._sections,
            AIRich.newLayout('Single', {
                text: this._footer,
                __typename: 'GenAIMetadataTextPrimitive',
            }),
        ]
        : [...this._sections];
        return {
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                botMetadata: {
                    messageDisclaimerText: this._title,
                    richResponseSourcesMetadata: { sources: this._richResponseSources },
                },
            },
            ...this._extraPayload,
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1,
                        submessages: includesSubmessages ? this._submessages : [],
                        unifiedResponse: {
                            data: includesUnifiedResponse ? Buffer.from(JSON.stringify({ response_id: crypto.randomUUID(), sections })).toString('base64') : '',
                        },
                        contextInfo: {
                            ...forward,
                            ...qObj,
                            ...this._contextInfo,
                        },
                    },
                },
            },
        };
    }

    async send(jid, { forwarded, includesUnifiedResponse, includesSubmessages, ...options } = {}) {
        const msg = this.build({ forwarded, includesUnifiedResponse, ...options });
        return await this.#client.relayMessage(jid, msg, { ...options });
    }

    static tokenizer(code, lang = 'javascript') {
        const keywordsMap = {
            javascript: new Set([
                'break', 'case', 'catch', 'continue', 'debugger', 'delete', 'do', 'else',
                'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return',
                'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
                'with', 'true', 'false', 'null', 'undefined', 'class', 'const', 'let',
                'super', 'extends', 'export', 'import', 'yield', 'static', 'constructor',
                'async', 'await', 'get', 'set'
            ]),
        };
        const TYPE_MAP = {
            0: 'DEFAULT',
            1: 'KEYWORD',
            2: 'METHOD',
            3: 'STR',
            4: 'NUMBER',
            5: 'COMMENT',
        };
        const keywords = keywordsMap[lang] || new Set();
        const tokens = [];
        let i = 0;
        const push = (content, type) => {
            if (!content) return;
            const last = tokens[tokens.length - 1];
            if (last && last.highlightType === type) last.codeContent += content;
            else tokens.push({ codeContent: content, highlightType: type });
        };
        while (i < code.length) {
            const c = code[i];
            if (/\s/.test(c)) {
                let s = i;
                while (i < code.length && /\s/.test(code[i])) i++;
                push(code.slice(s, i), 0);
                continue;
            }
            if (c === '/' && code[i + 1] === '/') {
                let s = i;
                i += 2;
                while (i < code.length && code[i] !== '\n') i++;
                push(code.slice(s, i), 5);
                continue;
            }
            if (c === '"' || c === "'" || c === '`') {
                let s = i;
                const q = c;
                i++;
                while (i < code.length) {
                    if (code[i] === '\\' && i + 1 < code.length) i += 2;
                    else if (code[i] === q) {
                        i++;
                        break;
                    } else i++;
                }
                push(code.slice(s, i), 3);
                continue;
            }
            if (/[0-9]/.test(c)) {
                let s = i;
                while (i < code.length && /[0-9.]/.test(code[i])) i++;
                push(code.slice(s, i), 4);
                continue;
            }
            if (/[a-zA-Z_$]/.test(c)) {
                let s = i;
                while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
                const word = code.slice(s, i);
                let type = 0;
                if (keywords.has(word)) type = 1;
                else {
                    let j = i;
                    while (j < code.length && /\s/.test(code[j])) j++;
                    if (code[j] === '(') type = 2;
                }
                push(word, type);
                continue;
            }
            push(c, 0);
            i++;
        }
        return {
            codeBlock: tokens,
            unified_codeBlock: tokens.map((t) => ({
                content: t.codeContent,
                type: TYPE_MAP[t.highlightType],
            })),
        };
    }

    static toTableMetadata(arr) {
        if (!Array.isArray(arr) || !arr.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))) {
            throw new TypeError('Table must be a nested array of strings');
        }
        const [header, ...rows] = arr;
        const maxLen = Math.max(header.length, ...rows.map((r) => r.length));
        const normalize = (r) => [...r, ...Array(maxLen - r.length).fill('')];
        const unified_rows = [
            {
                is_header: true,
                cells: normalize(header),
            },
            ...rows.map((r) => ({
                is_header: false,
                cells: normalize(r),
            })),
        ];
        const rowsMeta = unified_rows.map((r) => ({
            items: r.cells,
            ...(r.is_header ? { isHeading: true } : {}),
        }));
        return {
            title: '',
            rows: rowsMeta,
            unified_rows,
        };
    }
}

/**
 * Membungkus objek Socket Baileys dengan fungsionalitas dan helper tingkat tinggi.
 * 
 * @param {object} sock - Socket Baileys asli.
 * @returns {Promise<object>} Socket Baileys yang telah dibungkus dengan berbagai metode pembantu.
 */
export default async function wrapSocket(sock) {
    const oldSendMessage = sock.sendMessage
    sock.generateMessageID = generateMessageID

    sock.sendMessage = async (jid, content, options = {}) => {
        if (!jid || !content) return
        if (!content.contextInfo) content.contextInfo = {}
        if (typeof jid === 'string' && jid.endsWith('@g.us')) {
            const duration = groupCache.get(jid)
            if (duration) content.contextInfo.expiration = duration
        }
        return await oldSendMessage.call(sock, jid, content, options)
    }

    sock.sendImage = async (jid, path, caption = '', quoted = '', options = {}) => {
        let payload = typeof path === 'string' && path.startsWith('http') ? { url: path } : Buffer.isBuffer(path) ? path : { url: path }
        return await sock.sendMessage(jid, { image: payload, caption: String(caption), ...options }, { quoted })
    }

    sock.sendVideo = async (jid, path, caption = '', quoted = '', gif = false, options = {}) => {
        let payload = typeof path === 'string' && path.startsWith('http') ? { url: path } : Buffer.isBuffer(path) ? path : { url: path }
        return await sock.sendMessage(jid, { video: payload, caption: String(caption), gifPlayback: gif, ...options }, { quoted })
    }

    sock.sendAudio = async (jid, path, ptt = false, quoted = '', options = {}) => {
        try {
            let source = typeof path === 'string' && path.startsWith('http') ? path : Buffer.isBuffer(path) ? path : path
            if (ptt) {
                const buffer = await convertToOpus(source)
                return await sock.sendMessage(jid, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus', ...options }, { quoted })
            }
            return await sock.sendMessage(jid, { audio: typeof source === 'string' ? { url: source } : source, ptt: false, mimetype: 'audio/mpeg', ...options }, { quoted })
        } catch (e) {
            console.error(e)
        }
    }

    sock.sendAlbum = async (jid, items =[], options = {}) => {
        if (!sock.user?.id) throw new Error("User not authenticated")
        const messageSecret = crypto.randomBytes(32)
        const messageContent = {
            messageContextInfo: { messageSecret },
            albumMessage: {
                expectedImageCount: items.filter(a => a.image).length,
                expectedVideoCount: items.filter(a => a.video).length,
            }
        }
        const album = generateWAMessageFromContent(jid, messageContent, {
            userJid: sock.user.id,
            upload: sock.waUploadToServer,
            quoted: options.quoted || null,
            ephemeralExpiration: options.quoted?.expiration || 0,
        })
        await sock.relayMessage(album.key.remoteJid, album.message, { messageId: album.key.id })
        for (const content of items) {
            const mediaSecret = crypto.randomBytes(32)
            const mediaMsg = await generateWAMessage(album.key.remoteJid, content, {
                upload: sock.waUploadToServer,
                ephemeralExpiration: options.quoted?.expiration || 0,
            })
            mediaMsg.message.messageContextInfo = {
                messageSecret: mediaSecret,
                messageAssociation: { associationType: 1, parentMessageKey: album.key }
            }
            await sock.relayMessage(mediaMsg.key.remoteJid, mediaMsg.message, { messageId: mediaMsg.key.id })
        }
        return album
    }

    sock.sendCard = async (jid, options = {}) => {
        const { text = "", footer = "", cards =[], quoted = null } = options
        let carouselCards =[]
        for (let i = 0; i < cards.length; i++) {
            const item = cards[i]
            let mediaInput = typeof item.image === 'string' ? { url: item.image } : item.image
            const img = await prepareWAMessageMedia({ image: mediaInput }, { upload: sock.waUploadToServer })
            carouselCards.push({
                header: proto.Message.InteractiveMessage.Header.fromObject({
                    title: item.caption || "",
                    hasMediaAttachment: true,
                    ...img
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                    buttons: Array.isArray(item.buttons) ? item.buttons :[]
                }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: footer })
            })
        }
        const msg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: { text },
                        carouselMessage: { cards: carouselCards }
                    })
                }
            }
        }, { userJid: sock.user.id, quoted })
        return await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
    }

    sock.sendButton = async (jid, content = {}, options = {}) => {
        const { text = "", footer = "", title = "", buttons =[], image, video } = content
        const processedButtons = buttons.map((btn, i) => {
            if (btn.name && btn.buttonParamsJson) return btn
            return {
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || btn.displayText || `Button ${i + 1}`,
                    id: btn.id || `id_${i + 1}`
                })
            }
        })
        let header = { title, hasMediaAttachment: false }
        if (image || video) {
            const media = await prepareWAMessageMedia({[image ? 'image' : 'video']: typeof (image || video) === 'string' ? { url: (image || video) } : (image || video) 
            }, { upload: sock.waUploadToServer })
            header = { title, hasMediaAttachment: true, ...media }
        }
        const msg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: { text: text || content.caption || "" },
                        footer: { text: footer },
                        header: header,
                        nativeFlowMessage: { buttons: processedButtons },
                        contextInfo: {
                            mentionedJid: options.mentions ||[],
                            ...options.contextInfo
                        }
                    })
                }
            }
        }, { userJid: sock.user.id, quoted: options.quoted || null })
        await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes:[{
                tag: "biz",
                attrs: {},
                content:[{
                    tag: "interactive",
                    attrs: { type: "native_flow", v: "1" },
                    content:[{
                        tag: "native_flow", attrs: { v: "9", name: "mixed" }
                    }]
                }]
            }]
        })
        return msg
    }
    
    sock.sendSticker = async (jid, buffer, quoted = '', options = {}) => {
        const packname = options.packname || 'Kaguya - Hime !'
        const author = options.author || 'cosmic princess kaguya'
        const isVideo = options.isAnimated || false

        return new Promise((resolve, reject) => {
            const tempFileIn = `./temp_${Date.now()}_in.${isVideo ? 'mp4' : 'jpg'}`
            const tempFileOut = `./temp_${Date.now()}_out.webp`

            fs.writeFileSync(tempFileIn, buffer)

            let args =[
                "-vcodec", "libwebp",
                "-vf", "scale='min(512,iw)':'min(512,ih)',pad=512:512:(512-iw)/2:(512-ih)/2:color=white@0",
                "-loop", "0",
                "-an"
            ]

            if (isVideo) {
                args.push("-preset", "default", "-t", "00:00:05", "-r", "15", "-qscale", "20")
            } else {
                args.push("-preset", "default", "-qscale", "70")
            }

            ffmpeg(tempFileIn)
                .addOutputOptions(args)
                .toFormat('webp')
                .save(tempFileOut)
                .on('end', async () => {
                    try {
                        let webpBuffer = fs.readFileSync(tempFileOut)
                        
                        const img = new WebP.Image()
                        await img.load(webpBuffer)
                        
                        const json = { "sticker-pack-id": `yuuki-${Date.now()}`, "sticker-pack-name": packname, "sticker-pack-publisher": author, "emojis": ["🚀"] }
                        const exifHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00])
                        const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
                        const exif = Buffer.concat([exifHeader, jsonBuffer])
                        exif.writeUIntLE(jsonBuffer.length, 14, 4)
                        
                        img.exif = exif
                        let finalBuffer = await img.save(null)
                        
                        let res = await sock.sendMessage(jid, { sticker: finalBuffer, ...options }, { quoted })
                        
                        fs.unlinkSync(tempFileIn)
                        fs.unlinkSync(tempFileOut)
                        resolve(res)
                    } catch (e) {
                        if (fs.existsSync(tempFileIn)) fs.unlinkSync(tempFileIn)
                        if (fs.existsSync(tempFileOut)) fs.unlinkSync(tempFileOut)
                        reject(e)
                    }
                })
                .on('error', (err) => {
                    if (fs.existsSync(tempFileIn)) fs.unlinkSync(tempFileIn)
                    if (fs.existsSync(tempFileOut)) fs.unlinkSync(tempFileOut)
                    reject(err)
                })
        })
    }

    /**
     * Mengirim pesan tombol interaktif (Native Flow / Interactive Message) dengan skema objek sederhana.
     * 
     * @param {string} jid - ID tujuan pesan (JID).
     * @param {object} content - Parameter konten tombol interaktif.
     * @param {string} [content.title] - Judul pesan (header).
     * @param {string} [content.subtitle] - Subtitle pesan (header).
     * @param {string} [content.body] - Teks utama pesan.
     * @param {string} [content.footer] - Teks kaki pesan.
     * @param {string|Buffer} [content.image] - URL gambar atau Buffer untuk bagian atas.
     * @param {string|Buffer} [content.video] - URL video atau Buffer untuk bagian atas.
     * @param {string|Buffer} [content.document] - URL dokumen atau Buffer untuk bagian atas.
     * @param {array} [content.buttons] - Kumpulan tombol yang akan dipasang.
     * @param {object} [options] - Parameter tambahan untuk Baileys (seperti quoted).
     * 
     * @example
     * await sock.sendInteractiveButton(m.from, {
     *     title: "Pilihan Menu",
     *     body: "Silakan tekan tombol di bawah ini:",
     *     buttons: [
     *         { type: "reply", label: "Menu Bot", id: ".menu" },
     *         { type: "url", label: "Website", url: "https://lipz.site" },
     *         { type: "copy", label: "Salin Kode", code: "VIPCODE" }
     *     ]
     * }, { quoted: m })
     */
    sock.sendInteractiveButton = async (jid, content = {}, options = {}) => {
        const builder = new Button(sock)
        if (content.title) builder.setTitle(content.title)
        if (content.subtitle) builder.setSubtitle(content.subtitle)
        if (content.body) builder.setBody(content.body)
        if (content.footer) builder.setFooter(content.footer)
        if (content.image) builder.setImage(content.image)
        else if (content.video) builder.setVideo(content.video)
        else if (content.document) builder.setDocument(content.document)
        if (Array.isArray(content.buttons)) {
            for (const btn of content.buttons) {
                if (btn.type === 'reply') {
                    builder.addReply(btn.label || btn.displayText, btn.id || '', btn.options || {})
                } else if (btn.type === 'url') {
                    builder.addUrl(btn.label || btn.displayText, btn.url || '', btn.webview || false, btn.options || {})
                } else if (btn.type === 'copy') {
                    builder.addCopy(btn.label || btn.displayText, btn.code || '', btn.options || {})
                } else if (btn.type === 'call') {
                    builder.addCall(btn.label || btn.displayText, btn.id || '', btn.options || {})
                } else if (btn.type === 'location') {
                    builder.addLocation(btn.options || {})
                } else if (btn.type === 'address') {
                    builder.addAddress(btn.label || btn.displayText, btn.id || '', btn.options || {})
                } else if (btn.type === 'reminder') {
                    builder.addReminder(btn.label || btn.displayText, btn.id || '', btn.options || {})
                } else if (btn.type === 'cancel_reminder') {
                    builder.addCancelReminder(btn.label || btn.displayText, btn.id || '', btn.options || {})
                }
            }
        }
        if (content.contextInfo) builder.setContextInfo(content.contextInfo)
        if (content.payload) builder.addPayload(content.payload)
        if (content.params) builder.setParams(content.params)
        return await builder.send(jid, { quoted: options.quoted || null, ...options })
    }

    /**
     * Mengirim pesan slide kartu (Carousel / Multi-Card) interaktif dengan sangat mudah.
     * 
     * @param {string} jid - ID tujuan pesan (JID).
     * @param {object} content - Parameter konten carousel.
     * @param {string} [content.body] - Teks utama di bagian atas seluruh kartu.
     * @param {string} [content.footer] - Teks kaki di bagian bawah seluruh kartu.
     * @param {array} content.cards - Kumpulan kartu slide. Setiap kartu wajib memiliki media (image/video).
     * @param {object} [options] - Parameter tambahan untuk Baileys (seperti quoted).
     * 
     * @example
     * await sock.sendCarousel(m.from, {
     *     body: "Berikut daftar produk unggulan kami:",
     *     cards: [
     *         {
     *             title: "Produk 1",
     *             body: "Kualitas Premium",
     *             image: "https://url.com/image1.jpg",
     *             buttons: [{ type: "reply", label: "Detail", id: ".detail 1" }]
     *         },
     *         {
     *             title: "Produk 2",
     *             body: "Kualitas Standar",
     *             image: "https://url.com/image2.jpg",
     *             buttons: [{ type: "reply", label: "Detail", id: ".detail 2" }]
     *         }
     *     ]
     * }, { quoted: m })
     */
    sock.sendCarousel = async (jid, content = {}, options = {}) => {
        const builder = new Carousel(sock)
        if (content.body) builder.setBody(content.body)
        if (content.footer) builder.setFooter(content.footer)
        if (content.contextInfo) builder.setContextInfo(content.contextInfo)
        if (content.payload) builder.addPayload(content.payload)
        if (Array.isArray(content.cards)) {
            const cardsList = []
            for (const cardData of content.cards) {
                const cardBuilder = new Button(sock)
                if (cardData.title) cardBuilder.setTitle(cardData.title)
                if (cardData.subtitle) cardBuilder.setSubtitle(cardData.subtitle)
                if (cardData.body) cardBuilder.setBody(cardData.body)
                if (cardData.footer) cardBuilder.setFooter(cardData.footer)
                if (cardData.image) cardBuilder.setImage(cardData.image)
                else if (cardData.video) cardBuilder.setVideo(cardData.video)
                else if (cardData.document) cardBuilder.setDocument(cardData.document)
                if (Array.isArray(cardData.buttons)) {
                    for (const btn of cardData.buttons) {
                        if (btn.type === 'reply') {
                            cardBuilder.addReply(btn.label || btn.displayText, btn.id || '', btn.options || {})
                        } else if (btn.type === 'url') {
                            cardBuilder.addUrl(btn.label || btn.displayText, btn.url || '', btn.webview || false, btn.options || {})
                        } else if (btn.type === 'copy') {
                            cardBuilder.addCopy(btn.label || btn.displayText, btn.code || '', btn.options || {})
                        }
                    }
                }
                const cardObj = await cardBuilder.toCard()
                cardsList.push(cardObj)
            }
            builder.addCard(cardsList)
        }
        return await builder.send(jid, { quoted: options.quoted || null, ...options })
    }

    /**
     * Mengirim pesan terformat AI Rich Response (Teks Markdown, Tabel, Kode, Reels, Produk, dsb).
     * 
     * @param {string} jid - ID tujuan pesan (JID).
     * @param {object} content - Struktur data AI Rich.
     * @param {string} [content.title] - Judul pesan.
     * @param {string} [content.subtitle] - Subtitle pesan.
     * @param {string} [content.body] - Teks utama di atas komponen.
     * @param {string} [content.footer] - Teks kaki di bagian bawah.
     * @param {string} [content.text] - Blok teks markdown dengan hyperlink, citation, atau latex.
     * @param {array} [content.table] - Tabel berbentuk nested array of strings.
     * @param {object} [content.code] - Objek berisi { language, code } untuk syntax highlighting.
     * @param {array} [content.reels] - Kumpulan Reels (Instagram/TikTok).
     * @param {string|array} [content.images] - Link gambar grid tunggal atau array.
     * @param {string|array} [content.videos] - Link video atau array video.
     * @param {object|array} [content.products] - Kartu produk e-commerce.
     * @param {object|array} [content.posts] - Postingan bergaya feed media sosial.
     * @param {string} [content.tip] - Teks tip/catatan informasi tambahan di bagian bawah.
     * @param {string|array} [content.suggest] - Kumpulan tombol pilihan cepat (suggestion pill).
     * @param {array} [content.sources] - Sumber pencarian/referensi luar.
     * @param {object} [options] - Parameter tambahan untuk Baileys (seperti quoted).
     * 
     * @example
     * await sock.sendAIRich(m.from, {
     *     text: "Berikut adalah daftar harga barang di toko kami:",
     *     table: [
     *         ["Barang", "Harga", "Stok"],
     *         ["RAM 8GB", "Rp 500.000", "Ada"],
     *         ["SSD 512GB", "Rp 800.000", "Ada"]
     *     ]
     * })
     */
    sock.sendAIRich = async (jid, content = {}, options = {}) => {
        const builder = new AIRich(sock)
        if (content.title) builder.setTitle(content.title)
        if (content.subtitle) builder.setSubtitle(content.subtitle)
        if (content.body) builder.setBody(content.body)
        if (content.footer) builder.setFooter(content.footer)
        if (content.text) builder.addText(content.text, content.textOptions || {})
        if (content.table) builder.addTable(content.table)
        if (content.code) {
            builder.addCode(content.code.language || 'javascript', content.code.code || '')
        }
        if (content.reels) builder.addReels(content.reels)
        if (content.images) builder.addImage(content.images)
        if (content.videos) builder.addVideo(content.videos)
        if (content.products) builder.addProduct(content.products)
        if (content.posts) builder.addPost(content.posts)
        if (content.tip) builder.addTip(content.tip)
        if (content.suggest) builder.addSuggest(content.suggest)
        if (content.sources) builder.addSource(content.sources)
        if (content.contextInfo) builder.setContextInfo(content.contextInfo)
        if (content.payload) builder.addPayload(content.payload)
        return await builder.send(jid, { quoted: options.quoted || null, ...options })
    }

    /**
     * Mengirim pesan tombol interaktif kompatibilitas tinggi (ButtonV2).
     * 
     * @param {string} jid - ID tujuan pesan (JID).
     * @param {object} content - Parameter konten tombol V2.
     * @param {string} [content.title] - Judul pesan (header).
     * @param {string} [content.subtitle] - Subtitle pesan (header).
     * @param {string} [content.body] - Teks utama pesan.
     * @param {string} [content.footer] - Teks kaki pesan.
     * @param {string|Buffer} [content.thumbnail] - URL gambar atau Buffer untuk thumbnail peta/lokasi.
     * @param {object} [content.media] - Kumpulan pesan media custom.
     * @param {array} [content.buttons] - Kumpulan tombol instan.
     * @param {object} [options] - Parameter tambahan untuk Baileys (seperti quoted).
     * 
     * @example
     * await sock.sendButtonV2(m.from, {
     *     body: "Silakan tekan tombol di bawah ini:",
     *     buttons: [
     *         { label: "Pilihan 1", id: "pilih_1" },
     *         { label: "Pilihan 2", id: "pilih_2" }
     *     ]
     * }, { quoted: m })
     */
    sock.sendButtonV2 = async (jid, content = {}, options = {}) => {
        const builder = new ButtonV2(sock)
        if (content.title) builder.setTitle(content.title)
        if (content.subtitle) builder.setSubtitle(content.subtitle)
        if (content.body) builder.setBody(content.body)
        if (content.footer) builder.setFooter(content.footer)
        if (content.thumbnail) builder.setThumbnail(content.thumbnail)
        if (content.media) builder.setMedia(content.media)
        if (Array.isArray(content.buttons)) {
            for (const btn of content.buttons) {
                builder.addButton(btn.label || btn.displayText, btn.id)
            }
        }
        if (content.contextInfo) builder.setContextInfo(content.contextInfo)
        if (content.payload) builder.addPayload(content.payload)
        return await builder.send(jid, { quoted: options.quoted || null, ...options })
    }

    return sock
}

export { Button, ButtonV2, Carousel, AIRich }