"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const config_1 = require("../config");
const worker_1 = require("./worker");
const POLL_INTERVAL_MS = 15_000;
async function main() {
    if (!config_1.schedulerConfig.enabled) {
        console.log('Scheduler worker is disabled.');
        await db_1.pool.end();
        return;
    }
    const workerId = `scheduler-${process.pid}-${crypto_1.default.randomBytes(6).toString('hex')}`;
    let stopping = false;
    let wake = null;
    let sleepTimer = null;
    const stop = () => {
        stopping = true;
        if (sleepTimer)
            clearTimeout(sleepTimer);
        wake?.();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log('Scheduler worker started.', { workerId });
    while (!stopping) {
        try {
            await (0, worker_1.runSchedulerWorkerCycle)(workerId);
        }
        catch (error) {
            console.error('Scheduler worker cycle failed:', error);
        }
        if (stopping)
            break;
        await new Promise((resolve) => {
            wake = resolve;
            sleepTimer = setTimeout(resolve, POLL_INTERVAL_MS);
        });
        sleepTimer = null;
        wake = null;
    }
    await db_1.pool.end();
    console.log('Scheduler worker stopped.');
}
void main().catch((error) => {
    console.error('Scheduler worker crashed:', error);
    process.exitCode = 1;
});
//# sourceMappingURL=worker-entry.js.map