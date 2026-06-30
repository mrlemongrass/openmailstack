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
class ManageSieveClient {
    host;
    port;
    masterUser;
    masterPass;
    client;
    resolveData = null;
    rejectError = null;
    dataBuffer = '';
    literalBytesRemaining = 0;
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
            this.dataBuffer += data.toString('utf8');
            // Handle {size+} literal: read exactly size bytes before looking for status
            if (this.literalBytesRemaining > 0) {
                this.literalBytesRemaining -= data.length;
                if (this.literalBytesRemaining > 0)
                    return; // still waiting for more literal data
            }
            // Check for literal size prefix: {size}\r\n or {size+}\r\n
            const literalMatch = this.dataBuffer.match(/^\{(\d+)\+?\}\r\n/);
            if (literalMatch && !this.literalBytesRemaining) {
                const size = parseInt(literalMatch[1], 10);
                const afterPrefix = this.dataBuffer.slice(literalMatch[0].length);
                if (afterPrefix.length >= size) {
                    // Literal data already fully received; consume it and continue
                    this.literalBytesRemaining = 0;
                }
                else {
                    this.literalBytesRemaining = size - afterPrefix.length;
                    return; // wait for more data
                }
            }
            // Check if we received a full response (last line starts with OK/NO/BYE)
            const lines = this.dataBuffer.trim().split('\r\n');
            const lastLine = lines[lines.length - 1];
            if (lastLine.startsWith('OK') || lastLine.startsWith('NO') || lastLine.startsWith('BYE')) {
                if (this.resolveData) {
                    const response = this.dataBuffer;
                    this.dataBuffer = '';
                    this.literalBytesRemaining = 0;
                    this.resolveData(response);
                    this.resolveData = null;
                    this.rejectError = null;
                }
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
        if (!res.trim().split('\r\n').pop()?.startsWith('OK')) {
            throw new Error(`ManageSieve login failed: ${res}`);
        }
    }
    async getScript(scriptName) {
        const res = await this.sendCommand(`GETSCRIPT "${scriptName}"`);
        const lines = res.trim().split('\r\n');
        const lastLine = lines.pop();
        if (!lastLine?.startsWith('OK')) {
            throw new Error(`GETSCRIPT failed: ${res}`);
        }
        // Response format:
        // {size}
        // script content...
        // OK
        let content = '';
        if (lines[0].startsWith('{')) {
            lines.shift(); // Remove the {size} line
            content = lines.join('\n'); // Join the rest
        }
        return content;
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
            const lastLine = res.trim().split('\r\n').pop();
            if (!lastLine?.startsWith('OK')) {
                throw new Error(`PUTSCRIPT failed: ${res}`);
            }
        });
    }
    async setActive(scriptName) {
        const res = await this.sendCommand(`SETACTIVE "${scriptName}"`);
        if (!res.trim().split('\r\n').pop()?.startsWith('OK')) {
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