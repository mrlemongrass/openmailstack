"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManageSieveClient = void 0;
const net = __importStar(require("net"));
const CRLF = Buffer.from('\r\n', 'ascii');
const LITERAL_HEADER = /^\{(\d+)\+?\}$/;
const TERMINAL_STATUS = /^(?:OK|NO|BYE)(?:$|[\t (])/;
function findResponseEnd(buffer) {
    let cursor = 0;
    while (cursor < buffer.length) {
        const lineEnd = buffer.indexOf(CRLF, cursor);
        if (lineEnd < 0)
            return null;
        const line = buffer.subarray(cursor, lineEnd).toString('utf8');
        cursor = lineEnd + CRLF.length;
        const literalMatch = line.match(LITERAL_HEADER);
        if (literalMatch) {
            const literalSize = Number(literalMatch[1]);
            if (!Number.isSafeInteger(literalSize)) {
                throw new Error('ManageSieve literal size is invalid');
            }
            if (buffer.length < cursor + literalSize)
                return null;
            cursor += literalSize;
            continue;
        }
        if (TERMINAL_STATUS.test(line))
            return cursor;
    }
    return null;
}
function terminalStatus(response) {
    if (!response.endsWith('\r\n'))
        return null;
    const withoutTrailingCrlf = response.slice(0, -CRLF.length);
    const statusStart = withoutTrailingCrlf.lastIndexOf('\r\n');
    return statusStart < 0
        ? withoutTrailingCrlf
        : withoutTrailingCrlf.slice(statusStart + CRLF.length);
}
function responseIsOk(response) {
    const status = terminalStatus(response);
    return status !== null && /^OK(?:$|[\t (])/.test(status);
}
class ManageSieveClient {
    host;
    port;
    masterUser;
    masterPass;
    client;
    resolveData = null;
    rejectError = null;
    dataBuffer = Buffer.alloc(0);
    receiveTimer = null;
    constructor(host = 'localhost', port = 4190, masterUser, masterPass) {
        this.host = host;
        this.port = port;
        this.masterUser = masterUser;
        this.masterPass = masterPass;
        this.client = new net.Socket();
        this.client.setTimeout(30000);
        this.client.on('timeout', () => {
            if (this.rejectError) {
                this.rejectError(new Error('ManageSieve connection timed out'));
                this.resolveData = null;
                this.rejectError = null;
            }
            this.client.destroy();
        });
        this.client.on('data', (data) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
            this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);
            try {
                const responseEnd = findResponseEnd(this.dataBuffer);
                if (responseEnd !== null && this.resolveData) {
                    const resolve = this.resolveData;
                    const response = this.dataBuffer.subarray(0, responseEnd).toString('utf8');
                    this.dataBuffer = this.dataBuffer.subarray(responseEnd);
                    this.resolveData = null;
                    this.rejectError = null;
                    resolve(response);
                }
            }
            catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                if (this.rejectError)
                    this.rejectError(failure);
                this.resolveData = null;
                this.rejectError = null;
                this.client.destroy();
            }
        });
        this.client.on('error', (err) => {
            if (this.rejectError) {
                this.rejectError(err);
                this.rejectError = null;
                this.resolveData = null;
            }
        });
    }
    async sendCommand(cmd, waitResponse = true) {
        return new Promise((resolve, reject) => {
            if (waitResponse) {
                this.resolveData = resolve;
                this.rejectError = reject;
            }
            this.client.write(cmd + '\r\n');
            if (!waitResponse)
                resolve('');
        });
    }
    async connect() {
        return new Promise((resolve, reject) => {
            this.resolveData = resolve;
            this.rejectError = reject;
            this.client.connect(this.port, this.host);
        });
    }
    async login(user, pass) {
        const authUser = (this.masterUser && this.masterPass) ? `${user}*${this.masterUser}` : user;
        const authPass = (this.masterUser && this.masterPass) ? this.masterPass : pass;
        const authString = Buffer.from(`\0${authUser}\0${authPass}`).toString('base64');
        const res = await this.sendCommand(`AUTHENTICATE "PLAIN" "${authString}"`);
        if (!responseIsOk(res)) {
            throw new Error(`ManageSieve login failed: ${res}`);
        }
    }
    async getScript(scriptName) {
        const res = await this.sendCommand(`GETSCRIPT "${scriptName}"`);
        if (!responseIsOk(res)) {
            throw new Error(`GETSCRIPT failed: ${res}`);
        }
        const response = Buffer.from(res, 'utf8');
        const headerEnd = response.indexOf(CRLF);
        if (headerEnd < 0)
            throw new Error('GETSCRIPT response is missing a literal header');
        const literalMatch = response.subarray(0, headerEnd).toString('ascii').match(LITERAL_HEADER);
        if (!literalMatch)
            throw new Error('GETSCRIPT response is missing a literal');
        const literalSize = Number(literalMatch[1]);
        const contentStart = headerEnd + CRLF.length;
        const contentEnd = contentStart + literalSize;
        if (!Number.isSafeInteger(literalSize) || contentEnd + CRLF.length > response.length) {
            throw new Error('GETSCRIPT response contains an incomplete literal');
        }
        if (!response.subarray(contentEnd, contentEnd + CRLF.length).equals(CRLF)) {
            throw new Error('GETSCRIPT response literal is not terminated');
        }
        return response.subarray(contentStart, contentEnd).toString('utf8');
    }
    async putScript(scriptName, content) {
        // Need to send PUTSCRIPT "name" {size}
        // then the script content
        const size = Buffer.byteLength(content, 'utf8');
        return new Promise((resolve, reject) => {
            this.resolveData = resolve;
            this.rejectError = reject;
            this.client.write(`PUTSCRIPT "${scriptName}" {${size}+}\r\n${content}\r\n`);
        }).then(res => {
            if (!responseIsOk(res)) {
                throw new Error(`PUTSCRIPT failed: ${res}`);
            }
        });
    }
    async setActive(scriptName) {
        const res = await this.sendCommand(`SETACTIVE "${scriptName}"`);
        if (!responseIsOk(res)) {
            throw new Error(`SETACTIVE failed: ${res}`);
        }
    }
    async logout() {
        await this.sendCommand('LOGOUT');
        this.client.destroy();
    }
}
exports.ManageSieveClient = ManageSieveClient;
//# sourceMappingURL=managesieve.js.map