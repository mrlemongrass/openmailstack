const http = require('http');

const wbxmlPayload = Buffer.from([
    0x03, 0x01, 0x6a, 0x00, // Header
    0x00, 0x15, // Switch to page 21 (ComposeMail)
    0x45, // SendMail (0x05 + 0x40 for content)
    0x4B, 0x03, ...Buffer.from("client-1234"), 0x00, 0x01, // ClientId (0x0B + 0x40)
    0x08, // SaveInSentItems (0x08, no content)
    0x4A, 0x03, ...Buffer.from("From: thang@housevo.us\r\nTo: admin@housevo.us\r\nSubject: EAS Test Email\r\n\r\nThis is a test from EAS proxy!"), 0x00, 0x01, // Mime (0x0A + 0x40)
    0x01 // End SendMail
]);

const req = http.request({
    hostname: '127.0.0.1',
    port: 20000,
    path: '/Microsoft-Server-ActiveSync?Cmd=SendMail',
    method: 'POST',
    headers: {
        'Authorization': 'Basic ' + Buffer.from('thang@housevo.us:password').toString('base64'),
        'Content-Type': 'application/vnd.ms-sync.wbxml'
    }
}, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.on('data', d => console.log(d.toString()));
});

req.write(wbxmlPayload);
req.end();
