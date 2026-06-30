export declare class ManageSieveClient {
    private host;
    private port;
    private masterUser?;
    private masterPass?;
    private client;
    private resolveData;
    private rejectError;
    private dataBuffer;
    private literalBytesRemaining;
    private receiveTimer;
    constructor(host?: string, port?: number, masterUser?: string, masterPass?: string);
    private sendCommand;
    connect(): Promise<string>;
    login(user: string, pass: string): Promise<void>;
    getScript(scriptName: string): Promise<string>;
    putScript(scriptName: string, content: string): Promise<void>;
    setActive(scriptName: string): Promise<void>;
    logout(): Promise<void>;
}
//# sourceMappingURL=managesieve.d.ts.map