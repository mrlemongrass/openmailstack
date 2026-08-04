import * as net from 'net';

const CRLF = Buffer.from('\r\n', 'ascii');
const LITERAL_HEADER = /^\{(\d+)\+?\}$/;
const TERMINAL_STATUS = /^(?:OK|NO|BYE)(?:$|[\t (])/;
const MAX_LITERAL_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = MAX_LITERAL_BYTES + (64 * 1024);

function findResponseEnd(buffer: Buffer): number | null {
    let cursor = 0;

    while (cursor < buffer.length) {
        const lineEnd = buffer.indexOf(CRLF, cursor);
        if (lineEnd < 0) return null;

        const line = buffer.subarray(cursor, lineEnd).toString('utf8');
        cursor = lineEnd + CRLF.length;

        const literalMatch = line.match(LITERAL_HEADER);
        if (literalMatch) {
            const literalSize = Number(literalMatch[1]);
            if (!Number.isSafeInteger(literalSize)) {
                throw new Error('ManageSieve literal size is invalid');
            }
            if (literalSize > MAX_LITERAL_BYTES) {
                throw new Error(`ManageSieve literal exceeds ${MAX_LITERAL_BYTES} bytes`);
            }
            if (buffer.length < cursor + literalSize) return null;
            cursor += literalSize;
            continue;
        }

        if (TERMINAL_STATUS.test(line)) return cursor;
    }

    return null;
}

function terminalStatus(response: string): string | null {
    if (!response.endsWith('\r\n')) return null;
    const withoutTrailingCrlf = response.slice(0, -CRLF.length);
    const statusStart = withoutTrailingCrlf.lastIndexOf('\r\n');
    return statusStart < 0
        ? withoutTrailingCrlf
        : withoutTrailingCrlf.slice(statusStart + CRLF.length);
}

function responseIsOk(response: string): boolean {
    const status = terminalStatus(response);
    return status !== null && /^OK(?:$|[\t (])/.test(status);
}

export class ManageSieveClient {
    private client: net.Socket;
    private resolveData: ((data: string) => void) | null = null;
    private rejectError: ((err: Error) => void) | null = null;
    private dataBuffer = Buffer.alloc(0);
    private receiveTimer: NodeJS.Timeout | null = null;

    constructor(
        private host: string = 'localhost',
        private port: number = 4190,
        private masterUser?: string,
        private masterPass?: string
    ) {
        this.client = new net.Socket();
        this.client.setTimeout(30000);

        this.client.on('timeout', () => {
            this.rejectPending(new Error('ManageSieve connection timed out'));
            this.client.destroy();
        });

        this.client.on('data', (data) => {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

            try {
                if (this.dataBuffer.length + chunk.length > MAX_RESPONSE_BYTES) {
                    throw new Error(`ManageSieve response exceeds ${MAX_RESPONSE_BYTES} bytes`);
                }
                this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);

                const responseEnd = findResponseEnd(this.dataBuffer);
                if (responseEnd !== null && this.resolveData) {
                    const resolve = this.resolveData;
                    const response = this.dataBuffer.subarray(0, responseEnd).toString('utf8');
                    this.dataBuffer = this.dataBuffer.subarray(responseEnd);
                    this.resolveData = null;
                    this.rejectError = null;
                    resolve(response);
                }
            } catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                this.rejectPending(failure);
                this.client.destroy();
            }
        });

        this.client.on('error', (err) => {
            this.rejectPending(err);
        });

        this.client.on('end', () => {
            this.rejectPending(new Error('ManageSieve connection ended before response completed'));
        });

        this.client.on('close', () => {
            this.rejectPending(new Error('ManageSieve connection closed before response completed'));
        });
    }

    private rejectPending(error: Error): void {
        const reject = this.rejectError;
        this.resolveData = null;
        this.rejectError = null;
        this.dataBuffer = Buffer.alloc(0);
        if (this.receiveTimer) {
            clearTimeout(this.receiveTimer);
            this.receiveTimer = null;
        }
        if (reject) reject(error);
    }

    private async sendCommand(cmd: string, waitResponse = true): Promise<string> {
        return new Promise((resolve, reject) => {
            if (waitResponse) {
                this.resolveData = resolve;
                this.rejectError = reject;
            }
            this.client.write(cmd + '\r\n');
            if (!waitResponse) resolve('');
        });
    }

    async connect(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.resolveData = resolve;
            this.rejectError = reject;
            this.client.connect(this.port, this.host);
        });
    }

    async login(user: string, pass: string): Promise<void> {
        const authUser = (this.masterUser && this.masterPass) ? `${user}*${this.masterUser}` : user;
        const authPass = (this.masterUser && this.masterPass) ? this.masterPass : pass;
        const authString = Buffer.from(`\0${authUser}\0${authPass}`).toString('base64');
        const res = await this.sendCommand(`AUTHENTICATE "PLAIN" "${authString}"`);
        if (!responseIsOk(res)) {
            throw new Error(`ManageSieve login failed: ${res}`);
        }
    }

    async getScript(scriptName: string): Promise<string> {
        const res = await this.sendCommand(`GETSCRIPT "${scriptName}"`);
        if (!responseIsOk(res)) {
            throw new Error(`GETSCRIPT failed: ${res}`);
        }

        const response = Buffer.from(res, 'utf8');
        const headerEnd = response.indexOf(CRLF);
        if (headerEnd < 0) throw new Error('GETSCRIPT response is missing a literal header');

        const literalMatch = response.subarray(0, headerEnd).toString('ascii').match(LITERAL_HEADER);
        if (!literalMatch) throw new Error('GETSCRIPT response is missing a literal');

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

    async putScript(scriptName: string, content: string): Promise<void> {
        // Need to send PUTSCRIPT "name" {size}
        // then the script content
        const size = Buffer.byteLength(content, 'utf8');
        
        return new Promise((resolve, reject) => {
            this.resolveData = resolve;
            this.rejectError = reject;
            this.client.write(`PUTSCRIPT "${scriptName}" {${size}+}\r\n${content}\r\n`);
        }).then(res => {
            if (!responseIsOk(res as string)) {
                throw new Error(`PUTSCRIPT failed: ${res}`);
            }
        });
    }

    async setActive(scriptName: string): Promise<void> {
        const res = await this.sendCommand(`SETACTIVE "${scriptName}"`);
        if (!responseIsOk(res)) {
            throw new Error(`SETACTIVE failed: ${res}`);
        }
    }

    async logout(): Promise<void> {
        await this.sendCommand('LOGOUT');
        this.client.destroy();
    }
}
