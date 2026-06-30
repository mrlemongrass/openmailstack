import * as net from 'net';

export class ManageSieveClient {
    private client: net.Socket;
    private resolveData: ((data: string) => void) | null = null;
    private rejectError: ((err: Error) => void) | null = null;
    private dataBuffer = '';
    private literalBytesRemaining = 0;
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
                if (this.literalBytesRemaining > 0) return; // still waiting for more literal data
            }

            // Check for literal size prefix: {size}\r\n or {size+}\r\n
            const literalMatch = this.dataBuffer.match(/^\{(\d+)\+?\}\r\n/);
            if (literalMatch && !this.literalBytesRemaining) {
                const size = parseInt(literalMatch[1], 10);
                const afterPrefix = this.dataBuffer.slice(literalMatch[0].length);
                if (afterPrefix.length >= size) {
                    // Literal data already fully received; consume it and continue
                    this.literalBytesRemaining = 0;
                } else {
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
        if (!res.trim().split('\r\n').pop()?.startsWith('OK')) {
            throw new Error(`ManageSieve login failed: ${res}`);
        }
    }

    async getScript(scriptName: string): Promise<string> {
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

    async putScript(scriptName: string, content: string): Promise<void> {
        // Need to send PUTSCRIPT "name" {size}
        // then the script content
        const size = Buffer.byteLength(content, 'utf8');
        
        return new Promise((resolve, reject) => {
            this.resolveData = resolve;
            this.rejectError = reject;
            this.client.write(`PUTSCRIPT "${scriptName}" {${size}+}\r\n${content}\r\n`);
        }).then(res => {
            const lastLine = (res as string).trim().split('\r\n').pop();
            if (!lastLine?.startsWith('OK')) {
                throw new Error(`PUTSCRIPT failed: ${res}`);
            }
        });
    }

    async setActive(scriptName: string): Promise<void> {
        const res = await this.sendCommand(`SETACTIVE "${scriptName}"`);
        if (!res.trim().split('\r\n').pop()?.startsWith('OK')) {
            throw new Error(`SETACTIVE failed: ${res}`);
        }
    }

    async logout(): Promise<void> {
        await this.sendCommand('LOGOUT');
        this.client.destroy();
    }
}
