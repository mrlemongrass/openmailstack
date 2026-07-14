import crypto from 'crypto';
import { pool } from '../db';
import { schedulerConfig } from '../config';
import { OmsSchedulerMessageProvider, runSchedulerWorkerCycle } from './worker';

const POLL_INTERVAL_MS = 15_000;

async function main(): Promise<void> {
    if (!schedulerConfig.enabled) {
        console.log('Scheduler worker is disabled.');
        await pool.end();
        return;
    }

    const workerId = `scheduler-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    const provider = new OmsSchedulerMessageProvider();
    let stopping = false;
    let wake: (() => void) | null = null;
    let sleepTimer: NodeJS.Timeout | null = null;
    const stop = () => {
        stopping = true;
        if (sleepTimer) clearTimeout(sleepTimer);
        wake?.();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);

    console.log('Scheduler worker started.', { workerId });
    while (!stopping) {
        try {
            await runSchedulerWorkerCycle(workerId, provider);
        } catch (error) {
            console.error('Scheduler worker cycle failed:', error);
        }
        if (stopping) break;
        await new Promise<void>((resolve) => {
            wake = resolve;
            sleepTimer = setTimeout(resolve, POLL_INTERVAL_MS);
        });
        sleepTimer = null;
        wake = null;
    }
    await pool.end();
    console.log('Scheduler worker stopped.');
}

void main().catch((error) => {
    console.error('Scheduler worker crashed:', error);
    process.exitCode = 1;
});
