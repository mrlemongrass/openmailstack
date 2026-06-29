const { ImapFlow } = require('imapflow');

async function main() {
    const client = new ImapFlow({
        host: '127.0.0.1',
        port: 143,
        secure: false,
        tls: { rejectUnauthorized: false, checkServerIdentity: () => undefined },
        auth: {
            user: 'admin@housevo.us',
            pass: 'admin123'
        },
        logger: false
    });
    await client.connect();
    const folders = await client.list();
    console.log("Folders:", folders.map(f => f.path));
    
    const mbx = await client.mailboxOpen('INBOX');
    console.log("INBOX message count:", mbx.exists);
    await client.logout();
}
main().catch(console.error);
