const { ImapFlow } = require('imapflow');

async function main() {
    const client = new ImapFlow({
        host: '127.0.0.1',
        port: 143,
        secure: false,
        tls: { rejectUnauthorized: false },
        auth: { user: 'mrlemongrass@openmailstack.com', pass: 'password123' },
        logger: false
    });
    
    await client.connect();
    let lock = await client.getMailboxLock('INBOX');
    try {
        console.log("Mailbox opened, fetching...");
        const count = lock.mailbox.exists;
        console.log(`Mailbox has ${count} messages`);
        if (count > 0) {
            for await (let msg of client.fetch('1:*', { uid: true })) {
                console.log("Fetched message", msg.uid);
            }
        }
        console.log("Done fetching!");
    } catch(e) {
        console.log("Error:", e);
    } finally {
        lock.release();
    }
    await client.logout();
}

main().catch(console.error);
